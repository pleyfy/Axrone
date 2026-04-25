export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type WidgetId = Brand<number, 'WidgetId'>;
export type FontFaceId = Brand<number, 'FontFaceId'>;
export type FontFamilyId = Brand<number, 'FontFamilyId'>;
export type GlyphAtlasPageId = Brand<number, 'GlyphAtlasPageId'>;

export type WidgetKey = string | number | symbol;
export type WidgetSerializableKey = string | number | null;
export type Axis = 'row' | 'column';
export type DisplayMode = 'stack' | 'overlay';
export type PositionMode = 'flow' | 'absolute';
export type AlignMode = 'start' | 'center' | 'end' | 'stretch';
export type AlignSelfMode = AlignMode | 'auto';
export type JustifyMode =
    | 'start'
    | 'center'
    | 'end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
export type LengthKind = 'auto' | 'px' | 'percent' | 'content' | 'stretch' | 'viewport';
export type TextWrapMode = 'none' | 'word' | 'grapheme';
export type TextOverflowMode = 'clip' | 'ellipsis';
export type TextAlignMode = 'start' | 'center' | 'end' | 'justify';
export type TextDirectionMode = 'auto' | 'ltr' | 'rtl';
export type ResolvedTextDirection = 'ltr' | 'rtl';
export type UIImageFitMode = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
export type UIImageSamplingMode = 'linear' | 'nearest';
export type FontStyle = 'normal' | 'italic' | 'oblique';
export type FontWeight =
    | 100
    | 200
    | 300
    | 400
    | 500
    | 600
    | 700
    | 800
    | 900
    | 'thin'
    | 'extralight'
    | 'light'
    | 'normal'
    | 'medium'
    | 'semibold'
    | 'bold'
    | 'extrabold'
    | 'black';
export type FocusMoveDirection = 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down';
export type WidgetRoleBase = 'root' | 'container' | 'text' | 'button' | 'input' | 'custom';
export type WidgetRole = WidgetRoleBase | `${WidgetRoleBase}:${string}`;
export type PercentageString = `${number}%`;
export type StretchString = `stretch:${number}`;
export type ViewportString = `viewport:${number}`;
export type ColorHexString = `#${string}`;
export type KerningPairKey = `${number}:${number}`;
export type UILengthInput = number | 'auto' | 'content' | PercentageString | StretchString | ViewportString;
export type FontGlyphBitmapFormat = 'alpha8' | 'rgba8' | 'sdf8';
export type FontBinaryFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

export interface Vec2Like {
    readonly x: number;
    readonly y: number;
}

export interface SizeLike {
    readonly width: number;
    readonly height: number;
}

export interface RectLike extends Vec2Like, SizeLike {}

export interface UVRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}