import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { QueryResult } from '../types/tools';

export const EXECUTE_PYTHON_TOOL_NAME = 'execute_python';

/** Only ids nao generates are looked up, so the id is always safe to place in a JSON path. */
const SAVED_RESULT_ID_PATTERN = /^query_[A-Za-z0-9_-]+$/;

/** Rows an `execute_python` run kept with save_query_result under this query id, from the latest non-superseded part. */
export async function getPythonSavedResultInChat(chatId: string, queryId: string): Promise<QueryResult | null> {
	if (!SAVED_RESULT_ID_PATTERN.test(queryId)) {
		return null;
	}

	const [row] = await db
		.select({ toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				eq(s.messagePart.toolName, EXECUTE_PYTHON_TOOL_NAME),
				savedResultExists(queryId),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	const saved = (row?.toolOutput as { saved_results?: Record<string, QueryResult> } | null)?.saved_results?.[queryId];
	return saved && Array.isArray(saved.columns) && Array.isArray(saved.data) ? saved : null;
}

function savedResultExists(queryId: string) {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.messagePart.toolOutput}->'saved_results'->${queryId} is not null`
		: sql`json_extract(${s.messagePart.toolOutput}, ${`$.saved_results."${queryId}"`}) is not null`;
}
