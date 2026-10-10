import { executePython as schemas } from '@nao/shared/tools';
import {
	DEFAULT_PYTHON_EXECUTION_DURATION_SECS,
	MAX_PYTHON_EXECUTION_DURATION_SECS,
	MIN_PYTHON_EXECUTION_DURATION_SECS,
} from '@nao/shared/types';
import fs from 'fs';
import path from 'path';

import type { AgentSettings } from '../../types/agent-settings';
import type { QueryResult, ToolContext } from '../../types/tools';
import { isWithinProjectFolder, toVirtualPath } from '../../utils/tools';
import { createTool } from '../../utils/tools';
import { getHostFunctions, type HostFunction, HostFunctionError } from './python-host-functions';

// @pydantic/monty uses native bindings that aren't available on all platforms
// (e.g. no Linux ARM64 binary). Load lazily so the server can still start.
let montyModule: typeof import('@pydantic/monty') | null = null;
try {
	montyModule = await import('@pydantic/monty');
} catch {
	console.warn('⚠ @pydantic/monty native binding not available — execute_python tool disabled');
}

const RESOURCE_LIMITS = {
	maxDurationSecs: DEFAULT_PYTHON_EXECUTION_DURATION_SECS,
	maxMemory: 64 * 1024 * 1024, // 64 MB
	maxAllocations: 1_000_000,
	maxRecursionDepth: 500,
};

type CallableFunction = {
	paramNames: string[];
	call: (
		args: Record<string, unknown>,
	) => Promise<{ value: unknown } | { exception: { type: string; message: string } }>;
};

interface ExecutePythonOptions {
	/** Null when every configured MCP server may be called from the code. */
	allowedMcpServers: string[] | null;
	mcpEnabled: boolean;
}

/** Builds execute_python with the host functions this run may use, or null when Python is unavailable. */
export function createExecutePythonTool(options: ExecutePythonOptions) {
	if (!montyModule) {
		return null;
	}

	const hostFunctions = getHostFunctions({ mcpEnabled: options.mcpEnabled });

	return createTool<schemas.Input, schemas.Output>({
		description: buildDescription(hostFunctions, options.mcpEnabled),
		inputSchema: schemas.inputSchema,
		outputSchema: schemas.outputSchema,
		execute: async (input, context) => executePython(input, context, hostFunctions, options.allowedMcpServers),
		toModelOutput: ({ output }) => ({ type: 'text', value: formatModelOutput(output) }),
	});
}

async function executePython(
	{ code, inputs }: schemas.Input,
	context: ToolContext,
	hostFunctions: HostFunction[],
	allowedMcpServers: string[] | null,
): Promise<schemas.Output> {
	const { Monty, MontyRuntimeError, MontySnapshot, MontySyntaxError, MontyTypingError } = montyModule!;
	const inputNames = inputs ? Object.keys(inputs) : [];
	const savedResults = new Map<string, QueryResult>();
	const functions = buildCallableFunctions(context, hostFunctions, allowedMcpServers, savedResults);

	let monty: InstanceType<typeof Monty>;
	try {
		monty = new Monty(code, {
			scriptName: 'agent.py',
			inputs: inputNames,
			externalFunctions: [...functions.keys()],
		});
	} catch (err) {
		if (err instanceof MontySyntaxError) {
			throw new Error(`Python syntax error: ${err.display('type-msg')}`);
		}
		if (err instanceof MontyTypingError) {
			throw new Error(`Python type error: ${err.displayDiagnostics('full')}`);
		}
		throw err;
	}

	let state: InstanceType<typeof MontySnapshot> | InstanceType<(typeof import('@pydantic/monty'))['MontyComplete']>;

	try {
		state = monty.start({
			...(inputNames.length > 0 && { inputs }),
			limits: getResourceLimits(context.agentSettings),
		});

		while (state instanceof MontySnapshot) {
			const fn = functions.get(state.functionName);

			if (!fn) {
				state = state.resume({
					exception: { type: 'NotImplementedError', message: `Unknown function: ${state.functionName}` },
				});
				continue;
			}

			const args = collectArguments(fn.paramNames, state.args, state.kwargs);
			const result = await fn.call(args);
			state =
				'exception' in result
					? state.resume({ exception: result.exception })
					: state.resume({ returnValue: result.value });
		}
	} catch (err) {
		if (err instanceof MontyRuntimeError) {
			throw new Error(`Python runtime error: ${err.display('traceback')}`);
		}
		throw err;
	}

	return {
		output: toPlainValue(state.output),
		...(savedResults.size > 0 && { saved_results: Object.fromEntries(savedResults) }),
	};
}

