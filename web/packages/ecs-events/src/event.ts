export interface EventMap {}
export type EventKey<TEvents extends EventMap> = Extract<keyof TEvents, string>;

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

type InternalEventHandler = ((data: unknown) => void | Promise<void>) & {
    __originalHandler__?: (data: unknown) => void | Promise<void>;
};

interface QueuedEvent {
    readonly event: string;
    readonly data: unknown;
}

interface MutableEventMetrics {
    emittedCount: number;
    handlerCount: number;
    queuedCount: number;
    errorCount: number;
    lastEmittedAt: number | null;
}

const createInitialMetrics = (): MutableEventMetrics => ({
    emittedCount: 0,
    handlerCount: 0,
    queuedCount: 0,
    errorCount: 0,
    lastEmittedAt: null,
});

class TypedEventEmitter<TEvents extends EventMap> implements IEventEmitter<TEvents> {
    private readonly _handlers = new Map<string, Set<InternalEventHandler>>();
    private readonly _metrics = new Map<string, MutableEventMetrics>();
    private readonly _queue: QueuedEvent[] = [];

    private _paused = false;
    private _disposed = false;
    private _drainPromise: Promise<void> | null = null;

    on<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void {
        if (this._disposed) {
            return () => {};
        }

        const eventName = event as string;
        const handlers = this._getHandlers(eventName);
        handlers.add(handler as InternalEventHandler);
        this._getMetrics(eventName).handlerCount = handlers.size;

        return () => {
            this.off(event, handler);
        };
    }

    once<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler: (data: TEvents[TEvent]) => void | Promise<void>
    ): () => void {
        let unsubscribe = () => {};
        const wrappedHandler: InternalEventHandler = (async (data: unknown) => {
            unsubscribe();
            await handler(data as TEvents[TEvent]);
        }) as InternalEventHandler;
        wrappedHandler.__originalHandler__ = handler as (data: unknown) => void | Promise<void>;
        unsubscribe = this.on(event, wrappedHandler as (data: TEvents[TEvent]) => void | Promise<void>);
        return unsubscribe;
    }

    async emit<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): Promise<boolean> {
        if (this._disposed) {
            return false;
        }

        const eventName = event as string;
        if (this._paused) {
            this._enqueueEvent(eventName, data);
            return true;
        }

        return this._dispatchAsync(eventName, data);
    }

    emitSync<TEvent extends EventKey<TEvents>>(event: TEvent, data: TEvents[TEvent]): boolean {
        if (this._disposed) {
            return false;
        }

        const eventName = event as string;
        if (this._paused) {
            this._enqueueEvent(eventName, data);
            return true;
        }

        return this._dispatchSync(eventName, data);
    }

    off<TEvent extends EventKey<TEvents>>(
        event: TEvent,
        handler?: (data: TEvents[TEvent]) => void | Promise<void>
    ): boolean {
        const eventName = event as string;
        const handlers = this._handlers.get(eventName);
        if (!handlers) {
            return false;
        }

        let removed = false;
        if (!handler) {
            removed = handlers.size > 0;
            handlers.clear();
        } else {
            for (const registeredHandler of [...handlers]) {
                if (
                    registeredHandler === handler ||
                    registeredHandler.__originalHandler__ === handler
                ) {
                    handlers.delete(registeredHandler);
                    removed = true;
                }
            }
        }

        if (handlers.size === 0) {
            this._handlers.delete(eventName);
        }

        this._getMetrics(eventName).handlerCount = handlers.size;
        return removed;
    }

    getMetrics(event: string): EventMetrics {
        const eventName = event;
        const metrics = this._getMetrics(eventName);
        metrics.handlerCount = this._handlers.get(eventName)?.size ?? 0;
        return { ...metrics };
    }

    eventNames(): string[] {
        return [...new Set([...this._handlers.keys(), ...this._metrics.keys()])];
    }

    pause(): void {
        if (!this._disposed) {
            this._paused = true;
        }
    }

    resume(): void {
        if (this._disposed) {
            return;
        }

        this._paused = false;
        if (this._queue.length > 0) {
            void this._flushQueue();
        }
    }

    drain(): Promise<void> {
        return this._flushQueue();
    }

    dispose(): void {
        this._disposed = true;
        this._paused = false;
        this._handlers.clear();
        this._queue.length = 0;
        for (const metrics of this._metrics.values()) {
            metrics.handlerCount = 0;
            metrics.queuedCount = 0;
        }
    }

    private _getHandlers(eventName: string): Set<InternalEventHandler> {
        let handlers = this._handlers.get(eventName);
        if (!handlers) {
            handlers = new Set<InternalEventHandler>();
            this._handlers.set(eventName, handlers);
        }
        return handlers;
    }

    private _getMetrics(eventName: string): MutableEventMetrics {
        let metrics = this._metrics.get(eventName);
        if (!metrics) {
            metrics = createInitialMetrics();
            this._metrics.set(eventName, metrics);
        }
        return metrics;
    }

    private _enqueueEvent(eventName: string, data: unknown): void {
        this._queue.push({ event: eventName, data });
        this._getMetrics(eventName).queuedCount += 1;
    }

    private async _dispatchAsync(eventName: string, data: unknown): Promise<boolean> {
        const handlers = [...(this._handlers.get(eventName) ?? [])];
        const metrics = this._getMetrics(eventName);
        metrics.emittedCount += 1;
        metrics.lastEmittedAt = performance.now();

        let succeeded = true;
        for (const handler of handlers) {
            try {
                await handler(data);
            } catch (error) {
                metrics.errorCount += 1;
                succeeded = false;
                console.error(`Event handler failed for ${eventName}:`, error);
            }
        }

        return succeeded;
    }

    private _dispatchSync(eventName: string, data: unknown): boolean {
        const handlers = [...(this._handlers.get(eventName) ?? [])];
        const metrics = this._getMetrics(eventName);
        metrics.emittedCount += 1;
        metrics.lastEmittedAt = performance.now();

        let succeeded = true;
        for (const handler of handlers) {
            try {
                void handler(data);
            } catch (error) {
                metrics.errorCount += 1;
                succeeded = false;
                console.error(`Event handler failed for ${eventName}:`, error);
            }
        }

        return succeeded;
    }

    private _flushQueue(): Promise<void> {
        if (this._drainPromise) {
            return this._drainPromise;
        }

        this._drainPromise = (async () => {
            while (!this._paused && this._queue.length > 0) {
                const queuedEvent = this._queue.shift()!;
                const metrics = this._getMetrics(queuedEvent.event);
                metrics.queuedCount = Math.max(0, metrics.queuedCount - 1);
                await this._dispatchAsync(queuedEvent.event, queuedEvent.data);
            }
        })().finally(() => {
            this._drainPromise = null;
        });

        return this._drainPromise;
    }
}

export const createTypedEmitter = <TEvents extends EventMap>(): IEventEmitter<TEvents> =>
    new TypedEventEmitter<TEvents>();