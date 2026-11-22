import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { hitTestBoundWidget, asString, asNumber } from './internals';

export const RATING_CONTROLLER_TYPE = 'rating';

export interface RatingControllerProps {
    readonly value?: number;
    readonly max?: number;
    readonly starPrefix?: string;
    readonly filledColor?: string;
    readonly unfilledColor?: string;
    readonly onRate?: string;
}

export interface RatingControllerState {
    value: number;
}

type RatingContext = WidgetControllerContext<
    Record<string, unknown>,
    RatingControllerState,
    UIRuntime
>;

const DEFAULT_FILLED_COLOR = '#fbbf24ff';
const DEFAULT_UNFILLED_COLOR = '#475569ff';

const resolveMax = (props: RatingControllerProps): number =>
    Math.max(0, asNumber(props.max, 5) | 0);

const resolveStarKey = (props: RatingControllerProps, index: number): string =>
    `${asString(props.starPrefix)}${index}`;

const applyVisuals = (context: RatingContext): boolean => {
    const props = context.props as RatingControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const max = resolveMax(props);
    const filled = (asString(props.filledColor) || DEFAULT_FILLED_COLOR) as `#${string}`;
    const unfilled = (asString(props.unfilledColor) || DEFAULT_UNFILLED_COLOR) as `#${string}`;
    let applied = false;
    for (let i = 0; i < max; i++) {
        const starKey = resolveStarKey(props, i);
        const star = runtime.getBoundWidget(starKey);
        if (star !== null) {
            runtime.updateWidget(star, {
                style: { background: i < state.value ? filled : unfilled },
            });
            applied = true;
        }
    }
    return applied || max === 0;
};

const hitTestStar = (context: RatingContext, x: number, y: number): number => {
    const props = context.props as RatingControllerProps;
    const runtime = context.runtime;
    const max = resolveMax(props);
    for (let i = 0; i < max; i++) {
        const star = runtime.getBoundWidget(resolveStarKey(props, i));
        if (star !== null && hitTestBoundWidget(runtime, star, x, y)) {
            return i;
        }
    }
    return -1;
};

const emitRate = (context: RatingContext): void => {
    const props = context.props as RatingControllerProps;
    const name = asString(props.onRate);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, {
        value: context.state.value,
        max: resolveMax(props),
    });
};

export const ratingController: WidgetController<
    typeof RATING_CONTROLLER_TYPE,
    Record<string, unknown>,
    RatingControllerState,
    UIRuntime,
    unknown
> = {
    type: RATING_CONTROLLER_TYPE,
    createState: (props) => {
        const ratingProps = props as RatingControllerProps;
        const max = resolveMax(ratingProps);
        return {
            value: clamp(asNumber(ratingProps.value, 0), 0, max),
        };
    },
    mount: (context) => {
        applyVisuals(context as RatingContext);
    },
    update: (context, previousProps) => {
        const typed = context as RatingContext;
        const props = typed.props as RatingControllerProps;
        const previous = previousProps as RatingControllerProps;
        if (
            props.value !== previous.value ||
            props.max !== previous.max ||
            props.starPrefix !== previous.starPrefix ||
            props.filledColor !== previous.filledColor ||
            props.unfilledColor !== previous.unfilledColor
        ) {
            const max = resolveMax(props);
            if (props.value !== previous.value) {
                typed.state.value = clamp(asNumber(props.value, typed.state.value), 0, max);
            } else {
                typed.state.value = clamp(typed.state.value, 0, max);
            }
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as RatingContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        const max = resolveMax(typed.props as RatingControllerProps);
        if (max === 0) {
            return false;
        }
        if (event.type === 'pointer') {
            if (event.phase === 'down') {
                const hit = hitTestStar(typed, event.x, event.y);
                if (hit >= 0) {
                    state.value = hit + 1;
                    applyVisuals(typed);
                    emitRate(typed);
                    return true;
                }
                return false;
            }
            return false;
        }
        if (event.type === 'key' && event.phase === 'down') {
            if (event.key === 'ArrowRight') {
                state.value = clamp(state.value + 1, 0, max);
                applyVisuals(typed);
                emitRate(typed);
                return true;
            }
            if (event.key === 'ArrowLeft') {
                state.value = clamp(state.value - 1, 0, max);
                applyVisuals(typed);
                emitRate(typed);
                return true;
            }
            return false;
        }
        return false;
    },
};

export const getRatingValue = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as RatingControllerState | null;
    return state && typeof state.value === 'number' ? state.value : null;
};
