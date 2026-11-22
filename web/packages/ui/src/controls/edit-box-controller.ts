import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { asString, asNumber, asBoolean, setWidgetVisible } from './internals';
import { defaultUIControlTheme } from './theme';

/**
 * Declarative edit-box controller for `.ui.json` authored text inputs.
 *
 * The authored widget acts as the interaction surface and its `props` name the
 * child widgets that visualise the text value and placeholder:
 *
 *   props: {
 *     value,            // current text value (default: '')
 *     placeholder,      // placeholder text when empty (default: '')
 *     password,         // mask input characters (default: false)
 *     readOnly,         // prevent editing (default: false)
 *     maxLength,        // max character count (default: Infinity)
 *     placeholderKey,   // named binding -> placeholder text widget
 *     valueKey,         // named binding -> value text widget
 *     focusColor,       // border color when focused (default: theme.accentColor)
 *     blurColor,        // border color when not focused (default: '#334155ff')
 *   }
 *
 * Child widgets are resolved through the asset's binding table.
 */
export const EDIT_BOX_CONTROLLER_TYPE = 'edit-box';

export interface EditBoxControllerProps {
    readonly value?: string;
    readonly placeholder?: string;
    readonly password?: boolean;
    readonly readOnly?: boolean;
    readonly maxLength?: number;
    readonly placeholderKey?: string;
    readonly valueKey?: string;
    readonly focusColor?: string;
    readonly blurColor?: string;
}

export interface EditBoxControllerState {
    value: string;
    focused: boolean;
    selectionStart: number;
    selectionEnd: number;
}

type EditBoxContext = WidgetControllerContext<
    Record<string, unknown>,
    EditBoxControllerState,
    UIRuntime
>;

const DEFAULT_FOCUS_COLOR = defaultUIControlTheme.accentColor;
const DEFAULT_BLUR_COLOR = '#334155ff';
const PASSWORD_BULLET = '\u2022';

/**
 * Returns the display text for the current value. When `password` is true,
 * each character is replaced with a bullet character.
 */
const getDisplayText = (value: string, password: boolean): string => {
    if (!password) {
        return value;
    }
    return PASSWORD_BULLET.repeat(value.length);
};

/**
 * Pushes the current value and focus state onto the value, placeholder, and
 * root widgets. Updates text content, placeholder visibility, and border color.
 */
const applyVisuals = (context: EditBoxContext): void => {
    const props = context.props as EditBoxControllerProps;
    const runtime = context.runtime;
    const state = context.state;

    const focusColor = (asString(props.focusColor) || DEFAULT_FOCUS_COLOR) as `#${string}`;
    const blurColor = (asString(props.blurColor) || DEFAULT_BLUR_COLOR) as `#${string}`;
    const borderColor = state.focused ? focusColor : blurColor;

    // --- root widget border color ---
    runtime.updateWidget(context.widget, {
        style: { borderColor },
    });

    // --- value text widget ---
    const valueKey = asString(props.valueKey);
    if (valueKey) {
        const valueWidget = runtime.getBoundWidget(valueKey);
        if (valueWidget !== null) {
            const displayText = getDisplayText(state.value, asBoolean(props.password, false));
            runtime.updateWidget(valueWidget, {
                text: {
                    value: displayText,
                    caretIndex: state.focused ? state.selectionStart : undefined,
                },
            });
        }
    }

    // --- placeholder text widget ---
    const placeholderKey = asString(props.placeholderKey);
    if (placeholderKey) {
        const placeholderWidget = runtime.getBoundWidget(placeholderKey);
        if (placeholderWidget !== null) {
            const showPlaceholder = state.value.length === 0;
            setWidgetVisible(runtime, placeholderWidget, showPlaceholder);
            if (showPlaceholder) {
                const placeholderText = asString(props.placeholder);
                runtime.updateWidget(placeholderWidget, {
                    text: { value: placeholderText },
                });
            }
        }
    }
};

/**
 * Sets the focused state and applies visuals. Returns true if the state changed.
 */
const setFocused = (context: EditBoxContext, focused: boolean): boolean => {
    const state = context.state;
    if (state.focused === focused) {
        return false;
    }
    state.focused = focused;
    if (!focused) {
        state.selectionStart = 0;
        state.selectionEnd = 0;
    }
    applyVisuals(context);
    return true;
};

