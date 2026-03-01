import { query } from "../pool";
import type { Message, MessageType } from "../../types";

interface MessageRow {
  id: string;
  text: string;
  type: MessageType;
  created_at: string;
  sender_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    sender: {
      id: row.sender_id,
      name: row.sender_name,
      avatar_url: row.sender_avatar_url,
    },
    created_at: row.created_at,
  };
}

/**
 * Insert a new message for an item and return it with sender info.
 */
export async function createMessage(
  itemId: string,
  senderId: string,
  text: string,
  type: MessageType,
): Promise<Message> {
  const result = await query<MessageRow>(
    `INSERT INTO messages (item_id, sender_id, text, type)
     VALUES ($1, $2, $3, $4)
     RETURNING
       id,
       text,
       type,
       created_at,
       sender_id,
       (SELECT name FROM users WHERE id = $2) AS sender_name,
       (SELECT avatar_url FROM users WHERE id = $2) AS sender_avatar_url`,
    [itemId, senderId, text, type],
  );
  return rowToMessage(result.rows[0]);
}

/**
 * Fetch messages for an item with cursor-based pagination.
 * Returns messages before the cursor (ordered newest first).
 */
export async function findMessagesByItemId(
  itemId: string,
  cursor?: string,
  limit: number = 50,
): Promise<Message[]> {
  let sql: string;
  let params: unknown[];

  if (cursor) {
    sql = `SELECT
             m.id,
             m.text,
             m.type,
             m.created_at,
             u.id AS sender_id,
             u.name AS sender_name,
             u.avatar_url AS sender_avatar_url
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.item_id = $1
             AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
           ORDER BY m.created_at DESC
           LIMIT $3`;
    params = [itemId, cursor, limit];
  } else {
    sql = `SELECT
             m.id,
             m.text,
             m.type,
             m.created_at,
             u.id AS sender_id,
             u.name AS sender_name,
             u.avatar_url AS sender_avatar_url
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.item_id = $1
           ORDER BY m.created_at DESC
           LIMIT $2`;
    params = [itemId, limit];
  }

  const result = await query<MessageRow>(sql, params);
  return result.rows.map(rowToMessage);
}

/**
 * Count messages on an item that were not sent by this user.
 * Simplified unread count: all messages from the partner.
 */
export async function countUnreadMessages(
  itemId: string,
  userId: string,
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM messages
     WHERE item_id = $1
       AND sender_id != $2`,
    [itemId, userId],
  );
  return parseInt(result.rows[0].count, 10);
}
