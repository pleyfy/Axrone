import { DisposedUIError } from './errors';
import { FontRegistry, ensureDefaultUIFont } from './font';
import { LruCache, createCacheKey, createGraphemeSegments, detectDirection, isWhitespace } from './text/internals';
import type {
    FontFaceId,
    FontFaceInfo,
    ResolvedTextBlock,
    ResolvedTextDirection,
    TextBlockInput,
    TextCaretPlacement,
    TextClusterLayout,
    TextGlyphPlacement,
    TextLayoutConstraint,
    TextLayoutResult,
    TextLineLayout,
    TextSpanRenderStyle,
} from './types';

interface TextLayoutEngineOptions {
    readonly cacheSize?: number;
    readonly locale?: string;
}

interface MeasuredClusterGlyph {
    codePoint: number;
    advance: number;
    width: number;
    height: number;
    atlasEntry: ReturnType<FontRegistry['ensureGlyph']>;
}

interface MeasuredCluster {
    index: number;
    text: string;
    glyphs: MeasuredClusterGlyph[];
    width: number;
    whitespace: boolean;
    newline: boolean;
    breakOpportunity: boolean;
    spanIndex: number;
}

interface ClusterLine {
    start: number;
    end: number;
    width: number;
    gapCount: number;
}

export class TextLayoutEngine implements Disposable {
    private readonly fonts: FontRegistry;
    private readonly cache: LruCache<string, TextLayoutResult>;
    private readonly defaultLocale: string;
    private disposed = false;

    constructor(fonts: FontRegistry, options: TextLayoutEngineOptions = {}) {
        this.fonts = fonts;
        this.cache = new LruCache<string, TextLayoutResult>(options.cacheSize ?? 512);
        this.defaultLocale = options.locale ?? 'en';
    }

    measure(block: ResolvedTextBlock, constraints: TextLayoutConstraint = {}): TextLayoutResult {
        this.ensureActive();
        const maxWidth = constraints.width === undefined ? Number.POSITIVE_INFINITY : Math.max(0, constraints.width);
        const maxHeight = constraints.height === undefined ? Number.POSITIVE_INFINITY : Math.max(0, constraints.height);
        let faceId = this.fonts.resolveFace({
            family: block.family,
            weight: block.weight as TextBlockInput['weight'],
            style: block.style,
            locale: block.locale,
        });
        if (faceId === null && block.family.trim().length > 0) {
            ensureDefaultUIFont(this.fonts, block.family);
            faceId = this.fonts.resolveFace({
                family: block.family,
                weight: block.weight as TextBlockInput['weight'],
                style: block.style,
                locale: block.locale,
            });
        }
        const cacheKey = createCacheKey(block, faceId, maxWidth, maxHeight);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const faceInfo = this.fonts.getFaceInfo(faceId);
        const metrics = this.layoutText(block, faceId, faceInfo, maxWidth);
        this.cache.set(cacheKey, metrics);
        return metrics;
    }

    clear(): void {
        this.cache.clear();
    }

    dispose(): void {
        if (!this.disposed) {
            this.clear();
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('TextLayoutEngine');
        }
    }

