import type { FontRegistry } from './font';
import type { UIRuntime } from './runtime';
import type {
    AnchorInput,
    ColorInput,
    FontFaceAsset,
    PercentageString,
    TextBlockInput,
    UIKeyEvent,
    UIPointerEvent,
    WidgetFocusPolicyInput,
    WidgetId,
    WidgetKey,
    WidgetLayoutInput,
    WidgetRole,
    WidgetStyleInput,
} from './types';

export const AXRONE_FALLBACK_UI_FONT_FAMILY = 'AxroneUIFallback';

const FONT_SCALE = 2;

const BASE_GLYPH_PATTERNS = {
    '?': ['.###.', '...#.', '..#..', '..#..', '..#..', '.....', '..#..'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '*': ['#...#', '.#.#.', '#####', '.#.#.', '#...#', '.....', '.....'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '...#.', '..##.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    ':': ['.....', '..#..', '.....', '.....', '..#..', '.....', '.....'],
    ';': ['.....', '..#..', '.....', '.....', '..#..', '..#..', '.#...'],
    ',': ['.....', '.....', '.....', '.....', '..#..', '..#..', '.#...'],
    '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
    '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
    '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
    ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
    '[': ['.###.', '.#...', '.#...', '.#...', '.#...', '.#...', '.###.'],
    ']': ['.###.', '...#.', '...#.', '...#.', '...#.', '...#.', '.###.'],
    '<': ['....#', '...#.', '..#..', '.#...', '..#..', '...#.', '....#'],
    '>': ['#....', '.#...', '..#..', '...#.', '..#..', '.#...', '#....'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
} as const;

const DEFAULT_SELECTION_COLOR = '#38bdf855';

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const scaleGlyphPattern = (rows: readonly string[], scale = FONT_SCALE): Uint8Array => {
    const sourceHeight = rows.length;
    const sourceWidth = rows[0]?.length ?? 0;
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const data = new Uint8Array(width * height);

    for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
        for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
            const alpha = rows[sourceY]?.[sourceX] === '#' ? 255 : 0;
            for (let offsetY = 0; offsetY < scale; offsetY += 1) {
                for (let offsetX = 0; offsetX < scale; offsetX += 1) {
                    const x = sourceX * scale + offsetX;
                    const y = sourceY * scale + offsetY;
                    data[y * width + x] = alpha;
                }
            }
        }
    }

    return data;
};

const createGlyphMetric = (character: string, pattern: readonly string[]) => {
    const data = scaleGlyphPattern(pattern);
    const isThin = ['.', ',', ':', ';', '!'].includes(character);
    const isWide = character === 'M' || character === 'W' || character === 'm' || character === 'w';
    const isSpace = character === ' ';

    return {
        codePoint: character.charCodeAt(0),
        advance: isSpace ? 6 : isThin ? 6 : isWide ? 13 : 12,
        width: isSpace ? 1 : 10,
        height: isSpace ? 1 : 14,
        data: isSpace ? undefined : data,
        format: isSpace ? undefined : ('alpha8' as const),
        rowStride: isSpace ? undefined : 10,
    };
};

export const createFallbackUIFontAsset = (
    family = AXRONE_FALLBACK_UI_FONT_FAMILY
): FontFaceAsset => {
    const glyphs = new Map<number, ReturnType<typeof createGlyphMetric>>();

    for (const [character, pattern] of Object.entries(BASE_GLYPH_PATTERNS)) {
        const metric = createGlyphMetric(character, pattern);
        glyphs.set(metric.codePoint, metric);
        if (/^[A-Z]$/.test(character)) {
            const lowerMetric = createGlyphMetric(character.toLowerCase(), pattern);
            glyphs.set(lowerMetric.codePoint, lowerMetric);
        }
    }

    return {
        family,
        face: 'Regular',
        style: 'normal',
        weight: 400,
        ascent: 14,
        descent: 4,
        lineGap: 2,
        unitsPerEm: 20,
        defaultAdvance: 12,
        fallbackCodePoint: '?'.charCodeAt(0),
        glyphs: [...glyphs.values()],
    };
};

export const ensureFallbackUIFont = (
    fonts: Pick<FontRegistry, 'getDefaultFamily' | 'registerFace' | 'resolveFace'>,
    family = AXRONE_FALLBACK_UI_FONT_FAMILY
): string => {
    if (!fonts.resolveFace({ family })) {
        fonts.registerFace(createFallbackUIFontAsset(family));
    }
    return fonts.getDefaultFamily() ?? family;
};

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

export const defaultUIControlTheme: Readonly<UIControlTheme> = Object.freeze({
    fontSize: 16,
    controlHeight: 42,
    controlRadius: 12,
    borderWidth: 1,
    canvasColor: '#050b16cc',
    panelColor: '#0b1323dd',
    surfaceColor: '#162033f0',
    surfaceRaisedColor: '#22324dff',
    surfaceHoverColor: '#2a4060ff',
    surfacePressedColor: '#0f1728ff',
    surfaceDisabledColor: '#141c2bcc',
    borderColor: '#ffffff24',
    borderMutedColor: '#ffffff14',
    focusColor: '#67e8f9ff',
    textColor: '#eef4ffff',
    textMutedColor: '#94a3b8ff',
    placeholderColor: '#71809aff',
    accentColor: '#2dd4bfff',
    accentHoverColor: '#5eead4ff',
    accentPressedColor: '#14b8a6ff',
    successColor: '#22c55eff',
    successHoverColor: '#4ade80ff',
    successPressedColor: '#16a34aff',
    warningColor: '#f59e0bff',
    warningHoverColor: '#fbbf24ff',
    warningPressedColor: '#d97706ff',
    dangerColor: '#ef4444ff',
    dangerHoverColor: '#f87171ff',
    dangerPressedColor: '#dc2626ff',
    thumbColor: '#f8fbffff',
    trackColor: '#0b1220ff',
});

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

const resolveTheme = (theme: Partial<UIControlTheme> | undefined): UIControlTheme => ({
    ...defaultUIControlTheme,
    ...(theme ?? {}),
});

const resolveParentWidget = <TRuntime>(runtime: UIRuntime<TRuntime>, parent: UIParentTarget): WidgetId => {
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

const attachToParent = <TRuntime>(runtime: UIRuntime<TRuntime>, parent: UIParentTarget, widget: WidgetId): void => {
    runtime.appendChild(resolveParentWidget(runtime, parent), widget);
};

const disposeWidget = <TRuntime>(runtime: UIRuntime<TRuntime>, widget: WidgetId): void => {
    try {
        runtime.removeWidget(widget);
    } catch {
        return;
    }
};

const resolveFontFamily = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    theme: UIControlTheme,
    override?: string
): string => override ?? theme.fontFamily ?? runtime.fonts.getDefaultFamily() ?? '';

const countStepDecimals = (step: number): number => {
    if (!Number.isFinite(step) || step <= 0) {
        return 0;
    }
    const parts = step.toString().split('.');
    return parts[1]?.length ?? 0;
};

const formatNumericValue = (value: number, step = 0.1): string => {
    const decimals = clamp(countStepDecimals(step), 0, 3);
    const rounded = Number.parseFloat(value.toFixed(decimals));
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toString();
};

const clampIndex = (value: number, max: number): number => clamp(Math.floor(value), 0, max);

const normalizeRange = (min: number, max: number): { readonly min: number; readonly max: number } => {
    if (max >= min) {
        return { min, max };
    }
    return { min: max, max: min };
};

const normalizeSteppedValue = (value: number, min: number, max: number, step: number): number => {
    const normalizedStep = Number.isFinite(step) && step > 0 ? step : 1;
    const clamped = clamp(value, min, max);
    const snapped = Math.round((clamped - min) / normalizedStep) * normalizedStep + min;
    return clamp(Number.parseFloat(snapped.toFixed(6)), min, max);
};

const resolveVariantPalette = (
    theme: UIControlTheme,
    variant: UIControlVariant
): Readonly<{
    idle: ColorInput;
    hover: ColorInput;
    pressed: ColorInput;
    text: ColorInput;
    border: ColorInput;
}> => {
    switch (variant) {
        case 'primary':
            return {
                idle: theme.accentColor,
                hover: theme.accentHoverColor,
                pressed: theme.accentPressedColor,
                text: '#02110eff',
                border: '#99f6e4aa',
            };
        case 'success':
            return {
                idle: theme.successColor,
                hover: theme.successHoverColor,
                pressed: theme.successPressedColor,
                text: '#03140aff',
                border: '#86efacaa',
            };
        case 'warning':
            return {
                idle: theme.warningColor,
                hover: theme.warningHoverColor,
                pressed: theme.warningPressedColor,
                text: '#140d03ff',
                border: '#fcd34daa',
            };
        case 'danger':
            return {
                idle: theme.dangerColor,
                hover: theme.dangerHoverColor,
                pressed: theme.dangerPressedColor,
                text: '#180505ff',
                border: '#fca5a5aa',
            };
        case 'neutral':
        default:
            return {
                idle: theme.surfaceRaisedColor,
                hover: theme.surfaceHoverColor,
                pressed: theme.surfacePressedColor,
                text: theme.textColor,
                border: theme.borderColor,
            };
    }
};

const createTextBlock = <TRuntime>(
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

const isPointInside = <TRuntime>(runtime: UIRuntime<TRuntime>, widget: WidgetId, x: number, y: number): boolean => {
    const box = runtime.getLayoutBox(widget);
    return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
};

const createBaseHandle = <TRuntime>(runtime: UIRuntime<TRuntime>, root: WidgetId): UIHandle => ({
    root,
    dispose() {
        disposeWidget(runtime, root);
    },
});

export const createStackLayout = (
    direction: 'row' | 'column' = 'column',
    gap = 0,
    overrides: WidgetLayoutInput = {}
): WidgetLayoutInput => ({
    display: 'stack',
    direction,
    gap,
    ...overrides,
});

export const createOverlayLayout = (overrides: WidgetLayoutInput = {}): WidgetLayoutInput => ({
    display: 'overlay',
    ...overrides,
});

export const createAnchoredLayout = (
    anchor: AnchorInput = 'top-left',
    overrides: WidgetLayoutInput = {}
): WidgetLayoutInput => ({
    position: 'absolute',
    anchor,
    ...overrides,
});

export const createUIWidget = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIBaseOptions = {}
): UIWidgetHandle => {
    const root = runtime.createWidget({
        role: options.role ?? 'container:widget',
        key: options.key,
        layout: options.layout,
        style: options.style,
        enabled: options.enabled,
        interactive: options.interactive,
        focus: options.focus,
    });

    attachToParent(runtime, options.parent, root);

    return {
        root,
        content: root,
        update(patch) {
            runtime.updateWidget(root, patch);
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};

export const createUILayout = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UILayoutOptions = {}
): UILayoutHandle => {
    const widget = createUIWidget(runtime, {
        ...options,
        role: options.role ?? 'container:layout',
        layout: {
            display: 'stack',
            direction: 'column',
            gap: 12,
            ...(options.layout ?? {}),
        },
    });

    return widget;
};

export const createUICanvas = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UICanvasOptions = {}
): UICanvasHandle => {
    const theme = resolveTheme(options.theme);
    const widget = createUIWidget(runtime, {
        ...options,
        role: options.role ?? 'container:canvas',
        focus: {
            scope: true,
            cycle: true,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: '100%',
            height: '100%',
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.canvasColor,
            ...(options.style ?? {}),
        },
    });

    return widget;
};

export const createUIRichText = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIRichTextOptions = {}
): UIRichTextHandle => {
    const theme = resolveTheme(undefined);
    let textStyle: Partial<Omit<TextBlockInput, 'value'>> = { ...(options.text ?? {}) };
    let value = options.value ?? '';

    const root = runtime.createWidget({
        role: options.role ?? 'text:rich',
        key: options.key,
        layout: {
            width: 'content',
            height: 'content',
            ...(options.layout ?? {}),
        },
        style: {
            color: options.style?.color ?? theme.textColor,
            ...(options.style ?? {}),
        },
        text: createTextBlock(
            runtime,
            value,
            theme,
            textStyle,
            options.style?.color ?? theme.textColor
        ),
        enabled: options.enabled,
        interactive: options.interactive,
        focus: options.focus,
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        runtime.updateWidget(root, {
            text: createTextBlock(runtime, value, theme, textStyle, options.style?.color ?? theme.textColor),
            style: {
                ...(options.style ?? {}),
                color: options.style?.color ?? theme.textColor,
            },
        });
    };

    return {
        root,
        getText() {
            return value;
        },
        setText(nextValue) {
            value = nextValue;
            apply();
        },
        updateText(patch) {
            textStyle = { ...textStyle, ...patch };
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};

export const createUIButton = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIButtonOptions = {}
): UIButtonHandle => {
    const theme = resolveTheme(options.theme);
    const baseStyle = options.style ?? {};
    const baseText = options.text ?? {};
    const palette = () => resolveVariantPalette(theme, state.variant);
    const state = {
        label: options.label ?? 'Button',
        disabled: options.disabled ?? false,
        hovered: false,
        pressed: false,
        focused: false,
        variant: options.variant ?? 'neutral',
        onPress: options.onPress,
    };

    let handle: UIButtonHandle;

    const root = runtime.createWidget({
        role: 'button',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            width: 'content',
            height: 'content',
            minHeight: theme.controlHeight,
            padding: [10, 16],
            ...(options.layout ?? {}),
        },
        handlers: {
            pointerEnter: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = true;
                apply();
                return true;
            },
            pointerLeave: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = false;
                apply();
                return true;
            },
            pointerDown: () => {
                if (state.disabled) {
                    return false;
                }
                state.pressed = true;
                runtime.setFocus(root, 'pointer');
                apply();
                return true;
            },
            pointerUp: (event) => {
                if (state.disabled) {
                    return false;
                }
                const shouldPress = state.pressed && isPointInside(runtime, root, event.x, event.y);
                state.pressed = false;
                apply();
                if (shouldPress) {
                    state.onPress?.(handle);
                }
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                    state.onPress?.(handle);
                    return true;
                }
                return false;
            },
            focus: () => {
                state.focused = true;
                apply();
            },
            blur: () => {
                state.focused = false;
                state.pressed = false;
                apply();
            },
        },
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        const currentPalette = palette();
        const background = state.disabled
            ? theme.surfaceDisabledColor
            : state.pressed && state.hovered
              ? currentPalette.pressed
              : state.hovered
                ? currentPalette.hover
                : currentPalette.idle;
        const borderColor = state.focused ? theme.focusColor : currentPalette.border;
        const textColor = state.disabled ? theme.textMutedColor : baseText.color ?? currentPalette.text;

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            style: {
                ...baseStyle,
                background,
                borderColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : baseStyle.borderWidth ?? theme.borderWidth,
                radius: baseStyle.radius ?? theme.controlRadius,
                color: textColor,
            },
            text: createTextBlock(runtime, state.label, theme, {
                align: 'center',
                wrap: 'none',
                overflow: 'ellipsis',
                ...(baseText ?? {}),
                color: textColor,
            }, textColor),
        });
    };

    handle = {
        root,
        getLabel() {
            return state.label;
        },
        setLabel(value) {
            state.label = value;
            apply();
        },
        isDisabled() {
            return state.disabled;
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.pressed = false;
            state.hovered = false;
            apply();
        },
        setVariant(variant) {
            state.variant = variant;
            apply();
        },
        setOnPress(handler) {
            state.onPress = handler;
        },
        press() {
            if (!state.disabled) {
                state.onPress?.(handle);
            }
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};

export const createUIToggle = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIToggleOptions = {}
): UIToggleHandle => {
    const theme = resolveTheme(options.theme);
    const state = {
        checked: options.checked ?? false,
        disabled: options.disabled ?? false,
        hovered: false,
        pressed: false,
        focused: false,
        label: options.label ?? 'Toggle',
        onChange: options.onChange,
        variant: options.variant ?? 'primary',
    };
    const labelPlacement = options.labelPlacement ?? 'right';
    const trackWidth = 48;
    const trackHeight = 28;
    const thumbSize = 22;

    let handle: UIToggleHandle;

    const root = runtime.createWidget({
        role: 'custom:toggle',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 12,
            width: 'content',
            height: 'content',
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? '#00000000',
            ...(options.style ?? {}),
        },
        handlers: {
            pointerEnter: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = true;
                apply();
                return true;
            },
            pointerLeave: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = false;
                apply();
                return true;
            },
            pointerDown: () => {
                if (state.disabled) {
                    return false;
                }
                state.pressed = true;
                runtime.setFocus(root, 'pointer');
                apply();
                return true;
            },
            pointerUp: (event) => {
                if (state.disabled) {
                    return false;
                }
                const shouldToggle = state.pressed && isPointInside(runtime, root, event.x, event.y);
                state.pressed = false;
                if (shouldToggle) {
                    state.checked = !state.checked;
                    state.onChange?.(state.checked, handle);
                }
                apply();
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                    state.checked = !state.checked;
                    state.onChange?.(state.checked, handle);
                    apply();
                    return true;
                }
                return false;
            },
            focus: () => {
                state.focused = true;
                apply();
            },
            blur: () => {
                state.focused = false;
                state.pressed = false;
                apply();
            },
        },
    });

    const track = runtime.createWidget({
        role: 'custom:toggle-track',
        layout: {
            width: trackWidth,
            height: trackHeight,
            display: 'overlay',
            shrink: 0,
        },
    });
    const thumb = runtime.createWidget({
        role: 'custom:toggle-thumb',
        layout: {
            position: 'absolute',
            width: thumbSize,
            height: thumbSize,
        },
    });
    const label = runtime.createWidget({
        role: 'text',
        layout: {
            width: 'content',
            height: 'content',
        },
    });

    attachToParent(runtime, options.parent, root);
    if (labelPlacement === 'left') {
        runtime.appendChild(root, label);
        runtime.appendChild(root, track);
    } else {
        runtime.appendChild(root, track);
        runtime.appendChild(root, label);
    }
    runtime.appendChild(track, thumb);

    const apply = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const activeColor = state.checked ? palette.idle : theme.surfaceColor;
        const hoverColor = state.checked ? palette.hover : theme.surfaceHoverColor;
        const currentColor = state.disabled
            ? theme.surfaceDisabledColor
            : state.hovered || state.focused
              ? hoverColor
              : activeColor;

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
        });
        runtime.updateWidget(track, {
            style: {
                background: currentColor,
                borderColor: state.focused ? theme.focusColor : state.checked ? palette.border : theme.borderColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : theme.borderWidth,
                radius: 999,
            },
        });
        runtime.updateWidget(thumb, {
            layout: {
                position: 'absolute',
                width: thumbSize,
                height: thumbSize,
                anchor: {
                    x: state.checked ? 1 : 0,
                    y: 0.5,
                    pivotX: state.checked ? 1 : 0,
                    pivotY: 0.5,
                    offsetX: state.checked ? -3 : 3,
                    offsetY: 0,
                },
            },
            style: {
                background: state.disabled ? theme.textMutedColor : theme.thumbColor,
                borderColor: '#00000018',
                borderWidth: 1,
                radius: 999,
            },
        });
        runtime.updateWidget(label, {
            text: createTextBlock(runtime, state.label, theme, { wrap: 'none' }, state.disabled ? theme.textMutedColor : theme.textColor),
            style: {
                color: state.disabled ? theme.textMutedColor : theme.textColor,
            },
        });
    };

    handle = {
        root,
        isChecked() {
            return state.checked;
        },
        setChecked(checked) {
            state.checked = checked;
            apply();
        },
        toggle() {
            if (!state.disabled) {
                state.checked = !state.checked;
                state.onChange?.(state.checked, handle);
                apply();
            }
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.pressed = false;
            state.hovered = false;
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};

export const createUIProgressBar = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIProgressBarOptions = {}
): UIProgressBarHandle => {
    const theme = resolveTheme(options.theme);
    const range = normalizeRange(options.min ?? 0, options.max ?? 1);
    const state = {
        label: options.label ?? 'Progress',
        min: range.min,
        max: range.max,
        value: clamp(options.value ?? range.min, range.min, range.max),
        showValue: options.showValue ?? true,
        variant: options.variant ?? 'primary',
    };
    const root = runtime.createWidget({
        role: 'custom:progress-bar',
        key: options.key,
        layout: {
            display: 'stack',
            direction: 'column',
            gap: 8,
            width: 260,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? '#00000000',
            ...(options.style ?? {}),
        },
    });
    const labelWidget = runtime.createWidget({
        role: 'text',
        layout: {
            width: 'content',
            height: 'content',
        },
        style: {
            color: theme.textColor,
        },
    });
    const track = runtime.createWidget({
        role: 'custom:progress-track',
        layout: {
            width: '100%',
            height: 14,
            display: 'overlay',
        },
    });
    const fill = runtime.createWidget({
        role: 'custom:progress-fill',
        layout: {
            position: 'absolute',
            anchor: 'left',
            inset: { left: 0, top: 0, bottom: 0 },
            width: '0%',
        },
    });

    attachToParent(runtime, options.parent, root);
    if (state.showValue || state.label) {
        runtime.appendChild(root, labelWidget);
    }
    runtime.appendChild(root, track);
    runtime.appendChild(track, fill);

    const apply = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const percent = state.max === state.min ? 0 : (state.value - state.min) / (state.max - state.min);
        const percentString = `${clamp(percent * 100, 0, 100)}%` as PercentageString;
        const valueText = state.showValue ? `${formatNumericValue(state.value, 0.01)} / ${formatNumericValue(state.max, 0.01)}` : '';
        const labelText = state.label && state.showValue ? `${state.label}  ${valueText}` : state.label || valueText;

        if (state.showValue || state.label) {
            runtime.updateWidget(labelWidget, {
                text: createTextBlock(runtime, labelText, theme, { wrap: 'none' }, theme.textColor),
            });
        }

        runtime.updateWidget(track, {
            style: {
                background: theme.trackColor,
                borderColor: theme.borderMutedColor,
                borderWidth: theme.borderWidth,
                radius: 999,
            },
        });
        runtime.updateWidget(fill, {
            layout: {
                position: 'absolute',
                anchor: 'left',
                inset: { left: 0, top: 0, bottom: 0 },
                width: percentString,
            },
            style: {
                background: palette.idle,
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 999,
            },
        });
    };

    apply();

    return {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            state.value = clamp(value, state.min, state.max);
            apply();
        },
        setRange(min, max) {
            const next = normalizeRange(min, max);
            state.min = next.min;
            state.max = next.max;
            state.value = clamp(state.value, state.min, state.max);
            apply();
        },
        setLabel(label) {
            state.label = label;
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};

