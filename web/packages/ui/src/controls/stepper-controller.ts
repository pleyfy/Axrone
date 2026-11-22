import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { hitTestBoundWidget, asString, asNumber, normalizeRange } from './internals';

export const STEPPER_CONTROLLER_TYPE = 'stepper';

export interface StepperControllerProps {
    readonly value?: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly minusKey?: string;
    readonly plusKey?: string;
    readonly valueKey?: string;
    readonly onChange?: string;
}

export interface StepperControllerState {
    value: number;
}

type StepperContext = WidgetControllerContext<
    Record<string, unknown>,
    StepperControllerState,
    UIRuntime
>;

const DIM_OPACITY = 0.45;
const FULL_OPACITY = 1;

const resolveRange = (props: StepperControllerProps) =>
    normalizeRange(asNumber(props.min, 0), asNumber(props.max, 100));

const resolveStep = (props: StepperControllerProps): number => {
    const step = asNumber(props.step, 1);
    return Number.isFinite(step) && step > 0 ? step : 1;
};

const applyVisuals = (context: StepperContext): boolean => {
    const props = context.props as StepperControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const range = resolveRange(props);
    let applied = false;
    const valueKey = asString(props.valueKey);
    if (valueKey) {
        const valueWidget = runtime.getBoundWidget(valueKey);
        if (valueWidget !== null) {
            runtime.updateWidget(valueWidget, {
                text: { value: String(state.value) },
            });
            applied = true;
        }
    }
    const minusKey = asString(props.minusKey);
    if (minusKey) {
        const minus = runtime.getBoundWidget(minusKey);
        if (minus !== null) {
            runtime.updateWidget(minus, {
                style: { opacity: state.value <= range.min ? DIM_OPACITY : FULL_OPACITY },
            });
            applied = true;
        }
    }
    const plusKey = asString(props.plusKey);
    if (plusKey) {
        const plus = runtime.getBoundWidget(plusKey);
        if (plus !== null) {
            runtime.updateWidget(plus, {
                style: { opacity: state.value >= range.max ? DIM_OPACITY : FULL_OPACITY },
            });
            applied = true;
        }
    }
    return applied || (!valueKey && !minusKey && !plusKey);
};

const isHitKey = (context: StepperContext, key: string, x: number, y: number): boolean => {
    const name = asString((context.props as StepperControllerProps)[key as keyof StepperControllerProps]);
    if (!name) {
        return false;
    }
    const widget = context.runtime.getBoundWidget(name);
    return widget !== null && hitTestBoundWidget(context.runtime, widget, x, y);
};

const emitChange = (context: StepperContext): void => {
    const props = context.props as StepperControllerProps;
    const name = asString(props.onChange);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, {
        value: context.state.value,
    });
};

const setValue = (context: StepperContext, next: number): void => {
    const range = resolveRange(context.props as StepperControllerProps);
    context.state.value = clamp(next, range.min, range.max);
    applyVisuals(context);
};

export const stepperController: WidgetController<
    typeof STEPPER_CONTROLLER_TYPE,
    Record<string, unknown>,
    StepperControllerState,
    UIRuntime,
    unknown
> = {
    type: STEPPER_CONTROLLER_TYPE,
    createState: (props) => {
        const stepperProps = props as StepperControllerProps;
        const range = resolveRange(stepperProps);
        return {
            value: clamp(asNumber(stepperProps.value, range.min), range.min, range.max),
        };
    },
    mount: (context) => {
        applyVisuals(context as StepperContext);
    },
    update: (context, previousProps) => {
        const typed = context as StepperContext;
        const props = typed.props as StepperControllerProps;
        const previous = previousProps as StepperControllerProps;
        if (
            props.value !== previous.value ||
            props.min !== previous.min ||
            props.max !== previous.max ||
            props.step !== previous.step ||
            props.minusKey !== previous.minusKey ||
            props.plusKey !== previous.plusKey ||
            props.valueKey !== previous.valueKey
        ) {
            const range = resolveRange(props);
            if (props.value !== previous.value) {
                typed.state.value = clamp(asNumber(props.value, typed.state.value), range.min, range.max);
            } else {
                typed.state.value = clamp(typed.state.value, range.min, range.max);
            }
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as StepperContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        const step = resolveStep(typed.props as StepperControllerProps);
        if (event.type === 'pointer') {
            if (event.phase === 'down') {
                if (isHitKey(typed, 'minusKey', event.x, event.y)) {
                    setValue(typed, state.value - step);
                    emitChange(typed);
                    return true;
                }
                if (isHitKey(typed, 'plusKey', event.x, event.y)) {
                    setValue(typed, state.value + step);
                    emitChange(typed);
                    return true;
                }
                return false;
            }
            return false;
        }
        if (event.type === 'key' && event.phase === 'down') {
            if (event.key === 'ArrowLeft') {
                setValue(typed, state.value - step);
                emitChange(typed);
                return true;
            }
            if (event.key === 'ArrowRight') {
                setValue(typed, state.value + step);
                emitChange(typed);
                return true;
            }
            return false;
        }
        return false;
    },
};

export const getStepperValue = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as StepperControllerState | null;
    return state && typeof state.value === 'number' ? state.value : null;
};
