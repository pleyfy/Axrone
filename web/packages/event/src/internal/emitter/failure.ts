import { hasEvent } from './subscriptions';
import type { EmitterHost } from './host';
import type { EventKey, EventMap } from '../../definition';
import { EventHandlerError } from '../../errors';
import { rethrowAsync } from '../utils';

export function reportAsyncError(error: unknown): void {
    rethrowAsync(error);
}

export async function handleCapturedErrorAsync<T extends EventMap>(
    host: EmitterHost<T>,
    eventName: string,
    error: unknown
): Promise<void> {
    const wrapped = error instanceof EventHandlerError ? error : new EventHandlerError(eventName, error);

    if (eventName === 'error') {
        throw wrapped;
    }

    const errorEvent = 'error' as EventKey<T>;

    if (!hasEvent(host.state, errorEvent)) {
        throw wrapped;
    }

    await host.emit(errorEvent, wrapped as T[typeof errorEvent]);
}

export function handleCapturedErrorSync<T extends EventMap>(
    host: EmitterHost<T>,
    eventName: string,
    error: EventHandlerError
): void {
    if (eventName === 'error') {
        throw error;
    }

    const errorEvent = 'error' as EventKey<T>;

    if (!hasEvent(host.state, errorEvent)) {
        throw error;
    }

    host.emitSync(errorEvent, error as T[typeof errorEvent]);
}