export const createUISlider = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UISliderOptions = {}
): UISliderHandle => {
    const theme = resolveTheme(options.theme);
    const range = normalizeRange(options.min ?? 0, options.max ?? 1);
    const state = {
        label: options.label ?? '',
        min: range.min,
        max: range.max,
        step: options.step ?? 0.01,
        value: normalizeSteppedValue(options.value ?? range.min, range.min, range.max, options.step ?? 0.01),
        showValue: options.showValue ?? true,
        disabled: options.disabled ?? false,
        dragging: false,
        focused: false,
        variant: options.variant ?? 'primary',
        onChange: options.onChange,
    };

    const root = runtime.createWidget({
        role: 'custom:slider',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'stack',
            direction: 'column',
            gap: 8,
            width: 260,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? '#00000000',
            ...(options.style ?? {}),
        },
    });
    const header = runtime.createWidget({
        role: 'text',
    });
    const track = runtime.createWidget({
        role: 'custom:slider-track',
        layout: {
            width: '100%',
            height: 20,
            display: 'overlay',
        },
    });
    const rail = runtime.createWidget({
        role: 'custom:slider-rail',
        layout: {
            position: 'absolute',
            anchor: {
                x: 0,
                y: 0.5,
                pivotX: 0,
                pivotY: 0.5,
            },
            inset: { left: 0, right: 0 },
            height: 6,
        },
    });
    const fill = runtime.createWidget({
        role: 'custom:slider-fill',
        layout: {
            position: 'absolute',
            anchor: {
                x: 0,
                y: 0.5,
                pivotX: 0,
                pivotY: 0.5,
            },
            inset: { left: 0 },
            width: '0%',
            height: 6,
        },
    });
    const thumb = runtime.createWidget({
        role: 'custom:slider-thumb',
        layout: {
            position: 'absolute',
            width: 18,
            height: 18,
        },
    });

    attachToParent(runtime, options.parent, root);
    if (state.label || state.showValue) {
        runtime.appendChild(root, header);
    }
    runtime.appendChild(root, track);
    runtime.appendChild(track, rail);
    runtime.appendChild(track, fill);
    runtime.appendChild(track, thumb);

    let handle: UISliderHandle;

    const setValueInternal = (value: number, emit: boolean): void => {
        const nextValue = normalizeSteppedValue(value, state.min, state.max, state.step);
        if (nextValue === state.value) {
            apply();
            return;
        }
        state.value = nextValue;
        if (emit) {
            state.onChange?.(state.value, handle);
        }
        apply();
    };

    const updateFromPointer = (event: Readonly<UIPointerEvent>): void => {
        const box = runtime.getLayoutBox(track);
        const ratio = clamp((event.x - box.x) / Math.max(box.width, 1), 0, 1);
        setValueInternal(state.min + (state.max - state.min) * ratio, true);
    };

    const apply = (): void => {
        const palette = resolveVariantPalette(theme, state.variant);
        const ratio = state.max === state.min ? 0 : (state.value - state.min) / (state.max - state.min);
        const percent = clamp(ratio * 100, 0, 100);
        const headerText = state.label && state.showValue
            ? `${state.label}: ${formatNumericValue(state.value, state.step)}`
            : state.label || (state.showValue ? formatNumericValue(state.value, state.step) : '');

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            handlers: {
                pointerDown: (event) => {
                    if (state.disabled) {
                        return false;
                    }
                    runtime.setFocus(root, 'pointer');
                    if (isPointInside(runtime, track, event.x, event.y)) {
                        state.dragging = true;
                        updateFromPointer(event);
                    }
                    return true;
                },
                pointerMove: (event) => {
                    if (!state.dragging || state.disabled) {
                        return false;
                    }
                    updateFromPointer(event);
                    return true;
                },
                pointerUp: (event) => {
                    if (!state.dragging || state.disabled) {
                        return false;
                    }
                    updateFromPointer(event);
                    state.dragging = false;
                    return true;
                },
                keyDown: (event: Readonly<UIKeyEvent>) => {
                    if (state.disabled) {
                        return false;
                    }
                    switch (event.key) {
                        case 'ArrowLeft':
                        case 'ArrowDown':
                            setValueInternal(state.value - state.step, true);
                            return true;
                        case 'ArrowRight':
                        case 'ArrowUp':
                            setValueInternal(state.value + state.step, true);
                            return true;
                        case 'Home':
                            setValueInternal(state.min, true);
                            return true;
                        case 'End':
                            setValueInternal(state.max, true);
                            return true;
                        case 'PageDown':
                            setValueInternal(state.value - state.step * 10, true);
                            return true;
                        case 'PageUp':
                            setValueInternal(state.value + state.step * 10, true);
                            return true;
                        default:
                            return false;
                    }
                },
                focus: () => {
                    state.focused = true;
                    apply();
                },
                blur: () => {
                    state.focused = false;
                    state.dragging = false;
                    apply();
                },
            },
        });

        if (state.label || state.showValue) {
            runtime.updateWidget(header, {
                text: createTextBlock(runtime, headerText, theme, { wrap: 'none' }, state.disabled ? theme.textMutedColor : theme.textColor),
                style: {
                    color: state.disabled ? theme.textMutedColor : theme.textColor,
                },
            });
        }

        runtime.updateWidget(track, {
            style: {
                background: '#00000000',
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 0,
            },
        });
        runtime.updateWidget(rail, {
            style: {
                background: theme.trackColor,
                borderColor: state.focused ? theme.focusColor : theme.borderMutedColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : theme.borderWidth,
                radius: 999,
            },
        });
        runtime.updateWidget(fill, {
            layout: {
                position: 'absolute',
                anchor: {
                    x: 0,
                    y: 0.5,
                    pivotX: 0,
                    pivotY: 0.5,
                },
                inset: { left: 0 },
                width: `${percent}%`,
                height: 6,
            },
            style: {
                background: state.disabled ? theme.surfaceDisabledColor : palette.idle,
                borderColor: '#00000000',
                borderWidth: 0,
                radius: 999,
            },
        });
        runtime.updateWidget(thumb, {
            layout: {
                position: 'absolute',
                width: 18,
                height: 18,
                anchor: {
                    x: percent / 100,
                    y: 0.5,
                    pivotX: 0.5,
                    pivotY: 0.5,
                },
            },
            style: {
                background: state.disabled ? theme.textMutedColor : theme.thumbColor,
                borderColor: state.focused ? theme.focusColor : palette.border,
                borderWidth: theme.borderWidth,
                radius: 999,
            },
        });
    };

    handle = {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            setValueInternal(value, false);
        },
        setRange(min, max) {
            const next = normalizeRange(min, max);
            state.min = next.min;
            state.max = next.max;
            state.value = normalizeSteppedValue(state.value, state.min, state.max, state.step);
            apply();
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.dragging = false;
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};

