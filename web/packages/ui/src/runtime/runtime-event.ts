import { mapViewportPointToCanvas, resolveCanvasScale } from '../layout/canvas-scaler';
import type {
    FocusMoveDirection,
    LayoutBox,
    ResolvedLayout,
    ResolvedWidgetStyle,
    UICanvasConfig,
    UIInputEvent,
    UIPointerEvent,
    WidgetEventContext,
    WidgetFocusChangeEvent,
    WidgetId,
} from '../types';
import type { FocusController } from './focus-controller';
import { intersectRect, intersectsPoint } from './internals';
import { NodeFlag } from './node-flags';
import type { StoredWidgetRecord } from './records';
import type { RuntimeControllerResolver, RuntimePointerState } from './runtime-host';
import {
    dispatchKeyEvent,
    dispatchPointerEvent,
    dispatchTextEvent,
    type UIInputDispatchHost,
} from './runtime-input';
import { isVisible } from './runtime-tree';

export interface RuntimeInputSourceHost<TRuntime = unknown> extends RuntimePointerState {
    readonly rootId: WidgetId;
    readonly flags: Uint32Array;
    readonly parent: Int32Array;
    readonly firstChild: Int32Array;
    readonly nextSibling: Int32Array;
    readonly depth: Uint16Array;
    readonly sequence: Uint32Array;
    readonly styles: Array<ResolvedWidgetStyle | null>;
    readonly layouts: Array<ResolvedLayout | null>;
    readonly records: Array<StoredWidgetRecord<TRuntime> | null>;
    readonly states: unknown[];
    readonly focusController: FocusController;
    readonly registry: RuntimeControllerResolver;
    getRuntime(): TRuntime;
    isFocusable(index: number): boolean;
    readBox(index: number): LayoutBox;
    hitTest(x: number, y: number): WidgetId | null;
    updateHover(target: WidgetId | null, event: Readonly<UIPointerEvent>): void;
    bubbleEvent(index: number, event: Readonly<UIInputEvent>): boolean;
    setFocus(widget: WidgetId | null, reason: WidgetFocusChangeEvent['reason']): boolean;
    moveFocus(direction: FocusMoveDirection): WidgetId | null;
}

export interface RuntimeEventHost<TRuntime = unknown> extends RuntimeInputSourceHost<TRuntime> {
    readonly inputHost: UIInputDispatchHost;
}

export interface RuntimeViewportInputHost<TRuntime = unknown> extends RuntimeEventHost<TRuntime> {
    readonly canvasConfig: UICanvasConfig | null;
    lastViewport: { readonly width: number; readonly height: number } | null;
}

export function createInputHost<TRuntime>(host: RuntimeInputSourceHost<TRuntime>): UIInputDispatchHost {
    return {
        getPressed: () => host.getPressed(),
        setPressed: (widget) => {
            host.setPressed(widget);
        },
        getFocused: () => host.focusController.getFocused(),
        hitTest: (x, y) => host.hitTest(x, y),
        updateHover: (target, event) => host.updateHover(target, event),
        bubbleEvent: (index, event) => host.bubbleEvent(index, event),
        isFocusable: (index) => host.isFocusable(index),
        setFocus: (widget, reason) => host.setFocus(widget, reason),
        moveFocus: (direction) => host.moveFocus(direction),
    };
}

export function dispatchInput<TRuntime>(
    host: RuntimeEventHost<TRuntime>,
    event: Readonly<UIInputEvent>
): boolean {
    switch (event.type) {
        case 'pointer':
            return dispatchPointerEvent(host.inputHost, event);
        case 'key':
            return dispatchKeyEvent(host.inputHost, event);
        case 'text':
            return dispatchTextEvent(host.inputHost, event);
        case 'focus':
            if (!event.focused && host.focusController.getFocused()) {
                host.setFocus(null, 'window');
            }
            return false;
        default:
            return false;
    }
}

export function dispatchViewportInput<TRuntime>(
    host: RuntimeViewportInputHost<TRuntime>,
    event: Readonly<UIInputEvent>
): boolean {
    if (event.type !== 'pointer' || !host.canvasConfig || !host.lastViewport) {
        return dispatchInput(host, event);
    }
    const scale = resolveCanvasScale(
        host.canvasConfig,
        host.lastViewport.width,
        host.lastViewport.height
    );
    const mapped = mapViewportPointToCanvas(scale, event.x, event.y);
    return dispatchInput(host, { ...event, x: mapped.x, y: mapped.y });
}

