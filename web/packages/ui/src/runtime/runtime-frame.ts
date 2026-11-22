import { TRANSPARENT } from './internals';
import type {
    ImageRenderCommand,
    LayoutBox,
    QuadRenderCommand,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    SizeLike,
    TextLayoutResult,
    WidgetId,
} from '../types';

/**
 * Frame command builders extracted from UIRuntime (refactor plan P2-4).
 *
 * These are pure functions: they read only their explicit parameters and
 * produce render commands / measurements. UIRuntime delegates to them from
 * `commit()` and `measureContent()`; behavior is intentionally identical to
 * the previous private-method implementations.
 */

export function measureImageContent(
    image: ResolvedWidgetImage,
    constraints: Readonly<SizeLike>
): SizeLike {
    const intrinsicWidth = image.source.width;
    const intrinsicHeight = image.source.height;
    const maxWidth = Number.isFinite(constraints.width) ? Math.max(0, constraints.width) : Number.POSITIVE_INFINITY;
    const maxHeight = Number.isFinite(constraints.height) ? Math.max(0, constraints.height) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(maxWidth) && !Number.isFinite(maxHeight)) {
        return { width: intrinsicWidth, height: intrinsicHeight };
    }
    if (image.fit === 'fill') {
        return {
            width: Number.isFinite(maxWidth) ? maxWidth : intrinsicWidth,
            height: Number.isFinite(maxHeight) ? maxHeight : intrinsicHeight,
        };
    }
    const widthScale = Number.isFinite(maxWidth) ? maxWidth / intrinsicWidth : Number.POSITIVE_INFINITY;
    const heightScale = Number.isFinite(maxHeight) ? maxHeight / intrinsicHeight : Number.POSITIVE_INFINITY;
    if (image.fit === 'none') {
        return {
            width: Number.isFinite(maxWidth) ? Math.min(intrinsicWidth, maxWidth) : intrinsicWidth,
            height: Number.isFinite(maxHeight) ? Math.min(intrinsicHeight, maxHeight) : intrinsicHeight,
        };
    }
    const containScale = Math.min(widthScale, heightScale);
    const coverScale = Math.max(widthScale, heightScale);
    const scale = image.fit === 'cover'
        ? coverScale
        : image.fit === 'scale-down'
          ? Math.min(1, containScale)
          : containScale;
    if (!Number.isFinite(scale) || scale <= 0) {
        return { width: intrinsicWidth, height: intrinsicHeight };
    }
    return {
        width: intrinsicWidth * scale,
        height: intrinsicHeight * scale,
    };
}

export function resolveImageCommand(
    index: number,
    box: LayoutBox,
    image: ResolvedWidgetImage,
    style: ResolvedWidgetStyle,
    clip: LayoutBox | null,
    zIndex: number
): ImageRenderCommand | null {
    // Sprite-backed controls draw their image as the control surface: the
    // border box, not the padded content box.
    const containerWidth = image.bleed ? box.width : box.contentWidth;
    const containerHeight = image.bleed ? box.height : box.contentHeight;
    if (containerWidth <= 0 || containerHeight <= 0) {
        return null;
    }
    const originX = image.bleed ? box.x : box.contentX;
    const originY = image.bleed ? box.y : box.contentY;
    const sliced =
        image.border.left > 0 ||
        image.border.top > 0 ||
        image.border.right > 0 ||
        image.border.bottom > 0;
    const intrinsicWidth = image.source.width;
    const intrinsicHeight = image.source.height;
    let renderWidth = containerWidth;
    let renderHeight = containerHeight;
    if (!sliced) {
        if (image.fit === 'none') {
            renderWidth = intrinsicWidth;
            renderHeight = intrinsicHeight;
        } else if (image.fit !== 'fill') {
            const containScale = Math.min(containerWidth / intrinsicWidth, containerHeight / intrinsicHeight);
            const coverScale = Math.max(containerWidth / intrinsicWidth, containerHeight / intrinsicHeight);
            const scale = image.fit === 'cover'
                ? coverScale
                : image.fit === 'scale-down'
                  ? Math.min(1, containScale)
                  : containScale;
            renderWidth = intrinsicWidth * scale;
            renderHeight = intrinsicHeight * scale;
        }
    }
    return {
        kind: 'image',
        widget: index as WidgetId,
        source: image.source,
        ...(image.material ? { material: image.material } : {}),
        x: originX + (containerWidth - renderWidth) * image.alignX,
        y: originY + (containerHeight - renderHeight) * image.alignY,
        width: renderWidth,
        height: renderHeight,
        zIndex,
        tint: image.tint,
        opacity: style.opacity,
        sampling: image.sampling,
        radius: style.radius,
        clip,
        uvRect: image.uvRect,
        ...(sliced ? { border: image.border, fillCenter: image.fillCenter } : {}),
    };
}

