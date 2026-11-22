import type { GlyphAtlasEntry } from '@axrone/ui/types';
import { createSliceSpanTriple } from './nine-slice';

export const QUAD_FLOATS_PER_INSTANCE = 23;
export const IMAGE_FLOATS_PER_INSTANCE = 22;
export const TEXT_FLOATS_PER_INSTANCE = 26;

export interface InstanceAttributeLayout {
    readonly location: number;
    readonly size: number;
    readonly floatOffset: number;
}

export const QUAD_INSTANCE_ATTRIBUTES: readonly InstanceAttributeLayout[] = [
    { location: 1, size: 4, floatOffset: 0 },
    { location: 2, size: 4, floatOffset: 4 },
    { location: 3, size: 4, floatOffset: 8 },
    { location: 4, size: 4, floatOffset: 12 },
    { location: 5, size: 1, floatOffset: 16 },
    { location: 6, size: 3, floatOffset: 17 },
    { location: 7, size: 3, floatOffset: 20 },
];

export const IMAGE_INSTANCE_ATTRIBUTES: readonly InstanceAttributeLayout[] = [
    { location: 1, size: 4, floatOffset: 0 },
    { location: 2, size: 4, floatOffset: 4 },
    { location: 3, size: 4, floatOffset: 8 },
    { location: 4, size: 4, floatOffset: 12 },
    { location: 5, size: 3, floatOffset: 16 },
    { location: 6, size: 3, floatOffset: 19 },
];

export const TEXT_INSTANCE_ATTRIBUTES: readonly InstanceAttributeLayout[] = [
    { location: 1, size: 4, floatOffset: 0 },
    { location: 2, size: 4, floatOffset: 4 },
    { location: 3, size: 4, floatOffset: 8 },
    { location: 4, size: 4, floatOffset: 12 },
    { location: 5, size: 4, floatOffset: 16 },
    { location: 6, size: 3, floatOffset: 20 },
    { location: 7, size: 3, floatOffset: 23 },
];

export const IDENTITY_TRANSFORM = [1, 0, 0, 1, 0, 0] as const;

export const createGlyphPageKey = (entry: GlyphAtlasEntry): number =>
    (entry.faceId as number) * 65536 + (entry.page as number);

export const sliceColumnsScratch = createSliceSpanTriple();
export const sliceRowsScratch = createSliceSpanTriple();
