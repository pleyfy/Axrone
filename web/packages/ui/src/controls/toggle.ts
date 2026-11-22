import type { UIRuntime } from '../runtime';
import type { UIToggleHandle, UIToggleOptions } from './types';
import { attachToParent, createTextBlock, isPointInside } from './internals';
import { resolveTheme, resolveThemeScale, resolveVariantPalette } from './theme';
import { createStatefulControl } from './stateful-control';

const TOGGLE_PILL_RADIUS = 999;

export const createUIToggle = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIToggleOptions = {}
): UIToggleHandle => {
    const theme = resolveTheme(options.theme);
    const themeScale = resolveThemeScale(theme);
    const state = {
        checked: options.checked ?? false,
        disabled: options.disabled ?? false,
        hovered: false,
        pressed: false,
        focused: false,
        label: options.label ?? 'Toggle',
        onChange: options.onChange,
        variant: options.variant ?? 'primary',
    };
    const labelPlacement = options.labelPlacement ?? 'right';
    const trackHeight = Math.max(20, Math.round(theme.controlHeight * 0.68));
    const trackWidth = Math.max(Math.round(theme.controlHeight * 1.75), Math.round(48 * themeScale));
    const thumbSize = Math.max(16, Math.round(trackHeight - 6));

    let handle: UIToggleHandle;
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
                const shouldToggle = state.pressed && isPointInside(runtime, root, event.x, event.y);
                state.pressed = false;
                if (shouldToggle) {
                    state.checked = !state.checked;
                    state.onChange?.(state.checked, handle);
                }
                apply();
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) return false;
                if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                    state.checked = !state.checked;
                    state.onChange?.(state.checked, handle);
                    apply();
                    return true;
                }
                return false;
            },
        },
    });

    const root = runtime.createWidget({
        role: 'custom:toggle',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: Math.max(8, Math.round(theme.controlHeight * 0.24)),
            width: 'content',
            height: 'content',
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? '#00000000',
            ...(options.style ?? {}),
        },
        handlers: sc.handlers,
    });

    const track = runtime.createWidget({
        role: 'custom:toggle-track',
        layout: {
            width: trackWidth,
            height: trackHeight,
            display: 'overlay',
            shrink: 0,
        },
    });
    const thumb = runtime.createWidget({
        role: 'custom:toggle-thumb',
        layout: {
            position: 'absolute',
            width: thumbSize,
            height: thumbSize,
        },
    });
    const label = runtime.createWidget({
        role: 'text',
        layout: {
            width: 'content',
            height: 'content',
        },
    });

    attachToParent(runtime, options.parent, root);
    if (labelPlacement === 'left') {
        runtime.appendChild(root, label);
        runtime.appendChild(root, track);
    } else {
        runtime.appendChild(root, track);
        runtime.appendChild(root, label);
    }
    runtime.appendChild(track, thumb);

    applyRef = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const activeColor = state.checked ? palette.idle : theme.surfaceColor;
        const hoverColor = state.checked ? palette.hover : theme.surfaceHoverColor;
        const currentColor = state.disabled
            ? theme.surfaceDisabledColor
            : state.hovered || state.focused
              ? hoverColor
              : activeColor;

        sc.syncDisabled(root, options.focus ?? {});
        runtime.updateWidget(track, {
            style: {
                background: currentColor,
                borderColor: state.focused ? theme.focusColor : state.checked ? palette.border : theme.borderColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : theme.borderWidth,
                radius: TOGGLE_PILL_RADIUS,
            },
        });
        runtime.updateWidget(thumb, {
            layout: {
                position: 'absolute',
                width: thumbSize,
                height: thumbSize,
                anchor: {
                    x: state.checked ? 1 : 0,
                    y: 0.5,
                    pivotX: state.checked ? 1 : 0,
                    pivotY: 0.5,
                    offsetX: state.checked ? -3 : 3,
                    offsetY: 0,
                },
            },
            style: {
                background: state.disabled ? theme.textMutedColor : theme.thumbColor,
                borderColor: '#00000018',
                borderWidth: 1,
                radius: TOGGLE_PILL_RADIUS,
            },
        });
        runtime.updateWidget(label, {
            text: createTextBlock(runtime, state.label, theme, { wrap: 'none' }, state.disabled ? theme.textMutedColor : theme.textColor),
            style: {
                color: state.disabled ? theme.textMutedColor : theme.textColor,
            },
        });
    };

    handle = {
        root,
        isChecked() {
            return state.checked;
        },
        setChecked(checked) {
            state.checked = checked;
            apply();
        },
        toggle() {
            if (!state.disabled) {
                state.checked = !state.checked;
                state.onChange?.(state.checked, handle);
                apply();
            }
        },
        setDisabled(disabled) {
            sc.setDisabled(disabled, root, options.focus ?? {});
        },
        dispose() {
            sc.dispose(root);
        },
    };

    apply();
    return handle;
};
