import { EventEmitter } from '../event/event-emitter';
import { TweenCore } from './core';
import { Timeline } from './timeline';
import { IGroupable, TweenChainEventMap, VoidCallback } from './types';

let _nextId = 0;

export class TweenChain extends EventEmitter<TweenChainEventMap> implements IGroupable {
    readonly id: number = _nextId++;

    private _tweens: Array<IGroupable> = [];
    private _currentIndex = -1;
    private _isPlaying = false;
    private _isPaused = false;

    constructor() {
        super();
    }

    isPlaying(): boolean {
        return this._isPlaying;
    }

    add(tween: IGroupable): this {
        this._tweens.push(tween);
        return this;
    }

    start(time?: number): this {
        if (this._isPlaying) {
            return this;
        }

        if (this._tweens.length === 0) {
            return this;
        }

        this._isPlaying = true;
        this._isPaused = false;
        this._currentIndex = 0;

        this._playCurrentTween(time);

        this.emitSync('start', undefined);

        return this;
    }

    stop(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._isPlaying = false;
        this._isPaused = false;

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].stop();
        }

        this._currentIndex = -1;

        this.emitSync('stop', undefined);

        return this;
    }

    pause(): this {
        if (!this._isPlaying || this._isPaused) {
            return this;
        }

        this._isPaused = true;

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].pause();
        }

        this.emitSync('pause', undefined);

        return this;
    }

    resume(): this {
        if (!this._isPaused) {
            return this;
        }

        this._isPaused = false;

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].resume();
        }

        this.emitSync('resume', undefined);

        return this;
    }

    update(time?: number): this {
        if (!this._isPlaying || this._isPaused || this._currentIndex < 0) {
            return this;
        }

        const currentTween = this._tweens[this._currentIndex];
        currentTween.update(time);

        return this;
    }

    onComplete(callback: VoidCallback): this {
        this.on('complete', callback);
        return this;
    }

    private _playCurrentTween(time?: number): void {
        if (!this._isPlaying || this._isPaused || this._currentIndex >= this._tweens.length) {
            return;
        }

        const currentTween = this._tweens[this._currentIndex];

        if (currentTween instanceof TweenCore) {
            currentTween.on('complete', () => this._advanceToNextTween(time));
        } else if (currentTween instanceof Timeline) {
            currentTween.onComplete(() => this._advanceToNextTween(time));
        }

        currentTween.start(time);
    }

    private _advanceToNextTween(time?: number): void {
        this._currentIndex++;

        if (this._currentIndex >= this._tweens.length) {
            this._isPlaying = false;
            this.emitSync('complete', undefined);
        } else {
            this._playCurrentTween(time);
        }
    }
}
