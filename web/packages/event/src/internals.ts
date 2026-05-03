import type { EventPriority, UnsubscribeFn } from './definition';

export interface EventTapContext {
    readonly phase: 'start' | 'end';
    readonly event: string;
    readonly data: unknown;
    readonly priority: EventPriority;
    readonly sync: boolean;
}

export type EventTap = (context: EventTapContext) => void;

export const EVENT_EMITTER_TAP = Symbol('axrone.event.tap');

export interface EventTapSource {
    [EVENT_EMITTER_TAP](tap: EventTap): UnsubscribeFn;
}

export function hasEventTapSupport(value: unknown): value is EventTapSource {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as EventTapSource)[EVENT_EMITTER_TAP] === 'function'
    );
}