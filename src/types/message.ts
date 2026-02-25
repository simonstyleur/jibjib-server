import type { PairedUser } from "./user";

export type MessageType = "text" | "sticker";

export interface Message {
  id: string;
  text: string;
  type: MessageType;
  sender: PairedUser;
  created_at: string;
}
