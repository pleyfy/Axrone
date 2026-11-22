import { clamp, Color } from '@axrone/numeric';

export const hexToRgb = (hex: string): [number, number, number] => {
    try {
        const c = Color.fromHex(hex);
        return [c.r, c.g, c.b];
    } catch {
        return [1, 1, 1];
    }
};

export const rgbToHex = (rgb: readonly [number, number, number]): string => {
    const to = (channel: number) =>
        Math.round(clamp(channel, 0, 1) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`.toUpperCase();
};

export const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
        (2 * p1 - 2 * p2 + v0 + v1) * t3 +
        (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 +
        v0 * t +
        p1
    );
};

export const evaluateCurve = (points: readonly number[], t: number): number => {
    if (points.length === 0) {
        return 1;
    }
    if (points.length === 1) {
        return points[0] ?? 1;
    }
    const clamped = clamp(t, 0, 1);
    const segments = points.length - 1;
    const scaled = clamped * segments;
    const index = Math.min(segments - 1, Math.floor(scaled));
    const local = scaled - index;
    const p0 = points[Math.max(0, index - 1)] ?? 0;
    const p1 = points[index] ?? 0;
    const p2 = points[index + 1] ?? 0;
    const p3 = points[Math.min(points.length - 1, index + 2)] ?? 0;
    return Math.max(0, catmullRom(p0, p1, p2, p3, local));
};
