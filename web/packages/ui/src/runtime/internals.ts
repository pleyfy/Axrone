import { Rect } from '@axrone/numeric';
import type {
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
import { normalizeColor } from '../types/color';

export { normalizeColor };

export const EMPTY_RECORD_OBJECT: Readonly<Record<string, unknown>> = Object.freeze({});
export const EMPTY_LAYOUT_INPUT: WidgetLayoutInput = Object.freeze({});
export const EMPTY_STYLE_INPUT: WidgetStyleInput = Object.freeze({});
export const EMPTY_FOCUS_INPUT: WidgetFocusPolicyInput = Object.freeze({});
export const TRANSPARENT: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
export const BLACK: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const WHITE: ReadonlyColor = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

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
): WidgetFocusPolicyInput => ({ ...(base ?? {}), ...(patch ?? {}) }) as WidgetFocusPolicyInput;

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
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } =>
    Rect.normalize({
        x: input?.x ?? 0,
        y: input?.y ?? 0,
        width: input?.width ?? 1,
        height: input?.height ?? 1,
    });

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
    const result = Rect.intersect(left, right);
    if (!result) {
        return null;
    }
    return {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
        contentX: result.x,
        contentY: result.y,
        contentWidth: result.width,
        contentHeight: result.height,
    };
};
