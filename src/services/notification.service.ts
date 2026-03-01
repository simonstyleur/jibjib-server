import { query } from "../db/pool";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { NotificationType, NotificationPreference } from "../types";

interface NotificationPrefRow {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  enabled: boolean;
}

interface UserPlayerRow {
  onesignal_player_id: string | null;
}

/**
 * Get all notification preferences for a user.
 */
export async function getPreferences(userId: string): Promise<NotificationPreference[]> {
  const result = await query<NotificationPrefRow>(
    `SELECT * FROM notification_preferences WHERE user_id = $1 ORDER BY notification_type`,
    [userId],
  );

  return result.rows.map((row) => ({
    type: row.notification_type,
    enabled: row.enabled,
  }));
}

/**
 * Update notification preferences for a user.
 * Accepts an array of { type, enabled } objects and updates each one.
 * Returns the full updated preference list.
 */
export async function updatePreferences(
  userId: string,
  preferences: NotificationPreference[],
): Promise<NotificationPreference[]> {
  for (const pref of preferences) {
    await query(
      `UPDATE notification_preferences
       SET enabled = $3
       WHERE user_id = $1 AND notification_type = $2`,
      [userId, pref.type, pref.enabled],
    );
  }

  return getPreferences(userId);
}

/**
 * Send a push notification to a user via OneSignal REST API.
 *
 * Checks that:
 * 1. The user has a OneSignal player ID registered
 * 2. The user has the notification type enabled in preferences
 *
 * Logs but does not throw on failure to avoid breaking calling flows.
 */
export async function sendPushNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    // Check if the user has this notification type enabled
    const prefResult = await query<NotificationPrefRow>(
      `SELECT * FROM notification_preferences
       WHERE user_id = $1 AND notification_type = $2`,
      [userId, type],
    );

    if (prefResult.rows.length > 0 && !prefResult.rows[0].enabled) {
      logger.debug({ userId, type }, "Notification type disabled by user, skipping");
      return;
    }

    // Get the user's OneSignal player ID
    const userResult = await query<UserPlayerRow>(
      `SELECT onesignal_player_id FROM users WHERE id = $1`,
      [userId],
    );

    const playerId = userResult.rows[0]?.onesignal_player_id;
    if (!playerId) {
      logger.debug({ userId }, "No OneSignal player ID for user, skipping push");
      return;
    }

    // Verify OneSignal credentials are configured
    if (!config.onesignal.appId || !config.onesignal.apiKey) {
      logger.warn("OneSignal credentials not configured, skipping push notification");
      return;
    }

    // Send via OneSignal REST API
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${config.onesignal.apiKey}`,
      },
      body: JSON.stringify({
        app_id: config.onesignal.appId,
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: body },
        data: {
          type,
          ...data,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, body: errorBody, userId, type },
        "OneSignal push notification failed",
      );
      return;
    }

    logger.debug({ userId, type }, "Push notification sent successfully");
  } catch (err) {
    logger.error({ err, userId, type }, "Failed to send push notification");
  }
}
