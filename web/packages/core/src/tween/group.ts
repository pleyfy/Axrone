import { TweenCore } from './core';
import { IGroupable } from './types';

export class TweenGroup {
    private _tweens = new Set<IGroupable>();

    add(tween: IGroupable): this {
        this._tweens.add(tween);
        return this;
    }

    remove(tween: IGroupable): this {
        this._tweens.delete(tween);
        return this;
    }

    start(time?: number): this {
        for (const tween of this._tweens) {
            tween.start(time);
        }
        return this;
    }

    stop(): this {
        for (const tween of this._tweens) {
            tween.stop();
        }
        return this;
    }

    pause(): this {
        for (const tween of this._tweens) {
            if (tween.isPlaying()) {
                tween.pause();
            }
        }
        return this;
    }

    resume(): this {
        for (const tween of this._tweens) {
            if (tween instanceof TweenCore && (tween as any)._status === 'paused') {
                tween.resume();
            }
        }
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
    }
}