/**
 * Computes a character index from a pointer X coordinate within the value
 * widget's layout box. Uses text layout caret positions for accurate
 * nearest-caret distance search when available, falling back to proportional
 * estimation when no layout data exists.
 */
const resolveCursorIndex = (context: EditBoxContext, pointerX: number): number => {
    const props = context.props as EditBoxControllerProps;
    const runtime = context.runtime;
    const state = context.state;

    const valueKey = asString(props.valueKey);
    if (!valueKey) {
        return state.value.length;
    }

    const valueWidget = runtime.getBoundWidget(valueKey);
    if (valueWidget === null) {
        return state.value.length;
    }

    const displayText = getDisplayText(state.value, asBoolean(props.password, false));
    if (displayText.length === 0) {
        return 0;
    }

    // Use text layout caret positions for accurate nearest-caret search.
    const layout = runtime.getTextLayout(valueWidget);
    const box = runtime.getLayoutBox(valueWidget);

    if (layout && layout.carets.length > 0) {
        let bestIndex = layout.carets[0].index;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const caret of layout.carets) {
            const caretCenterX = box.contentX + caret.x;
            const dx = caretCenterX - pointerX;
            const distance = dx * dx;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = caret.index;
            }
        }
        return bestIndex;
    }

    // Fallback: proportional estimation when no text layout is available.
    if (box.width <= 0) {
        return displayText.length;
    }
    const relativeX = pointerX - box.x;
    const ratio = clamp(relativeX / box.width, 0, 1);
    return Math.round(ratio * displayText.length);
};

/**
 * Inserts a character at the current cursor position, respecting maxLength.
 */
const insertCharacter = (context: EditBoxContext, char: string): void => {
    const props = context.props as EditBoxControllerProps;
    const state = context.state;

    if (asBoolean(props.readOnly, false)) {
        return;
    }

    const maxLength = asNumber(props.maxLength, Infinity);
    if (state.value.length >= maxLength) {
        return;
    }

    const cursor = state.selectionStart;
    state.value = state.value.slice(0, cursor) + char + state.value.slice(cursor);
    state.selectionStart = cursor + 1;
    state.selectionEnd = state.selectionStart;
    applyVisuals(context);
};

/**
 * Deletes the character before the cursor (backspace).
 */
const deleteBackward = (context: EditBoxContext): void => {
    const props = context.props as EditBoxControllerProps;
    const state = context.state;

    if (asBoolean(props.readOnly, false)) {
        return;
    }

    const cursor = state.selectionStart;
    if (cursor <= 0) {
        return;
    }

    state.value = state.value.slice(0, cursor - 1) + state.value.slice(cursor);
    state.selectionStart = cursor - 1;
    state.selectionEnd = state.selectionStart;
    applyVisuals(context);
};

/**
 * Deletes the character after the cursor (delete).
 */
const deleteForward = (context: EditBoxContext): void => {
    const props = context.props as EditBoxControllerProps;
    const state = context.state;

    if (asBoolean(props.readOnly, false)) {
        return;
    }

    const cursor = state.selectionStart;
    if (cursor >= state.value.length) {
        return;
    }

    state.value = state.value.slice(0, cursor) + state.value.slice(cursor + 1);
    state.selectionEnd = cursor;
    applyVisuals(context);
};

export const editBoxController: WidgetController<
    typeof EDIT_BOX_CONTROLLER_TYPE,
    Record<string, unknown>,
    EditBoxControllerState,
    UIRuntime,
    unknown
