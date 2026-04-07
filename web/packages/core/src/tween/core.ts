import { DeepPartial } from '@axrone/utility';
import { EventEmitter } from '../event/event-emitter';
import { Easing, EasingFunction } from './easing-functions';
import { Interpolation } from './interpolation';
import {
    ITween,
    TweenConfig,
    TweenEventMap,
    TweenEventType,
    TweenEventCallback,
    TweenStatus,
} from './types';

let _nextId = 0;

export abstract class TweenCore<T> implements ITween<T> {
    readonly id: number = _nextId++;

    protected _object: T;
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
    protected _events = new EventEmitter<TweenEventMap<T>>();
    protected _status: TweenStatus = 'idle';
    protected _waitingForRepeatDelay = false;
    protected _repeatDelayEndTime?: number;

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

            if (config.autoStart) {
                setTimeout(() => this.start(), 0);
            }
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
        this._duration = ms;
        return this;
    }

    start(time?: number): this {
        if (this._isPlaying) {
            return this;
        }

        this._status = 'running';
        this._isPlaying = true;
        this._onStartCallbackFired = false;
        this._startTime = time !== undefined ? time : performance.now();
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
        this.update(Infinity);
        return this;
    }

    pause(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._status = 'paused';
        this._isPlaying = false;

        this._emit('pause', this);

        return this;
    }

    resume(): this {
        if (this._isPlaying || this._status !== 'paused') {
            return this;
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
        this._repeat = times;
        this._remainingRepeat = times;
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
        this._chainedTweens = tweens;
        return this;
    }

    on(event: TweenEventType, callback: TweenEventCallback<T>): this {
        this._events.on(event, callback as any);
        return this;
    }

    off(event: TweenEventType, callback?: TweenEventCallback<T>): this {
        this._events.off(event, callback as any);
        return this;
    }

    update(time?: number): this {
        if (!this._isPlaying || this._startTime === undefined) {
            return this;
        }

        const now = time !== undefined ? time : performance.now();

        if (now < this._startTime) {
            return this;
        }

        if (this._waitingForRepeatDelay) {
            if (this._repeatDelayEndTime && now >= this._repeatDelayEndTime) {
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

        let elapsed = (now - this._startTime) / this._duration;
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
        this._events.dispose();
        this._chainedTweens = [];
        this._valuesStart = Object.create(null);
        this._valuesEnd = Object.create(null);
    }

    protected _emit(event: TweenEventType, ...args: any[]): void {
        this._events.emitSync(event, args[0]);
    }

    protected abstract _initStartEndValues(): void;
    protected abstract _updateProperties(progress: number): void;
    protected abstract _reset(): void;
    protected abstract _deepClone<U>(source: U): U;

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
