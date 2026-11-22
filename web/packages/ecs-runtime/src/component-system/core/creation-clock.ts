/**
 * Shared creation timestamp for bulk creation windows.
 *
 * Actor/Component construction stamps `creationTime` from `performance.now()`
 * per instance. A 50k-sprite scene pays 200k clock reads during setup; opening
 * a batch window answers every stamp inside the window from a single clock
 * read taken at window entry. Public semantics are unchanged — the field is
 * still a real timestamp; within one batch it is simply the batch's own
 * instant, matching the "created together" mental model of bulk APIs.
 */
let batchTimestamp = -1;

/** The batch-window timestamp when open, otherwise a fresh clock read. */
export const getCreationTimestamp = (): number =>
    batchTimestamp >= 0 ? batchTimestamp : performance.now();

/** True while a creation batch window is open. */
export const isCreationBatchOpen = (): boolean => batchTimestamp >= 0;

/**
 * Runs `work` with a fixed creation timestamp. Nestable: an inner window
 * re-reads the clock and restores the outer value on exit.
 */
export const runWithinCreationBatch = <T>(work: () => T): T => {
    const parentTimestamp = batchTimestamp;
    batchTimestamp = performance.now();
    try {
        return work();
    } finally {
        batchTimestamp = parentTimestamp;
    }
};
