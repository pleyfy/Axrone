import { clamp } from '@axrone/numeric';
import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asArray, asBoolean, asNumber, asString, hitTestBoundWidget } from './internals';

export const LIST_VIEW_CONTROLLER_TYPE = 'list-view';

export interface ListViewControllerProps {
    readonly itemCount?: number;
    readonly itemHeight?: number;
    readonly itemPrefix?: string;
    readonly selectedIndex?: number;
    readonly labels?: string[];
    readonly startIndex?: number;
    readonly selectedColor?: string;
    readonly virtual?: boolean;
    readonly onSelect?: string;
    readonly onScrollIndex?: string;
}

export interface ListViewControllerState {
    selectedIndex: number;
    startIndex: number;
}

type ListViewContext = WidgetControllerContext<
    Record<string, unknown>,
    ListViewControllerState,
    UIRuntime
>;

const DEFAULT_ITEM_HEIGHT = 32;
const DEFAULT_SELECTED_COLOR = '#8b5cf633';
const TRANSPARENT_BACKGROUND = '#00000000';
const MAX_POOL_PROBE = 1024;

const resolveCount = (props: ListViewControllerProps): number =>
    Math.max(0, asNumber(props.itemCount, 0) | 0);

const resolveHeight = (props: ListViewControllerProps): number => {
    const value = asNumber(props.itemHeight, DEFAULT_ITEM_HEIGHT);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_ITEM_HEIGHT;
};

const resolvePrefix = (props: ListViewControllerProps): string =>
    asString(props.itemPrefix);

const resolveSelectedColor = (props: ListViewControllerProps): string =>
    asString(props.selectedColor) || DEFAULT_SELECTED_COLOR;

const resolveVirtual = (props: ListViewControllerProps): boolean =>
    asBoolean(props.virtual, false);

const resolveMaxStart = (count: number, poolLength: number): number =>
    Math.max(0, count - poolLength);

const isVirtualActive = (
    props: ListViewControllerProps,
    count: number,
    poolLength: number
): boolean => resolveVirtual(props) && poolLength > 0 && count > poolLength;

const resolvePool = (context: ListViewContext): WidgetId[] => {
    const props = context.props as ListViewControllerProps;
    const prefix = resolvePrefix(props);
    if (!prefix) {
        return [];
    }
    const pool: WidgetId[] = [];
    for (let j = 0; j < MAX_POOL_PROBE; j++) {
        const widget = context.runtime.getBoundWidget(`${prefix}${j}`);
        if (widget === null) {
            break;
        }
        pool.push(widget);
    }
    return pool;
};

const clampSelected = (raw: number, count: number): number => {
    const index = Math.trunc(raw);
    if (!Number.isFinite(index) || index < -1) {
        return -1;
    }
    if (count <= 0) {
        return -1;
    }
    if (index < -1) {
        return -1;
    }
    if (index > count - 1) {
        return count - 1;
    }
    return index;
};

const refresh = (context: ListViewContext): void => {
    const props = context.props as ListViewControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const count = resolveCount(props);
    const height = resolveHeight(props);
    const prefix = resolvePrefix(props);
    const labels = asArray(props.labels);
    const selectedColor = resolveSelectedColor(props);
    const pool = resolvePool(context);
    if (isVirtualActive(props, count, pool.length)) {
        const maxStart = resolveMaxStart(count, pool.length);
        state.startIndex = clamp(state.startIndex, 0, maxStart);
        for (let j = 0; j < pool.length; j++) {
            const virtualIndex = state.startIndex + j;
            const patch: Record<string, unknown> = {
                layout: {
                    position: 'absolute',
                    height,
                    inset: { top: j * height },
                },
            };
            const label = virtualIndex >= 0 && virtualIndex < labels.length
                ? labels[virtualIndex]
                : undefined;
            if (label !== undefined) {
                patch.text = { value: label };
            }
            const background = virtualIndex === state.selectedIndex
                ? selectedColor
                : TRANSPARENT_BACKGROUND;
            patch.style = { background };
            runtime.updateWidget(pool[j]!, patch);
        }
        return;
    }
    if (!prefix) {
        return;
    }
    for (let i = 0; i < count; i++) {
        const widget = runtime.getBoundWidget(`${prefix}${i}`);
        if (widget === null) {
            continue;
        }
        const patch: Record<string, unknown> = {};
        const label = i >= 0 && i < labels.length ? labels[i] : undefined;
        if (label !== undefined) {
            patch.text = { value: label };
        }
        patch.style = {
            background: i === state.selectedIndex ? selectedColor : TRANSPARENT_BACKGROUND,
        };
        runtime.updateWidget(widget, patch);
    }
};

