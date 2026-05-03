import type { UIRuntime } from '../runtime';
import type { UIButtonHandle, UIButtonOptions } from './types';
import { attachToParent, createTextBlock, disposeWidget, isPointInside } from './internals';
import { resolveTheme, resolveVariantPalette } from './theme';

export const createUIButton = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIButtonOptions = {}
): UIButtonHandle => {
    const theme = resolveTheme(options.theme);
    const baseStyle = options.style ?? {};
    const baseText = options.text ?? {};
    const palette = () => resolveVariantPalette(theme, state.variant);
    const state = {
        label: options.label ?? 'Button',
        disabled: options.disabled ?? false,
        hovered: false,
        pressed: false,
        focused: false,
        variant: options.variant ?? 'primary',
        onPress: options.onPress,
    };

    let handle: UIButtonHandle;

    const root = runtime.createWidget({
        role: 'button',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            width: 'content',
            height: 'content',
            minWidth: Math.max(88, Math.round(theme.controlHeight * 2.1)),
            minHeight: theme.controlHeight,
            padding: [12, 20],
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
            pointerDown: () => {
                if (state.disabled) {
                    return false;
                }
                state.pressed = true;
                runtime.setFocus(root, 'pointer');
                apply();
                return true;
            },
            pointerUp: (event) => {
                if (state.disabled) {
                    return false;
                }
                const shouldPress = state.pressed && isPointInside(runtime, root, event.x, event.y);
                state.pressed = false;
                apply();
                if (shouldPress) {
                    state.onPress?.(handle);
                }
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                    state.onPress?.(handle);
                    return true;
                }
                return false;
            },
            focus: () => {
                state.focused = true;
                apply();
            },
            blur: () => {
                state.focused = false;
                state.pressed = false;
                apply();
            },
        },
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        const currentPalette = palette();
        const background = state.disabled
            ? theme.surfaceDisabledColor
            : state.pressed && state.hovered
              ? currentPalette.pressed
              : state.hovered
                ? currentPalette.hover
                : currentPalette.idle;
        const borderColor = state.focused ? theme.focusColor : currentPalette.border;
        const textColor = state.disabled ? theme.textMutedColor : baseText.color ?? currentPalette.text;

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            style: {
                ...baseStyle,
                background,
                borderColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : baseStyle.borderWidth ?? theme.borderWidth,
                radius: baseStyle.radius ?? theme.controlRadius,
                color: textColor,
            },
            text: createTextBlock(runtime, state.label, theme, {
                align: 'center',
                wrap: 'none',
                overflow: 'ellipsis',
                weight: baseText.weight ?? 'medium',
                ...(baseText ?? {}),
                color: textColor,
            }, textColor),
        });
    };

    handle = {
        root,
        getLabel() {
            return state.label;
        },
        setLabel(value) {
            state.label = value;
            apply();
        },
        isDisabled() {
            return state.disabled;
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.pressed = false;
            state.hovered = false;
            apply();
        },
        setVariant(variant) {
            state.variant = variant;
            apply();
        },
        setOnPress(handler) {
            state.onPress = handler;
        },
        press() {
            if (!state.disabled) {
                state.onPress?.(handle);
            }
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};