> = {
    type: EDIT_BOX_CONTROLLER_TYPE,
    createState: (props) => {
        const editBoxProps = props as EditBoxControllerProps;
        return {
            value: asString(editBoxProps.value),
            focused: false,
            selectionStart: 0,
            selectionEnd: 0,
        };
    },
    mount: (context) => {
        const typed = context as EditBoxContext;
        applyVisuals(typed);
    },
    update: (context, previousProps) => {
        const typed = context as EditBoxContext;
        const props = typed.props as EditBoxControllerProps;
        const previous = previousProps as EditBoxControllerProps;

        if (
            props.value !== previous.value ||
            props.placeholder !== previous.placeholder ||
            props.focusColor !== previous.focusColor ||
            props.blurColor !== previous.blurColor ||
            props.password !== previous.password ||
            props.valueKey !== previous.valueKey ||
            props.placeholderKey !== previous.placeholderKey ||
            props.maxLength !== previous.maxLength ||
            props.readOnly !== previous.readOnly
        ) {
            if (props.value !== previous.value) {
                const rawValue = asString(props.value);
                const maxLength = asNumber(props.maxLength, Infinity);
                const clampedValue =
                    rawValue.length > maxLength
                        ? rawValue.slice(0, Math.max(0, maxLength))
                        : rawValue;
                typed.state.value = clampedValue;
                if (typed.state.selectionStart > clampedValue.length) {
                    typed.state.selectionStart = clampedValue.length;
                }
                if (typed.state.selectionEnd > clampedValue.length) {
                    typed.state.selectionEnd = clampedValue.length;
                }
            } else if (props.maxLength !== previous.maxLength) {
                const maxLength = asNumber(props.maxLength, Infinity);
                if (typed.state.value.length > maxLength) {
                    const clampedValue = typed.state.value.slice(0, Math.max(0, maxLength));
                    typed.state.value = clampedValue;
                    if (typed.state.selectionStart > clampedValue.length) {
                        typed.state.selectionStart = clampedValue.length;
                    }
                    if (typed.state.selectionEnd > clampedValue.length) {
                        typed.state.selectionEnd = clampedValue.length;
                    }
                }
            }
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as EditBoxContext;
        const state = typed.state;
        if (!state) {
            return false;
        }

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'down': {
                    // Focus the edit box and set cursor position.
                    setFocused(typed, true);
                    const cursorIndex = resolveCursorIndex(typed, event.x);
                    state.selectionStart = cursorIndex;
                    state.selectionEnd = cursorIndex;
                    applyVisuals(typed);
                    return true;
                }
                default:
                    return false;
            }
        }

        if (event.type === 'key' && event.phase === 'down') {
            if (!state.focused) {
                return false;
            }

            const props = typed.props as EditBoxControllerProps;

            switch (event.key) {
                case 'Backspace':
                    deleteBackward(typed);
                    return true;
                case 'Delete':
                    deleteForward(typed);
                    return true;
                case 'ArrowLeft':
                    if (state.selectionStart > 0) {
                        state.selectionStart--;
                        state.selectionEnd = state.selectionStart;
                        applyVisuals(typed);
                    }
                    return true;
                case 'ArrowRight':
                    if (state.selectionStart < state.value.length) {
                        state.selectionStart++;
                        state.selectionEnd = state.selectionStart;
                        applyVisuals(typed);
                    }
                    return true;
                case 'Home':
                    state.selectionStart = 0;
                    state.selectionEnd = 0;
                    applyVisuals(typed);
                    return true;
                case 'End':
                    state.selectionStart = state.value.length;
                    state.selectionEnd = state.selectionStart;
                    applyVisuals(typed);
                    return true;
                case 'Enter':
                case 'Escape':
                    setFocused(typed, false);
                    return true;
                default:
                    // Printable characters: single-character keys with no modifier.
                    if (
                        !asBoolean(props.readOnly, false) &&
                        event.key.length === 1 &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.altKey
                    ) {
                        insertCharacter(typed, event.key);
                        return true;
                    }
                    return false;
            }
        }

        // Blur when focus leaves the window entirely.
        if (event.type === 'focus' && !event.focused) {
            if (state.focused) {
                setFocused(typed, false);
                return true;
            }
        }

        return false;
    },
};

/**
 * Reads the live text value of an edit-box widget driven by `edit-box`.
 * Returns null when the widget has no edit-box state.
 */
export const getEditBoxValue = (
    runtime: UIRuntime,
    widget: WidgetId
): string | null => {
    const state = runtime.getWidgetState(widget) as EditBoxControllerState | null;
    return state ? state.value : null;
};

/**
 * Programmatically sets the text value of an edit-box widget driven by `edit-box`.
 * No-op when the widget has no edit-box state.
 */
export const setEditBoxValue = (
    runtime: UIRuntime,
    widget: WidgetId,
    value: string
): void => {
    const state = runtime.getWidgetState(widget) as EditBoxControllerState | null;
    if (!state) {
        return;
    }
    state.value = value;
    // Clamp cursor to the new value length.
    if (state.selectionStart > value.length) {
        state.selectionStart = value.length;
    }
    if (state.selectionEnd > value.length) {
        state.selectionEnd = value.length;
    }
};
