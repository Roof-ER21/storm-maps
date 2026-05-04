/**
 * Tiny in-process concurrency limiter. Used by PDF generation to cap
 * concurrent outbound HTTP fetches (Static Maps + NEXRAD WMS-T) so a
 * single PDF render can't keep 10 in-flight responses in memory at once.
 *
 *   const limit = makeLimiter(3);
 *   const results = await Promise.all(items.map((it) => limit(() => fetchOne(it))));
 *
 * Items submitted past the cap are queued FIFO and run as slots free up.
 * No external deps; ~25 lines.
 */

export type Limited<T> = () => Promise<T>;

export function makeLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (active < maxConcurrent) {
        active += 1;
        resolve();
      } else {
        queue.push(() => {
          active += 1;
          resolve();
        });
      }
    });

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return async <T>(fn: Limited<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
