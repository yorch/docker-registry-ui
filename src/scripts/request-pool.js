/*
 * Bounds how many registry requests are in flight at once.
 *
 * A catalog of a thousand repositories used to fire a thousand tag-count
 * requests in one go, and a page of tags one manifest request per row. The
 * browser queues them anyway, but the registry sees the whole burst and the
 * results arrive in no useful order.
 *
 * Tasks receive a `done` callback and are expected to call it from their own
 * `loadend` handler. `Http` keeps only one handler per event, so the pool
 * cannot attach its own listener to notice completion.
 */

export const MAX_CONCURRENT_REQUESTS = 6;

export class RequestPool {
  constructor(limit = MAX_CONCURRENT_REQUESTS) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
    this.pumping = false;
  }

  // `onDrop` is how a caller learns its task will never run. A callback-style
  // caller can ignore it, but anything that turned submit() into a promise must
  // pass one: a dropped task never starts, so it never reaches the `loadend`
  // that would settle it, and the promise would stay pending for the life of
  // the page. That is what left the retention delete dialog stuck on
  // "Deleting…" when the catalog refreshed mid-delete.
  submit(task, onDrop) {
    this.queue.push({ task, onDrop });
    this.pump();
  }

  // Forget work that has not started. Callers reach for this when what they
  // queued has been superseded -- a different registry, a fresh tag list. Work
  // already on the wire is left to finish; its result gets discarded by the
  // caller's own guards.
  drop() {
    const dropped = this.queue;
    this.queue = [];
    dropped.forEach(({ onDrop }) => {
      try {
        onDrop?.();
      } catch (_e) {
        // One caller's cleanup must not stop the rest from being notified.
      }
    });
  }

  // A cache hit replays synchronously, so `done` can run inside `task(done)`
  // and re-enter here. Draining in a loop guarded by a flag keeps that from
  // recursing once per queued task, which a full catalog would turn into a
  // stack overflow.
  pump() {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (this.active < this.limit && this.queue.length > 0) {
        const { task } = this.queue.shift();
        this.active++;
        let settled = false;
        const done = () => {
          if (settled) {
            return;
          }
          settled = true;
          this.active--;
          this.pump();
        };
        try {
          task(done);
        } catch (_e) {
          // A task that throws never reaches its own loadend handler, so it
          // would hold its slot for the life of the page.
          done();
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}

// Shared by the catalog tag counts and the per-row manifest fetches, so the two
// screens compete for the same budget instead of each opening their own.
export const requestPool = new RequestPool();