const hitTestVirtual = (context: ListViewContext, pool: WidgetId[], x: number, y: number): number => {
    for (let j = 0; j < pool.length; j++) {
        if (hitTestBoundWidget(context.runtime, pool[j]!, x, y)) {
            return context.state.startIndex + j;
        }
    }
    return -1;
};

const hitTestFlat = (context: ListViewContext, count: number, x: number, y: number): number => {
    const props = context.props as ListViewControllerProps;
    const prefix = resolvePrefix(props);
    if (!prefix) {
        return -1;
    }
    for (let i = 0; i < count; i++) {
        const widget = context.runtime.getBoundWidget(`${prefix}${i}`);
        if (widget !== null && hitTestBoundWidget(context.runtime, widget, x, y)) {
            return i;
        }
    }
    return -1;
};

export const listViewController: WidgetController<
    typeof LIST_VIEW_CONTROLLER_TYPE,
    Record<string, unknown>,
    ListViewControllerState,
    UIRuntime,
    unknown
> = {
    type: LIST_VIEW_CONTROLLER_TYPE,
    createState: (props) => {
        const listProps = props as ListViewControllerProps;
        const count = resolveCount(listProps);
        return {
            selectedIndex: clampSelected(asNumber(listProps.selectedIndex, -1), count),
            startIndex: Math.max(0, Math.trunc(asNumber(listProps.startIndex, 0))),
        };
    },
    mount: (context) => {
        refresh(context as ListViewContext);
    },
    update: (context, previousProps) => {
        const typed = context as ListViewContext;
        const props = typed.props as ListViewControllerProps;
        const previous = previousProps as ListViewControllerProps;
        if (
            props.itemCount !== previous.itemCount ||
            props.itemHeight !== previous.itemHeight ||
            props.itemPrefix !== previous.itemPrefix ||
            props.selectedIndex !== previous.selectedIndex ||
            props.labels !== previous.labels ||
            props.startIndex !== previous.startIndex ||
            props.selectedColor !== previous.selectedColor ||
            props.virtual !== previous.virtual ||
            props.onSelect !== previous.onSelect ||
            props.onScrollIndex !== previous.onScrollIndex
        ) {
            const count = resolveCount(props);
            if (props.selectedIndex !== previous.selectedIndex) {
                typed.state.selectedIndex = clampSelected(
                    asNumber(props.selectedIndex, typed.state.selectedIndex),
                    count
                );
            } else if (typed.state.selectedIndex > count - 1) {
                typed.state.selectedIndex = count > 0 ? count - 1 : -1;
            }
            if (props.startIndex !== previous.startIndex) {
                typed.state.startIndex = Math.max(
                    0,
                    Math.trunc(asNumber(props.startIndex, typed.state.startIndex))
                );
            }
            refresh(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as ListViewContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        const props = typed.props as ListViewControllerProps;
        if (event.type === 'pointer' && event.phase === 'down') {
            const count = resolveCount(props);
            if (count <= 0) {
                return false;
            }
            const pool = resolvePool(typed);
            const hit = isVirtualActive(props, count, pool.length)
                ? hitTestVirtual(typed, pool, event.x, event.y)
                : hitTestFlat(typed, count, event.x, event.y);
            if (hit < 0 || hit > count - 1) {
                return false;
            }
            state.selectedIndex = hit;
            refresh(typed);
            const onSelect = asString(props.onSelect);
            if (onSelect) {
                typed.runtime.emitControllerEvent(typed.widget as WidgetId, onSelect, {
                    index: hit,
                });
            }
            return true;
        }
        if (event.type === 'pointer' && event.phase === 'wheel') {
            if (!resolveVirtual(props)) {
                return false;
            }
            const count = resolveCount(props);
            const pool = resolvePool(typed);
            if (!isVirtualActive(props, count, pool.length)) {
                return false;
            }
            const deltaY = typeof event.deltaY === 'number' ? event.deltaY : 0;
            const deltaX = typeof event.deltaX === 'number' ? event.deltaX : 0;
            const primary = deltaY !== 0 ? deltaY : deltaX;
            if (primary === 0) {
                return false;
            }
            const step = primary > 0 ? 1 : -1;
            const maxStart = resolveMaxStart(count, pool.length);
            const next = clamp(state.startIndex + step, 0, maxStart);
            if (next === state.startIndex) {
                return false;
            }
            state.startIndex = next;
            refresh(typed);
            const onScrollIndex = asString(props.onScrollIndex);
            if (onScrollIndex) {
                typed.runtime.emitControllerEvent(typed.widget as WidgetId, onScrollIndex, {
                    startIndex: next,
                });
            }
            return true;
        }
        return false;
    },
};

export const getListViewSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as ListViewControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};

export const getListViewStartIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as ListViewControllerState | null;
    return state && typeof state.startIndex === 'number' ? state.startIndex : null;
};
