import { mcpCall } from '@nao/shared/tools';

import { McpTableOutput, renderToModelOutput } from '../../components/tool-outputs';
import { MCP_QUERY_HANDLE_KEY } from '../../queries/mcp-call.queries';
import { McpArgsValidationError, mcpService } from '../../services/mcp';
import { McpAuthRequiredError } from '../../services/mcp-oauth';
import type { ToolContext } from '../../types/tools';
import { extractTabularResult, extractTextContent, textAroundMarkdownTable } from '../../utils/mcp-tabular-result';
import { createTool } from '../../utils/tools';

const DESCRIPTION = [
	'Call a tool exposed by a configured MCP server.',
	'',
	'MCP tools are NOT preloaded into context. Each server has a folder /agent/mcps/<server>/ with one',
	'OpenAPI JSON file per available tool (the file name is the tool name). First discover the tool you',
	'need: list the server folder, then read (or grep) the relevant tool file (use the list, read and',
	"grep tools). Then call it here: set `tool` to the operation's operationId and `arguments` to an",
	"object that matches that operation's request body schema.",
	'',
	'`arguments` are validated against that schema before the call runs. A VALIDATION_ERROR result',
	'means the arguments are malformed — read the reported issues, fix them, and call again.',
	'',
	'Some servers require the user to connect their account first. If a call returns an AUTH_REQUIRED',
	'result, stop and ask the user to connect — a Connect button is shown to them automatically.',
	'An empty server folder means its tools are not discovered yet: run `mcp_connect` on that server.',
	'',
	'When a tool returns a table, its rows are kept server-side under a query id and only a preview is',
	'shown, starting with a "Query ID: query_…" line. Reuse that id (execute_sql on the local database,',
	'read_query_result, data_files) instead of copying rows into another tool call. A result without that',
	'line was not recognised as a table and has no id: never invent one.',
].join('\n');

type McpContentBlock = { type: string; text?: string };
const MCP_AUTH_REQUIRED_MARKER = Symbol('nao.mcp.authRequired');

/** Output shape returned when the calling user must connect their account to an OAuth MCP server. */
export interface McpAuthRequiredOutput {
	mcpAuthRequired: true;
	server: string;
	[MCP_AUTH_REQUIRED_MARKER]: true;
}

/** Output shape returned when the call arguments fail schema validation before dispatch. */
export interface McpValidationErrorOutput {
	mcpValidationError: true;
	server: string;
	tool: string;
	issues: string[];
}

export const authRequiredOutput = (server: string): McpAuthRequiredOutput => ({
	mcpAuthRequired: true,
	server,
	[MCP_AUTH_REQUIRED_MARKER]: true,
});

/** Text shown to the model when the user still has to connect their account to a server. */
export const authRequiredText = (server: string): string =>
	[
		`AUTH_REQUIRED: The user has not connected their account to the MCP server "${server}".`,
		'Stop and ask the user to connect using the Connect button shown below the conversation.',
		'Do not retry this tool until they have connected.',
	].join(' ');

export const isAuthRequired = (output: unknown): output is McpAuthRequiredOutput =>
	!!output &&
	typeof output === 'object' &&
	(output as Partial<McpAuthRequiredOutput>)[MCP_AUTH_REQUIRED_MARKER] === true;

const isValidationError = (output: unknown): output is McpValidationErrorOutput =>
	!!output && typeof output === 'object' && (output as McpValidationErrorOutput).mcpValidationError === true;

/** Recorded on an MCP output whose table was kept under a query id. */
export interface McpQueryHandle {
	id: `query_${string}`;
	row_count: number;
	columns: string[];
}

/**
 * Keeps a tabular MCP result in the run's query results so later tools reach the rows by id.
 * The raw output is persisted untouched apart from the handle, which is how later turns find it.
 */
const keepTabularResult = (output: unknown, context: ToolContext): unknown => {
	const table = extractTabularResult(output);
	if (!table) {
		return output;
	}

	const id = `query_${crypto.randomUUID().slice(0, 8)}` as const;
	context.queryResults.set(id, table);

	const handle: McpQueryHandle = { id, row_count: table.data.length, columns: table.columns };
	return { ...(output as Record<string, unknown>), [MCP_QUERY_HANDLE_KEY]: handle };
};

const readQueryHandle = (output: unknown): McpQueryHandle | null => {
	const handle = (output as Record<string, unknown> | null)?.[MCP_QUERY_HANDLE_KEY] as McpQueryHandle | undefined;
	return typeof handle?.id === 'string' ? handle : null;
};

const toModelOutput = (output: unknown) => {
	const handle = readQueryHandle(output);
	const table = handle ? extractTabularResult(output) : null;
	if (handle && table) {
		const note = textAroundMarkdownTable(extractTextContent(output));
		return renderToModelOutput(McpTableOutput({ queryId: handle.id, table, note }), output);
	}
	return { type: 'text' as const, value: extractText(output) };
};

const extractText = (output: unknown): string => {
	if (isAuthRequired(output)) {
		return authRequiredText(output.server);
	}

	if (isValidationError(output)) {
		return [
			`VALIDATION_ERROR: The arguments for tool "${output.tool}" on server "${output.server}" do not match its schema:`,
			...output.issues.map((issue) => `- ${issue}`),
			`Fix the arguments to match the tool spec (/agent/mcps/${output.server}/${output.tool}.json) and call again.`,
		].join('\n');
	}

	if (typeof output === 'string') {
		return output;
	}
	if (output && typeof output === 'object') {
		const content = (output as { content?: McpContentBlock[] }).content;
		if (Array.isArray(content)) {
			const text = content
				.filter((block) => block.type === 'text' && typeof block.text === 'string')
				.map((block) => block.text)
				.join('\n');
			if (text) {
				return text;
			}
		}
	}
	return JSON.stringify(output);
};

/** Single generic tool to invoke any discovered MCP tool, optionally restricted to `allowedServers`. */
export const createMcpCallTool = (allowedServers: string[] | null) =>
	createTool<mcpCall.Input, unknown>({
		description: DESCRIPTION,
		inputSchema: mcpCall.InputSchema,
		execute: async ({ server, tool, arguments: args }, context) => {
			try {
				const output = await mcpService.callTool({
					projectId: context.projectId,
					userId: context.userId,
					server,
					tool,
					args: args ?? {},
					allowedServers,
				});
				return keepTabularResult(output, context);
			} catch (error) {
				if (error instanceof McpAuthRequiredError) {
					return authRequiredOutput(error.server);
				}
				if (error instanceof McpArgsValidationError) {
					return {
						mcpValidationError: true,
						server: error.server,
						tool: error.tool,
						issues: error.issues,
					} satisfies McpValidationErrorOutput;
				}
				throw error;
			}
		},
		toModelOutput: ({ output }) => toModelOutput(output),
	});
