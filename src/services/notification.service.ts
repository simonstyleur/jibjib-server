import { query } from "../db/pool";
import { config } from "../config";
import { logger } from "../utils/logger";
import { renderPush, PARTNER_FALLBACK, type PushTemplate, type PushLanguage } from "../i18n/push";
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
 * Send a localized push notification to a user via OneSignal REST API.
 *
 * The copy comes from a template (src/i18n/push.ts) rendered in the
 * RECIPIENT's language (users.language). `params.name` defaults to the
 * localized "Your partner" when the caller passes null/undefined.
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
  template: PushTemplate,
  params: Record<string, string | number | null | undefined>,
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

    // Verify OneSignal credentials are configured
    if (!config.onesignal.appId || !config.onesignal.apiKey) {
      logger.debug("OneSignal credentials not configured, skipping push notification");
      return;
    }

    // Render the copy in the recipient's language
    const langResult = await query<{ language: PushLanguage }>(
      `SELECT language FROM users WHERE id = $1`,
      [userId],
    );
    const language = langResult.rows[0]?.language ?? "en";
    const cleanParams: Record<string, string | number> = { };
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) cleanParams[k] = v;
    }
    if (cleanParams.name === undefined) {
      cleanParams.name = PARTNER_FALLBACK[language] ?? PARTNER_FALLBACK.en;
    }
    const { title, body } = renderPush(language, template, cleanParams);

    // Send via OneSignal REST API using external user ID
    // (frontend calls OneSignal.login(userId) to link devices)
    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${config.onesignal.apiKey}`,
      },
      body: JSON.stringify({
        app_id: config.onesignal.appId,
        target_channel: "push",
        include_aliases: { external_id: [userId] },
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
