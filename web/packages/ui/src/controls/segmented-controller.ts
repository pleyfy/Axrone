import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { hitTestBoundWidget, asString, asNumber, asFiniteNumber, asColorString } from './internals';

export const SEGMENTED_CONTROL_CONTROLLER_TYPE = 'segmented-control';

export interface SegmentedControllerProps {
    readonly selectedIndex?: number;
    readonly segmentCount?: number;
    readonly segmentPrefix?: string;
    readonly selectedBackground?: string;
    readonly unselectedBackground?: string;
    readonly barHeight?: number;
    readonly segmentSpacing?: number;
    readonly cornerRadius?: number;
    readonly backgroundColor?: string;
    readonly paddingH?: number;
    readonly idleTextColor?: string;
    readonly activeTextColor?: string;
}

export interface SegmentedControllerState {
    selectedIndex: number;
    hoveredIndex: number;
}

type SegmentedContext = WidgetControllerContext<
    Record<string, unknown>,
    SegmentedControllerState,
    UIRuntime
>;

const DEFAULT_SELECTED_BACKGROUND = '#334155ff';
const DEFAULT_UNSELECTED_BACKGROUND = '#00000000';
const DEFAULT_IDLE_TEXT_COLOR = '#888888ff';
const DEFAULT_ACTIVE_TEXT_COLOR = '#ffffffff';

const resolveSegmentKey = (props: SegmentedControllerProps, index: number): string =>
    `${asString(props.segmentPrefix)}${index}`;

const resolveSegmentTextKey = (props: SegmentedControllerProps, index: number): string =>
    `${asString(props.segmentPrefix)}${index}-text`;

const applyVisuals = (context: SegmentedContext): boolean => {
    const props = context.props as SegmentedControllerProps;
    const runtime = context.runtime;
    const state = context.state;

    const count = Math.max(0, asNumber(props.segmentCount, 0) | 0);
    const selectedBg = (asString(props.selectedBackground) || DEFAULT_SELECTED_BACKGROUND) as `#${string}`;
    const unselectedBg = (asString(props.unselectedBackground) || DEFAULT_UNSELECTED_BACKGROUND) as `#${string}`;
    const idleText = (asColorString(props.idleTextColor) ?? DEFAULT_IDLE_TEXT_COLOR) as `#${string}`;
    const activeText = (asColorString(props.activeTextColor) ?? DEFAULT_ACTIVE_TEXT_COLOR) as `#${string}`;

    let applied = false;

    for (let i = 0; i < count; i++) {
        const isSelected = i === state.selectedIndex;
        const segmentKey = resolveSegmentKey(props, i);
        const segment = runtime.getBoundWidget(segmentKey);
        if (segment !== null) {
            const color = isSelected ? selectedBg : unselectedBg;
            runtime.updateWidget(segment, {
                style: { background: color },
            });
            applied = true;
        }
        const textKey = resolveSegmentTextKey(props, i);
        const textWidget = runtime.getBoundWidget(textKey);
        if (textWidget !== null) {
            runtime.updateWidget(textWidget, {
                style: { color: isSelected ? activeText : idleText },
            });
            applied = true;
        }
    }

    return applied || count === 0;
};

const applyRootAppearance = (context: SegmentedContext): void => {
    const props = context.props as SegmentedControllerProps;
    const runtime = context.runtime;
    const layoutPatch: Record<string, unknown> = {};
    const stylePatch: Record<string, unknown> = {};
    const barHeight = asFiniteNumber(props.barHeight);
    if (barHeight !== null && barHeight > 0) {
        layoutPatch.height = barHeight;
    }
    const spacing = asFiniteNumber(props.segmentSpacing);
    if (spacing !== null && spacing >= 0) {
        layoutPatch.gap = spacing;
    }
    const paddingH = asFiniteNumber(props.paddingH);
    if (paddingH !== null && paddingH >= 0) {
        layoutPatch.padding = { left: paddingH, right: paddingH, top: 0, bottom: 0 };
    }
    const cornerRadius = asFiniteNumber(props.cornerRadius);
    if (cornerRadius !== null && cornerRadius >= 0) {
        stylePatch.radius = cornerRadius;
    }
    const backgroundColor = asColorString(props.backgroundColor);
    if (backgroundColor !== null) {
        stylePatch.background = backgroundColor;
    }
    if (Object.keys(layoutPatch).length > 0 || Object.keys(stylePatch).length > 0) {
        runtime.updateWidget(context.widget, {
            ...(Object.keys(layoutPatch).length > 0 ? { layout: layoutPatch } : {}),
            ...(Object.keys(stylePatch).length > 0 ? { style: stylePatch } : {}),
        });
    }
};

