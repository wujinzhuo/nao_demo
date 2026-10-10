import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

export const MCP_CALL_TOOL_NAME = 'mcp_call';

/** Key under which `mcp_call` records the query id it kept a tabular result under. */
export const MCP_QUERY_HANDLE_KEY = 'nao_query_result';

/** Raw output of the latest non-superseded `mcp_call` part whose table was kept under this query id. */
export async function getMcpCallOutputByQueryIdInChat(chatId: string, queryId: string): Promise<unknown | null> {
	const [row] = await db
		.select({ toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				eq(s.messagePart.toolName, MCP_CALL_TOOL_NAME),
				mcpQueryHandleIdEquals(queryId),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	return row?.toolOutput ?? null;
}

function mcpQueryHandleIdEquals(queryId: string) {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.messagePart.toolOutput}->${MCP_QUERY_HANDLE_KEY}->>'id' = ${queryId}`
		: sql`json_extract(${s.messagePart.toolOutput}, ${`$.${MCP_QUERY_HANDLE_KEY}.id`}) = ${queryId}`;
}
