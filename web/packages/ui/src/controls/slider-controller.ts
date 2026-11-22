import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { normalizeRange, normalizeSteppedValue, asString, asNumber } from './internals';

/**
 * Declarative slider controller for `.ui.json` authored sliders.
 *
 * Unlike the imperative `createUISlider` factory (which builds and owns its own
 * widget tree), this controller drives a slider that already exists in an asset:
 * the authored widget acts as the interaction surface and its `props` name the
 * child widgets that visualise the value.
 *
 *   props: {
 *     min, max, value, step,
 *     fillKey,    // widget whose width tracks the value
 *     handleKey,  // widget anchored along the track at the value
 *     orientation // 'horizontal' (default) | 'vertical'
 *   }
 *
 * Child widgets are resolved through the asset's binding table, so the authored
 * keys are the contract; the controller never assumes a tree shape.
 */
export const SLIDER_CONTROLLER_TYPE = 'slider-drag';

export type SliderOrientation = 'horizontal' | 'vertical';

export interface SliderControllerProps {
    readonly min?: number;
    readonly max?: number;
    readonly value?: number;
    readonly step?: number;
    readonly fillKey?: string;
    readonly handleKey?: string;
    readonly orientation?: SliderOrientation;
}

export interface SliderControllerState {
    value: number;
    dragging: boolean;
}

type SliderContext = WidgetControllerContext<
    Record<string, unknown>,
    SliderControllerState,
    UIRuntime
>;

/** Resolves the authored range, guarding against inverted or missing bounds. */
const resolveRange = (props: SliderControllerProps) =>
    normalizeRange(asNumber(props.min, 0), asNumber(props.max, 1));

const resolveStep = (props: SliderControllerProps): number => {
    const step = asNumber(props.step, 0);
    return step > 0 ? step : 0;
};

/** Quantizes to the authored step; a step of 0 keeps the value continuous. */
const snapValue = (
    value: number,
    min: number,
    max: number,
    step: number
): number =>
    step > 0
        ? normalizeSteppedValue(value, min, max, step)
        : clamp(Number.parseFloat(value.toFixed(6)), min, max);

/** Normalized 0..1 position of the current value inside the range. */
const resolveRatio = (value: number, min: number, max: number): number =>
    max === min ? 0 : clamp((value - min) / (max - min), 0, 1);

/**
 * Pushes the value onto the fill and handle widgets named in `props`.
 * Missing keys are skipped, so a slider can ship with only a fill or only a
 * handle. Returns true once at least one visual was reached, which the caller
 * uses to know the binding table is ready.
 */
const applyVisuals = (context: SliderContext, ratio: number): boolean => {
    const props = context.props as SliderControllerProps;
    const runtime = context.runtime;
    const vertical = props.orientation === 'vertical';
    const percent = ratio * 100;
    let applied = false;

    const fillKey = asString(props.fillKey);
    if (fillKey) {
        const fill = runtime.getBoundWidget(fillKey);
        if (fill !== null) {
            runtime.updateWidget(fill, {
                layout: vertical
                    ? {
                        height: `${percent}%`,
                        anchor: { x: 0, y: 1, maxX: 0, maxY: 1, pivotX: 0, pivotY: 1 },
                        inset: { left: 0, bottom: 0 },
                    }
                    : { width: `${percent}%` },
            });
            applied = true;
        }
    }

    const handleKey = asString(props.handleKey);
    if (handleKey) {
        const handle = runtime.getBoundWidget(handleKey);
        if (handle !== null) {
            // The handle rides the track through its anchor, so its own size is
            // preserved and it stays centered on the value.
            runtime.updateWidget(handle, {
                layout: {
                    position: 'absolute',
                    anchor: vertical
                        ? { x: 0.5, y: 1 - ratio, maxX: 0.5, maxY: 1 - ratio, pivotX: 0.5, pivotY: 0.5 }
                        : { x: ratio, y: 0.5, maxX: ratio, maxY: 0.5, pivotX: 0.5, pivotY: 0.5 },
                },
            });
            applied = true;
        }
    }

    // A slider authored without a fill or handle has nothing to sync.
    return applied || (!fillKey && !handleKey);
};

const setValue = (context: SliderContext, nextValue: number): boolean => {
    const props = context.props as SliderControllerProps;
    const range = resolveRange(props);
    const snapped = snapValue(nextValue, range.min, range.max, resolveStep(props));
    const changed = snapped !== context.state.value;
    context.state.value = snapped;
    applyVisuals(context, resolveRatio(snapped, range.min, range.max));
    return changed;
};

