import { DeepPartial } from '@axrone/utility';
import { deepCloneTweenValue } from './runtime-utils';
import { Easing, EasingFunction } from './easing-functions';
import { Interpolation } from './interpolation';
import { TweenDispatcher } from './dispatcher';
import {
    ITween,
    TweenConfig,
    TweenEventType,
    TweenEventCallback,
    TweenStatus,
} from './types';
import { nextTweenId } from './id';

export abstract class TweenCore<T> implements ITween<T> {
    readonly id: number = nextTweenId();

    protected _object: T;
    // Null-prototype maps: config keys are user-controlled (`constructor`,
    // `__proto__`), so plain `{}` would collide with the prototype chain.
    // The dictionary-mode cost is setup-only; per-frame reads go through
    // compiled tracks, never these maps.
    protected _valuesStart = Object.create(null) as DeepPartial<T>;
    protected _valuesEnd = Object.create(null) as DeepPartial<T>;
    protected _duration = 1000;
    protected _repeat = 0;
    protected _repeatDelayTime?: number;
    protected _yoyo = false;
    protected _isPlaying = false;
    protected _reversed = false;
    protected _delayTime = 0;
    protected _startTime?: number;
    protected _easingFunction: EasingFunction = Easing.Linear.None;
    protected _interpolationFunction: (v: ArrayLike<number>, k: number) => number =
        Interpolation.Linear;
    protected _chainedTweens: ITween<any>[] = [];
    protected _onStartCallbackFired = false;
    protected _remainingRepeat = 0;
    protected _dispatcher = new TweenDispatcher<T>();
    protected _status: TweenStatus = 'idle';
    protected _waitingForRepeatDelay = false;
    protected _repeatDelayEndTime?: number;
    protected _clockMode: 'manual' | 'realtime' | undefined;
    protected _lastUpdateTime?: number;
    protected _pauseStartedAt?: number;

    constructor(object: T, config?: TweenConfig<T>) {
        this._object = object;

        if (config) {
            if (config.from) this.from(config.from);
            if (config.to) this.to(config.to);
            if (config.duration !== undefined) this.duration(config.duration);
            if (config.delay !== undefined) this.delay(config.delay);
            if (config.easing) this.easing(config.easing);
            if (config.repeat !== undefined) this.repeat(config.repeat);
            if (config.yoyo !== undefined) this.yoyo(config.yoyo);
            if (config.interpolation) this.interpolation(config.interpolation);
        }
    }

    isPlaying(): boolean {
        return this._isPlaying;
    }

    getStatus(): TweenStatus {
        return this._status;
    }

    getDuration(): number {
        return this._duration;
    }

    getTotalDuration(): number {
        const cycles = this._repeat === Infinity ? Infinity : this._repeat + 1;
        if (cycles === Infinity) {
            return Infinity;
        }
        const repeatDelay = this._repeatDelayTime && this._repeatDelayTime > 0 ? this._repeatDelayTime : 0;
        const repeats = this._repeat === Infinity ? 0 : this._repeat;
        return this._duration * cycles + repeatDelay * repeats;
    }

    from(properties: DeepPartial<T>): this {
        this._valuesStart = this._deepClone(properties);
        return this;
    }

    to(properties: DeepPartial<T>, duration?: number): this {
        this._valuesEnd = this._deepClone(properties);

        if (duration !== undefined) {
            this._duration = duration;
        }

        return this;
    }

    duration(ms: number): this {
        this._duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
        return this;
    }

    start(time?: number): this {
        if (this._isPlaying) {
            return this;
        }

        this._status = 'running';
        this._isPlaying = true;
        this._onStartCallbackFired = false;
        const startTime = time !== undefined ? time : performance.now();
        this._clockMode = time !== undefined ? 'manual' : 'realtime';
        this._lastUpdateTime = startTime;
        this._pauseStartedAt = undefined;
        this._repeatDelayEndTime = undefined;
        this._waitingForRepeatDelay = false;
        this._startTime = startTime;
        this._startTime += this._delayTime;
        this._remainingRepeat = this._repeat;

        this._initStartEndValues();

        this._emit('start', this);

        return this;
    }

    stop(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._status = 'idle';
        this._isPlaying = false;

        this._emit('stop', this);

        this._stopChainedTweens();
        return this;
    }

    end(): this {
        this._remainingRepeat = 0;
        this._waitingForRepeatDelay = false;
        this._repeatDelayEndTime = undefined;
        this.update(Infinity);
        return this;
    }

    pause(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._status = 'paused';
        this._isPlaying = false;
        this._pauseStartedAt = this._lastUpdateTime ?? performance.now();

        this._emit('pause', this);

        return this;
    }

