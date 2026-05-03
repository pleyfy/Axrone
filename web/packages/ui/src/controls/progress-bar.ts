import type { UIRuntime } from '../runtime';
import type { PercentageString } from '../types';
import type { UIProgressBarHandle, UIProgressBarOptions } from './types';
import { attachToParent, clamp, createTextBlock, disposeWidget, formatNumericValue, normalizeRange } from './internals';
import { resolveTheme, resolveVariantPalette } from './theme';

export const createUIProgressBar = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIProgressBarOptions = {}
): UIProgressBarHandle => {
    const theme = resolveTheme(options.theme);
    const trackHeight = Math.max(8, Math.round(theme.controlHeight * 0.34));
    const range = normalizeRange(options.min ?? 0, options.max ?? 1);
    const state = {
        label: options.label ?? 'Progress',
        min: range.min,
        max: range.max,
        value: clamp(options.value ?? range.min, range.min, range.max),
        showValue: options.showValue ?? true,
        variant: options.variant ?? 'primary',
    };
    const root = runtime.createWidget({
        role: 'custom:progress-bar',
        key: options.key,
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
    const labelWidget = runtime.createWidget({
        role: 'text',
        layout: {
            width: 'content',
            height: 'content',
        },
        style: {
            color: theme.textColor,
        },
    });
    const track = runtime.createWidget({
        role: 'custom:progress-track',
        layout: {
            width: '100%',
            height: trackHeight,
            display: 'overlay',
        },
    });
    const fill = runtime.createWidget({
        role: 'custom:progress-fill',
        layout: {
            position: 'absolute',
            anchor: 'left',
            inset: { left: 0, top: 0, bottom: 0 },
            width: '0%',
        },
    });

    attachToParent(runtime, options.parent, root);
    if (state.showValue || state.label) {
        runtime.appendChild(root, labelWidget);
    }
    runtime.appendChild(root, track);
    runtime.appendChild(track, fill);

    const apply = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const percent = state.max === state.min ? 0 : (state.value - state.min) / (state.max - state.min);
        const percentString = `${clamp(percent * 100, 0, 100)}%` as PercentageString;
        const valueText = state.showValue ? `${formatNumericValue(state.value, 0.01)} / ${formatNumericValue(state.max, 0.01)}` : '';
        const labelText = state.label && state.showValue ? `${state.label}  ${valueText}` : state.label || valueText;

        if (state.showValue || state.label) {
            runtime.updateWidget(labelWidget, {
                text: createTextBlock(runtime, labelText, theme, { wrap: 'none' }, theme.textColor),
            });
        }

        runtime.updateWidget(track, {
            style: {
                background: theme.trackColor,
                borderColor: theme.borderMutedColor,
                borderWidth: theme.borderWidth,
                radius: 999,
            },
        });
        runtime.updateWidget(fill, {
            layout: {
                position: 'absolute',
                anchor: 'left',
                inset: { left: 0, top: 0, bottom: 0 },
                width: percentString,
            },
            style: {
                background: palette.idle,
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 999,
            },
        });
    };

    apply();

    return {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            state.value = clamp(value, state.min, state.max);
            apply();
        },
        setRange(min, max) {
            const next = normalizeRange(min, max);
            state.min = next.min;
            state.max = next.max;
            state.value = clamp(state.value, state.min, state.max);
            apply();
        },
        setLabel(label) {
            state.label = label;
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};