import { logger } from "../utils/logger";

interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  created_at: string;
}

/**
 * Send a support message to a Telegram chat.
 * Currently a stub — logs the message instead of calling the Telegram API.
 * Actual Telegram Bot API integration is deferred to a future milestone.
 */
export async function sendSupportMessage(
  chatId: string,
  message: string,
): Promise<void> {
  logger.info(
    { chatId, messageLength: message.length },
    "Telegram sendSupportMessage (stub): would send message to chat",
  );
}

/**
 * Notify a Telegram channel/chat about a new support ticket.
 * Currently a stub — logs the ticket details instead of calling the Telegram API.
 * Actual Telegram Bot API integration is deferred to a future milestone.
 */
export async function notifyNewTicket(ticket: SupportTicket): Promise<void> {
  logger.info(
    { ticketId: ticket.id, userId: ticket.user_id, subject: ticket.subject },
    "Telegram notifyNewTicket (stub): would notify about new support ticket",
  );
}
