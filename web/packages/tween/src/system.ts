import { RafLoop } from './raf-loop';
import { IGroupable } from './types';

export class TweenSystem {
    private _active: IGroupable[] = [];
    private _count = 0;
    private _autoUpdate = false;
    private _lastTime = 0;
    private _lastUpdateTime?: number;
    private _maxDelta?: number;
    private _loop: RafLoop;
    private _autoRemove = true;

    public constructor() {
        this._loop = new RafLoop(() => this.update());
    }

    setAutoUpdate(enabled: boolean): void {
        this._autoUpdate = enabled;

        if (!enabled) {
            this._loop.stop();
        }
    }

    getAutoUpdate(): boolean {
        return this._autoUpdate;
    }

    /**
     * Cap the timestamp jump applied in a single `update`, in the same units
     * as the driven clock. After a background-tab stall the excess is
     * discarded instead of fast-forwarding every tween to its end state.
     * `undefined` (default) preserves the legacy pass-through behavior.
     */
    setMaxDelta(maxDelta?: number): void {
        this._maxDelta = maxDelta === undefined ? undefined : Math.max(0, maxDelta);
    }

    getMaxDelta(): number | undefined {
        return this._maxDelta;
    }

    /**
     * Membership policy for finished members. The shared system evicts
     * completed tweens by default; `TweenGroup` disables eviction so members
     * survive completion and can be restarted as a unit.
     */
    setAutoRemove(enabled: boolean): void {
        this._autoRemove = enabled;
    }

    getAutoRemove(): boolean {
        return this._autoRemove;
    }

    forEach(member: (tween: IGroupable) => void): void {
        for (let index = 0; index < this._count; index += 1) {
            member(this._active[index]!);
        }
    }

    add(tween: IGroupable): void {
        if (this._active.indexOf(tween) >= 0) {
            return;
        }
        this._active[this._count] = tween;
        this._count += 1;

        if (this._autoUpdate && !this._isInternalLoopRunning() && this._count > 0) {
            this._startInternalLoop();
        }
    }

    remove(tween: IGroupable): void {
        const index = this._active.indexOf(tween);
        if (index < 0 || index >= this._count) {
            return;
        }
        this._swapAndPop(index);
    }

    update(time?: number): boolean {
        if (this._count === 0) {
            return false;
        }

        let now = time !== undefined ? time : performance.now();

        if (
            this._maxDelta !== undefined &&
            this._lastUpdateTime !== undefined &&
            now - this._lastUpdateTime > this._maxDelta
        ) {
            now = this._lastUpdateTime + this._maxDelta;
        }
        this._lastUpdateTime = now;

        for (let index = this._count - 1; index >= 0; index -= 1) {
            const tween = this._active[index]!;
            tween.update(now);

            if (this._autoRemove && tween.getStatus() === 'completed') {
                this._swapAndPop(index);
            }
        }

        return this._count > 0;
    }

    getActiveTweenCount(): number {
        return this._count;
    }

    clear(): void {
        for (let index = 0; index < this._count; index += 1) {
            this._active[index]!.stop();
            this._active[index] = undefined as unknown as IGroupable;
        }
        this._count = 0;
        this._lastUpdateTime = undefined;
        this._loop.stop();
    }

    private _swapAndPop(index: number): void {
        const last = this._count - 1;
        this._active[index] = this._active[last]!;
        this._active[last] = undefined as unknown as IGroupable;
        this._count = last;
    }

    private _isInternalLoopRunning(): boolean {
        return this._loop.isRunning;
    }

    private _startInternalLoop(): void {
        if (this._isInternalLoopRunning()) return;

        this._lastTime = performance.now();
        this._loop.start();
    }
}
