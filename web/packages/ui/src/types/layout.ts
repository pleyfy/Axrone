import type {
    AlignMode,
    AlignSelfMode,
    Axis,
    ColorHexString,
    DisplayMode,
    JustifyMode,
    LengthKind,
    PositionMode,
    RectLike,
    UILengthInput,
} from './foundation';

export interface EdgeInsets {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

export interface CornerRadii {
    readonly topLeft: number;
    readonly topRight: number;
    readonly bottomRight: number;
    readonly bottomLeft: number;
}

export interface Anchor {
    readonly x: number;
    readonly y: number;
    readonly pivotX: number;
    readonly pivotY: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly stretch: boolean;
}

export interface ReadonlyColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface ColorLike {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a?: number;
}

export type EdgeInput =
    | number
    | readonly [number, number]
    | readonly [number, number, number, number]
    | Readonly<Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>>;

export type CornerInput = number | readonly [number, number, number, number];

export type ColorInput =
    | number
    | ColorHexString
    | readonly [number, number, number]
    | readonly [number, number, number, number]
    | ColorLike;

export type AnchorPreset =
    | 'top-left'
    | 'top'
    | 'top-right'
    | 'left'
    | 'center'
    | 'right'
    | 'bottom-left'
    | 'bottom'
    | 'bottom-right'
    | 'stretch';

export type AnchorInput =
    | AnchorPreset
    | Readonly<Partial<Pick<Anchor, 'x' | 'y' | 'pivotX' | 'pivotY' | 'offsetX' | 'offsetY' | 'stretch'>>>;

export interface ResolvedLength {
    readonly kind: LengthKind;
    readonly value: number;
}

export interface ResolvedLayout {
    readonly display: DisplayMode;
    readonly direction: Axis;
    readonly gap: number;
    readonly padding: EdgeInsets;
    readonly contentOffsetX: number;
    readonly contentOffsetY: number;
    readonly margin: EdgeInsets;
    readonly width: ResolvedLength;
    readonly height: ResolvedLength;
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly grow: number;
    readonly shrink: number;
    readonly basis: ResolvedLength;
    readonly alignItems: AlignMode;
    readonly alignSelf: AlignSelfMode;
    readonly justifyContent: JustifyMode;
    readonly position: PositionMode;
    readonly insetTop?: ResolvedLength;
    readonly insetRight?: ResolvedLength;
    readonly insetBottom?: ResolvedLength;
    readonly insetLeft?: ResolvedLength;
    readonly anchor: Anchor;
    readonly aspectRatio: number;
    readonly zIndex: number;
}

export interface LayoutBox extends RectLike {
    readonly contentX: number;
    readonly contentY: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
}

export type AffineTransform2D = readonly [number, number, number, number, number, number];

export interface WidgetLayoutInput {
    readonly display?: DisplayMode;
    readonly direction?: Axis;
    readonly gap?: number;
    readonly padding?: EdgeInput;
    readonly contentOffsetX?: number;
    readonly contentOffsetY?: number;
    readonly margin?: EdgeInput;
    readonly width?: UILengthInput;
    readonly height?: UILengthInput;
    readonly minWidth?: number;
    readonly minHeight?: number;
    readonly maxWidth?: number;
    readonly maxHeight?: number;
    readonly grow?: number;
    readonly shrink?: number;
    readonly basis?: UILengthInput;
    readonly alignItems?: AlignMode;
    readonly alignSelf?: AlignSelfMode;
    readonly justifyContent?: JustifyMode;
    readonly position?: PositionMode;
    readonly inset?: Readonly<Partial<Record<'top' | 'right' | 'bottom' | 'left', UILengthInput>>>;
    readonly anchor?: AnchorInput;
    readonly aspectRatio?: number;
    readonly zIndex?: number;
}
