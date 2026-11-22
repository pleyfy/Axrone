import type { WidgetId } from '../types';

/**
 * Typed event names emitted by built-in controllers.
 *
 * Controllers can emit semantic events at meaningful interaction points
 * (drag start, drop, etc.). The event name is typically authored in props
 * (e.g. `onDragStart: 'handleDragBegin'`), so the runtime event name is
 * dynamic and resolved from the widget's props at emit time.
 *
 * Because event names are authored strings, the bus types all known
 * controller payloads under `ControllerEvent` and falls back to
 * `string` with `unknown` payload for extension events.
 */
export const ControllerEvent = {
    DragStart: 'dragStart',
    DragEnd: 'dragEnd',
    Drop: 'drop',
    Press: 'press',
} as const;

export type ControllerEventName = (typeof ControllerEvent)[keyof typeof ControllerEvent];

/**
 * Maps each known controller event to its payload type.
 * Extension events (dynamic authored names) use the string fallback.
 */
export interface ControllerEventMap {
    [ControllerEvent.DragStart]: DragEventPayload;
    [ControllerEvent.DragEnd]: DragEventPayload;
    [ControllerEvent.Drop]: DragEventPayload;
    [ControllerEvent.Press]: PressEventPayload;
    /** Extension events with dynamic authored names. */
    [eventName: string]: unknown;
}

export interface DragEventPayload {
    readonly x: number;
    readonly y: number;
    readonly pointerX?: number;
    readonly pointerY?: number;
    readonly cancelled?: boolean;
}

export interface PressEventPayload {
    /** Widget origin in reference pixels. */
    readonly x: number;
    readonly y: number;
    /** Pointer location for pointer presses; widget center for keyboard presses. */
    readonly pointerX: number;
    readonly pointerY: number;
}

export type ControllerEventHandler<K extends keyof ControllerEventMap = keyof ControllerEventMap> =
    (payload: ControllerEventMap[K]) => void;

/**
 * Manages controller event listeners per widget.
 *
 * Controllers emit semantic events at meaningful interaction points.
 * Listeners are called synchronously during emit. The bus iterates the
 * listener set with for..of; if a listener unsubscribes during emit,
 * removal is queued and applied after the emit loop completes.
 */
export class ControllerEventBus {
    private readonly listeners = new Map<number, Map<string, Set<ControllerEventHandler>>>();
    private pendingRemoval: Array<{ widget: number; eventName: string; handler: ControllerEventHandler }> | null = null;

    /**
     * Registers a listener for a named controller event on a widget.
     */
    on(widget: WidgetId, eventName: string, callback: ControllerEventHandler): void {
        let widgetListeners = this.listeners.get(widget);
        if (!widgetListeners) {
            widgetListeners = new Map();
            this.listeners.set(widget, widgetListeners);
        }
        let eventListeners = widgetListeners.get(eventName);
        if (!eventListeners) {
            eventListeners = new Set();
            widgetListeners.set(eventName, eventListeners);
        }
        eventListeners.add(callback);
    }

    /**
     * Removes a previously registered controller event listener.
     * If called during an emit loop, the removal is deferred until after
     * the current emit completes to avoid mutating the set mid-iteration.
     */
    off(widget: WidgetId, eventName: string, callback: ControllerEventHandler): void {
        if (this.pendingRemoval !== null) {
            this.pendingRemoval.push({ widget, eventName, handler: callback });
            return;
        }
        this.remove(widget, eventName, callback);
    }

    /**
     * Emits a named controller event for a widget. Returns true when at
     * least one listener was invoked.
     *
     * The listener set is snapshot before iteration so that listeners
     * added during emit are deferred to the next emission. Listeners
     * removed during emit are queued and applied after the loop.
     */
    emit(widget: WidgetId, eventName: string, data?: unknown): boolean {
        const widgetListeners = this.listeners.get(widget);
        if (!widgetListeners) return false;
        const eventListeners = widgetListeners.get(eventName);
        if (!eventListeners || eventListeners.size === 0) return false;

        const hadPending = this.pendingRemoval !== null;
        if (!hadPending) {
            this.pendingRemoval = [];
        }

        // Snapshot the listeners so additions during iteration are deferred.
        const snapshot = Array.from(eventListeners);
        for (const listener of snapshot) {
            if (!eventListeners.has(listener)) {
                continue;
            }
            listener(data);
        }

        if (!hadPending && this.pendingRemoval !== null) {
            for (const removal of this.pendingRemoval) {
                this.remove(removal.widget, removal.eventName, removal.handler);
            }
            this.pendingRemoval = null;
        }

        return true;
    }

    /**
     * Clears all listeners for a widget. Called when the widget is disposed.
     */
    clear(widget: WidgetId): void {
        this.listeners.delete(widget);
    }

    private remove(widget: number, eventName: string, callback: ControllerEventHandler): void {
        const widgetListeners = this.listeners.get(widget);
        if (!widgetListeners) return;
        const eventListeners = widgetListeners.get(eventName);
        if (!eventListeners) return;
        eventListeners.delete(callback);
        if (eventListeners.size === 0) {
            widgetListeners.delete(eventName);
        }
        if (widgetListeners.size === 0) {
            this.listeners.delete(widget);
        }
    }
}