export const createUIEditBox = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIEditBoxOptions = {}
): UIEditBoxHandle => {
    const theme = resolveTheme(options.theme);
    const textOverrides = options.text ?? {};
    const state = {
        value: options.value ?? '',
        placeholder: options.placeholder ?? 'Type here',
        multiline: options.multiline ?? false,
        password: options.password ?? false,
        readOnly: options.readOnly ?? false,
        disabled: options.disabled ?? false,
        hovered: false,
        focused: false,
        caretIndex: 0,
        anchorIndex: null as number | null,
        onChange: options.onChange,
        onSubmit: options.onSubmit,
    };
    state.caretIndex = state.value.length;

    let handle: UIEditBoxHandle;

    const getSelectionBounds = (): readonly [number, number] | null => {
        if (state.anchorIndex === null || state.anchorIndex === state.caretIndex) {
            return null;
        }
        return state.anchorIndex < state.caretIndex
            ? [state.anchorIndex, state.caretIndex]
            : [state.caretIndex, state.anchorIndex];
    };

    const clearSelection = (): void => {
        state.anchorIndex = null;
    };

    const commitTextChange = (): void => {
        state.onChange?.(state.value, handle);
        apply();
    };

    const replaceSelection = (text: string): void => {
        const bounds = getSelectionBounds();
        const start = bounds ? bounds[0] : state.caretIndex;
        const end = bounds ? bounds[1] : state.caretIndex;
        state.value = `${state.value.slice(0, start)}${text}${state.value.slice(end)}`;
        state.caretIndex = start + text.length;
        clearSelection();
        commitTextChange();
    };

    const setCaretInternal = (index: number, extend = false): void => {
        const nextIndex = clampIndex(index, state.value.length);
        if (extend) {
            state.anchorIndex ??= state.caretIndex;
        } else {
            clearSelection();
        }
        state.caretIndex = nextIndex;
        apply();
    };

    const deleteBackward = (): void => {
        if (state.readOnly || state.disabled) {
            return;
        }
        const bounds = getSelectionBounds();
        if (bounds) {
            replaceSelection('');
            return;
        }
        if (state.caretIndex <= 0) {
            return;
        }
        state.value = `${state.value.slice(0, state.caretIndex - 1)}${state.value.slice(state.caretIndex)}`;
        state.caretIndex -= 1;
        commitTextChange();
    };

    const deleteForward = (): void => {
        if (state.readOnly || state.disabled) {
            return;
        }
        const bounds = getSelectionBounds();
        if (bounds) {
            replaceSelection('');
            return;
        }
        if (state.caretIndex >= state.value.length) {
            return;
        }
        state.value = `${state.value.slice(0, state.caretIndex)}${state.value.slice(state.caretIndex + 1)}`;
        commitTextChange();
    };

    const resolveDisplayValue = (): string => {
        if (state.password) {
            return '*'.repeat(state.value.length);
        }
        return state.value;
    };

    const setCaretFromPointer = (event: Readonly<UIPointerEvent>, extend = false): void => {
        const displayValue = resolveDisplayValue();
        if (displayValue.length === 0) {
            setCaretInternal(0, extend);
            return;
        }
        const layout = runtime.getTextLayout(root);
        const box = runtime.getLayoutBox(root);
        if (!layout || layout.carets.length === 0) {
            setCaretInternal(displayValue.length, extend);
            return;
        }

        let bestIndex = layout.carets[0].index;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const caret of layout.carets) {
            const dx = box.contentX + caret.x - event.x;
            const dy = box.contentY + caret.y + caret.height * 0.5 - event.y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = caret.index;
            }
        }
        setCaretInternal(bestIndex, extend);
    };

    const root = runtime.createWidget({
        role: 'input',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            width: 260,
            height: state.multiline ? 96 : theme.controlHeight,
            padding: [10, 12],
            ...(options.layout ?? {}),
        },
        handlers: {
            pointerEnter: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = true;
                apply();
                return true;
            },
            pointerLeave: () => {
                if (state.disabled) {
                    return false;
                }
                state.hovered = false;
                apply();
                return true;
            },
            pointerDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                runtime.setFocus(root, 'pointer');
                setCaretFromPointer(event, Boolean(event.shiftKey));
                return true;
            },
            keyDown: (event: Readonly<UIKeyEvent>) => {
                if (state.disabled) {
                    return false;
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                    state.anchorIndex = 0;
                    state.caretIndex = state.value.length;
                    apply();
                    return true;
                }
                switch (event.key) {
                    case 'ArrowLeft':
                        setCaretInternal(state.caretIndex - 1, Boolean(event.shiftKey));
                        return true;
                    case 'ArrowRight':
                        setCaretInternal(state.caretIndex + 1, Boolean(event.shiftKey));
                        return true;
                    case 'Home':
                        setCaretInternal(0, Boolean(event.shiftKey));
                        return true;
                    case 'End':
                        setCaretInternal(state.value.length, Boolean(event.shiftKey));
                        return true;
                    case 'Backspace':
                        deleteBackward();
                        return true;
                    case 'Delete':
                        deleteForward();
                        return true;
                    case 'Enter':
                        if (state.multiline) {
                            replaceSelection('\n');
                        } else {
                            state.onSubmit?.(state.value, handle);
                        }
                        return true;
                    default:
                        return false;
                }
            },
            textInput: (event) => {
                if (state.readOnly || state.disabled) {
                    return true;
                }
                replaceSelection(event.text);
                return true;
            },
            focus: () => {
                state.focused = true;
                apply();
            },
            blur: () => {
                state.focused = false;
                clearSelection();
                apply();
            },
        },
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        const displayValue = resolveDisplayValue();
        const placeholderVisible = displayValue.length === 0;
        const selection = state.focused && !placeholderVisible ? getSelectionBounds() : null;
        const textColor = placeholderVisible ? theme.placeholderColor : textOverrides.color ?? theme.textColor;

        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
            style: {
                ...(options.style ?? {}),
                background: state.disabled ? theme.surfaceDisabledColor : options.style?.background ?? theme.surfaceColor,
                borderColor: state.focused ? theme.focusColor : state.hovered ? theme.borderColor : theme.borderMutedColor,
                borderWidth: state.focused ? theme.borderWidth + 1 : options.style?.borderWidth ?? theme.borderWidth,
                radius: options.style?.radius ?? theme.controlRadius,
                clip: true,
                color: textColor,
            },
            text: createTextBlock(runtime, placeholderVisible ? state.placeholder : displayValue, theme, {
                wrap: state.multiline ? 'word' : 'none',
                overflow: state.multiline ? 'clip' : 'ellipsis',
                ...(textOverrides ?? {}),
                color: textColor,
                selectionStart: selection?.[0],
                selectionEnd: selection?.[1],
                selectionColor: textOverrides.selectionColor ?? DEFAULT_SELECTION_COLOR,
                caretIndex: state.focused && !placeholderVisible ? state.caretIndex : undefined,
                caretColor: theme.textColor,
                caretWidth: textOverrides.caretWidth ?? 2,
            }, textColor),
        });
    };

    handle = {
        root,
        getValue() {
            return state.value;
        },
        setValue(value) {
            state.value = value;
            state.caretIndex = clampIndex(state.caretIndex, state.value.length);
            clearSelection();
            apply();
        },
        setDisabled(disabled) {
            state.disabled = disabled;
            state.hovered = false;
            apply();
        },
        setReadOnly(readOnly) {
            state.readOnly = readOnly;
            apply();
        },
        setSelection(start, end) {
            state.anchorIndex = clampIndex(start, state.value.length);
            state.caretIndex = clampIndex(end, state.value.length);
            apply();
        },
        setCaret(index) {
            setCaretInternal(index, false);
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };

    apply();
    return handle;
};

