// Sliding-window in-memory rate limiter.
// Single-instance only; swap for a Redis-backed implementation when scaling
// horizontally (documented in docs/security.md).

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  // Evict expired hits.
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((windowMs - (now - oldest)) / 1000),
    };
  }
  bucket.hits.push(now);
  // Opportunistic cleanup of stale buckets to bound memory.
  if (buckets.size > 10000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

export function resetRateLimiter(): void {
  buckets.clear();
}