/** Maps a pointer position on the slider surface to a value in range. */
const valueFromPointer = (context: SliderContext, x: number, y: number): number => {
    const props = context.props as SliderControllerProps;
    const range = resolveRange(props);
    const box = context.runtime.getLayoutBox(context.widget as WidgetId);
    const rawRatio =
        props.orientation === 'vertical'
            ? clamp((y - box.y) / Math.max(box.height, 1), 0, 1)
            : clamp((x - box.x) / Math.max(box.width, 1), 0, 1);
    const ratio = props.orientation === 'vertical' ? 1 - rawRatio : rawRatio;
    return range.min + (range.max - range.min) * ratio;
};

/** Keyboard step: the authored step, or 1% of the range when continuous. */
const resolveKeyStep = (props: SliderControllerProps): number => {
    const step = resolveStep(props);
    if (step > 0) {
        return step;
    }
    const range = resolveRange(props);
    return (range.max - range.min) / 100 || 0.01;
};

export const sliderController: WidgetController<
    typeof SLIDER_CONTROLLER_TYPE,
    Record<string, unknown>,
    SliderControllerState,
    UIRuntime,
    unknown
> = {
    type: SLIDER_CONTROLLER_TYPE,
    createState: (props) => {
        const sliderProps = props as SliderControllerProps;
        const range = resolveRange(sliderProps);
        return {
            value: snapValue(
                asNumber(sliderProps.value, range.min),
                range.min,
                range.max,
                resolveStep(sliderProps)
            ),
            dragging: false,
        };
    },
    mount: (context) => {
        const typed = context as SliderContext;
        // Called again by the runtime once the binding table exists, so the
        // fill/handle lookups succeed even though widgets are built first.
        const range = resolveRange(typed.props as SliderControllerProps);
        applyVisuals(
            typed,
            resolveRatio(typed.state.value, range.min, range.max)
        );
    },
    update: (context, previousProps) => {
        const typed = context as SliderContext;
        const props = typed.props as SliderControllerProps;
        const previous = previousProps as SliderControllerProps;
        // Re-apply when the authored range or value changes in the inspector.
        if (
            props.min !== previous.min ||
            props.max !== previous.max ||
            props.step !== previous.step ||
            props.value !== previous.value ||
            props.orientation !== previous.orientation ||
            props.fillKey !== previous.fillKey ||
            props.handleKey !== previous.handleKey
        ) {
            const authored = asNumber(props.value, typed.state.value);
            setValue(typed, props.value !== previous.value ? authored : typed.state.value);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as SliderContext;
        const state = typed.state;
        if (!state) {
            return false;
        }

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'down':
                    state.dragging = true;
                    setValue(typed, valueFromPointer(typed, event.x, event.y));
                    return true;
                case 'move':
                    if (!state.dragging) {
                        return false;
                    }
                    setValue(typed, valueFromPointer(typed, event.x, event.y));
                    return true;
                case 'up':
                    if (!state.dragging) {
                        return false;
                    }
                    setValue(typed, valueFromPointer(typed, event.x, event.y));
                    state.dragging = false;
                    return true;
                case 'leave':
                    // Releasing outside the widget must not leave it stuck in drag.
                    state.dragging = false;
                    return false;
                default:
                    return false;
            }
        }

        if (event.type === 'key' && event.phase === 'down') {
            const props = typed.props as SliderControllerProps;
            const range = resolveRange(props);
            const step = resolveKeyStep(props);
            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowDown':
                    setValue(typed, state.value - step);
                    return true;
                case 'ArrowRight':
                case 'ArrowUp':
                    setValue(typed, state.value + step);
                    return true;
                case 'Home':
                    setValue(typed, range.min);
                    return true;
                case 'End':
                    setValue(typed, range.max);
                    return true;
                case 'PageDown':
                    setValue(typed, state.value - step * 10);
                    return true;
                case 'PageUp':
                    setValue(typed, state.value + step * 10);
                    return true;
                default:
                    return false;
            }
        }

        return false;
    },
};

/**
 * Reads the live value of a slider widget driven by `slider-drag`.
 * Returns null when the widget has no slider state (wrong controller or key).
 */
export const getSliderValue = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as SliderControllerState | null;
    return state && typeof state.value === 'number' ? state.value : null;
};
