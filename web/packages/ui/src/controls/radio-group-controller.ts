import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { hitTestBoundWidget, asString, asNumber, asBoolean, setWidgetVisible } from './internals';
import { defaultUIControlTheme } from './theme';

/**
 * Declarative radio-group controller for `.ui.json` authored radio groups.
 *
 * The authored widget acts as the interaction surface and its `props` name the
 * child widgets that visualise selection state:
 *
 *   props: {
 *     selectedIndex: number,
 *     itemCount: number,
 *     dotPrefix: string,      // e.g. 'radio-' resolves 'radio-0-dot', 'radio-1-dot', ...
 *     circlePrefix: string,   // e.g. 'radio-' resolves 'radio-0-circle', 'radio-1-circle', ...
 *     selectedColor: string,
 *     unselectedColor: string,
 *   }
 *
 * For each index i, the controller resolves:
 *   - dot widget:    `${dotPrefix}${i}-dot`
 *   - circle widget: `${circlePrefix}${i}-circle`
 *
 * Child widgets are resolved through the asset's binding table.
 */
export const RADIO_GROUP_CONTROLLER_TYPE = 'radio-group';

export interface RadioGroupControllerProps {
    readonly selectedIndex?: number;
    readonly itemCount?: number;
    readonly dotPrefix?: string;
    readonly circlePrefix?: string;
    readonly selectedColor?: string;
    readonly unselectedColor?: string;
    readonly radioSize?: number;
    readonly borderWidth?: number;
    readonly shape?: string;
    readonly dotScale?: number;
    readonly itemSpacing?: number;
    readonly direction?: string;
    readonly allowDeselect?: boolean;
    readonly selectOnHover?: boolean;
    readonly keyboardNav?: boolean;
}

export interface RadioGroupControllerState {
    selectedIndex: number;
    hoveredIndex: number;
}

type RadioGroupContext = WidgetControllerContext<
    Record<string, unknown>,
    RadioGroupControllerState,
    UIRuntime
>;

const DEFAULT_SELECTED_COLOR = defaultUIControlTheme.accentColor;
const DEFAULT_UNSELECTED_COLOR = '#475569ff';

/** Resolves the dot widget key for a given index. */
const resolveDotKey = (props: RadioGroupControllerProps, index: number): string =>
    `${asString(props.dotPrefix)}${index}-dot`;

/** Resolves the circle widget key for a given index. */
const resolveCircleKey = (props: RadioGroupControllerProps, index: number): string =>
    `${asString(props.circlePrefix)}${index}-circle`;

const SHAPE_RADII: Record<string, number> = { circle: 999, rounded: 8, square: 0 };

const DOT_BASE_SIZE = 18;
const DOT_MIN_SIZE = 4;

const resolveShapeRadius = (value: unknown): number | null => {
    const key = asString(value);
    return key in SHAPE_RADII ? SHAPE_RADII[key] : null;
};

const resolveDotSize = (value: unknown): number | null => {
    const scale = asNumber(value, NaN);
    if (!Number.isFinite(scale)) return null;
    return Math.max(DOT_MIN_SIZE, Math.round((DOT_BASE_SIZE * scale) / 100));
};

const resolveDirectionValue = (value: unknown): 'row' | 'column' | null => {
    const key = asString(value);
    if (key === 'horizontal') return 'row';
    if (key === 'vertical') return 'column';
    return null;
};

const clampSelectedIndex = (count: number, raw: number, allowDeselect: boolean): number => {
    if (allowDeselect && raw === -1) return -1;
    return count > 0 ? clamp(raw, 0, count - 1) : 0;
};

/**
 * Pushes the visual state onto all radio item widgets.
 * For each item: shows/hides the dot and sets the circle border color.
 * Returns true once at least one visual was applied.
 */
const applyVisuals = (context: RadioGroupContext): boolean => {
    const props = context.props as RadioGroupControllerProps;
    const runtime = context.runtime;
    const state = context.state;

    const count = Math.max(0, asNumber(props.itemCount, 0) | 0);
    const selectedColor = (asString(props.selectedColor) || DEFAULT_SELECTED_COLOR) as `#${string}`;
    const unselectedColor = (asString(props.unselectedColor) || DEFAULT_UNSELECTED_COLOR) as `#${string}`;

    const radioSize = asNumber(props.radioSize, NaN);
    const borderWidth = asNumber(props.borderWidth, NaN);
    const shapeRadius = resolveShapeRadius(props.shape);
    const dotSize = resolveDotSize(props.dotScale);

    let applied = false;

    for (let i = 0; i < count; i++) {
        const isSelected = i === state.selectedIndex;

        const dotKey = resolveDotKey(props, i);
        const dot = runtime.getBoundWidget(dotKey);
        if (dot !== null) {
            setWidgetVisible(runtime, dot, isSelected);
            if (dotSize !== null) {
                runtime.updateWidget(dot, {
                    layout: { width: dotSize, height: dotSize },
                });
            }
            applied = true;
        }

        const circleKey = resolveCircleKey(props, i);
        const circle = runtime.getBoundWidget(circleKey);
        if (circle !== null) {
            const stylePatch: Record<string, unknown> = {
                background: isSelected ? selectedColor : unselectedColor,
            };
            if (Number.isFinite(borderWidth) && borderWidth >= 0) {
                stylePatch.borderWidth = borderWidth;
            }
            if (shapeRadius !== null) {
                stylePatch.radius = shapeRadius;
            }
            const layoutPatch: Record<string, unknown> = {};
            if (Number.isFinite(radioSize) && radioSize > 0) {
                layoutPatch.width = radioSize;
                layoutPatch.height = radioSize;
            }
            runtime.updateWidget(circle, {
                ...(Object.keys(layoutPatch).length > 0 ? { layout: layoutPatch } : {}),
                style: stylePatch,
            });
            applied = true;
        }
    }

    const rootLayoutPatch: Record<string, unknown> = {};
    const itemSpacing = asNumber(props.itemSpacing, NaN);
    if (Number.isFinite(itemSpacing) && itemSpacing >= 0) {
        rootLayoutPatch.gap = itemSpacing;
    }
    const direction = resolveDirectionValue(props.direction);
    if (direction !== null) {
        rootLayoutPatch.direction = direction;
    }
    if (Object.keys(rootLayoutPatch).length > 0) {
        runtime.updateWidget(context.widget, { layout: rootLayoutPatch });
    }

    return applied || count === 0;
};

