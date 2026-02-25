export type NotificationType =
  | "items_added"
  | "item_edited"
  | "trip_started"
  | "item_message"
  | "voice_note"
  | "trip_completed"
  | "last_minute_add"
  | "pairing_invite";

export interface NotificationPreference {
  type: NotificationType;
  enabled: boolean;
}
