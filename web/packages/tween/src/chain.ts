import { IGroupable, TweenChainEventMap, TweenStatus, VoidCallback } from './types';
import { EventFanOut, UnsubscribeFn } from './dispatcher';
import { nextTweenId } from './id';

export type TweenChainEvent = keyof TweenChainEventMap & string;

/**
 * Structural completion source. `TweenCore.on` returns `this` while
 * `Timeline.on` returns an unsubscribe function; the chain accepts either
 * shape through this single interface instead of `instanceof` branches.
 */
interface CompletionSource {
    on(event: 'complete', callback: () => void): unknown;
    off?(event: 'complete', callback: () => void): unknown;
}

export class TweenChain implements IGroupable {
    readonly id: number = nextTweenId();

    private _tweens: Array<IGroupable> = [];
    private _currentIndex = -1;
    private _isPlaying = false;
    private _isPaused = false;
    private _status: TweenStatus = 'idle';
    private _detachCurrentCompletion?: () => void;
    private _lastUpdateTime?: number;
    private _events = new EventFanOut<TweenChainEventMap>();

    isPlaying(): boolean {
        return this._isPlaying;
    }

    getStatus(): TweenStatus {
        return this._status;
    }

    getTotalDuration(): number {
        return this._tweens.reduce((sum, tween) => sum + tween.getTotalDuration(), 0);
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
        this._status = 'running';
        this._lastUpdateTime = time;

        this._playCurrentTween(time);

        this._events.emit('start', undefined);

        return this;
    }

    stop(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._isPlaying = false;
        this._isPaused = false;
        this._status = 'idle';
        this._detachCurrentCompletion?.();
        this._detachCurrentCompletion = undefined;

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].stop();
        }

        this._currentIndex = -1;
        this._lastUpdateTime = undefined;

        this._events.emit('stop', undefined);
        return this;
    }

    pause(): this {
        if (!this._isPlaying || this._isPaused) {
            return this;
        }

        this._isPaused = true;
        this._status = 'paused';

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].pause();
        }

        this._events.emit('pause', undefined);

        return this;
    }

    resume(): this {
        if (!this._isPaused) {
            return this;
        }

        this._isPaused = false;
        this._status = 'running';

        if (this._currentIndex >= 0 && this._currentIndex < this._tweens.length) {
            this._tweens[this._currentIndex].resume();
        }

        this._events.emit('resume', undefined);

        return this;
    }

    update(time?: number): this {
        if (!this._isPlaying || this._isPaused || this._currentIndex < 0) {
            return this;
        }

        this._lastUpdateTime = time ?? performance.now();
        const currentTween = this._tweens[this._currentIndex];
        currentTween.update(time);

        return this;
    }

    dispose(): void {
        this.stop();
        this._detachCurrentCompletion?.();
        this._detachCurrentCompletion = undefined;
        this._tweens = [];
        this._currentIndex = -1;
        this._isPlaying = false;
        this._isPaused = false;
        this._status = 'idle';
        this._events.clear();
    }

    on(event: TweenChainEvent, callback: () => void): UnsubscribeFn {
        return this._events.on(event, callback);
    }

    off(event: TweenChainEvent, callback?: () => void): boolean {
        return this._events.off(event, callback);
    }

    has(event: TweenChainEvent): boolean {
        return this._events.has(event);
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
        const completeHandler = () => this._advanceToNextTween();

        this._detachCurrentCompletion?.();
        this._detachCurrentCompletion = this._subscribeToCompletion(currentTween, completeHandler);

        currentTween.start(time);
    }

    private _advanceToNextTween(): void {
        this._detachCurrentCompletion?.();
        this._detachCurrentCompletion = undefined;
        this._currentIndex++;

        if (this._currentIndex >= this._tweens.length) {
            this._isPlaying = false;
            this._isPaused = false;
            this._status = 'completed';
            this._events.emit('complete', undefined);
        } else {
            this._playCurrentTween(this._lastUpdateTime);
        }
    }

    private _subscribeToCompletion(target: IGroupable, callback: VoidCallback): () => void {
        const source = target as Partial<CompletionSource>;

        if (typeof source.on === 'function') {
            const subscription = (source as CompletionSource).on('complete', callback);
            if (typeof subscription === 'function') {
                return subscription as () => void;
            }

            return () => {
                source.off?.('complete', callback);
            };
        }

        return () => undefined;
    }
}
