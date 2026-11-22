/**
 * Tracks in-flight asynchronous work so `close()` + `drain()` can provide a
 * deterministic shutdown without an `AsyncDisposable` polyfill.
 */
export class OperationTracker {
    #state: 'open' | 'closing' | 'disposed' = 'open';
    #inFlight = 0;
    #waiters: (() => void)[] = [];

    get pending(): number {
        return this.#inFlight;
    }

    get isIdle(): boolean {
        return this.#inFlight === 0;
    }

    get isOpen(): boolean {
        return this.#state === 'open';
    }

    get isDisposed(): boolean {
        return this.#state === 'disposed';
    }

    /** Starts new work. Returns false when the tracker is closing/disposed. */
    begin(): boolean {
        if (this.#state !== 'open') return false;
        this.#inFlight++;
        return true;
    }

    /** Starts shutdown work (write-back) that may run after `close()`. */
    beginShutdown(): boolean {
        if (this.#state === 'disposed') return false;
        this.#inFlight++;
        return true;
    }

    end(): void {
        if (this.#inFlight === 0) return;
        this.#inFlight--;
        if (this.#inFlight !== 0) return;
        const waiters = this.#waiters;
        this.#waiters = [];
        for (const resolve of waiters) resolve();
    }

    /** Stops accepting new foreground work. */
    close(): void {
        if (this.#state === 'open') this.#state = 'closing';
    }

    /** Stops accepting all work; pending work may still finish. */
    dispose(): void {
        this.#state = 'disposed';
        this.close();
    }

    /** Resolves when the in-flight count reaches zero. */
    drain(): Promise<void> {
        if (this.#inFlight === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            this.#waiters.push(resolve);
        });
    }
}
