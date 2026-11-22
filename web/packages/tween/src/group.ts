import { TweenSystem } from './system';
import { IGroupable } from './types';

/**
 * Named membership over the shared system core. The group owns pause
 * bookkeeping and the restartable-member policy (`autoRemove` off); driving,
 * clamping and deferred edits come from `TweenSystem`, so the two containers
 * cannot drift apart again.
 */
export class TweenGroup {
    private _system = new TweenSystem();
    private _pausedTweens = new Set<IGroupable>();

    public constructor() {
        this._system.setAutoRemove(false);
    }

    add(tween: IGroupable): this {
        this._system.add(tween);
        return this;
    }

    remove(tween: IGroupable): this {
        this._system.remove(tween);
        return this;
    }

    start(time?: number): this {
        this._pausedTweens.clear();
        this._system.forEach((tween) => tween.start(time));
        return this;
    }

    stop(): this {
        this._system.forEach((tween) => tween.stop());
        this._pausedTweens.clear();
        return this;
    }

    pause(): this {
        this._pausedTweens.clear();
        this._system.forEach((tween) => {
            if (tween.isPlaying()) {
                this._pausedTweens.add(tween);
                tween.pause();
            }
        });
        return this;
    }

    resume(): this {
        for (const tween of this._pausedTweens) {
            tween.resume();
        }
        this._pausedTweens.clear();
        return this;
    }

    update(time?: number): this {
        this._system.update(time);
        return this;
    }

    getSize(): number {
        return this._system.getActiveTweenCount();
    }

    dispose(): void {
        this.stop();
        this._system.clear();
        this._pausedTweens.clear();
    }
}