/**
 * Determines which radio item the pointer is over by hit-testing each item's
 * circle widget layout box. Returns -1 when no item contains the point.
 */
const hitTestItem = (context: RadioGroupContext, x: number, y: number): number => {
    const props = context.props as RadioGroupControllerProps;
    const runtime = context.runtime;
    const count = Math.max(0, asNumber(props.itemCount, 0) | 0);

    for (let i = 0; i < count; i++) {
        const circleKey = resolveCircleKey(props, i);
        const circle = runtime.getBoundWidget(circleKey);
        if (circle !== null && hitTestBoundWidget(runtime, circle, x, y)) {
            return i;
        }
    }
    return -1;
};

export const radioGroupController: WidgetController<
    typeof RADIO_GROUP_CONTROLLER_TYPE,
    Record<string, unknown>,
    RadioGroupControllerState,
    UIRuntime,
    unknown
> = {
    type: RADIO_GROUP_CONTROLLER_TYPE,
    createState: (props) => {
        const radioProps = props as RadioGroupControllerProps;
        const count = Math.max(0, asNumber(radioProps.itemCount, 0) | 0);
        const rawIndex = asNumber(radioProps.selectedIndex, 0);
        return {
            selectedIndex: clampSelectedIndex(count, rawIndex, asBoolean(radioProps.allowDeselect, false)),
            hoveredIndex: -1,
        };
    },
    mount: (context) => {
        const typed = context as RadioGroupContext;
        applyVisuals(typed);
    },
    update: (context, previousProps) => {
        const typed = context as RadioGroupContext;
        const props = typed.props as RadioGroupControllerProps;
        const previous = previousProps as RadioGroupControllerProps;

        if (
            props.selectedIndex !== previous.selectedIndex ||
            props.itemCount !== previous.itemCount ||
            props.dotPrefix !== previous.dotPrefix ||
            props.circlePrefix !== previous.circlePrefix ||
            props.selectedColor !== previous.selectedColor ||
            props.unselectedColor !== previous.unselectedColor ||
            props.radioSize !== previous.radioSize ||
            props.borderWidth !== previous.borderWidth ||
            props.shape !== previous.shape ||
            props.dotScale !== previous.dotScale ||
            props.itemSpacing !== previous.itemSpacing ||
            props.direction !== previous.direction ||
            props.allowDeselect !== previous.allowDeselect ||
            props.selectOnHover !== previous.selectOnHover ||
            props.keyboardNav !== previous.keyboardNav
        ) {
            const count = Math.max(0, asNumber(props.itemCount, 0) | 0);
            const authored = asNumber(props.selectedIndex, typed.state.selectedIndex);
            typed.state.selectedIndex = clampSelectedIndex(count, authored, asBoolean(props.allowDeselect, false));
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as RadioGroupContext;
        const state = typed.state;
        if (!state) return false;

        const props = typed.props as RadioGroupControllerProps;
        const count = Math.max(0, asNumber(props.itemCount, 0) | 0);
        if (count === 0) return false;

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'down': {
                    const hit = hitTestItem(typed, event.x, event.y);
                    if (hit >= 0) {
                        if (asBoolean(props.allowDeselect, false) && hit === state.selectedIndex) {
                            state.selectedIndex = -1;
                        } else {
                            state.selectedIndex = hit;
                        }
                        applyVisuals(typed);
                        return true;
                    }
                    return false;
                }
                case 'move': {
                    const hit = hitTestItem(typed, event.x, event.y);
                    if (hit !== state.hoveredIndex) {
                        state.hoveredIndex = hit;
                    }
                    if (asBoolean(props.selectOnHover, false) && hit >= 0 && hit !== state.selectedIndex) {
                        state.selectedIndex = hit;
                        applyVisuals(typed);
                        return true;
                    }
                    return false;
                }
                case 'leave':
                    state.hoveredIndex = -1;
                    return false;
                default:
                    return false;
            }
        }

        if (event.type === 'key' && event.phase === 'down') {
            if (!asBoolean(props.keyboardNav, true)) return false;
            switch (event.key) {
                case 'ArrowDown':
                case 'ArrowRight': {
                    const next = state.selectedIndex + 1;
                    state.selectedIndex = next < count ? next : 0;
                    applyVisuals(typed);
                    return true;
                }
                case 'ArrowUp':
                case 'ArrowLeft': {
                    const prev = state.selectedIndex - 1;
                    state.selectedIndex = prev >= 0 ? prev : count - 1;
                    applyVisuals(typed);
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
 * Reads the live selected index of a radio group driven by `radio-group`.
 * Returns null when the widget has no radio-group state.
 */
export const getRadioGroupSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as RadioGroupControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};