export function buildSelectionCommands(
    index: number,
    box: LayoutBox,
    text: ResolvedTextBlock,
    layout: TextLayoutResult,
    clip: LayoutBox | null,
    zIndex: number,
    opacity: number
): QuadRenderCommand[] {
    if (text.selectionStart === null || text.selectionEnd === null || text.selectionStart === text.selectionEnd) {
        return [];
    }
    const start = Math.min(text.selectionStart, text.selectionEnd);
    const end = Math.max(text.selectionStart, text.selectionEnd);
    const selected = layout.clusters.filter((cluster) => cluster.index >= start && cluster.index < end);
    const perLine = new Map<number, { x0: number; x1: number; y: number; height: number }>();
    for (const cluster of selected) {
        const current = perLine.get(cluster.line);
        const x0 = cluster.x;
        const x1 = cluster.x + cluster.width;
        if (!current) {
            perLine.set(cluster.line, { x0, x1, y: cluster.y, height: cluster.height });
            continue;
        }
        current.x0 = Math.min(current.x0, x0);
        current.x1 = Math.max(current.x1, x1);
    }
    return [...perLine.values()].map((line) => ({
        kind: 'quad' as const,
        widget: index as WidgetId,
        x: box.contentX + line.x0,
        y: box.contentY + line.y,
        width: Math.max(1, line.x1 - line.x0),
        height: line.height,
        zIndex,
        color: text.selectionColor,
        borderColor: TRANSPARENT,
        borderWidth: 0,
        radius: { topLeft: 2, topRight: 2, bottomRight: 2, bottomLeft: 2 },
        opacity,
        clip,
    }));
}

export function buildLineDecorationCommands(
    index: number,
    box: LayoutBox,
    text: ResolvedTextBlock,
    layout: TextLayoutResult,
    clip: LayoutBox | null,
    zIndex: number,
    opacity: number
): QuadRenderCommand[] {
    const commands: QuadRenderCommand[] = [];
    for (const line of layout.lines) {
        if (line.width <= 0) {
            continue;
        }
        if (text.underline && text.underlineColor.a > 0) {
            commands.push({
                kind: 'quad',
                widget: index as WidgetId,
                x: box.contentX + line.x,
                y: box.contentY + line.y + layout.baseline + text.underlineOffset,
                width: Math.max(1, line.width),
                height: text.underlineThickness,
                zIndex,
                color: text.underlineColor,
                borderColor: TRANSPARENT,
                borderWidth: 0,
                radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                opacity,
                clip,
            });
        }
        if (text.strikeThrough && text.strikeThroughColor.a > 0) {
            commands.push({
                kind: 'quad',
                widget: index as WidgetId,
                x: box.contentX + line.x,
                y: box.contentY + line.y + line.ascent * 0.55,
                width: Math.max(1, line.width),
                height: text.strikeThroughThickness,
                zIndex,
                color: text.strikeThroughColor,
                borderColor: TRANSPARENT,
                borderWidth: 0,
                radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                opacity,
                clip,
            });
        }
    }
    return commands;
}

export function buildCaretCommand(
    index: number,
    box: LayoutBox,
    text: ResolvedTextBlock,
    layout: TextLayoutResult,
    clip: LayoutBox | null,
    zIndex: number,
    opacity: number
): QuadRenderCommand | null {
    if (text.caretIndex === null || text.caretColor.a <= 0) {
        return null;
    }
    const exact = layout.carets.find((caret) => caret.index === text.caretIndex);
    const fallback = exact ?? layout.carets.filter((caret) => caret.index <= text.caretIndex!).at(-1) ?? layout.carets[0];
    if (!fallback) {
        return null;
    }
    const caretHeight = Math.max(1, fallback.height - text.caretInset * 2);
    return {
        kind: 'quad',
        widget: index as WidgetId,
        x: box.contentX + fallback.x - text.caretWidth * 0.5,
        y: box.contentY + fallback.y + text.caretInset,
        width: text.caretWidth,
        height: caretHeight,
        zIndex,
        color: text.caretColor,
        borderColor: TRANSPARENT,
        borderWidth: 0,
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        opacity,
        clip,
    };
}
