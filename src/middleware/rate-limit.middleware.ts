import { Request, Response, NextFunction } from "express";
import { redis } from "../db/redis";
import { AppError } from "./error.middleware";

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum number of requests allowed within the window */
  max: number;
  /** Prefix for the Redis key */
  keyPrefix: string;
}

/**
 * Redis-based sliding window rate limiter.
 *
 * Uses a sorted set per key with timestamp scores.
 * On each request:
 *   1. Remove entries outside the window (ZREMRANGEBYSCORE)
 *   2. Add the current request (ZADD)
 *   3. Count entries in the window (ZCARD)
 *   4. If count > max, reject with 429
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = req.user?.id ?? req.ip ?? "unknown";
    const key = `rl:${keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const pipeline = redis.multi();
      // Remove entries outside the current window
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Add the current request with its timestamp as score and a unique member
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      // Count the entries in the window
      pipeline.zcard(key);
      // Set expiry on the key to auto-cleanup
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();

      if (!results) {
        // Redis pipeline returned null — allow the request through
        next();
        return;
      }

      // results[2] is the ZCARD result: [error, count]
      const [cardError, count] = results[2];
      if (cardError) {
        // On Redis error, allow the request through (fail-open)
        next();
        return;
      }

      const currentCount = count as number;

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, max - currentCount));
      res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));

      if (currentCount > max) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader("Retry-After", retryAfter);

        throw new AppError(
          "RATE_LIMITED",
          429,
          "Too many requests. Please try again later.",
          { retry_after_seconds: retryAfter },
        );
      }

      next();
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      // On unexpected Redis errors, fail-open and allow the request
      next();
    }
  };
}
