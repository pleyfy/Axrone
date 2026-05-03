import { UIError, UIErrorCode } from '../errors';
import type {
    Anchor,
    AnchorInput,
    CornerInput,
    CornerRadii,
    EdgeInput,
    EdgeInsets,
    ResolvedLayout,
    ResolvedLength,
    WidgetLayoutInput,
} from '../types';

const ZERO_EDGES: EdgeInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const ZERO_CORNERS: CornerRadii = Object.freeze({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 });
const DEFAULT_ANCHOR: Anchor = Object.freeze({
    x: 0,
    y: 0,
    pivotX: 0,
    pivotY: 0,
    offsetX: 0,
    offsetY: 0,
    stretch: false,
});
const AUTO_LENGTH: ResolvedLength = Object.freeze({ kind: 'auto', value: 0 });
const CONTENT_LENGTH: ResolvedLength = Object.freeze({ kind: 'content', value: 0 });

export const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const isEdgeRecord = (
    value: EdgeInput
): value is Readonly<Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const createLength = (kind: ResolvedLength['kind'], value: number): ResolvedLength => ({ kind, value });

export const compileLength = (input: number | string | undefined): ResolvedLength => {
    if (input === undefined || input === 'auto') {
        return AUTO_LENGTH;
    }
    if (input === 'content') {
        return CONTENT_LENGTH;
    }
    if (typeof input === 'number') {
        if (!Number.isFinite(input)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Length numbers must be finite.', { input });
        }
        return createLength('px', input);
    }
    if (input.endsWith('%')) {
        const value = Number.parseFloat(input.slice(0, -1));
        if (!Number.isFinite(value)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Percent lengths must contain a valid number.', {
                input,
            });
        }
        return createLength('percent', value / 100);
    }
    if (input.startsWith('stretch:')) {
        const value = Number.parseFloat(input.slice('stretch:'.length));
        if (!Number.isFinite(value) || value <= 0) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Stretch lengths must be greater than zero.', { input });
        }
        return createLength('stretch', value);
    }
    if (input.startsWith('viewport:')) {
        const value = Number.parseFloat(input.slice('viewport:'.length));
        if (!Number.isFinite(value)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Viewport lengths must contain a valid number.', {
                input,
            });
        }
        return createLength('viewport', value);
    }
    throw new UIError(UIErrorCode.InvalidArgument, 'Unsupported length input.', { input });
};

export const normalizeEdges = (input: EdgeInput | undefined): EdgeInsets => {
    if (input === undefined) {
        return ZERO_EDGES;
    }
    if (typeof input === 'number') {
        return { top: input, right: input, bottom: input, left: input };
    }
    if (Array.isArray(input)) {
        if (input.length === 2) {
            return { top: input[0], right: input[1], bottom: input[0], left: input[1] };
        }
        if (input.length === 4) {
            return {
                top: input[0],
                right: input[1],
                bottom: input[2],
                left: input[3],
            };
        }
    }
    if (!isEdgeRecord(input)) {
        return ZERO_EDGES;
    }
    return {
        top: input.top ?? 0,
        right: input.right ?? 0,
        bottom: input.bottom ?? 0,
        left: input.left ?? 0,
    };
};

export const normalizeCorners = (input: CornerInput | undefined): CornerRadii => {
    if (input === undefined) {
        return ZERO_CORNERS;
    }
    if (typeof input === 'number') {
        return { topLeft: input, topRight: input, bottomRight: input, bottomLeft: input };
    }
    return {
        topLeft: input[0],
        topRight: input[1],
        bottomRight: input[2],
        bottomLeft: input[3],
    };
};

export const normalizeAnchor = (input: AnchorInput | undefined): Anchor => {
    if (input === undefined) {
        return DEFAULT_ANCHOR;
    }
    if (typeof input === 'string') {
        switch (input) {
            case 'top-left':
                return { ...DEFAULT_ANCHOR };
            case 'top':
                return { ...DEFAULT_ANCHOR, x: 0.5, pivotX: 0.5 };
            case 'top-right':
                return { ...DEFAULT_ANCHOR, x: 1, pivotX: 1 };
            case 'left':
                return { ...DEFAULT_ANCHOR, y: 0.5, pivotY: 0.5 };
            case 'center':
                return { ...DEFAULT_ANCHOR, x: 0.5, y: 0.5, pivotX: 0.5, pivotY: 0.5 };
            case 'right':
                return { ...DEFAULT_ANCHOR, x: 1, y: 0.5, pivotX: 1, pivotY: 0.5 };
            case 'bottom-left':
                return { ...DEFAULT_ANCHOR, y: 1, pivotY: 1 };
            case 'bottom':
                return { ...DEFAULT_ANCHOR, x: 0.5, y: 1, pivotX: 0.5, pivotY: 1 };
            case 'bottom-right':
                return { ...DEFAULT_ANCHOR, x: 1, y: 1, pivotX: 1, pivotY: 1 };
            case 'stretch':
                return { ...DEFAULT_ANCHOR, stretch: true };
            default:
                return DEFAULT_ANCHOR;
        }
    }
    return {
        x: input.x ?? 0,
        y: input.y ?? 0,
        pivotX: input.pivotX ?? input.x ?? 0,
        pivotY: input.pivotY ?? input.y ?? 0,
        offsetX: input.offsetX ?? 0,
        offsetY: input.offsetY ?? 0,
        stretch: input.stretch ?? false,
    };
};

export const resolveLength = (
    length: ResolvedLength,
    available: number,
    content: number,
    viewport: number = available
): number => {
    switch (length.kind) {
        case 'px':
            return length.value;
        case 'percent':
            return Number.isFinite(available) ? available * length.value : content;
        case 'stretch':
            return Number.isFinite(available) ? available * length.value : content;
        case 'viewport':
            return Number.isFinite(viewport) ? viewport * length.value : content;
        case 'content':
        case 'auto':
        default:
            return content;
    }
};

export const compileLayoutInput = (input: WidgetLayoutInput | undefined): ResolvedLayout => {
    const inset = input?.inset;
    return {
        display: input?.display ?? 'stack',
        direction: input?.direction ?? 'column',
        gap: input?.gap ?? 0,
        padding: normalizeEdges(input?.padding),
        contentOffsetX: input?.contentOffsetX ?? 0,
        contentOffsetY: input?.contentOffsetY ?? 0,
        margin: normalizeEdges(input?.margin),
        width: compileLength(input?.width),
        height: compileLength(input?.height),
        minWidth: input?.minWidth ?? 0,
        minHeight: input?.minHeight ?? 0,
        maxWidth: input?.maxWidth ?? Number.POSITIVE_INFINITY,
        maxHeight: input?.maxHeight ?? Number.POSITIVE_INFINITY,
        grow: Math.max(0, input?.grow ?? 0),
        shrink: Math.max(0, input?.shrink ?? 1),
        basis: compileLength(input?.basis),
        alignItems: input?.alignItems ?? 'start',
        alignSelf: input?.alignSelf ?? 'auto',
        justifyContent: input?.justifyContent ?? 'start',
        position: input?.position ?? 'flow',
        insetTop: inset?.top === undefined ? undefined : compileLength(inset.top),
        insetRight: inset?.right === undefined ? undefined : compileLength(inset.right),
        insetBottom: inset?.bottom === undefined ? undefined : compileLength(inset.bottom),
        insetLeft: inset?.left === undefined ? undefined : compileLength(inset.left),
        anchor: normalizeAnchor(input?.anchor),
        aspectRatio: input?.aspectRatio ?? 0,
        zIndex: input?.zIndex ?? 0,
    };
};
