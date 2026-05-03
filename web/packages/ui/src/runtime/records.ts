import { normalizeCorners } from '../layout';
import type {
    ReadonlyColor,
    ResolvedFocusPolicy,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    TextBlockInput,
    WidgetConfig,
    WidgetEventHandlers,
    WidgetFocusPolicyInput,
    WidgetImageInput,
    WidgetKey,
    WidgetLayoutInput,
    WidgetRole,
    WidgetStyleInput,
} from '../types';
import {
    BLACK,
    EMPTY_FOCUS_INPUT,
    EMPTY_LAYOUT_INPUT,
    EMPTY_RECORD_OBJECT,
    EMPTY_STYLE_INPUT,
    TRANSPARENT,
    WHITE,
    clamp,
    cloneData,
    normalizeColor,
    normalizeIndex,
    normalizeUvRect,
    normalizeWeight,
} from './internals';

export interface StoredWidgetRecord<TRuntime = unknown> {
    readonly role: WidgetRole;
    readonly controller: string | null;
    readonly key?: WidgetKey;
    readonly props: Readonly<Record<string, unknown>>;
    readonly enabled: boolean;
    readonly interactive: boolean;
    readonly layoutInput: WidgetLayoutInput;
    readonly styleInput: WidgetStyleInput;
    readonly textInput: TextBlockInput | null;
    readonly imageInput: WidgetImageInput | null;
    readonly focusInput: WidgetFocusPolicyInput;
    readonly handlers: WidgetEventHandlers<Record<string, unknown>, TRuntime> | null;
}

export interface TextCompileContext {
    readonly defaultFamily: string | null;
    readonly locale: string;
    readonly fallbackColor: ReadonlyColor;
}

export const normalizeWidgetRecord = <TRuntime>(
    config: WidgetConfig<Record<string, unknown>, TRuntime>
): StoredWidgetRecord<TRuntime> => ({
    role: config.role ?? 'container',
    controller: config.controller ?? null,
    key: config.key,
    props: cloneData(config.props ?? EMPTY_RECORD_OBJECT),
    enabled: config.enabled ?? true,
    interactive: config.interactive ?? false,
    layoutInput: cloneData(config.layout ?? EMPTY_LAYOUT_INPUT),
    styleInput: cloneData(config.style ?? EMPTY_STYLE_INPUT),
    textInput: cloneData(config.text ?? null),
    imageInput: cloneData(config.image ?? null),
    focusInput: cloneData(config.focus ?? EMPTY_FOCUS_INPUT),
    handlers: (config.handlers as WidgetEventHandlers<Record<string, unknown>, TRuntime>) ?? null,
});

export const compileWidgetStyle = (input: WidgetStyleInput): ResolvedWidgetStyle => ({
    visible: input.visible ?? true,
    opacity: clamp(input.opacity ?? 1, 0, 1),
    clip: input.clip ?? false,
    background: normalizeColor(input.background, TRANSPARENT),
    borderColor: normalizeColor(input.borderColor, TRANSPARENT),
    borderWidth: Math.max(0, input.borderWidth ?? 0),
    radius: normalizeCorners(input.radius),
    color: normalizeColor(input.color, BLACK),
});

export const compileWidgetText = (
    input: TextBlockInput | null,
    context: TextCompileContext
): ResolvedTextBlock | null => {
    if (!input) {
        return null;
    }
    return {
        value: input.value,
        family: input.family ?? context.defaultFamily ?? '',
        size: Math.max(1, input.size ?? 16),
        weight: normalizeWeight(input.weight),
        style: input.style ?? 'normal',
        locale: input.locale ?? context.locale,
        direction: input.direction ?? 'auto',
        lineHeight: Math.max(0, input.lineHeight ?? 0),
        letterSpacing: input.letterSpacing ?? 0,
        wrap: input.wrap ?? 'word',
        overflow: input.overflow ?? 'clip',
        maxLines: Math.max(1, Math.floor(input.maxLines ?? Number.MAX_SAFE_INTEGER)),
        align: input.align ?? 'start',
        color: normalizeColor(input.color, context.fallbackColor),
        outlineColor: normalizeColor(input.outlineColor, TRANSPARENT),
        outlineWidth: Math.max(0, input.outlineWidth ?? 0),
        edgeSoftness: Math.max(0.5, input.edgeSoftness ?? 1),
        shadowColor: normalizeColor(input.shadowColor, TRANSPARENT),
        shadowOffsetX: input.shadowOffsetX ?? 0,
        shadowOffsetY: input.shadowOffsetY ?? 0,
        underline: input.underline ?? false,
        underlineColor: normalizeColor(input.underlineColor, TRANSPARENT),
        underlineThickness: Math.max(1, input.underlineThickness ?? 1),
        underlineOffset: input.underlineOffset ?? 1,
        strikeThrough: input.strikeThrough ?? false,
        strikeThroughColor: normalizeColor(input.strikeThroughColor, TRANSPARENT),
        strikeThroughThickness: Math.max(1, input.strikeThroughThickness ?? 1),
        selectionStart: normalizeIndex(input.selectionStart),
        selectionEnd: normalizeIndex(input.selectionEnd),
        selectionColor: normalizeColor(input.selectionColor, TRANSPARENT),
        caretIndex: normalizeIndex(input.caretIndex),
        caretColor: normalizeColor(input.caretColor, TRANSPARENT),
        caretWidth: Math.max(1, input.caretWidth ?? 1),
        caretInset: Math.max(0, input.caretInset ?? 1),
    };
};

export const compileWidgetImage = (input: WidgetImageInput | null): ResolvedWidgetImage | null => {
    if (!input) {
        return null;
    }
    const source =
        input.source.kind === 'material'
            ? {
                  kind: 'material' as const,
                  materialId: input.source.materialId,
                  textureBinding: input.source.textureBinding,
                  width: Math.max(1, input.source.width),
                  height: Math.max(1, input.source.height),
              }
            : {
                  kind: 'texture' as const,
                  resourceId: input.source.resourceId,
                  width: Math.max(1, input.source.width),
                  height: Math.max(1, input.source.height),
              };
    return {
        source,
        fit: input.fit ?? 'fill',
        alignX: clamp(input.alignX ?? 0.5, 0, 1),
        alignY: clamp(input.alignY ?? 0.5, 0, 1),
        sampling: input.sampling ?? 'linear',
        tint: normalizeColor(input.tint, WHITE),
        uvRect: normalizeUvRect(input.uvRect),
    };
};

export const compileWidgetFocus = (
    input: WidgetFocusPolicyInput,
    interactive: boolean
): ResolvedFocusPolicy => ({
    focusable: input.focusable ?? interactive,
    tabIndex: input.tabIndex ?? 0,
    scope: input.scope ?? false,
    cycle: input.cycle ?? false,
    order: input.order ?? 0,
});