export function hitTest(host: RuntimeInputSourceHost, x: number, y: number): WidgetId | null {
    let bestId = 0;
    let bestZIndex = Number.NEGATIVE_INFINITY;
    let bestDepth = -1;
    let bestOrder = -1;
    const visit = (index: number, clip: LayoutBox | null): void => {
        if (!isVisible(host.flags, index)) {
            return;
        }
        const box = host.readBox(index);
        const nextClip = host.styles[index]!.clip ? intersectRect(clip, box) : clip;
        if (host.styles[index]!.clip && nextClip === null) {
            return;
        }
        if (intersectsPoint(box, x, y) && (!nextClip || intersectsPoint(nextClip, x, y))) {
            if (
                (host.flags[index] & NodeFlag.Interactive) !== 0 &&
                (host.flags[index] & NodeFlag.Enabled) !== 0
            ) {
                const candidateZIndex = host.layouts[index]!.zIndex;
                const candidateDepth = host.depth[index];
                const candidateOrder = host.sequence[index];
                if (
                    bestId === 0 ||
                    candidateZIndex > bestZIndex ||
                    (candidateZIndex === bestZIndex && candidateDepth > bestDepth) ||
                    (candidateZIndex === bestZIndex &&
                        candidateDepth === bestDepth &&
                        candidateOrder > bestOrder)
                ) {
                    bestId = index;
                    bestZIndex = candidateZIndex;
                    bestDepth = candidateDepth;
                    bestOrder = candidateOrder;
                }
            }
            for (let child = host.firstChild[index]; child !== 0; child = host.nextSibling[child]) {
                visit(child, nextClip);
            }
        }
    };
    visit(host.rootId, null);
    return bestId === 0 ? null : (bestId as WidgetId);
}

export function updateHover<TRuntime>(
    host: RuntimeInputSourceHost<TRuntime>,
    target: WidgetId | null,
    event: Readonly<UIPointerEvent>
): void {
    if (host.getHovered() === target) {
        return;
    }
    const previous = host.getHovered();
    host.setHovered(target);
    if (previous) {
        invokeEvent(host, previous as number, { ...event, phase: 'leave' });
    }
    if (target) {
        invokeEvent(host, target as number, { ...event, phase: 'enter' });
    }
}

export function bubbleEvent<TRuntime>(
    host: RuntimeInputSourceHost<TRuntime>,
    index: number,
    event: Readonly<UIInputEvent>
): boolean {
    for (let current = index; current !== 0; current = host.parent[current]) {
        if (invokeEvent(host, current, event)) {
            return true;
        }
    }
    return false;
}

export function invokeEvent<TRuntime>(
    host: RuntimeInputSourceHost<TRuntime>,
    index: number,
    event: Readonly<UIInputEvent>
): boolean {
    const record = host.records[index];
    if (!record || !record.enabled) {
        return false;
    }
    const context: WidgetEventContext<Record<string, unknown>, TRuntime> = {
        runtime: host.getRuntime(),
        widget: index as WidgetId,
        props: record.props,
    };
    const handlers = record.handlers;
    let handled = false;
    switch (event.type) {
        case 'pointer':
            switch (event.phase) {
                case 'move':
                    handled = Boolean(handlers?.pointerMove?.(event, context));
                    break;
                case 'down':
                    handled = Boolean(handlers?.pointerDown?.(event, context));
                    break;
                case 'up':
                    handled = Boolean(handlers?.pointerUp?.(event, context));
                    break;
                case 'enter':
                    handled = Boolean(handlers?.pointerEnter?.(event, context));
                    break;
                case 'leave':
                    handled = Boolean(handlers?.pointerLeave?.(event, context));
                    break;
                case 'wheel':
                    handled = Boolean(handlers?.wheel?.(event, context));
                    break;
                default:
                    break;
            }
            break;
        case 'key':
            handled = event.phase === 'down'
                ? Boolean(handlers?.keyDown?.(event, context))
                : Boolean(handlers?.keyUp?.(event, context));
            break;
        case 'text':
            handled = Boolean(handlers?.textInput?.(event, context));
            break;
        default:
            break;
    }
    const controller = record.controller ? host.registry.resolve(record.controller) : null;
    if (!handled && controller?.input) {
        handled = Boolean(
            controller.input(event, {
                runtime: host.getRuntime(),
                widget: index as WidgetId,
                props: record.props,
                state: host.states[index],
            })
        );
    }
    return handled;
}
