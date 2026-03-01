import { AppError } from "../middleware/error.middleware";
import * as pairQueries from "../db/queries/pair.queries";
import * as pairingTokenQueries from "../db/queries/pairing-token.queries";
import * as listQueries from "../db/queries/list.queries";
import { generateSlug } from "../utils/slug";
import { generatePairingCode } from "../utils/pairing-code";
import {
  QR_EXPIRY_MINUTES,
  CODE_EXPIRY_MINUTES,
  INVITE_LINK_EXPIRY_HOURS,
} from "../constants/limits";
import type { PairingToken } from "../types";
import type { JoinPairingInput } from "../validators/pairing.schema";

/**
 * Build a PairingToken response object from a raw DB row.
 */
function buildPairingTokenResponse(
  row: pairingTokenQueries.PairingTokenRow,
): PairingToken {
  const qrExpiresAt = new Date(row.created_at);
  qrExpiresAt.setMinutes(qrExpiresAt.getMinutes() + QR_EXPIRY_MINUTES);

  const inviteExpiresAt = new Date(row.created_at);
  inviteExpiresAt.setHours(inviteExpiresAt.getHours() + INVITE_LINK_EXPIRY_HOURS);

  const codeExpiresAt = new Date(row.created_at);
  codeExpiresAt.setMinutes(codeExpiresAt.getMinutes() + CODE_EXPIRY_MINUTES);

  return {
    pair_id: row.pair_id,
    qr: {
      token: row.token,
      expires_at: qrExpiresAt.toISOString(),
    },
    invite_link: {
      url: `https://jibjib.app/join/${row.slug}`,
      slug: row.slug,
      expires_at: inviteExpiresAt.toISOString(),
    },
    code: {
      value: row.code,
      expires_at: codeExpiresAt.toISOString(),
    },
  };
}

/**
 * Create a new pairing for a user who is not yet paired.
 * Creates a pair, generates QR token + slug + code, and creates the default list.
 */
export async function createPairing(userId: string): Promise<PairingToken> {
  // 1. Check user is not already paired
  const existingPair = await pairQueries.findActivePairByUserId(userId);
  if (existingPair) {
    throw new AppError("ALREADY_PAIRED", 409, "You are already in a pair.");
  }

  // 2. Create pair (user_a = userId)
  const pair = await pairQueries.createPair(userId);

  // 3. Create pairing token with slug, code, QR token
  const slug = generateSlug();
  const code = generatePairingCode();

  // Expire at the longest duration (invite link = 24h)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + INVITE_LINK_EXPIRY_HOURS);

  const tokenRow = await pairingTokenQueries.createPairingToken({
    pair_id: pair.id,
    slug,
    code,
    method: "all",
    created_by: userId,
    expires_at: expiresAt,
  });

  // 4. Create default list for the pair
  await listQueries.createList(pair.id);

  // 5. Return PairingToken response
  return buildPairingTokenResponse(tokenRow);
}

/**
 * Join an existing pairing via QR token, slug, or code.
 */
