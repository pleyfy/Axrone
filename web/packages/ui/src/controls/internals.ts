import type { UIRuntime } from '../runtime';
import type { ColorInput, TextBlockInput, WidgetId } from '../types';
import type { UIControlTheme, UIHandle, UIParentTarget, UISlotHandle } from './types';

export const DEFAULT_SELECTION_COLOR = '#2563eb55';

export const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

export const resolveParentWidget = <TRuntime>(runtime: UIRuntime<TRuntime>, parent: UIParentTarget): WidgetId => {
    if (parent === null || parent === undefined) {
        return runtime.root;
    }
    if (typeof parent === 'number') {
        return parent as WidgetId;
    }
    if ('content' in parent) {
        return parent.content;
    }
    return parent.root;
};

export const attachToParent = <TRuntime>(runtime: UIRuntime<TRuntime>, parent: UIParentTarget, widget: WidgetId): void => {
    runtime.appendChild(resolveParentWidget(runtime, parent), widget);
};

export const disposeWidget = <TRuntime>(runtime: UIRuntime<TRuntime>, widget: WidgetId): void => {
    try {
        runtime.removeWidget(widget);
    } catch {
        return;
    }
};

export const resolveFontFamily = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    theme: UIControlTheme,
    override?: string
): string => override ?? theme.fontFamily ?? runtime.fonts.getDefaultFamily() ?? '';

export const countStepDecimals = (step: number): number => {
    if (!Number.isFinite(step) || step <= 0) {
        return 0;
    }
    const parts = step.toString().split('.');
    return parts[1]?.length ?? 0;
};

export const formatNumericValue = (value: number, step = 0.1): string => {
    const decimals = clamp(countStepDecimals(step), 0, 3);
    const rounded = Number.parseFloat(value.toFixed(decimals));
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toString();
};

export const clampIndex = (value: number, max: number): number => clamp(Math.floor(value), 0, max);

export const normalizeRange = (min: number, max: number): { readonly min: number; readonly max: number } => {
    if (max >= min) {
        return { min, max };
    }
    return { min: max, max: min };
};

export const normalizeSteppedValue = (value: number, min: number, max: number, step: number): number => {
    const normalizedStep = Number.isFinite(step) && step > 0 ? step : 1;
    const clamped = clamp(value, min, max);
    const snapped = Math.round((clamped - min) / normalizedStep) * normalizedStep + min;
    return clamp(Number.parseFloat(snapped.toFixed(6)), min, max);
};

export const createTextBlock = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    value: string,
    theme: UIControlTheme,
    override: Partial<Omit<TextBlockInput, 'value'>> | undefined,
    fallbackColor: ColorInput
): TextBlockInput => ({
    value,
    family: resolveFontFamily(runtime, theme, override?.family),
    size: override?.size ?? theme.fontSize,
    color: override?.color ?? fallbackColor,
    wrap: override?.wrap ?? 'word',
    overflow: override?.overflow ?? 'ellipsis',
    align: override?.align ?? 'start',
    maxLines: override?.maxLines,
    lineHeight: override?.lineHeight,
    letterSpacing: override?.letterSpacing,
    weight: override?.weight,
    style: override?.style,
    locale: override?.locale,
    direction: override?.direction,
    outlineColor: override?.outlineColor,
    outlineWidth: override?.outlineWidth,
    edgeSoftness: override?.edgeSoftness,
    shadowColor: override?.shadowColor,
    shadowOffsetX: override?.shadowOffsetX,
    shadowOffsetY: override?.shadowOffsetY,
    underline: override?.underline,
    underlineColor: override?.underlineColor,
    underlineThickness: override?.underlineThickness,
    underlineOffset: override?.underlineOffset,
    strikeThrough: override?.strikeThrough,
    strikeThroughColor: override?.strikeThroughColor,
    strikeThroughThickness: override?.strikeThroughThickness,
    selectionStart: override?.selectionStart,
    selectionEnd: override?.selectionEnd,
    selectionColor: override?.selectionColor,
    caretIndex: override?.caretIndex,
    caretColor: override?.caretColor,
    caretWidth: override?.caretWidth,
    caretInset: override?.caretInset,
});

export const isPointInside = <TRuntime>(runtime: UIRuntime<TRuntime>, widget: WidgetId, x: number, y: number): boolean => {
    const box = runtime.getLayoutBox(widget);
    return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
};

export const createBaseHandle = <TRuntime>(runtime: UIRuntime<TRuntime>, root: WidgetId): UIHandle => ({
    root,
    dispose() {
        disposeWidget(runtime, root);
    },
});