    private layoutText(
        block: ResolvedTextBlock,
        faceId: FontFaceId | null,
        faceInfo: FontFaceInfo | null,
        maxWidth: number
    ): TextLayoutResult {
        const locale = block.locale || this.defaultLocale;
        const direction = detectDirection(block.value, block.direction);
        const scale = faceInfo ? block.size / faceInfo.unitsPerEm : 1;
        const ascent = faceInfo ? faceInfo.ascent * scale : block.size * 0.8;
        const descent = faceInfo ? faceInfo.descent * scale : block.size * 0.2;
        const computedLineHeight = block.lineHeight > 0
            ? block.lineHeight
            : faceInfo
              ? (faceInfo.ascent + faceInfo.descent + faceInfo.lineGap) * scale
              : block.size * 1.2;
        const clusters = this.measureClusters(block, faceId, locale);
        const lines: ClusterLine[] = [];
        let cursor = 0;
        let truncated = false;
        while (cursor < clusters.length) {
            const line = this.measureLine(clusters, cursor, maxWidth, block.wrap);
            lines.push(line);
            const lineStart = line.start;
            cursor = line.end;
            if (cursor < clusters.length && clusters[cursor]?.newline) {
                cursor += 1;
            }
            // Guarantee forward progress: when measureLine strips trailing
            // whitespace and returns end === start (e.g. text "Hello "), the
            // outer loop would otherwise spin forever pushing empty lines.
            if (cursor === lineStart && cursor < clusters.length && !clusters[cursor].newline) {
                cursor += 1;
            }
            if (lines.length >= block.maxLines && cursor < clusters.length) {
                truncated = true;
                break;
            }
        }
        if (lines.length === 0) {
            lines.push({ start: 0, end: 0, width: 0, gapCount: 0 });
        }
        if (truncated && block.overflow === 'ellipsis') {
            this.applyEllipsis(lines[lines.length - 1], clusters, faceId, block, maxWidth);
        }
        const lineLayouts: TextLineLayout[] = [];
        const clusterLayouts: TextClusterLayout[] = [];
        const caretMap = new Map<number, TextCaretPlacement>();
        const glyphs: TextGlyphPlacement[] = [];
        let layoutWidth = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            layoutWidth = Math.max(layoutWidth, lines[lineIndex].width);
        }
        const targetWidth = Number.isFinite(maxWidth) ? maxWidth : layoutWidth;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            const y = lineIndex * computedLineHeight;
            // Baseline sits ascent below the line top, vertically centering the
            // font box when the line height exceeds ascent + descent.
            const baselineY = y + ascent + Math.max(0, computedLineHeight - (ascent + descent)) / 2;
            const isLastLine = lineIndex === lines.length - 1;
            const justify = block.align === 'justify' && Number.isFinite(maxWidth) && !isLastLine && line.gapCount > 0;
            const x = this.resolveLineOffset(block.align, direction, targetWidth, line.width);
            const extraGap = justify ? Math.max(0, targetWidth - line.width) / line.gapCount : 0;
            let cursorX = 0;
            let gapCursor = 0;
            for (let clusterIndex = line.start; clusterIndex < line.end; clusterIndex += 1) {
                const cluster = clusters[clusterIndex];
                const rawClusterStart = x + cursorX + gapCursor;
                const clusterGap = justify && cluster.whitespace ? extraGap : 0;
                const clusterWidth = cluster.width + clusterGap;
                for (const glyph of cluster.glyphs) {
                    // Position the atlas bitmap so its pen origin lands on the
                    // pen position: left edge = penX - originX, top edge =
                    // baseline - originY. The quad must use the bitmap's own
                    // dimensions or the sprite gets squeezed into the ink box.
                    const entry = glyph.atlasEntry;
                    const penX = x + cursorX + gapCursor;
                    glyphs.push({
                        codePoint: glyph.codePoint,
                        clusterIndex,
                        x: entry ? penX - entry.originX : penX,
                        y: entry ? baselineY - entry.originY : y,
                        advance: glyph.advance,
                        width: entry ? entry.width : glyph.width,
                        height: entry ? entry.height : glyph.height,
                        line: lineIndex,
                        text: cluster.text,
                        atlasEntry: glyph.atlasEntry,
                        spanIndex: cluster.spanIndex,
                    });
                    cursorX += glyph.advance;
                }
                if (justify && cluster.whitespace) {
                    gapCursor += extraGap;
                }
                const resolvedClusterStart =
                    direction === 'rtl'
                        ? x + line.width - (rawClusterStart - x + clusterWidth)
                        : rawClusterStart;
                clusterLayouts.push({
                    index: cluster.index,
                    line: lineIndex,
                    x: resolvedClusterStart,
                    y,
                    width: clusterWidth,
                    height: computedLineHeight,
                    text: cluster.text,
                    whitespace: cluster.whitespace,
                    newline: cluster.newline,
                    spanIndex: cluster.spanIndex,
                });
                if (!caretMap.has(cluster.index)) {
                    caretMap.set(cluster.index, {
                        index: cluster.index,
                        line: lineIndex,
                        x: resolvedClusterStart,
                        y,
                        height: computedLineHeight,
                    });
                }
                caretMap.set(cluster.index + 1, {
                    index: cluster.index + 1,
                    line: lineIndex,
                    x: resolvedClusterStart + clusterWidth,
                    y,
                    height: computedLineHeight,
                });
            }
            if (direction === 'rtl') {
                for (let index = glyphs.length - 1; index >= 0 && glyphs[index].line === lineIndex; index -= 1) {
                    glyphs[index].x = x + line.width - (glyphs[index].x - x + glyphs[index].advance);
                }
            }
            lineLayouts.push({
                index: lineIndex,
                start: line.start,
                end: line.end,
                x,
                y,
                width: line.width,
                height: computedLineHeight,
                ascent,
                descent,
                gapCount: line.gapCount,
            });
            if (!caretMap.has(line.start)) {
                caretMap.set(line.start, {
                    index: line.start,
                    line: lineIndex,
                    x,
                    y,
                    height: computedLineHeight,
                });
            }
            if (!caretMap.has(line.end)) {
                caretMap.set(line.end, {
                    index: line.end,
                    line: lineIndex,
                    x: x + line.width,
                    y,
                    height: computedLineHeight,
                });
            }
        }
        return {
            faceId,
            width: Number.isFinite(maxWidth) ? Math.min(targetWidth, Math.max(layoutWidth, 0)) : layoutWidth,
            height: lineLayouts.length * computedLineHeight,
            lineHeight: computedLineHeight,
            baseline: ascent,
            lines: lineLayouts,
            clusters: clusterLayouts,
            carets: [...caretMap.values()].sort((left, right) => left.index - right.index || left.line - right.line),
            glyphs,
            truncated,
            direction,
            text: block.value,
            spanStyles: buildSpanStyles(block),
        };
    }

    private measureClusters(block: ResolvedTextBlock, faceId: FontFaceId | null, locale: string): MeasuredCluster[] {
        const segments = createGraphemeSegments(block.value, locale);
        // Reuse module-scoped scratch buffers for the measurement loop to
        // avoid per-call allocations on the layout hot path.
        scratchClusters.length = 0;
        const spanMap = block.spans.length > 0 ? buildSpanOffsetMap(block) : null;
        let charOffset = 0;
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const newline = segment === '\n';
            const whitespace = isWhitespace(segment);
            const codePoints = Array.from(segment).map((char) => char.codePointAt(0) ?? 32);
            scratchGlyphs.length = 0;
            let width = 0;
            const spanIndex = spanMap !== null ? resolveSpanIndexAtOffset(spanMap, charOffset) : 0;
            for (let glyphIndex = 0; glyphIndex < codePoints.length; glyphIndex += 1) {
                const codePoint = codePoints[glyphIndex];
                const nextCodePoint = glyphIndex < codePoints.length - 1 ? codePoints[glyphIndex + 1] : undefined;
                const measurement = this.fonts.measureGlyph(faceId, codePoint, block.size, nextCodePoint);
                const advance = measurement.advance + (glyphIndex < codePoints.length - 1 ? block.letterSpacing : 0);
                scratchGlyphs.push({
                    codePoint,
                    advance,
                    width: measurement.width,
                    height: measurement.height,
                    atlasEntry: measurement.atlasEntry,
                });
                width += advance;
            }
            // Reuse or create the scratch cluster object at this index.
            let cluster = scratchClusters[index];
            if (!cluster) {
                cluster = { index: 0, text: '', glyphs: [], width: 0, whitespace: false, newline: false, breakOpportunity: false, spanIndex: 0 };
                scratchClusters[index] = cluster;
            }
            cluster.index = index;
            cluster.text = segment;
            cluster.glyphs.length = 0;
            for (let g = 0; g < scratchGlyphs.length; g += 1) {
                cluster.glyphs.push(scratchGlyphs[g]);
            }
            cluster.width = width;
            cluster.whitespace = whitespace;
            cluster.newline = newline;
            cluster.breakOpportunity = block.wrap === 'grapheme' || whitespace || segment === '-' || segment === '/';
            cluster.spanIndex = spanIndex;
            charOffset += segment.length;
        }
        scratchClusters.length = segments.length;
        // Copy out: callers (layoutText) retain results in the layout cache,
        // so the scratch buffers must not alias the returned data.
        const out: MeasuredCluster[] = new Array(segments.length);
        for (let i = 0; i < segments.length; i += 1) {
            const src = scratchClusters[i];
            out[i] = {
                index: src.index,
                text: src.text,
                glyphs: src.glyphs.slice(),
                width: src.width,
                whitespace: src.whitespace,
                newline: src.newline,
                breakOpportunity: src.breakOpportunity,
                spanIndex: src.spanIndex,
            };
        }
        return out;
    }

    private measureLine(
        clusters: readonly MeasuredCluster[],
        startIndex: number,
        maxWidth: number,
        wrap: ResolvedTextBlock['wrap']
    ): ClusterLine {
        let width = 0;
        let end = startIndex;
        let lastBreak = -1;
        let widthAtLastBreak = 0;
        let gapCount = 0;
        while (end < clusters.length) {
            const cluster = clusters[end];
            if (cluster.newline) {
                break;
            }
            const nextWidth = width + cluster.width;
            const overflow = Number.isFinite(maxWidth) && wrap !== 'none' && width > 0 && nextWidth > maxWidth;
            if (overflow) {
                if (wrap === 'word' && lastBreak >= startIndex) {
                    end = lastBreak + 1;
                    width = widthAtLastBreak;
                    gapCount = this.countGaps(clusters, startIndex, end);
                }
                break;
            }
            width = nextWidth;
            if (cluster.breakOpportunity) {
                lastBreak = end;
                widthAtLastBreak = width;
            }
            end += 1;
        }
        if (end === startIndex && end < clusters.length && !clusters[end].newline) {
            width = clusters[end].width;
            end += 1;
        }
        while (end > startIndex && clusters[end - 1].whitespace) {
            width -= clusters[end - 1].width;
            end -= 1;
        }
        return {
            start: startIndex,
            end,
            width: Math.max(0, width),
            gapCount: this.countGaps(clusters, startIndex, end),
        };
    }

    private applyEllipsis(
        line: ClusterLine,
        clusters: readonly MeasuredCluster[],
        faceId: FontFaceId | null,
        block: ResolvedTextBlock,
        maxWidth: number
    ): void {
        if (!Number.isFinite(maxWidth)) {
            return;
        }
        const ellipsisClusters = this.measureClusters({ ...block, value: '…' }, faceId, block.locale);
        const ellipsisWidth = ellipsisClusters[0]?.width ?? 0;
        while (line.end > line.start && line.width + ellipsisWidth > maxWidth) {
            line.end -= 1;
            line.width -= clusters[line.end].width;
        }
        line.width += ellipsisWidth;
    }

    private countGaps(clusters: readonly MeasuredCluster[], start: number, end: number): number {
        let count = 0;
        for (let index = start; index < end; index += 1) {
            if (clusters[index].whitespace) {
                count += 1;
            }
        }
        return count;
    }

    private resolveLineOffset(
        align: ResolvedTextBlock['align'],
        direction: ResolvedTextDirection,
        targetWidth: number,
        lineWidth: number
    ): number {
        const startOffset = direction === 'rtl' ? Math.max(0, targetWidth - lineWidth) : 0;
        const endOffset = direction === 'rtl' ? 0 : Math.max(0, targetWidth - lineWidth);
        switch (align) {
            case 'center':
                return Math.max(0, (targetWidth - lineWidth) / 2);
            case 'end':
                return endOffset;
            case 'justify':
            case 'start':
            default:
                return startOffset;
        }
    }
}

