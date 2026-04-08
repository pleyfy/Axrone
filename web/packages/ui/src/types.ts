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
export type FontGlyphBitmapFormat = 'alpha8' | 'rgba8';

export interface Vec2Like {
    readonly x: number;
    readonly y: number;
}

export interface SizeLike {
    readonly width: number;
    readonly height: number;
}

export interface RectLike extends Vec2Like, SizeLike {}

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

export interface WidgetLayoutInput {
    readonly display?: DisplayMode;
    readonly direction?: Axis;
    readonly gap?: number;
    readonly padding?: EdgeInput;
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

export interface WidgetStyleInput {
    readonly visible?: boolean;
    readonly opacity?: number;
    readonly clip?: boolean;
    readonly background?: ColorInput;
    readonly borderColor?: ColorInput;
    readonly borderWidth?: number;
    readonly radius?: CornerInput;
    readonly color?: ColorInput;
}

export interface ResolvedWidgetStyle {
    readonly visible: boolean;
    readonly opacity: number;
    readonly clip: boolean;
    readonly background: ReadonlyColor;
    readonly borderColor: ReadonlyColor;
    readonly borderWidth: number;
    readonly radius: CornerRadii;
    readonly color: ReadonlyColor;
}

export interface TextBlockInput {
    readonly value: string;
    readonly family?: string;
    readonly size?: number;
    readonly weight?: FontWeight;
    readonly style?: FontStyle;
    readonly locale?: string;
    readonly direction?: TextDirectionMode;
    readonly lineHeight?: number;
    readonly letterSpacing?: number;
    readonly wrap?: TextWrapMode;
    readonly overflow?: TextOverflowMode;
    readonly maxLines?: number;
    readonly align?: TextAlignMode;
    readonly color?: ColorInput;
}

export interface ResolvedTextBlock {
    readonly value: string;
    readonly family: string;
    readonly size: number;
    readonly weight: number;
    readonly style: FontStyle;
    readonly locale: string;
    readonly direction: TextDirectionMode;
    readonly lineHeight: number;
    readonly letterSpacing: number;
    readonly wrap: TextWrapMode;
    readonly overflow: TextOverflowMode;
    readonly maxLines: number;
    readonly align: TextAlignMode;
    readonly color: ReadonlyColor;
}

export interface WidgetFocusPolicyInput {
    readonly focusable?: boolean;
    readonly tabIndex?: number;
    readonly scope?: boolean;
    readonly cycle?: boolean;
    readonly order?: number;
}

export interface ResolvedFocusPolicy {
    readonly focusable: boolean;
    readonly tabIndex: number;
    readonly scope: boolean;
    readonly cycle: boolean;
    readonly order: number;
}

export interface UIPointerEvent {
    readonly type: 'pointer';
    readonly phase: 'move' | 'down' | 'up' | 'enter' | 'leave' | 'wheel';
    readonly x: number;
    readonly y: number;
    readonly pointerId?: number;
    readonly button?: number;
    readonly buttons?: number;
    readonly deltaX?: number;
    readonly deltaY?: number;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly metaKey?: boolean;
}

export interface UIKeyEvent {
    readonly type: 'key';
    readonly phase: 'down' | 'up';
    readonly key: string;
    readonly code?: string;
    readonly repeat?: boolean;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly metaKey?: boolean;
}

export interface UITextInputEvent {
    readonly type: 'text';
    readonly text: string;
    readonly composing?: boolean;
    readonly locale?: string;
}

export interface UIWindowFocusEvent {
    readonly type: 'focus';
    readonly focused: boolean;
}

export interface WidgetFocusChangeEvent {
    readonly type: 'widget-focus';
    readonly focused: boolean;
    readonly reason: 'api' | 'pointer' | 'navigation' | 'window';
}

export type UIInputEvent = UIPointerEvent | UIKeyEvent | UITextInputEvent | UIWindowFocusEvent;

export interface WidgetEventContext<
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> {
    readonly runtime: TRuntime;
    readonly widget: WidgetId;
    readonly props: Readonly<TProps>;
}

export type WidgetEventHandler<
    TEvent,
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> = (event: Readonly<TEvent>, context: WidgetEventContext<TProps, TRuntime>) => boolean | void;

export interface WidgetEventHandlers<
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> {
    readonly pointerMove?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly pointerDown?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly pointerUp?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly pointerEnter?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly pointerLeave?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly wheel?: WidgetEventHandler<UIPointerEvent, TProps, TRuntime>;
    readonly keyDown?: WidgetEventHandler<UIKeyEvent, TProps, TRuntime>;
    readonly keyUp?: WidgetEventHandler<UIKeyEvent, TProps, TRuntime>;
    readonly textInput?: WidgetEventHandler<UITextInputEvent, TProps, TRuntime>;
    readonly focus?: WidgetEventHandler<WidgetFocusChangeEvent, TProps, TRuntime>;
    readonly blur?: WidgetEventHandler<WidgetFocusChangeEvent, TProps, TRuntime>;
}

export interface WidgetConfig<
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> {
    readonly role?: WidgetRole;
    readonly controller?: string;
    readonly key?: WidgetKey;
    readonly props?: Readonly<TProps>;
    readonly enabled?: boolean;
    readonly interactive?: boolean;
    readonly layout?: WidgetLayoutInput;
    readonly style?: WidgetStyleInput;
    readonly text?: TextBlockInput | null;
    readonly focus?: WidgetFocusPolicyInput;
    readonly handlers?: WidgetEventHandlers<TProps, TRuntime>;
}

export type DeepReadonlyPartial<TValue> = TValue extends readonly (infer TElement)[]
    ? readonly DeepReadonlyPartial<TElement>[]
    : TValue extends (...args: never[]) => unknown
      ? TValue
      : TValue extends object
        ? { readonly [TKey in keyof TValue]?: DeepReadonlyPartial<TValue[TKey]> }
        : TValue;

export type WidgetPatch<
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> = Omit<DeepReadonlyPartial<WidgetConfig<TProps, TRuntime>>, 'props'> & {
    readonly props?: Readonly<Partial<TProps> | TProps>;
};

export interface FontAtlasOptions {
    readonly width?: number;
    readonly height?: number;
    readonly padding?: number;
}

export interface FontGlyphMetric {
    readonly codePoint: number;
    readonly advance: number;
    readonly bearingX?: number;
    readonly bearingY?: number;
    readonly width?: number;
    readonly height?: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
    readonly format?: FontGlyphBitmapFormat;
    readonly rowStride?: number;
}

export interface FontFaceAsset {
    readonly family: string;
    readonly face?: string;
    readonly style?: FontStyle;
    readonly weight?: FontWeight;
    readonly locale?: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap?: number;
    readonly unitsPerEm?: number;
    readonly defaultAdvance?: number;
    readonly glyphs:
        | ReadonlyArray<FontGlyphMetric>
        | ReadonlyMap<number, FontGlyphMetric>
        | Readonly<Record<string, FontGlyphMetric>>;
    readonly kernings?: Readonly<Record<KerningPairKey, number>> | ReadonlyMap<KerningPairKey, number>;
    readonly fallbackCodePoint?: number;
    readonly atlas?: FontAtlasOptions;
}

export interface FontFamilyDefinition {
    readonly name: string;
    readonly fallbacks?: readonly string[];
}

export interface FontQuery {
    readonly family?: string;
    readonly weight?: FontWeight;
    readonly style?: FontStyle;
    readonly locale?: string;
}

export interface FontAssetSourceDescriptor {
    readonly kind: 'descriptor';
    readonly asset: FontFaceAsset;
}

export interface FontAssetSourceBuffer {
    readonly kind: 'buffer';
    readonly data: ArrayBuffer | ArrayBufferView;
    readonly contentType?: string;
    readonly cacheKey?: string;
}

export interface FontAssetSourceUrl {
    readonly kind: 'url';
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly cacheKey?: string;
}

export type FontAssetSource = FontAssetSourceDescriptor | FontAssetSourceBuffer | FontAssetSourceUrl;

export interface RetryPolicy {
    readonly attempts?: number;
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly jitter?: number;
}

export interface FontLoadOptions {
    readonly signal?: AbortSignal;
    readonly retry?: RetryPolicy;
}

export interface FontLoader {
    readonly id: string;
    canLoad(source: FontAssetSource): boolean;
    load(source: FontAssetSource, signal?: AbortSignal): Promise<FontFaceAsset>;
}

export interface FontRegistryOptions {
    readonly atlasWidth?: number;
    readonly atlasHeight?: number;
    readonly atlasPadding?: number;
    readonly defaultFamily?: string;
    readonly retry?: RetryPolicy;
    readonly fetch?: typeof globalThis.fetch;
}

export interface GlyphAtlasEntry {
    readonly faceId: FontFaceId;
    readonly page: GlyphAtlasPageId;
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly codePoint: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly format: FontGlyphBitmapFormat;
    readonly rowStride: number;
    readonly u0: number;
    readonly v0: number;
    readonly u1: number;
    readonly v1: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
}

export interface GlyphAtlasPageSnapshot {
    readonly id: number;
    readonly width: number;
    readonly height: number;
    readonly entries: readonly GlyphAtlasEntry[];
}

export interface FontFaceInfo {
    readonly id: FontFaceId;
    readonly family: string;
    readonly face: string;
    readonly style: FontStyle;
    readonly weight: number;
    readonly locale: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
    readonly unitsPerEm: number;
    readonly defaultAdvance: number;
    readonly fallbackCodePoint: number;
}

export interface FontGlyphMeasurement {
    readonly faceId: FontFaceId | null;
    readonly codePoint: number;
    readonly advance: number;
    readonly metric: FontGlyphMetric | null;
    readonly atlasEntry: GlyphAtlasEntry | null;
}

export interface FontFaceSnapshot {
    readonly id: number;
    readonly family: string;
    readonly face: string;
    readonly style: FontStyle;
    readonly weight: number;
    readonly locale: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
    readonly unitsPerEm: number;
    readonly defaultAdvance: number;
    readonly fallbackCodePoint: number;
    readonly glyphs: readonly FontGlyphMetric[];
    readonly kernings: readonly [KerningPairKey, number][];
    readonly atlas: readonly GlyphAtlasPageSnapshot[];
}

export interface FontRegistrySnapshot {
    readonly defaultFamily: string | null;
    readonly families: readonly FontFamilyDefinition[];
    readonly faces: readonly FontFaceSnapshot[];
}

export interface TextLayoutConstraint {
    readonly width?: number;
    readonly height?: number;
}

export interface TextGlyphPlacement {
    readonly codePoint: number;
    readonly clusterIndex: number;
    readonly x: number;
    readonly y: number;
    readonly advance: number;
    readonly line: number;
    readonly text: string;
    readonly atlasEntry: GlyphAtlasEntry | null;
}

export interface TextLineLayout {
    readonly index: number;
    readonly start: number;
    readonly end: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly ascent: number;
    readonly descent: number;
    readonly gapCount: number;
}

export interface TextLayoutResult {
    readonly faceId: FontFaceId | null;
    readonly width: number;
    readonly height: number;
    readonly lineHeight: number;
    readonly baseline: number;
    readonly lines: readonly TextLineLayout[];
    readonly glyphs: readonly TextGlyphPlacement[];
    readonly truncated: boolean;
    readonly direction: ResolvedTextDirection;
    readonly text: string;
}

export interface QuadRenderCommand {
    readonly kind: 'quad';
    readonly widget: WidgetId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly zIndex: number;
    readonly color: ReadonlyColor;
    readonly borderColor: ReadonlyColor;
    readonly borderWidth: number;
    readonly radius: CornerRadii;
    readonly opacity: number;
    readonly clip: RectLike | null;
}

export interface TextRenderCommand {
    readonly kind: 'text';
    readonly widget: WidgetId;
    readonly zIndex: number;
    readonly color: ReadonlyColor;
    readonly opacity: number;
    readonly clip: RectLike | null;
    readonly layout: TextLayoutResult;
}

export interface CustomRenderCommand<TPayload = unknown> {
    readonly kind: 'custom';
    readonly widget: WidgetId;
    readonly zIndex: number;
    readonly clip: RectLike | null;
    readonly payload: TPayload;
}

export type RenderCommand<TPayload = unknown> =
    | QuadRenderCommand
    | TextRenderCommand
    | CustomRenderCommand<TPayload>;

export interface UIFrameMetrics {
    readonly widgetCount: number;
    readonly visibleWidgetCount: number;
    readonly renderCount: number;
    readonly customCommandCount: number;
    readonly textCommandCount: number;
    readonly glyphCount: number;
    readonly layoutPasses: number;
}

export interface UIFrame<TPayload = unknown> {
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly commands: readonly RenderCommand<TPayload>[];
    readonly metrics: UIFrameMetrics;
}

export interface WidgetSnapshot {
    readonly role: WidgetRole;
    readonly controller?: string;
    readonly key?: WidgetSerializableKey;
    readonly props?: Readonly<Record<string, unknown>> | null;
    readonly enabled?: boolean;
    readonly interactive?: boolean;
    readonly layout?: WidgetLayoutInput;
    readonly style?: WidgetStyleInput;
    readonly text?: TextBlockInput | null;
    readonly focus?: WidgetFocusPolicyInput;
    readonly children: readonly WidgetSnapshot[];
}

export interface UIRuntimeSnapshot {
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly locale: string;
    readonly root: WidgetSnapshot;
}