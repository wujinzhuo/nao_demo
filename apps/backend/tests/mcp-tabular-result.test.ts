import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { createMcpCallTool } from '../src/agents/tools/mcp-call';
import { MCP_QUERY_HANDLE_KEY } from '../src/queries/mcp-call.queries';
import { mcpService } from '../src/services/mcp';
import type { QueryResult, ToolContext } from '../src/types/tools';
import { extractTabularResult, textAroundMarkdownTable } from '../src/utils/mcp-tabular-result';

afterEach(() => {
	vi.restoreAllMocks();
});

const textBlocks = (...texts: string[]) => ({ content: texts.map((text) => ({ type: 'text', text })) });

describe('extractTabularResult', () => {
	it('reads rows from structured content', () => {
		const result = extractTabularResult({ structuredContent: { rows: [{ a: 1 }, { a: 2 }] } });

		expect(result).toEqual({ columns: ['a'], data: [{ a: 1 }, { a: 2 }] });
	});

	it('reads a JSON array from a single text block', () => {
		const result = extractTabularResult(textBlocks(JSON.stringify([{ sku: 'X', qty: 3 }])));

		expect(result).toEqual({ columns: ['sku', 'qty'], data: [{ sku: 'X', qty: 3 }] });
	});

	it('reads a columns/rows table', () => {
		const result = extractTabularResult(textBlocks(JSON.stringify({ columns: ['a', 'b'], rows: [[1, 2]] })));

		expect(result).toEqual({ columns: ['a', 'b'], data: [{ a: 1, b: 2 }] });
	});

	it('reads one JSON object per text block', () => {
		const result = extractTabularResult(textBlocks('{"a":1}', '{"a":2,"b":3}'));

		expect(result).toEqual({ columns: ['a', 'b'], data: [{ a: 1 }, { a: 2, b: 3 }] });
	});

	it('reads a Markdown table wrapped in prose, the way bi-sales answers', () => {
		const text = [
			"表 'dwd_sales_delivery_i_d' 报表查询返回 2 条，维度: wadat_ist, kunnr",
			'SQL: `SELECT wadat_ist, kunnr, SUM(lfimg) AS qty FROM t GROUP BY 1, 2`',
			'',
			'| wadat_ist | kunnr | name1 | qty | amount_cny |',
			'| --- | --- | --- | --- | --- |',
			'| 2026-10-10 | 202796 | A \\| B Ltd |  12 | 3450.50 |',
			'| 2026-10-10 | 0012345 | C Ltd |  | -7 |',
		].join('\n');

		const result = extractTabularResult({
			...textBlocks(text),
			structuredContent: { result: text },
			isError: false,
		});

		expect(result).toEqual({
			columns: ['wadat_ist', 'kunnr', 'name1', 'qty', 'amount_cny'],
			data: [
				{ wadat_ist: '2026-10-10', kunnr: 202796, name1: 'A | B Ltd', qty: 12, amount_cny: 3450.5 },
				{ wadat_ist: '2026-10-10', kunnr: '0012345', name1: 'C Ltd', qty: null, amount_cny: -7 },
			],
		});
		expect(textAroundMarkdownTable(text)).toContain('报表查询返回 2 条');
		expect(textAroundMarkdownTable(text)).not.toContain('| ---');
	});

	it('leaves text with several Markdown tables for the model to read', () => {
		const table = '| a |\n| --- |\n| 1 |';
		expect(extractTabularResult(textBlocks(`${table}\n\n${table}`))).toBeNull();
	});

	it('ignores prose, errors and envelopes with several lists', () => {
		expect(extractTabularResult(textBlocks('Shipped 12 orders today.'))).toBeNull();
		expect(extractTabularResult({ isError: true, ...textBlocks('[{"a":1}]') })).toBeNull();
		expect(extractTabularResult(textBlocks(JSON.stringify({ x: [{ a: 1 }], y: [{ b: 2 }] })))).toBeNull();
		expect(extractTabularResult(textBlocks('[]'))).toBeNull();
	});
});

describe('mcp_call with a tabular result', () => {
	type CallableTool = {
		execute: (input: unknown, options: { experimental_context: ToolContext }) => Promise<unknown>;
		toModelOutput: (args: { output: unknown }) => { value: string };
	};

	it('keeps the rows under a query id and shows the model only a preview', async () => {
		const rows = Array.from({ length: 25 }, (_, index) => ({ order_no: `SO-${index}`, qty: index }));
		vi.spyOn(mcpService, 'callTool').mockResolvedValue(textBlocks(JSON.stringify(rows)));
		const context = { projectId: 'p', userId: 'u', queryResults: new Map<string, QueryResult>() } as ToolContext;
		const tool = createMcpCallTool(null) as unknown as CallableTool;

		const output = (await tool.execute(
			{ server: 'bi-sales', tool: 'run_report_query', arguments: {} },
			{ experimental_context: context },
		)) as Record<string, { id: string; row_count: number }>;

		const handle = output[MCP_QUERY_HANDLE_KEY]!;
		expect(handle.row_count).toBe(25);
		expect(context.queryResults.get(handle.id)?.data).toHaveLength(25);

		const modelText = tool.toModelOutput({ output }).value;
		expect(modelText).toContain(`Query ID: ${handle.id}`);
		expect(modelText).toContain('SO-9');
		expect(modelText).not.toContain('SO-10');
	});

	it('gives the model the query id and the server summary for a Markdown table, not every row', async () => {
		const body = Array.from({ length: 30 }, (_, index) => `| SO-${index} | ${index} |`);
		const text = ['查询返回 30 条', '', '| order_no | qty |', '| --- | --- |', ...body].join('\n');
		vi.spyOn(mcpService, 'callTool').mockResolvedValue(textBlocks(text));
		const context = { projectId: 'p', userId: 'u', queryResults: new Map<string, QueryResult>() } as ToolContext;
		const tool = createMcpCallTool(null) as unknown as CallableTool;

		const output = (await tool.execute(
			{ server: 'bi-sales', tool: 'run_report_query', arguments: {} },
			{ experimental_context: context },
		)) as Record<string, { id: string }>;

		const handle = output[MCP_QUERY_HANDLE_KEY]!;
		expect(context.queryResults.get(handle.id)?.data).toHaveLength(30);

		const modelText = tool.toModelOutput({ output }).value;
		expect(modelText).toContain(`Query ID: ${handle.id}`);
		expect(modelText).toContain('查询返回 30 条');
		expect(modelText).not.toContain('SO-29');
	});

	it('passes non-tabular results through unchanged', async () => {
		vi.spyOn(mcpService, 'callTool').mockResolvedValue(textBlocks('No shipments today.'));
		const context = { projectId: 'p', userId: 'u', queryResults: new Map<string, QueryResult>() } as ToolContext;
		const tool = createMcpCallTool(null) as unknown as CallableTool;

		const output = await tool.execute({ server: 's', tool: 't' }, { experimental_context: context });

		expect(context.queryResults.size).toBe(0);
		expect(tool.toModelOutput({ output }).value).toBe('No shipments today.');
	});
});