export const createUIScrollView = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIScrollViewOptions = {}
): UIScrollViewHandle => {
    const theme = resolveTheme(options.theme);
    const state = {
        scrollX: Math.max(0, options.scrollX ?? 0),
        scrollY: Math.max(0, options.scrollY ?? 0),
        disabled: options.disabled ?? false,
    };

    const root = runtime.createWidget({
        role: 'custom:scroll-view',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: 320,
            height: 200,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.panelColor,
            borderColor: options.style?.borderColor ?? theme.borderColor,
            borderWidth: options.style?.borderWidth ?? theme.borderWidth,
            radius: options.style?.radius ?? theme.controlRadius,
            clip: true,
            ...(options.style ?? {}),
        },
        handlers: {
            wheel: (event) => {
                if (state.disabled) {
                    return false;
                }
                state.scrollX = Math.max(0, state.scrollX + (event.deltaX ?? 0));
                state.scrollY = Math.max(0, state.scrollY + (event.deltaY ?? 0));
                applyOffsets();
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                switch (event.key) {
                    case 'PageDown':
                        state.scrollY = Math.max(0, state.scrollY + 64);
                        applyOffsets();
                        return true;
                    case 'PageUp':
                        state.scrollY = Math.max(0, state.scrollY - 64);
                        applyOffsets();
                        return true;
                    case 'Home':
                        state.scrollY = 0;
                        state.scrollX = 0;
                        applyOffsets();
                        return true;
                    case 'End':
                        clampToBoundsInternal();
                        applyOffsets();
                        return true;
                    default:
                        return false;
                }
            },
        },
    });
    const content = runtime.createWidget({
        role: 'container:scroll-content',
        layout: {
            position: 'absolute',
            inset: { top: 0, left: 0 },
            width: '100%',
            height: 'content',
            display: 'stack',
            direction: 'column',
            gap: 10,
            ...(options.contentLayout ?? {}),
            contentOffsetX: state.scrollX,
            contentOffsetY: state.scrollY,
        },
        style: {
            background: options.contentStyle?.background ?? '#00000000',
            ...(options.contentStyle ?? {}),
        },
    });

    attachToParent(runtime, options.parent, root);
    runtime.appendChild(root, content);

    const applyOffsets = (): void => {
        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
        });
        runtime.updateWidget(content, {
            layout: {
                ...(options.contentLayout ?? {}),
                position: 'absolute',
                inset: { top: 0, left: 0 },
                width: options.contentLayout?.width ?? '100%',
                height: options.contentLayout?.height ?? 'content',
                display: options.contentLayout?.display ?? 'stack',
                direction: options.contentLayout?.direction ?? 'column',
                gap: options.contentLayout?.gap ?? 10,
                contentOffsetX: state.scrollX,
                contentOffsetY: state.scrollY,
            },
        });
    };

    const clampToBoundsInternal = (): void => {
        const viewport = runtime.getLayoutBox(root);
        const contentBox = runtime.getLayoutBox(content);
        if (viewport.contentWidth <= 0 || viewport.contentHeight <= 0) {
            return;
        }
        state.scrollX = clamp(state.scrollX, 0, Math.max(0, contentBox.width - viewport.contentWidth));
        state.scrollY = clamp(state.scrollY, 0, Math.max(0, contentBox.height - viewport.contentHeight));
    };

    applyOffsets();

    return {
        root,
        content,
        getScroll() {
            return { x: state.scrollX, y: state.scrollY };
        },
        setScroll(x, y) {
            state.scrollX = Math.max(0, x);
            state.scrollY = Math.max(0, y);
            applyOffsets();
        },
        scrollBy(deltaX, deltaY) {
            state.scrollX = Math.max(0, state.scrollX + deltaX);
            state.scrollY = Math.max(0, state.scrollY + deltaY);
            applyOffsets();
        },
        clampToBounds() {
            clampToBoundsInternal();
            applyOffsets();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};

export const createUIPageView = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIPageViewOptions = {}
): UIPageViewHandle => {
    const theme = resolveTheme(options.theme);
    const state = {
        page: Math.max(0, options.page ?? 0),
        disabled: options.disabled ?? false,
        showIndicators: options.showIndicators ?? true,
    };
    const pages: WidgetId[] = [];
    const indicatorDots: WidgetId[] = [];

    const root = runtime.createWidget({
        role: 'custom:page-view',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: 320,
            height: 200,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.panelColor,
            borderColor: options.style?.borderColor ?? theme.borderColor,
            borderWidth: options.style?.borderWidth ?? theme.borderWidth,
            radius: options.style?.radius ?? theme.controlRadius,
            clip: true,
            ...(options.style ?? {}),
        },
        handlers: {
            keyDown: (event) => {
                if (state.disabled || pages.length === 0) {
                    return false;
                }
                if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                    setPageInternal(state.page - 1);
                    return true;
                }
                if (event.key === 'ArrowRight' || event.key === 'PageDown') {
                    setPageInternal(state.page + 1);
                    return true;
                }
                return false;
            },
        },
    });
    const content = runtime.createWidget({
        role: 'container:page-view-content',
        layout: {
            position: 'absolute',
            anchor: 'stretch',
            display: 'overlay',
        },
    });
    const indicators = runtime.createWidget({
        role: 'container:page-view-indicators',
        layout: {
            position: 'absolute',
            anchor: 'bottom',
            inset: { bottom: 12 },
            display: 'stack',
            direction: 'row',
            gap: 8,
            justifyContent: 'center',
            alignItems: 'center',
            width: 'content',
            height: 'content',
        },
    });

    attachToParent(runtime, options.parent, root);
    runtime.appendChild(root, content);
    if (state.showIndicators) {
        runtime.appendChild(root, indicators);
    }

    const updateIndicators = (): void => {
        if (!state.showIndicators) {
            return;
        }
        while (indicatorDots.length < pages.length) {
            const dotIndex = indicatorDots.length;
            const dot = runtime.createWidget({
                role: 'custom:page-view-dot',
                interactive: true,
                focus: { focusable: false },
                layout: {
                    width: 10,
                    height: 10,
                    shrink: 0,
                },
                handlers: {
                    pointerUp: () => {
                        setPageInternal(dotIndex);
                        return true;
                    },
                },
            });
            indicatorDots.push(dot);
            runtime.appendChild(indicators, dot);
        }
        for (let index = 0; index < indicatorDots.length; index += 1) {
            runtime.updateWidget(indicatorDots[index], {
                style: {
                    background: index === state.page ? theme.accentColor : theme.surfaceRaisedColor,
                    borderColor: index === state.page ? theme.focusColor : theme.borderColor,
                    borderWidth: 1,
                    radius: 999,
                    opacity: index === state.page ? 1 : 0.85,
                },
            });
        }
    };

    const setPageInternal = (index: number): void => {
        if (pages.length === 0) {
            state.page = 0;
            return;
        }
        state.page = clamp(index, 0, pages.length - 1);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
            runtime.updateWidget(pages[pageIndex], {
                layout: {
                    position: 'absolute',
                    anchor: 'stretch',
                },
                style: {
                    visible: pageIndex === state.page,
                },
            });
        }
        updateIndicators();
    };

    updateIndicators();

    return {
        root,
        content,
        getPage() {
            return state.page;
        },
        setPage(index) {
            setPageInternal(index);
        },
        addPage(page) {
            pages.push(page);
            runtime.appendChild(content, page);
            setPageInternal(state.page);
            return pages.length - 1;
        },
        next() {
            setPageInternal(state.page + 1);
            return state.page;
        },
        previous() {
            setPageInternal(state.page - 1);
            return state.page;
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};
