import { EventFanOut, UnsubscribeFn } from './dispatcher';
import { ITimeline, IGroupable, TimelineOptions, TimelineEventMap, TweenStatus, VoidCallback } from './types';
import { nextTweenId } from './id';
import { RafLoop } from './raf-loop';

export class Timeline implements ITimeline {
    readonly id: number = nextTweenId();

    private _timelineItems: Array<{
        target: IGroupable;
        start: number;
        end: number;
        originalDuration: number;
        finished: boolean;
    }> = [];
    private _duration = 0;
    private _currentTime = 0;
    private _isPlaying = false;
    private _isPaused = false;
    private _timeScale = 1;
    private _lastUpdateTime = 0;
    private _autoUpdate = false;
    private _clockMode: 'manual' | 'realtime' | undefined;
    private _status: TweenStatus = 'idle';
    private _events = new EventFanOut<TimelineEventMap>();
    private _loop: RafLoop;

    public constructor() {
        this._loop = new RafLoop(() => {
            this.update();
            return this._isPlaying && !this._isPaused;
        });
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

    isPlaying(): boolean {
        return this._isPlaying;
    }

    getStatus(): TweenStatus {
        return this._status;
    }

    add(tween: IGroupable, options: TimelineOptions = {}): this {
        const { offset = 0, position } = options;

        const startPosition = position !== undefined ? position : this._duration + offset;
        const duration = tween.getTotalDuration();
        const endPosition = startPosition + duration;

        this._timelineItems.push({
            target: tween,
            start: startPosition,
            end: endPosition,
            originalDuration: duration,
            finished: false,
        });

        this._duration = Math.max(this._duration, endPosition);

        this._timelineItems.sort((a, b) => a.start - b.start);

        return this;
    }

    start(time?: number): this {
        if (this._isPlaying) {
            return this;
        }

        this._isPlaying = true;
        this._isPaused = false;
        this._status = 'running';
        this._clockMode = time !== undefined ? 'manual' : 'realtime';
        this._lastUpdateTime = time ?? (this._autoUpdate ? 0 : performance.now());

        for (const item of this._timelineItems) {
            item.finished = false;
            item.target.stop();
        }

        this._currentTime = 0;

        this._events.emit('start', undefined);

        if (time === undefined && this._autoUpdate) {
            this._startInternalLoop();
        }

        return this;
    }

    stop(): this {
        if (!this._isPlaying) {
            return this;
        }

        this._isPlaying = false;
        this._isPaused = false;
        this._status = 'idle';

        this._loop.stop();

        for (const item of this._timelineItems) {
            item.target.stop();
        }

        this._events.emit('stop', undefined);

        return this;
    }

    pause(): this {
        if (!this._isPlaying || this._isPaused) {
            return this;
        }

        this._isPaused = true;
        this._status = 'paused';

        this._loop.stop();

        for (const item of this._timelineItems) {
            if (item.target.isPlaying()) {
                item.target.pause();
            }
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
        if (this._clockMode !== 'manual') {
            this._lastUpdateTime = performance.now();
        }

        for (const item of this._timelineItems) {
            if (item.target.getStatus() === 'paused') {
                item.target.resume();
            }
        }

        if (this._autoUpdate) {
            this._startInternalLoop();
        }

        this._events.emit('resume', undefined);

        return this;
    }

    update(time?: number): this {
        if (!this._isPlaying || this._isPaused) return this;

        if (time !== undefined) {
            if (this._clockMode !== 'manual') {
                this._clockMode = 'manual';
                this._lastUpdateTime = 0;
            }
            this._currentTime += (time - this._lastUpdateTime) * this._timeScale;
            this._lastUpdateTime = time;
        } else {
            if (this._clockMode !== 'realtime') {
                this._clockMode = 'realtime';
                this._lastUpdateTime = performance.now();
            }

            const now = performance.now();
            const delta = (now - this._lastUpdateTime) * this._timeScale;
            this._currentTime += delta;
            this._lastUpdateTime = now;
        }

        this._events.emit('update', this._currentTime);

        this._updateItems();

        if (this._currentTime >= this._duration) {
            this._isPlaying = false;
            this._isPaused = false;
            this._status = 'completed';
            this._events.emit('complete', undefined);
            return this;
        }

        return this;
    }

    getDuration(): number {
        return this._duration;
    }

    getTotalDuration(): number {
        return this._duration;
    }

    setTimeScale(scale: number): this {
        this._timeScale = scale;
        return this;
    }

    on<K extends keyof TimelineEventMap & string>(
        event: K,
        callback: (payload: TimelineEventMap[K]) => void
    ): UnsubscribeFn {
        return this._events.on(event, callback);
    }

    off<K extends keyof TimelineEventMap & string>(
        event: K,
        callback?: (payload: TimelineEventMap[K]) => void
    ): boolean {
        return this._events.off(event, callback);
    }

    has<K extends keyof TimelineEventMap & string>(event: K): boolean {
        return this._events.has(event);
    }

    onComplete(callback: VoidCallback): this {
        this.on('complete', callback);
        return this;
    }

    onUpdate(callback: (time: number) => void): this {
        this.on('update', callback);
        return this;
    }

    dispose(): void {
        this.stop();

        this._loop.stop();

        for (const item of this._timelineItems) {
            item.target.stop();
        }
        this._timelineItems = [];
        this._duration = 0;
        this._currentTime = 0;
        this._isPlaying = false;
        this._isPaused = false;
        this._autoUpdate = false;
        this._clockMode = undefined;
        this._status = 'idle';
        this._events.clear();
    }

    private _startInternalLoop(): void {
        if (this._loop.isRunning) return;
        this._lastUpdateTime = performance.now();
        this._loop.start();
    }

    private _updateItems(): void {
        for (const item of this._timelineItems) {
            const { target, start, end } = item;

            if (item.finished) {
                if (this._currentTime < start) {
                    item.finished = false;
                } else {
                    continue;
                }
            }

            if (this._currentTime >= start && this._currentTime <= end) {
                if (!target.isPlaying()) {
                    target.start(0);
                }

                const relativeTime = this._currentTime - start;
                target.update(relativeTime);
            } else if (this._currentTime > end) {
                if (target.isPlaying()) {
                    const tweenDuration = item.originalDuration;
                    target.update(tweenDuration);
                    target.stop();
                } else if (target.getStatus() !== 'completed') {
                    target.start(0);
                    const tweenDuration = item.originalDuration;
                    target.update(tweenDuration);
                    target.stop();
                }
                item.finished = true;
            } else if (this._currentTime < start) {
                if (target.isPlaying()) {
                    target.stop();
                }
            }
        }
    }
}
