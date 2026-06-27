import jwt, { type JwtHeader, type SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config";
import { AppError } from "../middleware/error.middleware";

/**
 * Apple Sign-In identity-token verification.
 *
 * The mobile app sends the `identityToken` (a JWT) returned by
 * AppleAuthentication.signInAsync. We verify it against Apple's published public
 * keys (JWKS) and validate the issuer + audience before trusting the `sub`
 * claim, which is the stable per-user Apple identifier we store as auth_id.
 */

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URI = "https://appleid.apple.com/auth/keys";

const client = jwksClient({
  jwksUri: APPLE_JWKS_URI,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
  rateLimit: true,
});

function getAppleSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error("Apple signing key not found"));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

export interface AppleIdentity {
  /** Stable, app-scoped Apple user id. Use as auth_id. */
  sub: string;
  email?: string;
}

/**
 * Verify an Apple identity token. Throws AppError(401) if invalid/expired or the
 * audience doesn't match our bundle id. Resolves with the verified claims.
 */
export function verifyAppleIdentityToken(idToken: string): Promise<AppleIdentity> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getAppleSigningKey,
      {
        issuer: APPLE_ISSUER,
        audience: config.apple.bundleId,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === "string") {
          reject(new AppError("INVALID_TOKEN", 401, "Invalid Apple identity token."));
          return;
        }
        const payload = decoded as jwt.JwtPayload;
        if (!payload.sub) {
          reject(new AppError("INVALID_TOKEN", 401, "Apple token missing subject."));
          return;
        }
        resolve({
          sub: payload.sub,
          email: typeof payload.email === "string" ? payload.email : undefined,
        });
      },
    );
  });
}
