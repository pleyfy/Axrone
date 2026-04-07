import { IGroupable } from './types';

export class TweenSystem {
    private _tweens = new Set<IGroupable>();
    private _tweensToAdd = new Set<IGroupable>();
    private _tweensToRemove = new Set<IGroupable>();
    private _isUpdating = false;
    private _autoUpdate = false;
    private _lastTime = 0;
    private _animFrameId?: number;

    setAutoUpdate(enabled: boolean): void {
        this._autoUpdate = enabled;

        if (!enabled && this._animFrameId !== undefined) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = undefined;
        }
    }

    getAutoUpdate(): boolean {
        return this._autoUpdate;
    }

    add(tween: IGroupable): void {
        if (this._isUpdating) {
            this._tweensToAdd.add(tween);
        } else {
            this._tweens.add(tween);
        }

        if (this._autoUpdate && !this._isInternalLoopRunning() && this._tweens.size > 0) {
            this._startInternalLoop();
        }
    }

    remove(tween: IGroupable): void {
        if (this._isUpdating) {
            this._tweensToRemove.add(tween);
        } else {
            this._tweens.delete(tween);
        }
    }

    update(time?: number): boolean {
        if (this._tweens.size === 0 && this._tweensToAdd.size === 0) {
            return false;
        }

        const now = time !== undefined ? time : performance.now();

        this._isUpdating = true;

        for (const tween of this._tweens) {
            tween.update(now);
        }

        this._isUpdating = false;

        if (this._tweensToRemove.size > 0) {
            for (const tween of this._tweensToRemove) {
                this._tweens.delete(tween);
            }
            this._tweensToRemove.clear();
        }

        if (this._tweensToAdd.size > 0) {
            for (const tween of this._tweensToAdd) {
                this._tweens.add(tween);
            }
            this._tweensToAdd.clear();
        }

        return this._tweens.size > 0;
    }

    getActiveTweenCount(): number {
        return this._tweens.size;
    }

    clear(): void {
        for (const tween of this._tweens) {
            tween.stop();
        }
        this._tweens.clear();
        this._tweensToAdd.clear();
        this._tweensToRemove.clear();

        if (this._animFrameId !== undefined) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = undefined;
        }
    }

    private _isInternalLoopRunning(): boolean {
        return this._animFrameId !== undefined;
    }

    private _startInternalLoop(): void {
        if (this._isInternalLoopRunning()) return;

        this._lastTime = performance.now();
        this._tick();
    }

    private _tick = (): void => {
        if (!this._autoUpdate) return;

        this._animFrameId = requestAnimationFrame(this._tick);

        const now = performance.now();
        const hasActiveTweens = this.update(now);

        if (!hasActiveTweens) {
            cancelAnimationFrame(this._animFrameId!);
            this._animFrameId = undefined;
        }
    };
}
