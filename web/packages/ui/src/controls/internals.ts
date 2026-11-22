import { clamp } from '@axrone/numeric';
import type { UIRuntime } from '../runtime';
import type { ColorInput, TextBlockInput, UIImageSource, WidgetId } from '../types';
import type { UIControlTheme, UIHandle, UIParentTarget, UISlotHandle } from './types';

export const DEFAULT_SELECTION_COLOR = '#2563eb55';

// ─── Coercion helpers ────────────────────────────────────────────────────────
// Canonical as* helpers used by all controllers. Button uses asStringOrNull
// for null-returning semantics; the other 10 controllers use asString with
// trimmed string semantics (returns empty string for non-strings).

/** Coerces unknown to string | null. Returns null for non-strings or empty/whitespace-only strings. */
export const asStringOrNull = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null;

/** Coerces unknown to trimmed string. Returns empty string for non-strings. */
export const asString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

/** Coerces unknown to number with fallback. Returns fallback for non-finite numbers. */
export const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Coerces unknown to boolean with fallback. Returns fallback for non-booleans. */
export const asBoolean = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

/** Coerces unknown to Record<string, unknown>. Returns empty object for non-objects or arrays. */
export const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

// ─── Image-source helpers ────────────────────────────────────────────────────
// Shared helpers for controllers that swap image sources (button, checkbox).

/**
 * Inline image-source descriptor for per-state sprite swapping.
 * Mirrors `UIImageSource` without requiring an import-time dependency on the
 * full widget type — keeps the props contract self-contained in JSON.
 */
export interface ImageSourceInput {
    readonly kind: 'texture' | 'material';
    readonly resourceId?: string;
    readonly materialId?: string;
    readonly textureBinding?: string;
    readonly width: number;
    readonly height: number;
}

/** Type guard: checks if unknown value is a valid UIImageSource. */
export const isValidImageSource = (source: unknown): source is UIImageSource => {
    if (!source || typeof source !== 'object') return false;
    const src = source as Record<string, unknown>;
    if (src.kind === 'texture') return typeof src.resourceId === 'string' && !!src.resourceId;
    if (src.kind === 'material') return typeof src.materialId === 'string' && !!src.materialId;
    return false;
};

/** Converts an ImageSourceInput to a UIImageSource, or null if invalid. */
export const toImageSource = (input: ImageSourceInput): UIImageSource | null => {
    if (input.kind === 'texture' && input.resourceId) {
        return { kind: 'texture', resourceId: input.resourceId, width: input.width, height: input.height };
    }
    if (input.kind === 'material' && input.materialId) {
        return {
            kind: 'material',
            materialId: input.materialId,
            textureBinding: input.textureBinding,
            width: input.width,
            height: input.height,
        };
    }
    return null;
};

/** Extracts an ImageSourceInput from a raw record (e.g. from JSON props). */
export const extractSourceInput = (record: Record<string, unknown>): ImageSourceInput | null => {
    const kind = record.kind;
    if (kind !== 'texture' && kind !== 'material') return null;
    const width = Number(record.width);
    const height = Number(record.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const result: Record<string, unknown> = { kind, width, height };
    if (typeof record.resourceId === 'string') result.resourceId = record.resourceId;
    if (typeof record.materialId === 'string') result.materialId = record.materialId;
    if (typeof record.textureBinding === 'string') result.textureBinding = record.textureBinding;
    return result as unknown as ImageSourceInput;
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

export const hitTestBoundWidget = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    widget: WidgetId,
    x: number,
    y: number
): boolean => {
    const box = runtime.getLayoutBox(widget);
    return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
};

export const asArray = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const asFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

export const asColorString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null;

export const setWidgetVisible = <TRuntime>(runtime: UIRuntime<TRuntime>, widget: WidgetId, visible: boolean): void => {
    runtime.updateWidget(widget, { enabled: visible, style: { visible } });
};

export const createBaseHandle = <TRuntime>(runtime: UIRuntime<TRuntime>, root: WidgetId): UIHandle => ({
    root,
    dispose() {
        disposeWidget(runtime, root);
    },
});
