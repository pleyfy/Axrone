import { reportAsyncError } from './failure';
import { ensureRuntime } from './runtime';
import type { EmitterState } from './state';
import type { EventPriority, UnsubscribeFn } from '../../definition';
import type { EventTap, EventTapContext } from '../../internals';

export function addTap(state: EmitterState, tap: EventTap): UnsubscribeFn {
    ensureRuntime(state);
    state.tapListeners.add(tap);
    return () => state.tapListeners.delete(tap);
}

export function clearTaps(state: EmitterState): void {
    state.tapListeners.clear();
}

export function emitTaps(state: EmitterState, context: EventTapContext): void {
    if (state.tapListeners.size === 0) {
        return;
    }

    for (const tap of state.tapListeners) {
        try {
            tap(context);
        } catch (error) {
            reportAsyncError(error);
        }
    }
}

export function emitTapsFor(
    state: EmitterState,
    eventName: string,
    data: unknown,
    priority: EventPriority,
    sync: boolean,
    phase: 'start' | 'end'
): void {
    if (state.tapListeners.size === 0) {
        return;
    }

    for (const tap of state.tapListeners) {
        try {
            tap({ event: eventName, data, priority, sync, phase });
        } catch (error) {
            reportAsyncError(error);
        }
    }
}
