import {
    createTypedEmitter as createBaseTypedEmitter,
    type EventKey,
    type EventMap,
    type IEventEmitter as BaseEventEmitter,
} from '@axrone/event';

export type { EventKey, EventMap };

export interface EventMetrics {
    readonly emittedCount: number;
    readonly handlerCount: number;
    readonly queuedCount: number;
    readonly errorCount: number;
    readonly lastEmittedAt: number | null;
}

export interface IEventEmitter<TEvents extends EventMap> {
    on<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void;
    once<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void;
    emit<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): Promise<boolean>;
    emitSync<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): boolean;
    off<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler?: (data: TEvents[TEvent]) => void | Promise<void>
    ): boolean;
    getMetrics(event: string): EventMetrics;
    eventNames(): string[];
    pause(): void;
    resume(): void;
    drain(): Promise<void>;
    dispose(): void;
}

class TypedEventEmitterAdapter<TEvents extends EventMap> implements IEventEmitter<TEvents> {
    private readonly _emitter: BaseEventEmitter<TEvents> = createBaseTypedEmitter<TEvents>();
    private readonly _trackedEvents = new Set<string>();
    private readonly _lastEmittedAt = new Map<string, number>();
    private _disposed = false;

    on<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void {
        if (this._disposed) {
            return () => {};
        }

        const eventName = String(event);
        this._trackedEvents.add(eventName);
        const unsubscribe = this._emitter.on(event, handler);
        return () => {
            unsubscribe();
        };
    }

    once<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void {
        if (this._disposed) {
            return () => {};
        }

        const eventName = String(event);
        this._trackedEvents.add(eventName);
        const unsubscribe = this._emitter.once(event, handler);
        return () => {
            unsubscribe();
        };
    }

    async emit<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): Promise<boolean> {
        if (this._disposed) {
            return false;
        }

        const eventName = String(event);
        this._trackedEvents.add(eventName);
        const wasPaused = this._emitter.isPaused();
        const result = await this._emitter.emit(event, data);

        if (!wasPaused) {
            this._lastEmittedAt.set(eventName, performance.now());
        }

        return result;
    }

    emitSync<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): boolean {
        if (this._disposed) {
            return false;
        }

        const eventName = String(event);
        this._trackedEvents.add(eventName);
        const wasPaused = this._emitter.isPaused();
        const result = this._emitter.emitSync(event, data);

        if (!wasPaused) {
            this._lastEmittedAt.set(eventName, performance.now());
        }

        return result;
    }

    off<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler?: (data: TEvents[TEvent]) => void | Promise<void>
    ): boolean {
        if (this._disposed) {
            return false;
        }

        this._trackedEvents.add(String(event));
        return this._emitter.off(event, handler);
    }

    getMetrics(event: string): EventMetrics {
        this._trackedEvents.add(event);

        const eventKey = event as EventKey<TEvents>;
        const metrics = this._emitter.getMetrics(eventKey);
        const queuedCount = this._emitter.getPendingCount(eventKey);

        return {
            emittedCount: Math.max(0, metrics.emit.count - queuedCount),
            handlerCount: this._emitter.listenerCount(eventKey),
            queuedCount,
            errorCount: metrics.execution.errors,
            lastEmittedAt: this._lastEmittedAt.get(event) ?? null,
        };
    }

    eventNames(): string[] {
        const eventNames = new Set<string>(this._trackedEvents);

        for (const eventName of this._emitter.eventNames()) {
            eventNames.add(String(eventName));
        }

        return [...eventNames];
    }

    pause(): void {
        if (!this._disposed) {
            this._emitter.pause();
        }
    }

    resume(): void {
        if (!this._disposed) {
            this._emitter.resume();
        }
    }

    drain(): Promise<void> {
        if (this._disposed) {
            return Promise.resolve();
        }

        return this._emitter.drain();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._emitter.dispose();
        this._trackedEvents.clear();
        this._lastEmittedAt.clear();
    }
}

export const createTypedEmitter = <TEvents extends EventMap>(): IEventEmitter<TEvents> =>
    new TypedEventEmitterAdapter<TEvents>();