export type { TextLayoutEngineOptions, TextLayoutConstraint, TextLayoutResult, TextLineLayout, TextGlyphPlacement, TextBlockInput };

/**
 * Builds an array where entry[i] is the span index that owns the character at
 * offset i in the block's value. The block value is the concatenation of span
 * texts when spans are present.
 */
const buildSpanOffsetMap = (block: ResolvedTextBlock): readonly number[] => {
    const map: number[] = [];
    for (let spanIndex = 0; spanIndex < block.spans.length; spanIndex += 1) {
        const spanText = block.spans[spanIndex].text;
        for (let charIndex = 0; charIndex < spanText.length; charIndex += 1) {
            map.push(spanIndex);
        }
    }
    return map;
};

/**
 * Returns the span index for a given character offset, clamped to the last span
 * when the offset exceeds the map length (e.g. for a trailing grapheme that
 * straddles a span boundary).
 */
const resolveSpanIndexAtOffset = (spanMap: readonly number[], offset: number): number => {
    if (offset < spanMap.length) {
        return spanMap[offset];
    }
    return spanMap.length > 0 ? spanMap[spanMap.length - 1] : 0;
};

/**
 * Derives the per-span render styles from the resolved block spans. Returns an
 * empty array when no spans are present, so the renderer can fall back to the
 * command-level color.
 */
const buildSpanStyles = (block: ResolvedTextBlock): readonly TextSpanRenderStyle[] => {
    if (block.spans.length === 0) {
        return EMPTY_SPAN_STYLES;
    }
    const styles: TextSpanRenderStyle[] = [];
    for (const span of block.spans) {
        styles.push({
            color: span.color,
            outlineColor: span.outlineColor,
            outlineWidth: span.outlineWidth,
        });
    }
    return styles;
};

const EMPTY_SPAN_STYLES: readonly TextSpanRenderStyle[] = Object.freeze([]);

// Module-scoped scratch buffers reused across measureClusters calls.
// Each call resets the objects in-place; results are consumed synchronously
// within layoutText and never retained beyond the measure() call.
const scratchClusters: MeasuredCluster[] = [];
const scratchGlyphs: MeasuredClusterGlyph[] = [];