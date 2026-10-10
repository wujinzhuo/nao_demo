import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import type { executePython } from '@nao/shared/tools';

import { createExecutePythonTool } from '../src/agents/tools/execute-python';
import { McpArgsValidationError, mcpService } from '../src/services/mcp';
import { McpAuthRequiredError } from '../src/services/mcp-oauth';
import type { QueryResult, ToolContext } from '../src/types/tools';

type RunnableTool = {
	execute: (
		input: executePython.Input,
		options: { experimental_context: ToolContext },
	) => Promise<executePython.Output>;
	toModelOutput: (args: { output: executePython.Output }) => { value: string };
	description: string;
};

const SHIPMENTS = [
	{ order_no: 'A1', sku: 'X', qty: 2 },
	{ order_no: 'A2', sku: 'Y', qty: 5 },
	{ order_no: 'A3', sku: 'X', qty: 3 },
];

let projectFolder: string;

beforeEach(async () => {
	projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-code-mode-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(projectFolder, { recursive: true, force: true });
});

describe('execute_python code mode', () => {
	it('calls an MCP tool from the code and returns only what the code computed', async () => {
		const callTool = vi
			.spyOn(mcpService, 'callTool')
			.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(SHIPMENTS) }] });

		const output = await run(
			`rows = mcp_call("bi-sales", "run_report_query", {"table_name": "shipments"})
sum(row["qty"] for row in rows)`,
		);

		expect(output.output).toBe(10);
		expect(callTool).toHaveBeenCalledWith(
			expect.objectContaining({
				server: 'bi-sales',
				tool: 'run_report_query',
				args: { table_name: 'shipments' },
				allowedServers: ['bi-sales'],
			}),
		);
	});

	it('accepts the MCP arguments as keywords', async () => {
		const callTool = vi.spyOn(mcpService, 'callTool').mockResolvedValue({ structuredContent: { rows: SHIPMENTS } });

		await run(`len(mcp_call(server="bi-sales", tool="run_report_query", arguments={"limit": 3}))`);

		expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ args: { limit: 3 } }));
	});

	it('keeps rows the code saves under a query id the other tools can reach', async () => {
		vi.spyOn(mcpService, 'callTool').mockResolvedValue({ structuredContent: SHIPMENTS });
		const context = buildContext();

		const output = await run(
			`rows = mcp_call("bi-sales", "run_report_query", {})
save_query_result([r for r in rows if r["sku"] == "X"])`,
			context,
		);

		const queryId = output.output as string;
		expect(queryId).toMatch(/^query_/);
		expect(context.queryResults.get(queryId)?.data).toEqual([SHIPMENTS[0], SHIPMENTS[2]]);
		expect(output.saved_results?.[queryId]?.columns).toEqual(['order_no', 'sku', 'qty']);
	});

	it('tells the model about saved ids without listing their rows', async () => {
		vi.spyOn(mcpService, 'callTool').mockResolvedValue({ structuredContent: SHIPMENTS });
		const tool = buildTool();
		const output = await tool.execute(
			{ code: 'save_query_result(mcp_call("bi-sales", "run_report_query", {}))' },
			{ experimental_context: buildContext() },
		);

		const text = tool.toModelOutput({ output }).value;
		expect(text).toContain('3 rows, columns order_no, sku, qty');
		expect(text).not.toContain('A2');
	});

	it('loads an earlier query result by id', async () => {
		const context = buildContext([['query_ab12', { columns: ['qty'], data: [{ qty: 4 }, { qty: 6 }] }]]);

		const output = await run('sum(r["qty"] for r in load_query_result("query_ab12"))', context);

		expect(output.output).toBe(10);
	});

	it('raises a missing query result as a Python KeyError the code can catch', async () => {
		const output = await run(`try:
    load_query_result("query_missing")
    result = "loaded"
except KeyError:
    result = "missing"
result`);

		expect(output.output).toBe('missing');
	});

	it('surfaces MCP failures as Python exceptions', async () => {
		vi.spyOn(mcpService, 'callTool').mockRejectedValueOnce(new McpAuthRequiredError('bi-sales'));
		await expect(run('mcp_call("bi-sales", "run_report_query", {})')).rejects.toThrow('AUTH_REQUIRED');

		vi.spyOn(mcpService, 'callTool').mockRejectedValueOnce(
			new McpArgsValidationError('bi-sales', 'run_report_query', ['measures is required']),
		);
		await expect(run('mcp_call("bi-sales", "run_report_query", {})')).rejects.toThrow('measures is required');

		vi.spyOn(mcpService, 'callTool').mockResolvedValueOnce({
			isError: true,
			content: [{ type: 'text', text: 'table not found' }],
		});
		await expect(run('mcp_call("bi-sales", "run_report_query", {})')).rejects.toThrow('table not found');
	});

	it('offers mcp_call only when the run has MCP servers', () => {
		const withMcp = buildTool();
		const withoutMcp = createExecutePythonTool({
			allowedMcpServers: null,
			mcpEnabled: false,
		}) as unknown as RunnableTool;

		expect(withMcp.description).toContain('mcp_call(server: str');
		expect(withoutMcp.description).not.toContain('mcp_call(server: str');
		expect(withoutMcp.description).toContain('save_query_result');
	});
});

const buildTool = (): RunnableTool =>
	createExecutePythonTool({ allowedMcpServers: ['bi-sales'], mcpEnabled: true }) as unknown as RunnableTool;

const buildContext = (queryResults: [string, QueryResult][] = []): ToolContext =>
	({
		projectId: 'proj-1',
		userId: 'user-1',
		chatId: 'chat-1',
		projectFolder,
		agentSettings: null,
		queryResults: new Map(queryResults),
	}) as unknown as ToolContext;

const run = (code: string, context: ToolContext = buildContext()) =>
	buildTool().execute({ code }, { experimental_context: context });
