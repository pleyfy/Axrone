import type { UIRuntime } from '../runtime';
import type { UIKeyEvent, UIPointerEvent } from '../types';
import type { UISliderHandle, UISliderOptions } from './types';
import {
    attachToParent,
    clamp,
    createTextBlock,
    disposeWidget,
    formatNumericValue,
    isPointInside,
    normalizeRange,
    normalizeSteppedValue,
} from './internals';
import { resolveTheme, resolveVariantPalette } from './theme';

export const createUISlider = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UISliderOptions = {}
): UISliderHandle => {
    const theme = resolveTheme(options.theme);
    const trackHeight = Math.max(12, Math.round(theme.controlHeight * 0.48));
    const thumbSize = Math.max(14, Math.round(trackHeight - 2));
    const range = normalizeRange(options.min ?? 0, options.max ?? 1);
    const state = {
        label: options.label ?? '',
        min: range.min,
        max: range.max,
        step: options.step ?? 0.01,
        value: normalizeSteppedValue(options.value ?? range.min, range.min, range.max, options.step ?? 0.01),
        showValue: options.showValue ?? true,
        disabled: options.disabled ?? false,
        dragging: false,
        focused: false,
        variant: options.variant ?? 'primary',
        onChange: options.onChange,
    };

    const root = runtime.createWidget({
        role: 'custom:slider',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'stack',
            direction: 'column',
            gap: 8,
            width: 260,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? '#00000000',
            ...(options.style ?? {}),
        },
    });
    const header = runtime.createWidget({
        role: 'text',
    });
    const track = runtime.createWidget({
        role: 'custom:slider-track',
        layout: {
            width: '100%',
            height: trackHeight,
            display: 'overlay',
        },
    });
    const rail = runtime.createWidget({
        role: 'custom:slider-rail',
        layout: {
            position: 'absolute',
            anchor: {
                x: 0,
                y: 0.5,
                pivotX: 0,
                pivotY: 0.5,
            },
            inset: { left: 0, right: 0 },
            height: 6,
        },
    });
    const fill = runtime.createWidget({
        role: 'custom:slider-fill',
        layout: {
            position: 'absolute',
            anchor: {
                x: 0,
                y: 0.5,
                pivotX: 0,
                pivotY: 0.5,
            },
            inset: { left: 0 },
            width: '0%',
            height: Math.max(4, Math.round(trackHeight * 0.34)),
        },
    });
    const thumb = runtime.createWidget({
        role: 'custom:slider-thumb',
        layout: {
            position: 'absolute',
            width: thumbSize,
            height: thumbSize,
        },
    });

    attachToParent(runtime, options.parent, root);
    if (state.label || state.showValue) {
        runtime.appendChild(root, header);
    }
    runtime.appendChild(root, track);
    runtime.appendChild(track, rail);
    runtime.appendChild(track, fill);
    runtime.appendChild(track, thumb);

    let handle: UISliderHandle;

    const setValueInternal = (value: number, emit: boolean): void => {
        const nextValue = normalizeSteppedValue(value, state.min, state.max, state.step);
        if (nextValue === state.value) {
            apply();
            return;
        }
        state.value = nextValue;
        if (emit) {
            state.onChange?.(state.value, handle);
        }
        apply();
    };

    const updateFromPointer = (event: Readonly<UIPointerEvent>): void => {
        const box = runtime.getLayoutBox(track);
        const ratio = clamp((event.x - box.x) / Math.max(box.width, 1), 0, 1);
        setValueInternal(state.min + (state.max - state.min) * ratio, true);
    };

    const apply = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const ratio = state.max === state.min ? 0 : (state.value - state.min) / (state.max - state.min);
        const percent = clamp(ratio * 100, 0, 100);
        const headerText = state.label && state.showValue
            ? `${state.label}: ${formatNumericValue(state.value, state.step)}`
            : state.label || (state.showValue ? formatNumericValue(state.value, state.step) : '');

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            handlers: {
                pointerDown: (event) => {
                    if (state.disabled) {
                        return false;
                    }
                    runtime.setFocus(root, 'pointer');
                    if (isPointInside(runtime, track, event.x, event.y)) {
                        state.dragging = true;
                        updateFromPointer(event);
                    }
                    return true;
                },
                pointerMove: (event) => {
                    if (!state.dragging || state.disabled) {
                        return false;
                    }
                    updateFromPointer(event);
                    return true;
                },
                pointerUp: (event) => {
                    if (!state.dragging || state.disabled) {
                        return false;
                    }
                    updateFromPointer(event);
                    state.dragging = false;
                    return true;
                },
                keyDown: (event: Readonly<UIKeyEvent>) => {
                    if (state.disabled) {
                        return false;
                    }
                    switch (event.key) {
                        case 'ArrowLeft':
                        case 'ArrowDown':
                            setValueInternal(state.value - state.step, true);
                            return true;
                        case 'ArrowRight':
                        case 'ArrowUp':
                            setValueInternal(state.value + state.step, true);
                            return true;
                        case 'Home':
                            setValueInternal(state.min, true);
                            return true;
                        case 'End':
                            setValueInternal(state.max, true);
                            return true;
                        case 'PageDown':
                            setValueInternal(state.value - state.step * 10, true);
                            return true;
                        case 'PageUp':
                            setValueInternal(state.value + state.step * 10, true);
                            return true;
                        default:
                            return false;
                    }
                },
                focus: () => {
                    state.focused = true;
                    apply();
                },
                blur: () => {
                    state.focused = false;
                    state.dragging = false;
                    apply();
                },
            },
        });

        if (state.label || state.showValue) {
            runtime.updateWidget(header, {
                text: createTextBlock(runtime, headerText, theme, { wrap: 'none' }, state.disabled ? theme.textMutedColor : theme.textColor),
                style: {
                    color: state.disabled ? theme.textMutedColor : theme.textColor,
                },
            });
        }

        runtime.updateWidget(track, {
            style: {
                background: '#00000000',
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 0,
            },
        });
        runtime.updateWidget(rail, {
            style: {
                background: theme.trackColor,
                borderColor: state.focused ? theme.focusColor : theme.borderMutedColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : theme.borderWidth,
                radius: 999,
            },
        });
        runtime.updateWidget(fill, {
            layout: {
                position: 'absolute',
                anchor: {
                    x: 0,
                    y: 0.5,
                    pivotX: 0,
                    pivotY: 0.5,
                },
                inset: { left: 0 },
                width: `${percent}%`,
                height: Math.max(4, Math.round(trackHeight * 0.34)),
            },
            style: {
                background: state.disabled ? theme.surfaceDisabledColor : palette.idle,
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 999,
            },
        });
        runtime.updateWidget(thumb, {
            layout: {
                position: 'absolute',
                width: thumbSize,
                height: thumbSize,
                anchor: {
                    x: percent / 100,
                    y: 0.5,
                    pivotX: 0.5,
                    pivotY: 0.5,
                },
            },
            style: {
                background: state.disabled ? theme.textMutedColor : theme.thumbColor,
                borderColor: state.focused ? theme.focusColor : palette.border,
                borderWidth: theme.borderWidth,
                radius: 999,
            },
        });
    };

    handle = {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            setValueInternal(value, false);
        },
        setRange(min, max) {
            const next = normalizeRange(min, max);
            state.min = next.min;
            state.max = next.max;
            state.value = normalizeSteppedValue(state.value, state.min, state.max, state.step);
            apply();
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.dragging = false;
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};