import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asString, asNumber, setWidgetVisible } from './internals';

/**
 * Declarative tooltip-host controller for `.ui.json` authored widgets.
 *
 * The authored widget acts as the hover surface and its `props` name the
 * child widgets that form the tooltip popup and its text content:
 *
 *   props: {
 *     text,        // tooltip text content
 *     position,    // 'top' | 'bottom' | 'left' | 'right' (default 'top')
 *     delay,       // hover delay in seconds before showing (reserved for future timer API)
 *     offset,      // distance from host edge in pixels (default 8)
 *     tooltipKey,  // named binding -> tooltip popup widget
 *     textKey,     // named binding -> text widget inside tooltip popup
 *   }
 *
 * The tooltip popup is authored as a child of the host and positioned using
 * anchor-based layout to appear outside the host bounds. The host should use
 * `display: 'overlay'` so the tooltip can escape normal flow.
 *
 * Child widgets are resolved through the asset's binding table and cached
 * in state to avoid repeated lookups on every pointer event.
 */
export const TOOLTIP_HOST_CONTROLLER_TYPE = 'tooltip-host';

// ─── Tooltip constants ───────────────────────────────────────────────────────
const FRAME_INTERVAL_MS = 1000 / 60;
const TOOLTIP_DEFAULT_OFFSET = 8;
const TOOLTIP_FPS = 60;

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipControllerProps {
    readonly text?: string;
    readonly position?: TooltipPosition;
    readonly delay?: number;
    readonly offset?: number;
    readonly tooltipKey?: string;
    readonly textKey?: string;
}

export interface TooltipControllerState {
    visible: boolean;
    hovered: boolean;
    pendingShow: boolean;
    delayFrames: number;
    entryTime: number;
    cachedTooltip: WidgetId | null;
    cachedTextWidget: WidgetId | null;
}

type TooltipContext = WidgetControllerContext<
    Record<string, unknown>,
    TooltipControllerState,
    UIRuntime
>;

/**
 * Resolves the tooltip popup widget from the binding table and caches it.
 * Returns the resolved WidgetId or null when the key is missing or unbound.
 */
const resolveTooltipWidget = (context: TooltipContext): WidgetId | null => {
    const props = context.props as TooltipControllerProps;
    const key = asString(props.tooltipKey);
    if (!key) {
        return null;
    }
    const resolved = context.runtime.getBoundWidget(key);
    context.state.cachedTooltip = resolved;
    return resolved;
};

/**
 * Resolves the text widget inside the tooltip popup from the binding table
 * and caches it. Returns the resolved WidgetId or null when unbound.
 */
const resolveTextWidget = (context: TooltipContext): WidgetId | null => {
    const props = context.props as TooltipControllerProps;
    const key = asString(props.textKey);
    if (!key) {
        return null;
    }
    const resolved = context.runtime.getBoundWidget(key);
    context.state.cachedTextWidget = resolved;
    return resolved;
};

/**
 * Calculates anchor-based positioning for the tooltip popup relative to the
 * host's layout box. The tooltip is anchored so its edge faces the host edge
 * specified by `props.position`, with `props.offset` pixels of gap.
 *
 * Anchor semantics: the tooltip's anchor rect is pinned to the opposite edge
 * of the host, with the pivot placed so the tooltip appears centered along
 * the perpendicular axis.
 */
const applyTooltipPosition = (context: TooltipContext, tooltipWidget: WidgetId): void => {
    const props = context.props as TooltipControllerProps;
    const position: TooltipPosition = (props.position as TooltipPosition) ?? 'top';
    const offset = asNumber(props.offset, TOOLTIP_DEFAULT_OFFSET);

    switch (position) {
        case 'top':
            // Tooltip bottom-center anchored to host top-center, gap above.
            context.runtime.updateWidget(tooltipWidget, {
                layout: {
                    position: 'absolute',
                    anchor: { x: 0.5, y: 0, maxX: 0.5, maxY: 0, pivotX: 0.5, pivotY: 1 },
                    inset: { bottom: offset },
                },
            });
            break;
        case 'bottom':
            // Tooltip top-center anchored to host bottom-center, gap below.
            context.runtime.updateWidget(tooltipWidget, {
                layout: {
                    position: 'absolute',
                    anchor: { x: 0.5, y: 1, maxX: 0.5, maxY: 1, pivotX: 0.5, pivotY: 0 },
                    inset: { top: offset },
                },
            });
            break;
        case 'left':
            // Tooltip right-center anchored to host left-center, gap to the left.
            context.runtime.updateWidget(tooltipWidget, {
                layout: {
                    position: 'absolute',
                    anchor: { x: 0, y: 0.5, maxX: 0, maxY: 0.5, pivotX: 1, pivotY: 0.5 },
                    inset: { right: offset },
                },
            });
            break;
        case 'right':
            // Tooltip left-center anchored to host right-center, gap to the right.
            context.runtime.updateWidget(tooltipWidget, {
                layout: {
                    position: 'absolute',
                    anchor: { x: 1, y: 0.5, maxX: 1, maxY: 0.5, pivotX: 0, pivotY: 0.5 },
                    inset: { left: offset },
                },
            });
            break;
        default:
            break;
    }
};

/** Pushes the authored text into the text child widget, if bound. */
const applyTooltipText = (context: TooltipContext, textWidget: WidgetId): void => {
    const props = context.props as TooltipControllerProps;
    const text = asString(props.text);
    if (text) {
        context.runtime.updateWidget(textWidget, {
            text: { value: text },
        });
    }
};

