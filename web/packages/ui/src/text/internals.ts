import type { FontFaceId, ResolvedTextBlock, ResolvedTextDirection } from '../types';

export class LruCache<TKey, TValue> {
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

export const createGraphemeSegments = (value: string, locale: string): string[] => {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
        const segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'grapheme' });
        return [...segmenter.segment(value)].map((segment) => segment.segment);
    }
    return Array.from(value);
};

export const detectDirection = (value: string, requested: ResolvedTextBlock['direction']): ResolvedTextDirection => {
    if (requested === 'ltr' || requested === 'rtl') {
        return requested;
    }
    return /[\u0590-\u08FF]/u.test(value) ? 'rtl' : 'ltr';
};

export const isWhitespace = (value: string): boolean => /^\s+$/u.test(value) && value !== '\n';

export const createCacheKey = (
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