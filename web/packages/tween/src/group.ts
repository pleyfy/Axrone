import { TweenCore } from './core';
import { IGroupable } from './types';

export class TweenGroup {
    private _tweens = new Set<IGroupable>();
    private _pausedTweens = new Set<IGroupable>();

    add(tween: IGroupable): this {
        this._tweens.add(tween);
        return this;
    }

    remove(tween: IGroupable): this {
        this._tweens.delete(tween);
        return this;
    }

    start(time?: number): this {
        this._pausedTweens.clear();
        for (const tween of this._tweens) {
            tween.start(time);
        }
        return this;
    }

    stop(): this {
        for (const tween of this._tweens) {
            tween.stop();
        }
        this._pausedTweens.clear();
        return this;
    }

    pause(): this {
        this._pausedTweens.clear();
        for (const tween of this._tweens) {
            if (tween.isPlaying()) {
                this._pausedTweens.add(tween);
                tween.pause();
            }
        }
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
        for (const tween of this._tweens) {
            tween.update(time);
        }
        return this;
    }

    dispose(): void {
        this.stop();
        this._tweens.clear();
        this._pausedTweens.clear();
    }
}
