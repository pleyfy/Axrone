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
import type { ColorInput, CornerInput, CornerRadii, ReadonlyColor, WidgetLayoutInput } from './layout';

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

export interface WidgetImageInput {
    readonly source: UIImageSource;
    readonly fit?: UIImageFitMode;
    readonly alignX?: number;
    readonly alignY?: number;
    readonly sampling?: UIImageSamplingMode;
    readonly tint?: ColorInput;
    readonly uvRect?: Readonly<Partial<UVRect>>;
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
}

export interface ResolvedWidgetImage {
    readonly source: UIImageSource;
    readonly fit: UIImageFitMode;
    readonly alignX: number;
    readonly alignY: number;
    readonly sampling: UIImageSamplingMode;
    readonly tint: ReadonlyColor;
    readonly uvRect: UVRect;
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