    resume(time?: number): this {
        if (this._isPlaying || this._status !== 'paused') {
            return this;
        }

        if (
            this._startTime !== undefined &&
            this._pauseStartedAt !== undefined
        ) {
            if (this._clockMode === 'manual') {
                // Manual clock: the paused span is only known when the caller
                // passes the resume time. Without it we keep following the
                // master clock (zero paused duration, backwards compatible).
                if (time !== undefined) {
                    const pausedDuration = Math.max(0, time - this._pauseStartedAt);
                    this._startTime += pausedDuration;

                    if (typeof this._repeatDelayEndTime === 'number') {
                        this._repeatDelayEndTime += pausedDuration;
                    }

                    this._lastUpdateTime = time;
                }
                this._pauseStartedAt = undefined;
            } else {
                const now = performance.now();
                const pausedDuration = Math.max(0, now - this._pauseStartedAt);
                this._startTime += pausedDuration;

                if (typeof this._repeatDelayEndTime === 'number') {
                    this._repeatDelayEndTime += pausedDuration;
                }

                this._lastUpdateTime = now;
                this._pauseStartedAt = undefined;
            }
        } else {
            this._pauseStartedAt = undefined;
        }
        this._status = 'running';
        this._isPlaying = true;

        this._emit('resume', this);

        return this;
    }

    delay(ms: number): this {
        this._delayTime = ms;
        return this;
    }

    repeat(times: number): this {
        const normalized = times === Infinity ? Infinity : Math.max(0, Math.trunc(times));
        this._repeat = normalized;
        this._remainingRepeat = normalized;
        return this;
    }

    repeatDelay(ms: number): this {
        this._repeatDelayTime = ms;
        return this;
    }

    yoyo(enable: boolean): this {
        this._yoyo = enable;
        return this;
    }

    easing(fn: EasingFunction): this {
        this._easingFunction = fn;
        return this;
    }

    interpolation(fn: (v: ArrayLike<number>, k: number) => number): this {
        this._interpolationFunction = fn;
        return this;
    }

    chain(...tweens: ITween<any>[]): this {
        this._chainedTweens.push(...tweens);
        return this;
    }

    on(event: TweenEventType, callback: TweenEventCallback<T>): this {
        if (event === 'update') {
            this._dispatcher.onUpdate(callback);
        } else {
            this._dispatcher.on(event, callback);
        }
        return this;
    }

    off(event: TweenEventType, callback?: TweenEventCallback<T>): this {
        if (event === 'update') {
            this._dispatcher.offUpdate(callback);
        } else if (callback === undefined) {
            this._dispatcher.off(event);
        } else {
            this._dispatcher.off(event, callback);
        }
        return this;
    }

    update(time?: number): this {
        if (!this._isPlaying || this._startTime === undefined) {
            return this;
        }

        const now = time !== undefined ? time : performance.now();

        if (time !== undefined) {
            this._clockMode = 'manual';
        } else if (!this._clockMode) {
            this._clockMode = 'realtime';
        }

        this._lastUpdateTime = now;

        if (now < this._startTime) {
            return this;
        }

        if (this._waitingForRepeatDelay) {
            if (!Number.isFinite(now)) {
                this._waitingForRepeatDelay = false;
                this._remainingRepeat = 0;
                this._repeatDelayEndTime = undefined;
            } else if (this._repeatDelayEndTime && now >= this._repeatDelayEndTime) {
                this._waitingForRepeatDelay = false;
                this._reset();
                this._updateProperties(0);

                if (this._repeatDelayTime && this._repeatDelayTime > 0) {
                    this._startTime = this._repeatDelayEndTime;
                } else {
                    const overtime = now - this._repeatDelayEndTime;
                    this._startTime = now - overtime;
                }

                return this;
            } else {
                return this;
            }
        }

        let elapsed =
            this._duration <= 0 ? 1 : (now - this._startTime) / this._duration;
        elapsed = elapsed > 1 ? 1 : elapsed;

        const value = this._easingFunction(elapsed);
        this._updateProperties(value);
        this._emit('update', this, elapsed);

        if (elapsed === 1) {
            if (this._remainingRepeat > 0 || this._remainingRepeat === Infinity) {
                if (isFinite(this._remainingRepeat)) {
                    this._remainingRepeat--;
                }

                this._emit('repeat', this);

                if (this._repeatDelayTime && this._repeatDelayTime > 0) {
                    this._waitingForRepeatDelay = true;
                    this._repeatDelayEndTime = now + this._repeatDelayTime;
                } else {
                    this._waitingForRepeatDelay = true;
                    this._repeatDelayEndTime = now;
                }
            } else {
                this._status = 'completed';
                this._isPlaying = false;
                this._emit('complete', this);
                this._startChainedTweens(now);
            }
        }

        return this;
    }

    dispose(): void {
        this.stop();
        this._dispatcher.clear();
        this._chainedTweens = [];
        this._valuesStart = Object.create(null);
        this._valuesEnd = Object.create(null);
        this._lastUpdateTime = undefined;
        this._pauseStartedAt = undefined;
        this._clockMode = undefined;
    }

    protected _emit(event: TweenEventType, tween?: ITween<T>, elapsed?: number): void {
        if (tween === undefined) {
            return;
        }
        this._dispatcher.emit(event, tween, elapsed);
    }

    protected abstract _initStartEndValues(): void;
    protected abstract _updateProperties(progress: number): void;
    protected abstract _reset(): void;

    protected _deepClone<U>(source: U): U {
        return deepCloneTweenValue(source);
    }

    private _startChainedTweens(time?: number): void {
        for (const tween of this._chainedTweens) {
            tween.start(time);
        }
    }

    private _stopChainedTweens(): void {
        for (const tween of this._chainedTweens) {
            tween.stop();
        }
    }
}
