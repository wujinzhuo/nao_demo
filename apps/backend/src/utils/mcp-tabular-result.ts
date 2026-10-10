import type { QueryResult } from '../types/tools';

type McpContentBlock = { type?: unknown; text?: unknown };
type Row = Record<string, unknown>;

/**
 * Reads the rows out of an MCP tool result when it is a table, so they can be kept server-side
 * under a query id instead of being pasted into the model's context. Servers shape a table in
 * several ways: as structured content, as one JSON text block, or as one JSON object per block.
 */
export function extractTabularResult(output: unknown): QueryResult | null {
	if (!isPlainObject(output) || output.isError === true) {
		return null;
	}

	const rows = findRows(output.structuredContent) ?? findRowsInContent(output.content);
	return rows ? rowsToQueryResult(rows) : null;
}

/** The text blocks of an MCP tool result, joined. */
export function extractTextContent(output: unknown): string {
	if (typeof output === 'string') {
		return output;
	}
	if (!isPlainObject(output) || !Array.isArray(output.content)) {
		return '';
	}
	return (output.content as McpContentBlock[])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text as string)
		.join('\n');
}

export function rowsToQueryResult(rows: Row[]): QueryResult {
	const columns = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			columns.add(key);
		}
	}
	return { columns: [...columns], data: rows };
}

export function isPlainObject(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts a bare list of rows, a `{ columns, rows }` table, or an envelope holding exactly one list of rows. */
function findRows(value: unknown): Row[] | null {
	if (isRowList(value)) {
		return value;
	}
	if (!isPlainObject(value)) {
		return null;
	}

	const columnar = readColumnarTable(value);
	if (columnar) {
		return columnar;
	}

	const rowLists = Object.values(value).filter(isRowList);
	return rowLists.length === 1 ? rowLists[0]! : null;
}

function findRowsInContent(content: unknown): Row[] | null {
	if (!Array.isArray(content)) {
		return null;
	}

	const texts = (content as McpContentBlock[])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text as string);

	if (texts.length === 0) {
		return null;
	}
	if (texts.length === 1) {
		return findRows(tryParseJson(texts[0]!)) ?? readMarkdownTable(texts[0]!);
	}

	const parsedBlocks = texts.map(tryParseJson);
	return parsedBlocks.every(isPlainObject) ? parsedBlocks : null;
}

function readColumnarTable(value: Row): Row[] | null {
	const { columns } = value;
	const rows = value.rows ?? value.data;
	if (!isStringList(columns) || !Array.isArray(rows) || rows.length === 0 || !rows.every(Array.isArray)) {
		return null;
	}

	return rows.map((row: unknown[]) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

/**
 * Many servers render a query as prose around one Markdown table. Only a text holding exactly one
 * table is read, so an answer that compares several tables is left for the model to read whole.
 */
function readMarkdownTable(text: string): Row[] | null {
	const tables = findMarkdownTables(text);
	if (tables.length !== 1) {
		return null;
	}

	const [header, ...body] = tables[0]!;
	const columns = splitMarkdownRow(header!);
	const rows = body.map(splitMarkdownRow).filter((cells) => cells.length === columns.length);
	if (rows.length === 0) {
		return null;
	}

	return rows.map((cells) =>
		Object.fromEntries(columns.map((column, index) => [column, toCellValue(cells[index]!)])),
	);
}

/**
 * The text outside the Markdown table, e.g. a server's summary line and the SQL it ran. Empty when
 * the text holds no single Markdown table, so rows that came as JSON never leak back as prose.
 */
export function textAroundMarkdownTable(text: string): string {
	if (findMarkdownTables(text).length !== 1) {
		return '';
	}

	return text
		.split('\n')
		.filter((line) => !isMarkdownTableLine(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Each table as its header line followed by its body lines, the separator line dropped. */
function findMarkdownTables(text: string): string[][] {
	const lines = text.split('\n');
	const tables: string[][] = [];

	for (let index = 0; index < lines.length - 1; index++) {
		if (!isMarkdownTableLine(lines[index]!) || !isMarkdownSeparator(lines[index + 1]!)) {
			continue;
		}

		const table = [lines[index]!];
		let next = index + 2;
		while (next < lines.length && isMarkdownTableLine(lines[next]!)) {
			table.push(lines[next]!);
			next++;
		}
		tables.push(table);
		index = next - 1;
	}

	return tables;
}

function isMarkdownTableLine(line: string): boolean {
	return line.trim().startsWith('|');
}

function isMarkdownSeparator(line: string): boolean {
	return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?$/.test(line);
}

function splitMarkdownRow(line: string): string[] {
	const trimmed = line
		.trim()
		.replace(/^\|/, '')
		.replace(/(?<!\\)\|$/, '');
	return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

/**
 * Markdown carries no types, so a cell that reads as a plain number becomes one: amounts and
 * quantities then sum and sort as numbers. A leading zero marks a code, which stays text.
 */
function toCellValue(cell: string): unknown {
	if (cell === '') {
		return null;
	}
	if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(cell)) {
		const parsed = Number(cell);
		if (Number.isFinite(parsed) && (cell.includes('.') || Number.isSafeInteger(parsed))) {
			return parsed;
		}
	}
	return cell;
}

export function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function isRowList(value: unknown): value is Row[] {
	return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}
