import { DisposedUIError } from './errors';
import { FontRegistry } from './font';
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
} from './types';

interface TextLayoutEngineOptions {
    readonly cacheSize?: number;
    readonly locale?: string;
}

interface MeasuredClusterGlyph {
    readonly codePoint: number;
    readonly advance: number;
    readonly width: number;
    readonly height: number;
    readonly atlasEntry: ReturnType<FontRegistry['ensureGlyph']>;
}

interface MeasuredCluster {
    readonly index: number;
    readonly text: string;
    readonly glyphs: readonly MeasuredClusterGlyph[];
    readonly width: number;
    readonly whitespace: boolean;
    readonly newline: boolean;
    readonly breakOpportunity: boolean;
}

interface ClusterLine {
    start: number;
    end: number;
    width: number;
    gapCount: number;
}

class LruCache<TKey, TValue> {
    private readonly limit: number;
    private readonly entries = new Map<TKey, TValue>();

    constructor(limit: number) {
        this.limit = Math.max(1, limit);
    }

    get(key: TKey): TValue | undefined {
        const value = this.entries.get(key);
        if (value === undefined) {
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    set(key: TKey, value: TValue): void {
        if (this.entries.has(key)) {
            this.entries.delete(key);
        }
        this.entries.set(key, value);
        if (this.entries.size > this.limit) {
            const firstKey = this.entries.keys().next().value as TKey;
            this.entries.delete(firstKey);
        }
    }

    clear(): void {
        this.entries.clear();
    }
}

const createGraphemeSegments = (value: string, locale: string): string[] => {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
        const segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'grapheme' });
        return [...segmenter.segment(value)].map((segment) => segment.segment);
    }
    return Array.from(value);
};

const detectDirection = (value: string, requested: ResolvedTextBlock['direction']): ResolvedTextDirection => {
    if (requested === 'ltr' || requested === 'rtl') {
        return requested;
    }
    return /[\u0590-\u08FF]/u.test(value) ? 'rtl' : 'ltr';
};

const isWhitespace = (value: string): boolean => /^\s+$/u.test(value) && value !== '\n';

const createCacheKey = (
    block: ResolvedTextBlock,
    faceId: FontFaceId | null,
    width: number,
    height: number
): string =>
    [
        faceId ?? 'none',
        block.family,
        block.size,
        block.weight,
        block.style,
        block.locale,
        block.direction,
        block.letterSpacing,
        block.lineHeight,
        block.wrap,
        block.overflow,
        block.maxLines,
        block.align,
        width,
        height,
        block.value,
    ].join('|');

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
        const faceId = this.fonts.resolveFace({
            family: block.family,
            weight: block.weight as TextBlockInput['weight'],
            style: block.style,
            locale: block.locale,
        });
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
            cursor = line.end;
            if (cursor < clusters.length && clusters[cursor]?.newline) {
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
                    glyphs.push({
                        codePoint: glyph.codePoint,
                        clusterIndex,
                        x: x + cursorX + gapCursor,
                        y,
                        advance: glyph.advance,
                        width: glyph.width,
                        height: glyph.height,
                        line: lineIndex,
                        text: cluster.text,
                        atlasEntry: glyph.atlasEntry,
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
                    const glyph = glyphs[index];
                    glyphs[index] = {
                        ...glyph,
                        x: x + line.width - (glyph.x - x + glyph.advance),
                    };
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
        };
    }

    private measureClusters(block: ResolvedTextBlock, faceId: FontFaceId | null, locale: string): MeasuredCluster[] {
        const segments = createGraphemeSegments(block.value, locale);
        const result: MeasuredCluster[] = [];
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const newline = segment === '\n';
            const whitespace = isWhitespace(segment);
            const codePoints = Array.from(segment).map((char) => char.codePointAt(0) ?? 32);
            const glyphs: MeasuredClusterGlyph[] = [];
            let width = 0;
            for (let glyphIndex = 0; glyphIndex < codePoints.length; glyphIndex += 1) {
                const codePoint = codePoints[glyphIndex];
                const nextCodePoint = glyphIndex < codePoints.length - 1 ? codePoints[glyphIndex + 1] : undefined;
                const measurement = this.fonts.measureGlyph(faceId, codePoint, block.size, nextCodePoint);
                const advance = measurement.advance + (glyphIndex < codePoints.length - 1 ? block.letterSpacing : 0);
                glyphs.push({
                    codePoint,
                    advance,
                    width: measurement.width,
                    height: measurement.height,
                    atlasEntry: measurement.atlasEntry,
                });
                width += advance;
            }
            result.push({
                index,
                text: segment,
                glyphs,
                width,
                whitespace,
                newline,
                breakOpportunity: block.wrap === 'grapheme' || whitespace || segment === '-' || segment === '/',
            });
        }
        return result;
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