function buildCallableFunctions(
	context: ToolContext,
	hostFunctions: HostFunction[],
	allowedMcpServers: string[] | null,
	savedResults: Map<string, QueryResult>,
): Map<string, CallableFunction> {
	const functions = new Map<string, CallableFunction>();
	const ctx: schemas.Ctx = { virtualFS: createVirtualFS(context.projectFolder) };

	for (const fn of schemas.EXTERNAL_FUNCTIONS) {
		functions.set(fn.name, { paramNames: fn.paramNames, call: async (args) => fn.execute(args, ctx) });
	}

	const hostContext = { toolContext: context, allowedMcpServers, savedResults };
	for (const fn of hostFunctions) {
		functions.set(fn.name, {
			paramNames: fn.paramNames,
			call: async (args) => {
				try {
					return { value: await fn.execute(args, hostContext) };
				} catch (error) {
					if (error instanceof HostFunctionError) {
						return { exception: { type: error.type, message: error.message } };
					}
					throw error;
				}
			},
		});
	}

	return functions;
}

/** Python may pass arguments by position or by keyword; dicts arrive as Maps and are made plain here. */
function collectArguments(
	paramNames: string[],
	positionalArgs: unknown[],
	keywordArgs: Record<string, unknown>,
): Record<string, unknown> {
	const args: Record<string, unknown> = Object.fromEntries(
		paramNames.map((name, index) => [name, toPlainValue(positionalArgs[index])]),
	);
	for (const [name, value] of Object.entries(keywordArgs ?? {})) {
		args[name] = toPlainValue(value);
	}
	return args;
}

function toPlainValue(value: unknown): unknown {
	if (value instanceof Map) {
		return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), toPlainValue(item)]));
	}
	if (Array.isArray(value)) {
		return value.map(toPlainValue);
	}
	return value;
}

function formatModelOutput(output: schemas.Output): string {
	const rendered = typeof output.output === 'string' ? output.output : JSON.stringify(output.output ?? null);
	const saved = Object.entries(output.saved_results ?? {}).map(
		([id, result]) => `- ${id}: ${result.data.length} rows, columns ${result.columns.join(', ')}`,
	);

	if (saved.length === 0) {
		return rendered;
	}
	return [
		rendered,
		'',
		'Rows kept server-side by save_query_result (use these ids with execute_sql on the local database, save_to, display_chart or read_query_result):',
		...saved,
	].join('\n');
}

function buildDescription(hostFunctions: HostFunction[], mcpEnabled: boolean): string {
	const hostDescriptions = hostFunctions.map((f) => `\t${f.signature}: ${f.description}`).join('\n');
	return [
		schemas.description,
		`Functions that run on the server, called like normal functions (no await):\n${hostDescriptions}.`,
		mcpEnabled
			? 'Prefer this over mcp_call when MCP rows need processing: call mcp_call from the code, transform the rows there, and return only a summary or keep the result with save_query_result. The rows never enter your context.'
			: '',
		'Only the return value of the last expression reaches you, so return a summary rather than every row. The execution time limit includes time spent waiting on these functions.',
	]
		.filter(Boolean)
		.join(' ');
}

function getResourceLimits(agentSettings: AgentSettings | null): typeof RESOURCE_LIMITS {
	return {
		...RESOURCE_LIMITS,
		maxDurationSecs: resolveMaxDurationSecs(agentSettings),
	};
}

function resolveMaxDurationSecs(agentSettings: AgentSettings | null): number {
	const value = agentSettings?.pythonExecution?.maxDurationSecs;
	if (value === undefined || !Number.isInteger(value)) {
		return DEFAULT_PYTHON_EXECUTION_DURATION_SECS;
	}
	return Math.min(MAX_PYTHON_EXECUTION_DURATION_SECS, Math.max(MIN_PYTHON_EXECUTION_DURATION_SECS, value));
}

function findAllFiles(dir: string, projectFolder: string): schemas.VirtualFile[] {
	const files: schemas.VirtualFile[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (!isWithinProjectFolder(fullPath, projectFolder)) {
				continue;
			}

			if (entry.isDirectory()) {
				files.push(...findAllFiles(fullPath, projectFolder));
			} else if (entry.isFile()) {
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const virtualPath = toVirtualPath(fullPath, projectFolder);
					files.push({ path: virtualPath, content });
				} catch {
					// Skip files that can't be read (binary files, permission issues, etc.)
				}
			}
		}
	} catch {
		// Skip directories that can't be read
	}

	return files;
}

function createVirtualFS(projectFolder: string): Map<string, string> {
	const vfs = new Map<string, string>();

	const projectFiles = findAllFiles(projectFolder, projectFolder);
	for (const file of projectFiles) {
		vfs.set(file.path, file.content);
	}

	return vfs;
}

export const isPythonAvailable = montyModule !== null;

export default createExecutePythonTool({ allowedMcpServers: null, mcpEnabled: false });
