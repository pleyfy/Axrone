/**
 * Single-owner `requestAnimationFrame` driver shared by the system,
 * timelines and springs.
 *
 * Each frame invokes `step`; a `false` return parks the loop until the next
 * `start()`. Zero allocations after construction: the frame callback is a
 * bound field, never re-created per frame. Owners keep their own semantics
 * (what a step does); this class only owns timer lifecycle.
 */
export class RafLoop {
    private _frameId?: number;
    private _running = false;
    private readonly _step: () => boolean;
    private readonly _immediate: boolean;

    public constructor(step: () => boolean, immediate = false) {
        this._step = step;
        this._immediate = immediate;
    }

    public get isRunning(): boolean {
        return this._running;
    }

    public start(): void {
        if (this._running) {
            return;
        }
        this._running = true;

        if (this._immediate) {
            this._frame();
            return;
        }
        this._frameId = requestAnimationFrame(this._frame);
    }

    public stop(): void {
        if (!this._running && this._frameId === undefined) {
            return;
        }
        this._running = false;
        if (this._frameId !== undefined) {
            cancelAnimationFrame(this._frameId);
            this._frameId = undefined;
        }
    }

    private _frame = (): void => {
        if (!this._running) {
            return;
        }

        this._frameId = undefined;
        let alive = false;
        try {
            alive = this._step();
        } finally {
            if (alive && this._running) {
                this._frameId = requestAnimationFrame(this._frame);
            } else {
                this._running = false;
            }
        }
    };
}
