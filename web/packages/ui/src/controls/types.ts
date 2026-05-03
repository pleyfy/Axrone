import type {
    ColorInput,
    TextBlockInput,
    WidgetFocusPolicyInput,
    WidgetId,
    WidgetKey,
    WidgetLayoutInput,
    WidgetRole,
    WidgetStyleInput,
} from '../types';

export interface UIControlTheme {
    readonly fontFamily?: string;
    readonly fontSize: number;
    readonly controlHeight: number;
    readonly controlRadius: number;
    readonly borderWidth: number;
    readonly canvasColor: ColorInput;
    readonly panelColor: ColorInput;
    readonly surfaceColor: ColorInput;
    readonly surfaceRaisedColor: ColorInput;
    readonly surfaceHoverColor: ColorInput;
    readonly surfacePressedColor: ColorInput;
    readonly surfaceDisabledColor: ColorInput;
    readonly borderColor: ColorInput;
    readonly borderMutedColor: ColorInput;
    readonly focusColor: ColorInput;
    readonly textColor: ColorInput;
    readonly textMutedColor: ColorInput;
    readonly placeholderColor: ColorInput;
    readonly accentColor: ColorInput;
    readonly accentHoverColor: ColorInput;
    readonly accentPressedColor: ColorInput;
    readonly successColor: ColorInput;
    readonly successHoverColor: ColorInput;
    readonly successPressedColor: ColorInput;
    readonly warningColor: ColorInput;
    readonly warningHoverColor: ColorInput;
    readonly warningPressedColor: ColorInput;
    readonly dangerColor: ColorInput;
    readonly dangerHoverColor: ColorInput;
    readonly dangerPressedColor: ColorInput;
    readonly thumbColor: ColorInput;
    readonly trackColor: ColorInput;
}

export type UIControlVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type UIParentTarget = WidgetId | UIHandle | UISlotHandle | null | undefined;

export interface UIHandle {
    readonly root: WidgetId;
    dispose(): void;
}

export interface UISlotHandle extends UIHandle {
    readonly content: WidgetId;
}

export interface UIWidgetPatch {
    readonly layout?: WidgetLayoutInput;
    readonly style?: WidgetStyleInput;
    readonly text?: TextBlockInput | null;
    readonly enabled?: boolean;
    readonly interactive?: boolean;
    readonly focus?: WidgetFocusPolicyInput;
}

export interface UIWidgetHandle extends UISlotHandle {
    update(patch: UIWidgetPatch): void;
}

export interface UIBaseOptions {
    readonly parent?: UIParentTarget;
    readonly key?: WidgetKey;
    readonly role?: WidgetRole;
    readonly layout?: WidgetLayoutInput;
    readonly style?: WidgetStyleInput;
    readonly enabled?: boolean;
    readonly interactive?: boolean;
    readonly focus?: WidgetFocusPolicyInput;
}

export interface UIRichTextOptions extends UIBaseOptions {
    readonly value?: string;
    readonly text?: Partial<Omit<TextBlockInput, 'value'>>;
}

export interface UIRichTextHandle extends UIHandle {
    getText(): string;
    setText(value: string): void;
    updateText(patch: Partial<Omit<TextBlockInput, 'value'>>): void;
}

export interface UIButtonOptions extends UIBaseOptions {
    readonly label?: string;
    readonly disabled?: boolean;
    readonly variant?: UIControlVariant;
    readonly theme?: Partial<UIControlTheme>;
    readonly text?: Partial<Omit<TextBlockInput, 'value'>>;
    readonly onPress?: (handle: UIButtonHandle) => void;
}

export interface UIButtonHandle extends UIHandle {
    getLabel(): string;
    setLabel(value: string): void;
    isDisabled(): boolean;
    setDisabled(disabled: boolean): void;
    setVariant(variant: UIControlVariant): void;
    setOnPress(handler: UIButtonOptions['onPress']): void;
    press(): void;
}

export interface UIToggleOptions extends UIBaseOptions {
    readonly label?: string;
    readonly checked?: boolean;
    readonly disabled?: boolean;
    readonly labelPlacement?: 'left' | 'right';
    readonly variant?: UIControlVariant;
    readonly theme?: Partial<UIControlTheme>;
    readonly onChange?: (checked: boolean, handle: UIToggleHandle) => void;
}

export interface UIToggleHandle extends UIHandle {
    isChecked(): boolean;
    setChecked(checked: boolean): void;
    toggle(): void;
    setDisabled(disabled: boolean): void;
}

export interface UIProgressBarOptions extends UIBaseOptions {
    readonly label?: string;
    readonly value?: number;
    readonly min?: number;
    readonly max?: number;
    readonly showValue?: boolean;
    readonly variant?: UIControlVariant;
    readonly theme?: Partial<UIControlTheme>;
}

export interface UIProgressBarHandle extends UIHandle {
    getValue(): number;
    setValue(value: number): void;
    setRange(min: number, max: number): void;
    setLabel(label: string): void;
}

export interface UISliderOptions extends UIBaseOptions {
    readonly label?: string;
    readonly value?: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly showValue?: boolean;
    readonly disabled?: boolean;
    readonly variant?: UIControlVariant;
    readonly theme?: Partial<UIControlTheme>;
    readonly onChange?: (value: number, handle: UISliderHandle) => void;
}

export interface UISliderHandle extends UIHandle {
    getValue(): number;
    setValue(value: number): void;
    setRange(min: number, max: number): void;
    setDisabled(disabled: boolean): void;
}

export interface UIEditBoxOptions extends UIBaseOptions {
    readonly value?: string;
    readonly placeholder?: string;
    readonly multiline?: boolean;
    readonly password?: boolean;
    readonly readOnly?: boolean;
    readonly disabled?: boolean;
    readonly theme?: Partial<UIControlTheme>;
    readonly text?: Partial<Omit<TextBlockInput, 'value'>>;
    readonly onChange?: (value: string, handle: UIEditBoxHandle) => void;
    readonly onSubmit?: (value: string, handle: UIEditBoxHandle) => void;
}

export interface UIEditBoxHandle extends UIHandle {
    getValue(): string;
    setValue(value: string): void;
    setDisabled(disabled: boolean): void;
    setReadOnly(readOnly: boolean): void;
    setSelection(start: number, end: number): void;
    setCaret(index: number): void;
}

export interface UIScrollViewOptions extends UIBaseOptions {
    readonly scrollX?: number;
    readonly scrollY?: number;
    readonly disabled?: boolean;
    readonly theme?: Partial<UIControlTheme>;
    readonly contentLayout?: WidgetLayoutInput;
    readonly contentStyle?: WidgetStyleInput;
}

export interface UIScrollViewHandle extends UISlotHandle {
    getScroll(): Readonly<{ x: number; y: number }>;
    setScroll(x: number, y: number): void;
    scrollBy(deltaX: number, deltaY: number): void;
    clampToBounds(): void;
}

export interface UIPageViewOptions extends UIBaseOptions {
    readonly page?: number;
    readonly showIndicators?: boolean;
    readonly disabled?: boolean;
    readonly theme?: Partial<UIControlTheme>;
}

export interface UIPageViewHandle extends UISlotHandle {
    getPage(): number;
    setPage(index: number): void;
    addPage(page: WidgetId): number;
    next(): number;
    previous(): number;
}

export interface UICanvasOptions extends UIBaseOptions {
    readonly theme?: Partial<UIControlTheme>;
}

export interface UICanvasHandle extends UISlotHandle {}
export interface UILayoutOptions extends UIBaseOptions {}
export interface UILayoutHandle extends UISlotHandle {}
