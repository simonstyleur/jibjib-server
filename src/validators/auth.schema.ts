import { z } from "zod";

export const anonymousSchema = z.object({
  name: z.string().min(1).max(100),
  language: z.enum(["en", "fr", "ar"]),
  device_id: z.string().min(1),
  device_os: z.enum(["ios", "android"]),
  app_version: z.string().min(1),
  onesignal_player_id: z.string().optional(),
});

export const socialSchema = z.object({
  provider: z.enum(["google", "apple", "facebook"]),
  id_token: z.string().min(1),
  // Apple only returns the display name on the first authorization, so the app
  // forwards it here for new-account creation. Optional (absent on later logins).
  name: z.string().min(1).max(100).optional(),
  device_id: z.string().min(1),
  device_os: z.enum(["ios", "android"]),
  app_version: z.string().min(1),
});

export const linkSchema = z.object({
  provider: z.enum(["google", "apple", "facebook"]),
  id_token: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const logoutSchema = z.object({
  refresh_token: z.string().min(1),
  device_id: z.string().min(1),
});

export type AnonymousInput = z.infer<typeof anonymousSchema>;
export type SocialInput = z.infer<typeof socialSchema>;
export type LinkInput = z.infer<typeof linkSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