const hitTestSegment = (context: SegmentedContext, x: number, y: number): number => {
    const props = context.props as SegmentedControllerProps;
    const runtime = context.runtime;
    const count = Math.max(0, asNumber(props.segmentCount, 0) | 0);

    for (let i = 0; i < count; i++) {
        const segmentKey = resolveSegmentKey(props, i);
        const segment = runtime.getBoundWidget(segmentKey);
        if (segment !== null && hitTestBoundWidget(runtime, segment, x, y)) {
            return i;
        }
    }
    return -1;
};

export const segmentedController: WidgetController<
    typeof SEGMENTED_CONTROL_CONTROLLER_TYPE,
    Record<string, unknown>,
    SegmentedControllerState,
    UIRuntime,
    unknown
> = {
    type: SEGMENTED_CONTROL_CONTROLLER_TYPE,
    createState: (props) => {
        const segProps = props as SegmentedControllerProps;
        const count = Math.max(0, asNumber(segProps.segmentCount, 0) | 0);
        const rawIndex = asNumber(segProps.selectedIndex, 0);
        const clampedIndex = count > 0 ? clamp(rawIndex, 0, count - 1) : 0;
        return {
            selectedIndex: clampedIndex,
            hoveredIndex: -1,
        };
    },
    mount: (context) => {
        const typed = context as SegmentedContext;
        applyVisuals(typed);
        applyRootAppearance(typed);
    },
    update: (context, previousProps) => {
        const typed = context as SegmentedContext;
        const props = typed.props as SegmentedControllerProps;
        const previous = previousProps as SegmentedControllerProps;

        const selectionChanged =
            props.selectedIndex !== previous.selectedIndex ||
            props.segmentCount !== previous.segmentCount ||
            props.segmentPrefix !== previous.segmentPrefix;
        const visualsChanged =
            props.selectedBackground !== previous.selectedBackground ||
            props.unselectedBackground !== previous.unselectedBackground ||
            props.idleTextColor !== previous.idleTextColor ||
            props.activeTextColor !== previous.activeTextColor;
        const rootChanged =
            props.barHeight !== previous.barHeight ||
            props.segmentSpacing !== previous.segmentSpacing ||
            props.cornerRadius !== previous.cornerRadius ||
            props.backgroundColor !== previous.backgroundColor ||
            props.paddingH !== previous.paddingH;

        if (selectionChanged) {
            const count = Math.max(0, asNumber(props.segmentCount, 0) | 0);
            const authored = asNumber(props.selectedIndex, typed.state.selectedIndex);
            typed.state.selectedIndex = count > 0 ? clamp(authored, 0, count - 1) : 0;
            applyVisuals(typed);
        } else if (visualsChanged) {
            applyVisuals(typed);
        }
        if (rootChanged) {
            applyRootAppearance(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as SegmentedContext;
        const state = typed.state;
        if (!state) return false;

        const props = typed.props as SegmentedControllerProps;
        const count = Math.max(0, asNumber(props.segmentCount, 0) | 0);
        if (count === 0) return false;

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'down': {
                    const hit = hitTestSegment(typed, event.x, event.y);
                    if (hit >= 0) {
                        state.selectedIndex = hit;
                        applyVisuals(typed);
                        return true;
                    }
                    return false;
                }
                case 'move': {
                    const hit = hitTestSegment(typed, event.x, event.y);
                    if (hit !== state.hoveredIndex) {
                        state.hoveredIndex = hit;
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
            switch (event.key) {
                case 'ArrowRight': {
                    const next = state.selectedIndex + 1;
                    state.selectedIndex = next < count ? next : 0;
                    applyVisuals(typed);
                    return true;
                }
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

export const getSegmentedSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as SegmentedControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};