export async function joinPairing(
  userId: string,
  input: JoinPairingInput,
): Promise<{ pair: pairQueries.PairRow; list: listQueries.ListRow }> {
  // 1. Find token by whichever identifier is provided
  let tokenRow: pairingTokenQueries.PairingTokenRow | null = null;

  if (input.token) {
    tokenRow = await pairingTokenQueries.findByToken(input.token);
  } else if (input.slug) {
    tokenRow = await pairingTokenQueries.findBySlug(input.slug);
  } else if (input.code) {
    tokenRow = await pairingTokenQueries.findByCode(input.code);
  }

  if (!tokenRow) {
    throw new AppError("PAIRING_NOT_FOUND", 404, "Pairing token not found or already used.");
  }

  // 2. Check not expired
  const now = new Date();
  const expiresAt = new Date(tokenRow.expires_at);

  // For QR, check QR expiry; for code, check code expiry; for slug, check invite expiry
  // Since the token stores the overall expires_at (longest = invite link), check per method
  const tokenCreatedAt = new Date(tokenRow.created_at);

  if (input.token) {
    // QR expiry
    const qrExpiry = new Date(tokenCreatedAt);
    qrExpiry.setMinutes(qrExpiry.getMinutes() + QR_EXPIRY_MINUTES);
    if (now > qrExpiry) {
      throw new AppError("PAIRING_EXPIRED", 410, "This QR code has expired.");
    }
  } else if (input.code) {
    // Code expiry
    const codeExpiry = new Date(tokenCreatedAt);
    codeExpiry.setMinutes(codeExpiry.getMinutes() + CODE_EXPIRY_MINUTES);
    if (now > codeExpiry) {
      throw new AppError("PAIRING_EXPIRED", 410, "This pairing code has expired.");
    }
  } else if (input.slug) {
    // Invite link expiry
    if (now > expiresAt) {
      throw new AppError("PAIRING_EXPIRED", 410, "This invite link has expired.");
    }
  }

  // 3. Check not already used (findBy* already filters used_at IS NULL, but double-check pair)
  const pair = await pairQueries.findPairById(tokenRow.pair_id);
  if (!pair) {
    throw new AppError("PAIRING_NOT_FOUND", 404, "Pairing not found.");
  }
  if (pair.user_b_id) {
    throw new AppError("PAIRING_USED", 409, "This pairing has already been used.");
  }

  // 4. Check user not already paired
  const existingPair = await pairQueries.findActivePairByUserId(userId);
  if (existingPair) {
    throw new AppError("ALREADY_PAIRED", 409, "You are already in a pair.");
  }

  // 5. Check user not joining own pair
  if (pair.user_a_id === userId) {
    throw new AppError("FORBIDDEN", 403, "You cannot join your own pairing.");
  }

  // 6. Complete pair (set user_b), mark token used
  const completedPair = await pairQueries.completePair(tokenRow.pair_id, userId);
  await pairingTokenQueries.markUsed(tokenRow.id, userId);

  // Revoke remaining tokens for this pair
  await pairingTokenQueries.revokeByPairId(tokenRow.pair_id);

  // 7. Return pair and list with items
  const lists = await listQueries.findListsByPairId(completedPair.id);
  const list = lists[0]; // There should be exactly one default list

  return { pair: completedPair, list };
}

/**
 * Refresh the QR/slug/code for a pending pairing.
 * Revokes old tokens and creates a new one.
 */
export async function refreshQr(userId: string): Promise<PairingToken> {
  // 1. Find active pair where this user is user_a (the creator)
  const pair = await pairQueries.findActivePairByUserId(userId);
  if (!pair) {
    throw new AppError("NOT_FOUND", 404, "No active pairing found.");
  }

  if (pair.user_b_id) {
    throw new AppError("ALREADY_PAIRED", 409, "Pairing is already complete.");
  }

  // 2. Revoke old tokens
  await pairingTokenQueries.revokeByPairId(pair.id);

  // 3. Create new token with fresh QR + slug + code
  const slug = generateSlug();
  const code = generatePairingCode();

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + INVITE_LINK_EXPIRY_HOURS);

  const tokenRow = await pairingTokenQueries.createPairingToken({
    pair_id: pair.id,
    slug,
    code,
    method: "all",
    created_by: userId,
    expires_at: expiresAt,
  });

  // 4. Return new PairingToken
  return buildPairingTokenResponse(tokenRow);
}

/**
 * Unpair (archive) the user's current pair.
 * Revokes all active tokens.
 */
export async function unpair(userId: string): Promise<{ archived_at: string }> {
  const pair = await pairQueries.findActivePairByUserId(userId);
  if (!pair) {
    throw new AppError("NOT_FOUND", 404, "No active pairing found.");
  }

  // 1. Revoke all tokens
  await pairingTokenQueries.revokeByPairId(pair.id);

  // 2. Archive the pair
  const archived = await pairQueries.archivePair(pair.id);

  return { archived_at: archived.archived_at! };
}
