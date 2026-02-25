export const WS_EVENTS = {
  // Server -> Client
  CONNECTED: "connected",
  PAIR_USER_ONLINE: "pair:user_online",
  PAIR_USER_OFFLINE: "pair:user_offline",
  PAIR_COMPLETED: "pair:completed",

  ITEM_ADDED: "item:added",
  ITEM_UPDATED: "item:updated",
  ITEM_CHECKED: "item:checked",
  ITEM_DELETED: "item:deleted",
  ITEM_RESTORED: "item:restored",
  ITEM_MEDIA_ADDED: "item:media_added",
  ITEM_MEDIA_REMOVED: "item:media_removed",

  MESSAGE_NEW: "message:new",
  MESSAGE_TYPING: "message:typing",
  MESSAGE_TYPING_STOPPED: "message:typing_stopped",

  TRIP_STARTED: "trip:started",
  TRIP_PROGRESS: "trip:progress",
  TRIP_ITEM_ADDED: "trip:item_added",
  TRIP_ENDED: "trip:ended",

  SYNC_CHANGES_AVAILABLE: "sync:changes_available",
  SYNC_CONFLICT: "sync:conflict",

  // Client -> Server
  ITEM_CHECK: "item:check",
  MESSAGE_SEND: "message:send",
  MESSAGE_TYPING_START: "message:typing_start",
  MESSAGE_TYPING_STOP: "message:typing_stop",
  MESSAGE_READ: "message:read",
  PRESENCE_PING: "presence:ping",
} as const;
