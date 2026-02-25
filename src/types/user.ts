export interface User {
  id: string;
  name: string;
  avatar_url: string | null;
  language: "en" | "fr" | "ar";
  auth_provider: "anonymous" | "google" | "apple" | "facebook" | null;
  onesignal_player_id: string | null;
  created_at: string;
}

export interface PairedUser {
  id: string;
  name: string;
  avatar_url: string | null;
  is_online?: boolean;
}
