import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import type { IVec2Like } from '@axrone/numeric';
import { asString, asNumber, asBoolean } from './internals';

/**
 * Declarative drag controller for `.ui.json` authored draggable widgets.
 *
 * Unlike the imperative drag factories, this controller drives a widget that
 * already exists in an asset: the authored widget becomes draggable and its
 * position is updated via absolute positioning during drag.
 *
 *   props: {
 *     enabled,        // Can be dragged (default true)
 *     axis,           // 'both' | 'horizontal' | 'vertical' (default 'both')
 *     bounds,         // 'root' | 'none' (default 'none')
 *     ghostOpacity,   // Opacity of dragged widget (default 0.5)
 *     onDragStart,    // Event callback name
 *     onDragEnd,      // Event callback name
 *     onDrop          // Event callback name
 *   }
 */
export const DRAG_CONTROLLER_TYPE = 'widget-drag';

export type DragAxis = 'both' | 'horizontal' | 'vertical';
export type DragBounds = 'root' | 'none';

export interface DragControllerProps {
    readonly enabled?: boolean;
    readonly axis?: DragAxis;
    readonly bounds?: DragBounds;
    readonly ghostOpacity?: number;
    readonly onDragStart?: string;
    readonly onDragEnd?: string;
    readonly onDrop?: string;
}

export interface DragControllerState {
    dragging: boolean;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    originalPosition: IVec2Like | null;
}

type DragContext = WidgetControllerContext<
    Record<string, unknown>,
    DragControllerState,
    UIRuntime
>;

const resolveAxis = (props: DragControllerProps): DragAxis => {
    const axis = asString(props.axis);
    if (axis === 'horizontal' || axis === 'vertical') {
        return axis;
    }
    return 'both';
};

const resolveBounds = (props: DragControllerProps): DragBounds => {
    const bounds = asString(props.bounds);
    if (bounds === 'root') {
        return 'root';
    }
    return 'none';
};

/**
 * Captures the widget's current layout position as the starting point for drag.
 */
const captureStartPosition = (context: DragContext): void => {
    const box = context.runtime.getLayoutBox(context.widget as WidgetId);
    context.state.originalPosition = { x: box.x, y: box.y };
};

/**
 * Updates the widget's position during drag, respecting axis constraints.
 */
const updateDragPosition = (context: DragContext, pointerX: number, pointerY: number): void => {
    const props = context.props as DragControllerProps;
    const state = context.state;
    const axis = resolveAxis(props);
    const bounds = resolveBounds(props);

    // Calculate new position based on pointer movement.
    let newX = pointerX - state.offsetX;
    let newY = pointerY - state.offsetY;

    // Apply axis constraints.
    if (axis === 'horizontal') {
        newY = state.originalPosition?.y ?? 0;
    } else if (axis === 'vertical') {
        newX = state.originalPosition?.x ?? 0;
    }

    // Apply root bounds if requested.
    if (bounds === 'root') {
        const box = context.runtime.getLayoutBox(context.widget as WidgetId);
        const rootBox = context.runtime.getLayoutBox(context.runtime.root);
        newX = clamp(newX, rootBox.x, rootBox.x + rootBox.width - box.width);
        newY = clamp(newY, rootBox.y, rootBox.y + rootBox.height - box.height);
    }

    // Update widget position via absolute positioning.
    context.runtime.updateWidget(context.widget as WidgetId, {
        layout: {
            position: 'absolute',
            inset: {
                left: newX,
                top: newY,
            },
        },
    });
};

/**
 * Applies ghost opacity during drag.
 */
const applyGhostOpacity = (context: DragContext, dragging: boolean): void => {
    const props = context.props as DragControllerProps;
    const opacity = dragging ? asNumber(props.ghostOpacity, 0.5) : 1;
    context.runtime.updateWidget(context.widget as WidgetId, {
        style: { opacity },
    });
};

export const dragController: WidgetController<
    typeof DRAG_CONTROLLER_TYPE,
    Record<string, unknown>,
    DragControllerState,
    UIRuntime,
    unknown
> = {
    type: DRAG_CONTROLLER_TYPE,
    createState: () => ({
        dragging: false,
        startX: 0,
        startY: 0,
        offsetX: 0,
        offsetY: 0,
        originalPosition: null,
    }),
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as DragContext;
        const props = typed.props as DragControllerProps;
        const state = typed.state;

        if (!state) {
            return false;
        }

        const enabled = asBoolean(props.enabled, true);
        if (!enabled) {
            return false;
        }

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'down': {
                    // Start drag.
                    state.dragging = true;
                    state.startX = event.x;
                    state.startY = event.y;

                    // Capture current position and calculate offset.
                    captureStartPosition(typed);
                    const box = typed.runtime.getLayoutBox(typed.widget as WidgetId);
                    state.offsetX = event.x - box.x;
                    state.offsetY = event.y - box.y;

                    // Apply ghost opacity.
                    applyGhostOpacity(typed, true);

                    // Dispatch onDragStart callback.
                    const onStart = asString(props.onDragStart);
                    if (onStart) {
                        typed.runtime.emitControllerEvent(typed.widget as WidgetId, onStart, {
                            x: box.x,
                            y: box.y,
                            pointerX: event.x,
                            pointerY: event.y,
                        });
                    }

                    return true;
                }
                case 'move': {
                    if (!state.dragging) {
                        return false;
                    }
                    updateDragPosition(typed, event.x, event.y);
                    return true;
                }
                case 'up': {
                    if (!state.dragging) {
                        return false;
                    }
                    state.dragging = false;
                    applyGhostOpacity(typed, false);

                    // Dispatch onDragEnd and onDrop callbacks.
                    const onEnd = asString(props.onDragEnd);
                    if (onEnd) {
                        const finalBox = typed.runtime.getLayoutBox(typed.widget as WidgetId);
                        typed.runtime.emitControllerEvent(typed.widget as WidgetId, onEnd, {
                            x: finalBox.x,
                            y: finalBox.y,
                            pointerX: event.x,
                            pointerY: event.y,
                        });
                    }
                    const onDrop = asString(props.onDrop);
                    if (onDrop) {
                        const finalBox = typed.runtime.getLayoutBox(typed.widget as WidgetId);
                        typed.runtime.emitControllerEvent(typed.widget as WidgetId, onDrop, {
                            x: finalBox.x,
                            y: finalBox.y,
                            pointerX: event.x,
                            pointerY: event.y,
                        });
                    }

                    return true;
                }
                case 'leave': {
                    if (!state.dragging) {
                        return false;
                    }
                    updateDragPosition(typed, event.x, event.y);
                    return true;
                }
                default:
                    return false;
            }
        }

        return false;
    },
};

/**
 * Reads whether a widget is currently being dragged.
 * Returns null when the widget has no drag state.
 */
export const isWidgetDragging = (
    runtime: UIRuntime,
    widget: WidgetId
): boolean | null => {
    const state = runtime.getWidgetState(widget) as DragControllerState | null;
    return state ? state.dragging : null;
};
