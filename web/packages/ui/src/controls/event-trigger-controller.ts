import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext, WidgetFocusContext } from '../widget';
import { asBoolean, asNumber, asString, isPointInside } from './internals';

export const EVENT_TRIGGER_CONTROLLER_TYPE = 'event-trigger';

export type EventTriggerEventType = 'press' | 'hover' | 'focus';

export interface EventTriggerControllerProps {
    readonly triggerActive?: boolean;
    readonly eventType?: EventTriggerEventType;
    readonly onFire?: string;
    readonly oneShot?: boolean;
    readonly debounceMs?: number;
}

export interface EventTriggerControllerState {
    pressedInside: boolean;
    armed: boolean;
    lastFireAt: number;
}

type EventTriggerContext = WidgetControllerContext<
    Record<string, unknown>,
    EventTriggerControllerState,
    UIRuntime
>;

const resolveActive = (props: EventTriggerControllerProps): boolean =>
    asBoolean(props.triggerActive, true);

const resolveEventType = (props: EventTriggerControllerProps): EventTriggerEventType => {
    const raw = asString(props.eventType);
    if (raw === 'hover' || raw === 'focus') {
        return raw;
    }
    return 'press';
};

const resolveDebounceMs = (props: EventTriggerControllerProps): number => {
    const record = props as unknown as Record<string, unknown>;
    const primary = asNumber(props.debounceMs, Number.NaN);
    if (Number.isFinite(primary) && primary >= 0) {
        return primary;
    }
    const legacy = asNumber(record.debounce, Number.NaN);
    if (Number.isFinite(legacy) && legacy >= 0) {
        return legacy;
    }
    return 0;
};

const tryFire = (context: EventTriggerContext, detail: Record<string, unknown>): boolean => {
    const props = context.props as EventTriggerControllerProps;
    const state = context.state;
    if (!state.armed) {
        return false;
    }
    const name = asString(props.onFire);
    if (!name) {
        return false;
    }
    const debounceMs = resolveDebounceMs(props);
    const now = performance.now();
    if (debounceMs > 0 && now - state.lastFireAt < debounceMs) {
        return false;
    }
    state.lastFireAt = now;
    if (asBoolean(props.oneShot, false)) {
        state.armed = false;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, detail);
    return true;
};

export const eventTriggerController: WidgetController<
    typeof EVENT_TRIGGER_CONTROLLER_TYPE,
    Record<string, unknown>,
    EventTriggerControllerState,
    UIRuntime,
    unknown
> = {
    type: EVENT_TRIGGER_CONTROLLER_TYPE,
    createState: () => ({
        pressedInside: false,
        armed: true,
        lastFireAt: Number.NEGATIVE_INFINITY,
    }),
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as EventTriggerContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        const props = typed.props as EventTriggerControllerProps;
        if (!resolveActive(props)) {
            return false;
        }
        const eventType = resolveEventType(props);
        if (event.type !== 'pointer') {
            return false;
        }
        if (eventType === 'hover') {
            if (event.phase === 'enter') {
                tryFire(typed, {
                    eventType,
                    pointerX: event.x,
                    pointerY: event.y,
                });
                return true;
            }
            return false;
        }
        if (eventType === 'focus') {
            return false;
        }
        switch (event.phase) {
            case 'down': {
                const inside = isPointInside(typed.runtime, typed.widget as WidgetId, event.x, event.y);
                state.pressedInside = inside;
                return inside;
            }
            case 'up': {
                const wasPressed = state.pressedInside;
                state.pressedInside = false;
                if (!wasPressed) {
                    return false;
                }
                if (!isPointInside(typed.runtime, typed.widget as WidgetId, event.x, event.y)) {
                    return true;
                }
                const box = typed.runtime.getLayoutBox(typed.widget as WidgetId);
                tryFire(typed, {
                    eventType,
                    x: box.x,
                    y: box.y,
                    pointerX: event.x,
                    pointerY: event.y,
                });
                return true;
            }
            case 'leave': {
                state.pressedInside = false;
                return false;
            }
            default:
                return false;
        }
    },
    focus: (context) => {
        const typed = context as unknown as EventTriggerContext & { reason: WidgetFocusContext['reason'] };
        const props = typed.props as EventTriggerControllerProps;
        if (!resolveActive(props)) {
            return;
        }
        if (resolveEventType(props) !== 'focus') {
            return;
        }
        tryFire(typed as unknown as EventTriggerContext, {
            eventType: 'focus',
            reason: typed.reason,
        });
    },
    blur: (context) => {
        const typed = context as unknown as EventTriggerContext;
        const props = typed.props as EventTriggerControllerProps;
        if (!resolveActive(props)) {
            return;
        }
        typed.state.pressedInside = false;
    },
};

export const isEventTriggerArmed = (
    runtime: UIRuntime,
    widget: WidgetId
): boolean | null => {
    const state = runtime.getWidgetState(widget) as EventTriggerControllerState | null;
    return state ? state.armed : null;
};
