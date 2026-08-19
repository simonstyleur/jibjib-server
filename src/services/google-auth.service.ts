import jwt, { type JwtHeader, type SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config";
import { AppError } from "../middleware/error.middleware";

/**
 * Google Sign-In identity-token verification.
 *
 * The mobile app sends the `idToken` returned by GoogleSignin.signIn(). We verify
 * it against Google's published public keys (JWKS) and validate the issuer +
 * audience before trusting the `sub` claim, which is the stable per-user Google
 * identifier we store as auth_id. Same shape as apple-auth.service.ts.
 *
 * Two things differ from Apple and both have bitten people before:
 *
 * 1. The audience is the WEB OAuth client id, even for a native Android sign-in.
 *    The Android clients only authorise the request; the token Google mints is
 *    addressed to the web client. config.google.clientIds is therefore a list —
 *    an iOS client id joins it rather than replacing it.
 *
 * 2. Google publishes two issuer spellings for the same tokens, with and without
 *    the scheme. Accepting only one rejects perfectly valid tokens, so both are
 *    listed.
 */

const GOOGLE_ISSUERS: [string, ...string[]] = [
  "https://accounts.google.com",
  "accounts.google.com",
];
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

const client = jwksClient({
  jwksUri: GOOGLE_JWKS_URI,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
  rateLimit: true,
});

function getGoogleSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error("Google signing key not found"));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

export interface GoogleIdentity {
  /** Stable Google account id. Use as auth_id. */
  sub: string;
  email?: string;
  name?: string;
}

/**
 * Verify a Google ID token. Throws AppError(401) if invalid/expired or the
 * audience isn't one of ours. Resolves with the verified claims.
 */
export function verifyGoogleIdentityToken(idToken: string): Promise<GoogleIdentity> {
  return new Promise((resolve, reject) => {
    if (config.google.clientIds.length === 0) {
      reject(
        new AppError(
          "NOT_CONFIGURED",
          500,
          "Google sign-in is not configured on this server.",
        ),
      );
      return;
    }

    jwt.verify(
      idToken,
      getGoogleSigningKey,
      {
        issuer: GOOGLE_ISSUERS,
        // Non-empty by the guard above; jsonwebtoken's types want a tuple.
        audience: config.google.clientIds as [string, ...string[]],
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === "string") {
          reject(new AppError("INVALID_TOKEN", 401, "Invalid Google identity token."));
          return;
        }
        const payload = decoded as jwt.JwtPayload;
        if (!payload.sub) {
          reject(new AppError("INVALID_TOKEN", 401, "Google token missing subject."));
          return;
        }
        // Google will happily mint a token for an unverified address. We only use
        // email for display, never to match accounts, but refusing unverified
        // ones keeps it from being trusted by accident later.
        const emailVerified = payload.email_verified === true || payload.email_verified === "true";
        resolve({
          sub: payload.sub,
          email: emailVerified && typeof payload.email === "string" ? payload.email : undefined,
          name: typeof payload.name === "string" ? payload.name : undefined,
        });
      },
    );
  });
}
