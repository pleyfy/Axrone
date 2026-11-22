import type { ITween, TweenEventCallback, TweenEventType } from './types';

/** Detach function returned by subscriber-style `on()` methods. */
export type UnsubscribeFn = () => boolean;

/**
 * Typed fan-out for void/number-style lifecycle maps (`TimelineEventMap`,
 * `TweenChainEventMap`). One array per event, no boxing, no clocks.
 */
export class EventFanOut<TEventMap extends Record<string, unknown>> {
    private _listeners = new Map<keyof TEventMap & string, Array<(payload: never) => void>>();

    public on<K extends keyof TEventMap & string>(
        event: K,
        callback: (payload: TEventMap[K]) => void
    ): UnsubscribeFn {
        let list = this._listeners.get(event);
        if (list === undefined) {
            list = [];
            this._listeners.set(event, list);
        }
        list.push(callback as (payload: never) => void);
        return () => this.off(event, callback);
    }

    public off<K extends keyof TEventMap & string>(
        event: K,
        callback?: (payload: TEventMap[K]) => void
    ): boolean {
        const list = this._listeners.get(event);
        if (list === undefined) {
            return false;
        }
        if (callback === undefined) {
            const removed = list.length > 0;
            this._listeners.delete(event);
            return removed;
        }
        const index = list.indexOf(callback as (payload: never) => void);
        if (index < 0) {
            return false;
        }
        list.splice(index, 1);
        if (list.length === 0) {
            this._listeners.delete(event);
        }
        return true;
    }

    public has<K extends keyof TEventMap & string>(event: K): boolean {
        return (this._listeners.get(event)?.length ?? 0) > 0;
    }

    public emit<K extends keyof TEventMap & string>(event: K, payload: TEventMap[K]): void {
        const list = this._listeners.get(event);
        if (list === undefined) {
            return;
        }
        for (let index = 0; index < list.length; index += 1) {
            (list[index] as (payload: TEventMap[K]) => void)(payload);
        }
    }

    public clear(): void {
        this._listeners.clear();
    }
}

/**
 * Allocation-free event fan-out for tween lifecycles.
 *
 * Unlike the former per-tween heavyweight `EventEmitter`, this dispatcher
 * owns no buckets, indexes, meters, schedulers or timers. `update` listeners
 * are invoked positionally — no `{ tween, elapsed }` boxing — and skipped
 * through `hasUpdate` when nobody listens, so listener-less frames cost a
 * single length check.
 */
export class TweenDispatcher<T> {
    private _update: Array<TweenEventCallback<T>> = [];
    private _lifecycle = new Map<TweenEventType, Array<TweenEventCallback<T>>>();

    public onUpdate(listener: TweenEventCallback<T>): void {
        this._update.push(listener);
    }

    public offUpdate(listener?: TweenEventCallback<T>): void {
        if (listener === undefined) {
            this._update = [];
            return;
        }
        const index = this._update.indexOf(listener);
        if (index >= 0) {
            this._update.splice(index, 1);
        }
    }

    public hasUpdate(): boolean {
        return this._update.length > 0;
    }

    public emitUpdate(tween: ITween<T>, elapsed: number): void {
        const listeners = this._update;
        for (let index = 0; index < listeners.length; index += 1) {
            listeners[index]!(tween, elapsed);
        }
    }

    public on(event: TweenEventType, listener: TweenEventCallback<T>): void {
        let list = this._lifecycle.get(event);
        if (list === undefined) {
            list = [];
            this._lifecycle.set(event, list);
        }
        list.push(listener);
    }

    public off(event: TweenEventType, listener?: TweenEventCallback<T>): void {
        if (listener === undefined) {
            this._lifecycle.delete(event);
            return;
        }
        const list = this._lifecycle.get(event);
        if (list === undefined) {
            return;
        }
        const index = list.indexOf(listener);
        if (index >= 0) {
            list.splice(index, 1);
        }
        if (list.length === 0) {
            this._lifecycle.delete(event);
        }
    }

    public has(event: TweenEventType): boolean {
        return (this._lifecycle.get(event)?.length ?? 0) > 0;
    }

    public emit(event: TweenEventType, tween: ITween<T>, elapsed?: number): void {
        if (event === 'update') {
            if (this._update.length === 0) {
                return;
            }
            this.emitUpdate(tween, elapsed ?? 0);
            return;
        }
        const list = this._lifecycle.get(event);
        if (list === undefined) {
            return;
        }
        for (let index = 0; index < list.length; index += 1) {
            list[index]!(tween);
        }
    }

    public clear(): void {
        this._update = [];
        this._lifecycle.clear();
    }
}
