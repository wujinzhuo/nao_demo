import { McpArgsValidationError, mcpService } from '../../services/mcp';
import { McpAuthRequiredError } from '../../services/mcp-oauth';
import { getQueryResult } from '../../services/query-result.service';
import type { QueryResult, ToolContext } from '../../types/tools';
import {
	extractTabularResult,
	extractTextContent,
	isPlainObject,
	rowsToQueryResult,
	tryParseJson,
} from '../../utils/mcp-tabular-result';

/**
 * Functions the Python code calls that run on the server rather than in the interpreter: they reach
 * MCP servers and query results, so data moves between them without ever passing through the
 * model's context. This is what turns execute_python into "code mode" for MCP.
 */
export interface HostFunction {
	name: string;
	signature: string;
	description: string;
	paramNames: string[];
	execute: (args: Record<string, unknown>, context: HostFunctionContext) => Promise<unknown>;
}

export interface HostFunctionContext {
	toolContext: ToolContext;
	/** Null when every configured server may be called. */
	allowedMcpServers: string[] | null;
	/** Results the code kept with save_query_result during this run. */
	savedResults: Map<string, QueryResult>;
}

/** Raised inside the interpreter as a Python exception of `type`. */
export class HostFunctionError extends Error {
	constructor(
		public type: string,
		message: string,
	) {
		super(message);
	}
}

export function getHostFunctions({ mcpEnabled }: { mcpEnabled: boolean }): HostFunction[] {
	return mcpEnabled ? [mcpCallFunction, ...queryResultFunctions] : queryResultFunctions;
}

const mcpCallFunction: HostFunction = {
	name: 'mcp_call',
	signature: 'mcp_call(server: str, tool: str, arguments: dict) -> list[dict] | dict | str',
	description:
		'Call an MCP tool from the code. A table comes back as a list of row dicts, JSON as dicts and lists, anything else as text',
	paramNames: ['server', 'tool', 'arguments'],
	execute: async ({ server, tool, arguments: args }, { toolContext, allowedMcpServers }) => {
		if (typeof server !== 'string' || typeof tool !== 'string') {
			throw new HostFunctionError('TypeError', 'mcp_call needs the server and tool names as strings');
		}
		if (args !== undefined && args !== null && !isPlainObject(args)) {
			throw new HostFunctionError('TypeError', 'mcp_call arguments must be a dict');
		}

		const output = await callMcpTool(toolContext, allowedMcpServers, server, tool, args ?? {});
		return toPythonValue(output);
	},
};

const queryResultFunctions: HostFunction[] = [
	{
		name: 'load_query_result',
		signature: 'load_query_result(query_id: str) -> list[dict]',
		description: 'Rows of an earlier query result (execute_sql, mcp_call or save_query_result), by its id',
		paramNames: ['query_id'],
		execute: async ({ query_id: queryId }, { toolContext }) => {
			if (typeof queryId !== 'string') {
				throw new HostFunctionError('TypeError', 'load_query_result needs the query id as a string');
			}
			const result = await getQueryResult(toolContext, queryId);
			if (!result) {
				throw new HostFunctionError('KeyError', `No query result with id '${queryId}' in this chat`);
			}
			return result.data;
		},
	},
	{
		name: 'save_query_result',
		signature: 'save_query_result(rows: list[dict]) -> str',
		description:
			'Keep rows server-side and get a query id for them, usable by execute_sql (local database), save_to exports, display_chart and read_query_result',
		paramNames: ['rows'],
		execute: async ({ rows }, { toolContext, savedResults }) => {
			if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
				throw new HostFunctionError('TypeError', 'save_query_result needs a list of dicts, one per row');
			}
			const id = `query_${crypto.randomUUID().slice(0, 8)}`;
			const result = rowsToQueryResult(rows);
			toolContext.queryResults.set(id, result);
			savedResults.set(id, result);
			return id;
		},
	},
];

async function callMcpTool(
	toolContext: ToolContext,
	allowedMcpServers: string[] | null,
	server: string,
	tool: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	try {
		return await mcpService.callTool({
			projectId: toolContext.projectId,
			userId: toolContext.userId,
			server,
			tool,
			args,
			allowedServers: allowedMcpServers,
		});
	} catch (error) {
		if (error instanceof McpAuthRequiredError) {
			throw new HostFunctionError(
				'RuntimeError',
				`AUTH_REQUIRED: the user has not connected their account to "${server}". Call mcp_connect on it and ask the user to connect.`,
			);
		}
		if (error instanceof McpArgsValidationError) {
			throw new HostFunctionError(
				'ValueError',
				`Arguments do not match /agent/mcps/${server}/${tool}.json: ${error.issues.join('; ')}`,
			);
		}
		throw new HostFunctionError('RuntimeError', error instanceof Error ? error.message : String(error));
	}
}

function toPythonValue(output: unknown): unknown {
	if (isPlainObject(output) && output.isError === true) {
		throw new HostFunctionError('RuntimeError', extractTextContent(output) || 'The MCP tool reported an error');
	}

	const table = extractTabularResult(output);
	if (table) {
		return table.data;
	}

	if (isPlainObject(output) && output.structuredContent !== undefined) {
		return output.structuredContent;
	}

	const text = extractTextContent(output);
	const parsed = tryParseJson(text);
	return parsed ?? text;
}
