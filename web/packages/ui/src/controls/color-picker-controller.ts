import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asArray, asColorString, asNumber, asString, hitTestBoundWidget } from './internals';

export const COLOR_PICKER_CONTROLLER_TYPE = 'color-picker';

export interface ColorPickerControllerProps {
    readonly value?: string;
    readonly swatchPrefix?: string;
    readonly swatchCount?: number;
    readonly swatchColors?: string[];
    readonly previewKey?: string;
    readonly onPick?: string;
}

export interface ColorPickerControllerState {
    value: string;
    selectedIndex: number;
}

type ColorPickerContext = WidgetControllerContext<
    Record<string, unknown>,
    ColorPickerControllerState,
    UIRuntime
>;

export const DEFAULT_COLOR_PICKER_VALUE = '#ffffffff';
const DEFAULT_SWATCH_COUNT = 6;
const DEFAULT_SWATCH_COLORS: readonly string[] = [
    '#000000ff',
    '#333333ff',
    '#666666ff',
    '#999999ff',
    '#ccccccff',
    '#ffffffff',
];
const SELECTED_BORDER_COLOR = '#ffffffff';
const UNSELECTED_BORDER_COLOR = '#00000000';
const SELECTED_BORDER_WIDTH = 2;

const resolveCount = (props: ColorPickerControllerProps): number =>
    Math.max(0, asNumber(props.swatchCount, DEFAULT_SWATCH_COUNT) | 0);

const resolveColors = (props: ColorPickerControllerProps, count: number): string[] => {
    const authored = asArray(props.swatchColors);
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
        const slot = authored[i] ?? DEFAULT_SWATCH_COLORS[i % DEFAULT_SWATCH_COLORS.length]!;
        colors.push(asColorString(slot) ?? DEFAULT_SWATCH_COLORS[i % DEFAULT_SWATCH_COLORS.length]!);
    }
    return colors;
};

const resolveValue = (props: ColorPickerControllerProps): string =>
    asColorString(props.value) ?? DEFAULT_COLOR_PICKER_VALUE;

const indexOfColor = (colors: readonly string[], value: string): number => {
    for (let i = 0; i < colors.length; i++) {
        if (colors[i] === value) {
            return i;
        }
    }
    return -1;
};

const resolveSwatchKey = (props: ColorPickerControllerProps, index: number): string =>
    `${asString(props.swatchPrefix)}${index}`;

const applyVisuals = (context: ColorPickerContext): void => {
    const props = context.props as ColorPickerControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const count = resolveCount(props);
    const colors = resolveColors(props, count);
    const prefix = asString(props.swatchPrefix);

    if (prefix) {
        for (let i = 0; i < count; i++) {
            const swatch = runtime.getBoundWidget(resolveSwatchKey(props, i));
            if (swatch === null) {
                continue;
            }
            const selected = i === state.selectedIndex;
            runtime.updateWidget(swatch, {
                style: {
                    background: colors[i]! as `#${string}`,
                    borderColor: selected ? SELECTED_BORDER_COLOR : UNSELECTED_BORDER_COLOR,
                    borderWidth: selected ? SELECTED_BORDER_WIDTH : 0,
                },
            });
        }
    }

    const previewKey = asString(props.previewKey);
    if (previewKey) {
        const preview = runtime.getBoundWidget(previewKey);
        if (preview !== null) {
            runtime.updateWidget(preview, {
                style: { background: state.value as `#${string}` },
            });
        }
    }
};

const emitPick = (context: ColorPickerContext): void => {
    const props = context.props as ColorPickerControllerProps;
    const name = asString(props.onPick);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget, name, {
        value: context.state.value,
    });
};

const pickIndex = (context: ColorPickerContext, index: number): void => {
    const props = context.props as ColorPickerControllerProps;
    const count = resolveCount(props);
    if (index < 0 || index >= count) {
        return;
    }
    const colors = resolveColors(props, count);
    context.state.selectedIndex = index;
    context.state.value = colors[index]!;
    applyVisuals(context);
    emitPick(context);
};

const hitTestSwatch = (context: ColorPickerContext, x: number, y: number): number => {
    const props = context.props as ColorPickerControllerProps;
    const runtime = context.runtime;
    const count = resolveCount(props);
    if (!asString(props.swatchPrefix) || count === 0) {
        return -1;
    }
    for (let i = 0; i < count; i++) {
        const swatch = runtime.getBoundWidget(resolveSwatchKey(props, i));
        if (swatch !== null && hitTestBoundWidget(runtime, swatch, x, y)) {
            return i;
        }
    }
    return -1;
};

export const colorPickerController: WidgetController<
    typeof COLOR_PICKER_CONTROLLER_TYPE,
    Record<string, unknown>,
    ColorPickerControllerState,
    UIRuntime,
    unknown
> = {
    type: COLOR_PICKER_CONTROLLER_TYPE,
    createState: (props) => {
        const pickerProps = props as ColorPickerControllerProps;
        const count = resolveCount(pickerProps);
        const value = resolveValue(pickerProps);
        return {
            value,
            selectedIndex: indexOfColor(resolveColors(pickerProps, count), value),
        };
    },
    mount: (context) => {
        applyVisuals(context as ColorPickerContext);
    },
    update: (context, previousProps) => {
        const typed = context as ColorPickerContext;
        const props = typed.props as ColorPickerControllerProps;
        const previous = previousProps as ColorPickerControllerProps;
        if (
            props.value !== previous.value ||
            props.swatchPrefix !== previous.swatchPrefix ||
            props.swatchCount !== previous.swatchCount ||
            props.swatchColors !== previous.swatchColors ||
            props.previewKey !== previous.previewKey ||
            props.onPick !== previous.onPick
        ) {
            if (props.value !== previous.value) {
                typed.state.value = resolveValue(props);
            }
            const count = resolveCount(props);
            typed.state.selectedIndex = indexOfColor(resolveColors(props, count), typed.state.value);
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as ColorPickerContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        const props = typed.props as ColorPickerControllerProps;
        const count = resolveCount(props);
        if (count === 0) {
            return false;
        }
        if (event.type === 'pointer') {
            if (event.phase !== 'down') {
                return false;
            }
            const hit = hitTestSwatch(typed, event.x, event.y);
            if (hit < 0) {
                return false;
            }
            pickIndex(typed, hit);
            return true;
        }
        if (event.type === 'key' && event.phase === 'down') {
            switch (event.key) {
                case 'ArrowRight': {
                    const next = state.selectedIndex + 1;
                    const wrapped = next < count ? next : 0;
                    state.selectedIndex = wrapped;
                    state.value = resolveColors(props, count)[wrapped]!;
                    applyVisuals(typed);
                    return true;
                }
                case 'ArrowLeft': {
                    const prev = state.selectedIndex - 1;
                    const wrapped = prev >= 0 ? prev : count - 1;
                    state.selectedIndex = wrapped;
                    state.value = resolveColors(props, count)[wrapped]!;
                    applyVisuals(typed);
                    return true;
                }
                case 'Enter': {
                    emitPick(typed);
                    return true;
                }
                default:
                    return false;
            }
        }
        return false;
    },
};

export const getColorPickerValue = (
    runtime: UIRuntime,
    widget: WidgetId
): string | null => {
    const state = runtime.getWidgetState(widget) as ColorPickerControllerState | null;
    return state && typeof state.value === 'string' ? state.value : null;
};

export const getColorPickerSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as ColorPickerControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};
