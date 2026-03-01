import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "../constants/limits";

export const sendMessageSchema = z.object({
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  type: z.enum(["text", "sticker"]),
});

export const messagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessagesQueryInput = z.infer<typeof messagesQuerySchema>;
