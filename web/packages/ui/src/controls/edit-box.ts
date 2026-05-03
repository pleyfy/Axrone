import type { UIRuntime } from '../runtime';
import type { UIKeyEvent, UIPointerEvent } from '../types';
import type { UIEditBoxHandle, UIEditBoxOptions } from './types';
import { DEFAULT_SELECTION_COLOR, attachToParent, clampIndex, createTextBlock, disposeWidget } from './internals';
import { resolveTheme } from './theme';

export const createUIEditBox = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIEditBoxOptions = {}
): UIEditBoxHandle => {
    const theme = resolveTheme(options.theme);
    const textOverrides = options.text ?? {};
    const state = {
        value: options.value ?? '',
        placeholder: options.placeholder ?? 'Type here',
        multiline: options.multiline ?? false,
        password: options.password ?? false,
        readOnly: options.readOnly ?? false,
        disabled: options.disabled ?? false,
        hovered: false,
        focused: false,
        caretIndex: 0,
        anchorIndex: null as number | null,
        onChange: options.onChange,
        onSubmit: options.onSubmit,
    };
    state.caretIndex = state.value.length;

    let handle: UIEditBoxHandle;

    const getSelectionBounds = (): readonly [number, number] | null => {
        if (state.anchorIndex === null || state.anchorIndex === state.caretIndex) {
            return null;
        }
        return state.anchorIndex < state.caretIndex
            ? [state.anchorIndex, state.caretIndex]
            : [state.caretIndex, state.anchorIndex];
    };

    const clearSelection = (): void => {
        state.anchorIndex = null;
    };

    const commitTextChange = (): void => {
        state.onChange?.(state.value, handle);
        apply();
    };

    const replaceSelection = (text: string): void => {
        const bounds = getSelectionBounds();
        const start = bounds ? bounds[0] : state.caretIndex;
        const end = bounds ? bounds[1] : state.caretIndex;
        state.value = `${state.value.slice(0, start)}${text}${state.value.slice(end)}`;
        state.caretIndex = start + text.length;
        clearSelection();
        commitTextChange();
    };

    const setCaretInternal = (index: number, extend = false): void => {
        const nextIndex = clampIndex(index, state.value.length);
        if (extend) {
            state.anchorIndex ??= state.caretIndex;
        } else {
            clearSelection();
        }
        state.caretIndex = nextIndex;
        apply();
    };

    const deleteBackward = (): void => {
        if (state.readOnly || state.disabled) {
            return;
        }
        const bounds = getSelectionBounds();
        if (bounds) {
            replaceSelection('');
            return;
        }
        if (state.caretIndex <= 0) {
            return;
        }
        state.value = `${state.value.slice(0, state.caretIndex - 1)}${state.value.slice(state.caretIndex)}`;
        state.caretIndex -= 1;
        commitTextChange();
    };

    const deleteForward = (): void => {
        if (state.readOnly || state.disabled) {
            return;
        }
        const bounds = getSelectionBounds();
        if (bounds) {
            replaceSelection('');
            return;
        }
        if (state.caretIndex >= state.value.length) {
            return;
        }
        state.value = `${state.value.slice(0, state.caretIndex)}${state.value.slice(state.caretIndex + 1)}`;
        commitTextChange();
    };

    const resolveDisplayValue = (): string => {
        if (state.password) {
            return '*'.repeat(state.value.length);
        }
        return state.value;
    };

    const setCaretFromPointer = (event: Readonly<UIPointerEvent>, extend = false): void => {
        const displayValue = resolveDisplayValue();
        if (displayValue.length === 0) {
            setCaretInternal(0, extend);
            return;
        }
        const layout = runtime.getTextLayout(root);
        const box = runtime.getLayoutBox(root);
        if (!layout || layout.carets.length === 0) {
            setCaretInternal(displayValue.length, extend);
            return;
        }

        let bestIndex = layout.carets[0].index;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const caret of layout.carets) {
            const dx = box.contentX + caret.x - event.x;
            const dy = box.contentY + caret.y + caret.height * 0.5 - event.y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = caret.index;
            }
        }
        setCaretInternal(bestIndex, extend);
    };

    const root = runtime.createWidget({
        role: 'input',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            width: 260,
            height: state.multiline ? 96 : theme.controlHeight,
            padding: [10, 12],
            ...(options.layout ?? {}),
        },
        handlers: {
            pointerEnter: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = true;
                apply();
                return true;
            },
            pointerLeave: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = false;
                apply();
                return true;
            },
            pointerDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                runtime.setFocus(root, 'pointer');
                setCaretFromPointer(event, Boolean(event.shiftKey));
                return true;
            },
            keyDown: (event: Readonly<UIKeyEvent>) => {
                if (state.disabled) {
                    return false;
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                    state.anchorIndex = 0;
                    state.caretIndex = state.value.length;
                    apply();
                    return true;
                }
                switch (event.key) {
                    case 'ArrowLeft':
                        setCaretInternal(state.caretIndex - 1, Boolean(event.shiftKey));
                        return true;
                    case 'ArrowRight':
                        setCaretInternal(state.caretIndex + 1, Boolean(event.shiftKey));
                        return true;
                    case 'Home':
                        setCaretInternal(0, Boolean(event.shiftKey));
                        return true;
                    case 'End':
                        setCaretInternal(state.value.length, Boolean(event.shiftKey));
                        return true;
                    case 'Backspace':
                        deleteBackward();
                        return true;
                    case 'Delete':
                        deleteForward();
                        return true;
                    case 'Enter':
                        if (state.multiline) {
                            replaceSelection('\n');
                        } else {
                            state.onSubmit?.(state.value, handle);
                        }
                        return true;
                    default:
                        return false;
                }
            },
            textInput: (event) => {
                if (state.readOnly || state.disabled) {
                    return true;
                }
                replaceSelection(event.text);
                return true;
            },
            focus: () => {
                state.focused = true;
                apply();
            },
            blur: () => {
                state.focused = false;
                clearSelection();
                apply();
            },
        },
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        const displayValue = resolveDisplayValue();
        const placeholderVisible = displayValue.length === 0;
        const selection = state.focused && !placeholderVisible ? getSelectionBounds() : null;
        const textColor = placeholderVisible ? theme.placeholderColor : textOverrides.color ?? theme.textColor;

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            style: {
                ...(options.style ?? {}),
                background: state.disabled ? theme.surfaceDisabledColor : options.style?.background ?? theme.surfaceColor,
                borderColor: state.focused ? theme.focusColor : state.hovered ? theme.borderColor : theme.borderMutedColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : options.style?.borderWidth ?? theme.borderWidth,
                radius: options.style?.radius ?? theme.controlRadius,
                clip: true,
                color: textColor,
            },
            text: createTextBlock(runtime, placeholderVisible ? state.placeholder : displayValue, theme, {
                wrap: state.multiline ? 'word' : 'none',
                overflow: state.multiline ? 'clip' : 'ellipsis',
                ...(textOverrides ?? {}),
                color: textColor,
                selectionStart: selection?.[0],
                selectionEnd: selection?.[1],
                selectionColor: textOverrides.selectionColor ?? DEFAULT_SELECTION_COLOR,
                caretIndex: state.focused && !placeholderVisible ? state.caretIndex : undefined,
                caretColor: theme.textColor,
                caretWidth: textOverrides.caretWidth ?? 2,
            }, textColor),
        });
    };

    handle = {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            state.value = value;
            state.caretIndex = clampIndex(state.caretIndex, state.value.length);
            clearSelection();
            apply();
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.hovered = false;
            apply();
        },
        setReadOnly(readOnly) {
            state.readOnly = readOnly;
            apply();
        },
        setSelection(start, end) {
            state.anchorIndex = clampIndex(start, state.value.length);
            state.caretIndex = clampIndex(end, state.value.length);
            apply();
        },
        setCaret(index) {
            setCaretInternal(index, false);
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};