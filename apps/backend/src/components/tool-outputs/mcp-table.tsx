import { pluralize } from '@nao/shared';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';

import { Block, ListItem, Span, Title, TitledList } from '../../lib/markdown';
import type { QueryResult } from '../../types/tools';
import { QueryRows } from './query-rows';

const PREVIEW_ROWS = 10;

/** What the model sees of a table an MCP tool returned: its id, its shape and a preview, never every row. */
export const McpTableOutput = ({ queryId, table, note }: { queryId: string; table: QueryResult; note?: string }) => {
	const rowCount = table.data.length;
	const previewRows = table.data.slice(0, PREVIEW_ROWS);
	const isTruncated = rowCount > previewRows.length;

	return (
		<Block>
			<Span>Query ID: {queryId}</Span>
			{note && <Span>Server message: {note}</Span>}
			<Span>
				The MCP tool returned a table. Its rows are kept server-side under this query id
				{isTruncated ? ', so only a preview is shown here.' : '.'}
			</Span>

			<TitledList title={`${pluralize('Column', table.columns.length)} (${table.columns.length})`}>
				{table.columns.map((column, index) => (
					<ListItem key={`${column}-${index}`}>{column}</ListItem>
				))}
			</TitledList>

			<Title>
				{pluralize('Row', rowCount)} ({rowCount}){isTruncated ? ` — first ${previewRows.length} shown` : ''}
			</Title>

			<QueryRows rows={previewRows} />

			<Span>
				Work with the full result through its id instead of copying rows into another tool: execute_sql with
				database_id "{LOCAL_DATABASE_ID}" and SELECT * FROM {queryId} to filter, aggregate, join or export it
				(save_to, e.g. format xlsx for a spreadsheet), read_query_result to page through it, or data_files of
				execute_sandboxed_code when a sandbox is available. To chart it, run it through execute_sql first and
				chart that result.
			</Span>
		</Block>
	);
};
