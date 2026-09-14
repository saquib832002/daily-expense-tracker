/**
 * A way back to the welcome screen.
 *
 * This exists because of a bug that took three attempts to pin down, and the
 * shape of the bug is worth remembering: the first-run screen was reachable
 * only by a condition — an unset flag on a ledger with no entries — and when
 * that condition silently failed there was **no way at all** to reach the
 * screen and no way to tell whether the build even contained it. Uninstalling
 * did not prove anything, because the same guess about what "fresh" means was
 * doing the deciding both times.
 *
 * So the screen now has a door as well as a condition. Tapping *Set up again*
 * in More opens it on demand, which makes it testable in five seconds, and
 * gives a real user the only way to revisit the two questions it asks.
 *
 * The flag lives in the database; this module is only the nudge that tells the
 * root layout to look again without waiting for a restart.
 */
const listeners = new Set<() => void>();

/** Ask the root layout to show the welcome screen now. */
export function requestFirstRun(): void {
  listeners.forEach((fn) => fn());
}

/** Root layout only. Returns the unsubscribe function. */
export function onFirstRunRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
