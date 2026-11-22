import type { UIRuntime } from '../runtime';
import type { UIButtonHandle, UIButtonOptions } from './types';
import { attachToParent, createTextBlock, isPointInside } from './internals';
import { resolveTheme, resolveVariantPalette } from './theme';
import { createStatefulControl } from './stateful-control';

const BUTTON_MIN_WIDTH = 88;

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
    let applyRef: () => void = () => {};
    const apply = () => applyRef();

    const sc = createStatefulControl<typeof state>(runtime, {
        state,
        apply,
        handlers: {
            pointerEnter: () => {
                if (state.disabled) return false;
                state.hovered = true;
                apply();
                return true;
            },
            pointerLeave: () => {
                if (state.disabled) return false;
                state.hovered = false;
                apply();
                return true;
            },
            pointerDown: () => {
                if (state.disabled) return false;
                state.pressed = true;
                runtime.setFocus(root, 'pointer');
                apply();
                return true;
            },
            pointerUp: (event) => {
                if (state.disabled) return false;
                const shouldPress = state.pressed && isPointInside(runtime, root, event.x, event.y);
                state.pressed = false;
                apply();
                if (shouldPress) {
                    state.onPress?.(handle);
                }
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) return false;
                if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                    state.onPress?.(handle);
                    return true;
                }
                return false;
            },
        },
    });

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
            minWidth: Math.max(BUTTON_MIN_WIDTH, Math.round(theme.controlHeight * 2.1)),
            minHeight: theme.controlHeight,
            padding: [12, 20],
            ...(options.layout ?? {}),
        },
        handlers: sc.handlers,
    });

    attachToParent(runtime, options.parent, root);

    applyRef = (): void => {
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

        sc.syncDisabled(root, options.focus ?? {});
        runtime.updateWidget(root, {
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
            sc.setDisabled(disabled, root, options.focus ?? {});
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
            sc.dispose(root);
        },
    };

    apply();
    return handle;
};
