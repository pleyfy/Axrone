import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asString } from './internals';

export const DATETIME_PICKER_CONTROLLER_TYPE = 'datetime-picker';

export interface DateTimePickerControllerProps {
    readonly value?: string;
    readonly displayKey?: string;
    readonly onCommit?: string;
}

export interface DateTimePickerControllerState {
    value: string;
    editing: boolean;
    draft: string;
}

type DateTimePickerContext = WidgetControllerContext<
    Record<string, unknown>,
    DateTimePickerControllerState,
    UIRuntime
>;

const MAX_DATETIME_LENGTH = 16;

const resolveValue = (props: DateTimePickerControllerProps): string =>
    asString(props.value);

const applyDisplay = (context: DateTimePickerContext, text: string): void => {
    const props = context.props as DateTimePickerControllerProps;
    const displayKey = asString(props.displayKey);
    if (!displayKey) {
        return;
    }
    const display = context.runtime.getBoundWidget(displayKey);
    if (display === null) {
        return;
    }
    context.runtime.updateWidget(display, {
        text: { value: text },
    });
};

const shownText = (state: DateTimePickerControllerState): string =>
    state.editing ? state.draft : state.value;

const commitDraft = (context: DateTimePickerContext): void => {
    const props = context.props as DateTimePickerControllerProps;
    const state = context.state;
    state.value = state.draft;
    state.editing = false;
    applyDisplay(context, state.value);
    const name = asString(props.onCommit);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget, name, {
        value: state.value,
    });
};

const cancelEditing = (context: DateTimePickerContext): void => {
    const state = context.state;
    state.editing = false;
    state.draft = state.value;
    applyDisplay(context, state.value);
};

export const dateTimePickerController: WidgetController<
    typeof DATETIME_PICKER_CONTROLLER_TYPE,
    Record<string, unknown>,
    DateTimePickerControllerState,
    UIRuntime,
    unknown
> = {
    type: DATETIME_PICKER_CONTROLLER_TYPE,
    createState: (props) => {
        const pickerProps = props as DateTimePickerControllerProps;
        const value = resolveValue(pickerProps);
        return {
            value,
            editing: false,
            draft: value,
        };
    },
    mount: (context) => {
        const typed = context as DateTimePickerContext;
        applyDisplay(typed, typed.state.value);
    },
    update: (context, previousProps) => {
        const typed = context as DateTimePickerContext;
        const props = typed.props as DateTimePickerControllerProps;
        const previous = previousProps as DateTimePickerControllerProps;
        if (
            props.value !== previous.value ||
            props.displayKey !== previous.displayKey ||
            props.onCommit !== previous.onCommit
        ) {
            if (props.value !== previous.value) {
                typed.state.value = resolveValue(props);
                if (!typed.state.editing) {
                    typed.state.draft = typed.state.value;
                }
            }
            applyDisplay(typed, shownText(typed.state));
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as DateTimePickerContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        if (event.type === 'pointer') {
            if (event.phase !== 'down') {
                return false;
            }
            state.editing = true;
            state.draft = state.value;
            typed.runtime.setFocus(typed.widget, 'pointer');
            applyDisplay(typed, state.draft);
            return true;
        }
        if (event.type === 'key' && event.phase === 'down') {
            if (!state.editing) {
                return false;
            }
            switch (event.key) {
                case 'Enter':
                    commitDraft(typed);
                    return true;
                case 'Escape':
                    cancelEditing(typed);
                    return true;
                case 'Backspace':
                    if (state.draft.length > 0) {
                        state.draft = state.draft.slice(0, -1);
                        applyDisplay(typed, state.draft);
                    }
                    return true;
                default: {
                    if (
                        event.key.length === 1 &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.altKey &&
                        state.draft.length < MAX_DATETIME_LENGTH
                    ) {
                        state.draft = state.draft + event.key;
                        applyDisplay(typed, state.draft);
                        return true;
                    }
                    return false;
                }
            }
        }
        return false;
    },
};

export const getDateTimePickerValue = (
    runtime: UIRuntime,
    widget: WidgetId
): string | null => {
    const state = runtime.getWidgetState(widget) as DateTimePickerControllerState | null;
    return state && typeof state.value === 'string' ? state.value : null;
};

export const isDateTimePickerEditing = (
    runtime: UIRuntime,
    widget: WidgetId
): boolean | null => {
    const state = runtime.getWidgetState(widget) as DateTimePickerControllerState | null;
    return state ? state.editing : null;
};
