import type {
    ColorInput,
    LayoutBox,
    ReadonlyColor,
    ResolvedTextBlock,
    TextBlockInput,
    WidgetEventHandlers,
    WidgetFocusPolicyInput,
    WidgetImageInput,
    WidgetLayoutInput,
    WidgetPatch,
    WidgetStyleInput,
} from '../types';
import { isPlainObject } from '@axrone/utility';

export const EMPTY_RECORD_OBJECT: Readonly<Record<string, unknown>> = Object.freeze({});
export const EMPTY_LAYOUT_INPUT: WidgetLayoutInput = Object.freeze({});
export const EMPTY_STYLE_INPUT: WidgetStyleInput = Object.freeze({});
export const EMPTY_FOCUS_INPUT: WidgetFocusPolicyInput = Object.freeze({});
export const TRANSPARENT: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
export const BLACK: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const WHITE: ReadonlyColor = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

export const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const isColorLike = (
    value: ColorInput
): value is { readonly r: number; readonly g: number; readonly b: number; readonly a?: number } =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const cloneData = <TValue>(value: TValue): TValue => {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneData(entry)) as TValue;
    }
    if (isPlainObject(value)) {
        const clone: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'function' || typeof entry === 'symbol') {
                continue;
            }
            clone[key] = cloneData(entry);
        }
        return clone as TValue;
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
        return undefined as TValue;
    }
    return value;
};

const colorFromNumber = (value: number): ReadonlyColor => ({
    r: ((value >>> 24) & 0xff) / 255,
    g: ((value >>> 16) & 0xff) / 255,
    b: ((value >>> 8) & 0xff) / 255,
    a: (value & 0xff) / 255,
});

const colorFromHex = (value: string): ReadonlyColor => {
    const hex = value.replace('#', '').trim();
    if (hex.length === 3) {
        return {
            r: Number.parseInt(hex[0] + hex[0], 16) / 255,
            g: Number.parseInt(hex[1] + hex[1], 16) / 255,
            b: Number.parseInt(hex[2] + hex[2], 16) / 255,
            a: 1,
        };
    }
    if (hex.length === 6 || hex.length === 8) {
        return {
            r: Number.parseInt(hex.slice(0, 2), 16) / 255,
            g: Number.parseInt(hex.slice(2, 4), 16) / 255,
            b: Number.parseInt(hex.slice(4, 6), 16) / 255,
            a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
    }
    return TRANSPARENT;
};

export const normalizeColor = (input: ColorInput | undefined, fallback: ReadonlyColor): ReadonlyColor => {
    if (input === undefined) {
        return fallback;
    }
    if (typeof input === 'number') {
        return colorFromNumber(input >>> 0);
    }
    if (typeof input === 'string') {
        return colorFromHex(input);
    }
    if (Array.isArray(input)) {
        if (input.length === 3) {
            return { r: input[0], g: input[1], b: input[2], a: 1 };
        }
        return { r: input[0], g: input[1], b: input[2], a: input[3] };
    }
    if (!isColorLike(input)) {
        return fallback;
    }
    return {
        r: input.r,
        g: input.g,
        b: input.b,
        a: input.a ?? 1,
    };
};

export const normalizeWeight = (value: ResolvedTextBlock['weight'] | TextBlockInput['weight']): number => {
    switch (value) {
        case 'thin':
            return 100;
        case 'extralight':
            return 200;
        case 'light':
            return 300;
        case 'normal':
            return 400;
        case 'medium':
            return 500;
        case 'semibold':
            return 600;
        case 'bold':
            return 700;
        case 'extrabold':
            return 800;
        case 'black':
            return 900;
        case undefined:
            return 400;
        default:
            return value;
    }
};

export const mergeLayoutInput = (
    base: WidgetLayoutInput,
    patch: WidgetPatch['layout'] | undefined
): WidgetLayoutInput => {
    if (!patch) {
        return base;
    }
    return {
        ...base,
        ...patch,
        inset: patch.inset ? { ...(base.inset ?? {}), ...patch.inset } : base.inset,
        anchor:
            patch.anchor && isPlainObject(patch.anchor) && isPlainObject(base.anchor)
                ? { ...base.anchor, ...patch.anchor }
                : patch.anchor ?? base.anchor,
    } as WidgetLayoutInput;
};

export const mergeStyleInput = (
    base: WidgetStyleInput,
    patch: WidgetPatch['style'] | undefined
): WidgetStyleInput => ({ ...(base ?? {}), ...(patch ?? {}) }) as WidgetStyleInput;

export const mergeTextInput = (
    base: TextBlockInput | null,
    patch: WidgetPatch['text'] | undefined
): TextBlockInput | null => {
    if (patch === undefined) {
        return base;
    }
    if (patch === null) {
        return null;
    }
    return { ...(base ?? { value: '' }), ...patch } as TextBlockInput;
};

export const mergeImageInput = (
    base: WidgetImageInput | null,
    patch: WidgetPatch['image'] | undefined
): WidgetImageInput | null => {
    if (patch === undefined) {
        return base;
    }
    if (patch === null) {
        return null;
    }
    const next = patch as WidgetImageInput;
    return {
        ...(base ?? {}),
        ...next,
        uvRect: next.uvRect ? { ...(base?.uvRect ?? {}), ...next.uvRect } : base?.uvRect,
    } as WidgetImageInput;
};

export const mergeFocusInput = (
    base: WidgetFocusPolicyInput,
    patch: WidgetPatch['focus'] | undefined
): WidgetFocusPolicyInput => ({ ...(base ?? {}), ...(patch ?? {}) });

export const mergeHandlers = <TRuntime>(
    base: WidgetEventHandlers<Record<string, unknown>, TRuntime> | null,
    patch: WidgetEventHandlers<Record<string, unknown>, TRuntime> | undefined
): WidgetEventHandlers<Record<string, unknown>, TRuntime> | null => {
    if (patch === undefined) {
        return base;
    }
    return { ...(base ?? {}), ...patch };
};

export const mergeProps = (
    base: Readonly<Record<string, unknown>>,
    patch: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> => ({ ...(base ?? EMPTY_RECORD_OBJECT), ...(patch ?? {}) });

export const normalizeIndex = (value: number | undefined): number | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.floor(value));
};

export const normalizeUvRect = (
    input: WidgetImageInput['uvRect']
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
    const x = clamp(input?.x ?? 0, 0, 1);
    const y = clamp(input?.y ?? 0, 0, 1);
    const width = clamp(input?.width ?? 1, 0, 1 - x);
    const height = clamp(input?.height ?? 1, 0, 1 - y);
    return { x, y, width, height };
};

export const intersectsPoint = (box: LayoutBox | null, x: number, y: number): boolean => {
    if (!box) {
        return false;
    }
    return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
};

export const intersectRect = (left: LayoutBox | null, right: LayoutBox): LayoutBox | null => {
    if (!left) {
        return right;
    }
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const maxX = Math.min(left.x + left.width, right.x + right.width);
    const maxY = Math.min(left.y + left.height, right.y + right.height);
    if (maxX <= x || maxY <= y) {
        return null;
    }
    return {
        x,
        y,
        width: maxX - x,
        height: maxY - y,
        contentX: x,
        contentY: y,
        contentWidth: maxX - x,
        contentHeight: maxY - y,
    };
};
