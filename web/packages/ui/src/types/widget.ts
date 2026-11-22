import type {
    FontStyle,
    FontWeight,
    UIImageFitMode,
    UIImageSamplingMode,
    TextAlignMode,
    TextDirectionMode,
    TextOverflowMode,
    TextWrapMode,
    UVRect,
    WidgetId,
    WidgetKey,
    WidgetRole,
} from './foundation';
import type { DeepReadonlyPartial } from '@axrone/utility';
import type { ColorInput, CornerInput, CornerRadii, EdgeInsets, ReadonlyColor, WidgetLayoutInput } from './layout';

/**
 * A polyline stroke in normalized 0–1 space, rendered inside the widget rect.
 * Used by controllers (e.g. checkbox) to draw vector shapes (check, cross, dash).
 */
export interface WidgetStrokeData {
    readonly points: readonly (readonly [number, number])[];
    readonly color: ColorInput;
    readonly weight: number;
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
    /** Optional polyline strokes rendered inside the widget rect (normalized 0–1 coordinates). */
    readonly strokes?: readonly WidgetStrokeData[];
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
    readonly strokes: readonly WidgetStrokeData[];
}

export type TextAutoSizeMode = 'none' | 'shrink-to-fit';

/** A styled span within a rich text block. */
export interface RichTextSpan {
    readonly text: string;
    readonly color?: ColorInput;
    readonly outlineColor?: ColorInput;
    readonly outlineWidth?: number;
    readonly size?: number;
    readonly weight?: FontWeight;
    readonly style?: FontStyle;
    readonly family?: string;
    readonly underline?: boolean;
    readonly strikeThrough?: boolean;
}

/** A resolved rich text span with normalized style values. */
export interface ResolvedRichTextSpan {
    readonly text: string;
    readonly color: ReadonlyColor;
    readonly outlineColor: ReadonlyColor;
    readonly outlineWidth: number;
    readonly size: number;
    readonly weight: number;
    readonly style: FontStyle;
    readonly family: string;
    readonly underline: boolean;
    readonly strikeThrough: boolean;
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
    readonly outlineColor?: ColorInput;
    readonly outlineWidth?: number;
    readonly edgeSoftness?: number;
    readonly shadowColor?: ColorInput;
    readonly shadowOffsetX?: number;
    readonly shadowOffsetY?: number;
    readonly underline?: boolean;
    readonly underlineColor?: ColorInput;
    readonly underlineThickness?: number;
    readonly underlineOffset?: number;
    readonly strikeThrough?: boolean;
    readonly strikeThroughColor?: ColorInput;
    readonly strikeThroughThickness?: number;
    readonly selectionStart?: number;
    readonly selectionEnd?: number;
    readonly selectionColor?: ColorInput;
    readonly caretIndex?: number;
    readonly caretColor?: ColorInput;
    readonly caretWidth?: number;
    readonly caretInset?: number;
    readonly autoSize?: TextAutoSizeMode;
    readonly minAutoSize?: number;
    readonly maxAutoSize?: number;
    readonly spans?: readonly RichTextSpan[];
}

export interface UIImageTextureSource {
    readonly kind: 'texture';
    readonly resourceId: string;
    readonly width: number;
    readonly height: number;
}

export interface UIImageMaterialSource {
    readonly kind: 'material';
    readonly materialId: string;
    readonly textureBinding?: string;
    readonly width: number;
    readonly height: number;
}

export type UIImageSource = UIImageTextureSource | UIImageMaterialSource;

export interface UIImageBorderInput {
    readonly left?: number;
    readonly top?: number;
    readonly right?: number;
    readonly bottom?: number;
}

export interface WidgetImageInput {
    readonly source: UIImageSource;
    readonly material?: string;
    readonly fit?: UIImageFitMode;
    readonly alignX?: number;
    readonly alignY?: number;
    readonly sampling?: UIImageSamplingMode;
    readonly tint?: ColorInput;
    readonly uvRect?: Readonly<Partial<UVRect>>;
    readonly border?: UIImageBorderInput | number;
    readonly fillCenter?: boolean;
    /**
     * Draw the image across the widget's full border box instead of the padded
     * content box. Used by sprite-backed controls whose image is the control
     * surface, not an inset decoration.
     */
    readonly bleed?: boolean;
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
    readonly outlineColor: ReadonlyColor;
    readonly outlineWidth: number;
    readonly edgeSoftness: number;
    readonly shadowColor: ReadonlyColor;
    readonly shadowOffsetX: number;
    readonly shadowOffsetY: number;
    readonly underline: boolean;
    readonly underlineColor: ReadonlyColor;
    readonly underlineThickness: number;
    readonly underlineOffset: number;
    readonly strikeThrough: boolean;
    readonly strikeThroughColor: ReadonlyColor;
    readonly strikeThroughThickness: number;
    readonly selectionStart: number | null;
    readonly selectionEnd: number | null;
    readonly selectionColor: ReadonlyColor;
    readonly caretIndex: number | null;
    readonly caretColor: ReadonlyColor;
    readonly caretWidth: number;
    readonly caretInset: number;
    readonly autoSize: TextAutoSizeMode;
    readonly minAutoSize: number;
    readonly maxAutoSize: number;
    readonly spans: readonly ResolvedRichTextSpan[];
}

export interface ResolvedWidgetImage {
    readonly source: UIImageSource;
    readonly material: string;
    readonly fit: UIImageFitMode;
    readonly alignX: number;
    readonly alignY: number;
    readonly sampling: UIImageSamplingMode;
    readonly tint: ReadonlyColor;
    readonly uvRect: UVRect;
    readonly border: EdgeInsets;
    readonly fillCenter: boolean;
    readonly bleed: boolean;
}

export interface WidgetFocusPolicyInput {
    readonly focusable?: boolean;
    readonly tabIndex?: number;
    readonly scope?: boolean;
    readonly cycle?: boolean;
    readonly order?: number;
    readonly ringColor?: ColorInput;
    readonly ringWidth?: number;
    readonly ringOffset?: number;
}

export interface ResolvedFocusPolicy {
    readonly focusable: boolean;
    readonly tabIndex: number;
    readonly scope: boolean;
    readonly cycle: boolean;
    readonly order: number;
    readonly ringColor: ReadonlyColor;
    readonly ringWidth: number;
    readonly ringOffset: number;
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
    readonly image?: WidgetImageInput | null;
    readonly focus?: WidgetFocusPolicyInput;
    readonly handlers?: WidgetEventHandlers<TProps, TRuntime>;
}

export type WidgetPatch<
    TProps extends Record<string, unknown> = Record<string, never>,
    TRuntime = unknown,
> = Omit<DeepReadonlyPartial<WidgetConfig<TProps, TRuntime>>, 'props'> & {
    readonly props?: Readonly<Partial<TProps> | TProps>;
};