/** Shows the tooltip: positions it, updates text, and enables the popup widget. */
const showTooltip = (context: TooltipContext): void => {
    const state = context.state;
    const tooltipWidget = state.cachedTooltip ?? resolveTooltipWidget(context);
    if (tooltipWidget === null) {
        return;
    }

    applyTooltipPosition(context, tooltipWidget);

    const textWidget = state.cachedTextWidget ?? resolveTextWidget(context);
    if (textWidget !== null) {
        applyTooltipText(context, textWidget);
    }

    setWidgetVisible(context.runtime, tooltipWidget, true);
    state.visible = true;
    state.pendingShow = false;
};

/** Hides the tooltip popup widget. */
const hideTooltip = (context: TooltipContext): void => {
    const state = context.state;
    const tooltipWidget = state.cachedTooltip;
    if (tooltipWidget === null) {
        state.visible = false;
        state.pendingShow = false;
        return;
    }

    setWidgetVisible(context.runtime, tooltipWidget, false);
    state.visible = false;
    state.pendingShow = false;
};

export const tooltipHostController: WidgetController<
    typeof TOOLTIP_HOST_CONTROLLER_TYPE,
    Record<string, unknown>,
    TooltipControllerState,
    UIRuntime,
    unknown
> = {
    type: TOOLTIP_HOST_CONTROLLER_TYPE,
    createState: () => ({
        visible: false,
        hovered: false,
        pendingShow: false,
        delayFrames: 0,
        entryTime: 0,
        cachedTooltip: null,
        cachedTextWidget: null,
    }),
    mount: (context) => {
        const typed = context as TooltipContext;

        // Resolve and cache child widget references from the binding table.
        // The binding table is populated before mount by the runtime, so
        // lookups succeed here even for widgets authored as descendants.
        resolveTooltipWidget(typed);
        resolveTextWidget(typed);

        // Compute the delay in frames from props.delay (seconds).
        // At ~60fps each frame is ~16.67ms; we convert seconds to frame count
        // so the event-driven delay check can compare elapsed time against it.
        const props = typed.props as TooltipControllerProps;
        const delaySeconds = asNumber(props.delay, 0);
        typed.state.delayFrames = Math.round(delaySeconds * TOOLTIP_FPS);

        // Start with the tooltip hidden.
        const tooltipWidget = typed.state.cachedTooltip;
        if (tooltipWidget !== null) {
            setWidgetVisible(typed.runtime, tooltipWidget, false);
        }

    },
    update: (context, previousProps) => {
        const typed = context as TooltipContext;
        const props = typed.props as TooltipControllerProps;
        const previous = previousProps as TooltipControllerProps;

        // Re-resolve bindings when keys change — the authored widget may have
        // been re-bound to a different child.
        if (props.tooltipKey !== previous.tooltipKey) {
            resolveTooltipWidget(typed);
        }
        if (props.textKey !== previous.textKey) {
            resolveTextWidget(typed);
        }

        // Recompute delay frames when the delay prop changes.
        // Convert seconds to frames at ~60fps.
        if (props.delay !== previous.delay) {
            const delaySeconds = asNumber(props.delay, 0);
            typed.state.delayFrames = Math.round(delaySeconds * TOOLTIP_FPS);
        }

        // If the tooltip is currently visible and relevant props changed,
        // re-apply position and text so the change is reflected immediately.
        if (typed.state.visible) {
            if (
                props.position !== previous.position ||
                props.offset !== previous.offset
            ) {
                const tooltipWidget = typed.state.cachedTooltip;
                if (tooltipWidget !== null) {
                    applyTooltipPosition(typed, tooltipWidget);
                }
            }

            if (props.text !== previous.text) {
                const textWidget = typed.state.cachedTextWidget;
                if (textWidget !== null) {
                    applyTooltipText(typed, textWidget);
                }
            }
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as TooltipContext;
        const state = typed.state;
        if (!state) {
            return false;
        }

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'enter':
                    state.hovered = true;
                    // Record entry time and begin the delay countdown.
                    // If delayFrames is 0 (no delay configured) show immediately
                    // to preserve the original zero-delay behavior.
                    state.entryTime = performance.now();
                    state.pendingShow = true;
                    if (state.delayFrames === 0) {
                        showTooltip(typed);
                    }
                    return false;
                case 'leave':
                    state.hovered = false;
                    state.pendingShow = false;
                    hideTooltip(typed);
                    return false;
                default:
                    // Event-driven delay check: on any subsequent pointer event
                    // while a show is pending, test whether enough time has
                    // elapsed since pointer enter. Each "frame" corresponds to
                    // 1000/60 ms (~16.67ms). This avoids setTimeout and
                    // per-frame allocations — the controller only receives
                    // input events, so the delay is evaluated lazily here.
                    if (state.pendingShow && state.delayFrames > 0) {
                        const elapsed = performance.now() - state.entryTime;
                        const delayMs = state.delayFrames * FRAME_INTERVAL_MS;
                        if (elapsed >= delayMs) {
                            showTooltip(typed);
                        }
                    }
                    return false;
            }
        }

        return false;
    },
};

/**
 * Reads the live visibility state of a tooltip-host widget.
 * Returns null when the widget has no tooltip state (wrong controller or key).
 */
export const isTooltipVisible = (
    runtime: UIRuntime,
    widget: WidgetId
): boolean | null => {
    const state = runtime.getWidgetState(widget) as TooltipControllerState | null;
    return state ? state.visible : null;
};
