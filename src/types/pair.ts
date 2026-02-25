import type { PairedUser } from "./user";

export interface Pair {
  id: string;
  paired_with: PairedUser;
  paired_at: string;
}

export interface PairingToken {
  pair_id: string;
  qr: {
    token: string;
    expires_at: string;
  };
  invite_link: {
    url: string;
    slug: string;
    expires_at: string;
  };
  code: {
    value: string;
    expires_at: string;
  };
}
