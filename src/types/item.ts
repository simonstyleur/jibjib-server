import type { PairedUser } from "./user";

export type ItemCategory =
  | "produce"
  | "dairy"
  | "meat"
  | "seafood"
  | "bakery"
  | "frozen"
  | "canned"
  | "snacks"
  | "beverages"
  | "household"
  | "personal_care"
  | "baby"
  | "pet"
  | "other";

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: string | null;
  is_checked: boolean;
  checked_by: PairedUser | null;
  checked_at: string | null;
  position: number;
  photo_urls: string[];
  voice_url: string | null;
  has_messages: boolean;
  unread_message_count: number;
  created_by: PairedUser;
  created_at: string;
  updated_at: string;
}
