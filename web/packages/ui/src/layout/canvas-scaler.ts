import { clamp } from '@axrone/numeric';
import type { IVec2Like } from '@axrone/numeric';
import type { UICanvasConfig } from '../types/ui-asset';

/** Tracks scale modes that have already produced a console.warn so each mode warns at most once. */
const warnedScaleModes = new Set<string>();

/**
 * Result of computing how a UI canvas maps from its reference resolution
 * to the actual viewport.
 */
export interface CanvasScaleResult {
    /** Horizontal scale factor (reference → viewport). */
    readonly scaleX: number;
    /** Vertical scale factor (reference → viewport). */
    readonly scaleY: number;
    /** Horizontal offset in viewport pixels (for centering / letterboxing). */
    readonly offsetX: number;
    /** Vertical offset in viewport pixels (for centering / letterboxing). */
    readonly offsetY: number;
    /** The effective rendered width in viewport pixels. */
    readonly effectiveWidth: number;
    /** The effective rendered height in viewport pixels. */
    readonly effectiveHeight: number;
}

/**
 * Computes how a UI canvas with the given configuration maps from its
 * reference resolution to the actual viewport dimensions.
 *
 * The result can be used to build an AffineTransform2D for render commands:
 *   transform = [scaleX, 0, 0, scaleY, offsetX, offsetY]
 *
 * So that a point (x, y) in reference space maps to:
 *   screenX = x * scaleX + offsetX
 *   screenY = y * scaleY + offsetY
 */
export function resolveCanvasScale(
    canvas: UICanvasConfig,
    actualWidth: number,
    actualHeight: number
): CanvasScaleResult {
    const refW = canvas.referenceWidth;
    const refH = canvas.referenceHeight;

    // Guard against degenerate inputs
    if (refW <= 0 || refH <= 0 || actualWidth <= 0 || actualHeight <= 0) {
        return {
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            effectiveWidth: Math.max(0, actualWidth),
            effectiveHeight: Math.max(0, actualHeight),
        };
    }

    const scaleW = actualWidth / refW;
    const scaleH = actualHeight / refH;

    switch (canvas.scaleMode) {
        case 'match-width': {
            const scale = scaleW;
            const effectiveH = refH * scale;
            return {
                scaleX: scale,
                scaleY: scale,
                offsetX: 0,
                offsetY: (actualHeight - effectiveH) / 2,
                effectiveWidth: actualWidth,
                effectiveHeight: effectiveH,
            };
        }

        case 'match-height': {
            const scale = scaleH;
            const effectiveW = refW * scale;
            return {
                scaleX: scale,
                scaleY: scale,
                offsetX: (actualWidth - effectiveW) / 2,
                offsetY: 0,
                effectiveWidth: effectiveW,
                effectiveHeight: actualHeight,
            };
        }

        case 'match-width-or-height': {
            const bias = clamp(canvas.matchBias, 0, 1);
            const scale = scaleW * (1 - bias) + scaleH * bias;
            const effectiveW = refW * scale;
            const effectiveH = refH * scale;
            return {
                scaleX: scale,
                scaleY: scale,
                offsetX: (actualWidth - effectiveW) / 2,
                offsetY: (actualHeight - effectiveH) / 2,
                effectiveWidth: effectiveW,
                effectiveHeight: effectiveH,
            };
        }

        case 'fill': {
            return {
                scaleX: scaleW,
                scaleY: scaleH,
                offsetX: 0,
                offsetY: 0,
                effectiveWidth: actualWidth,
                effectiveHeight: actualHeight,
            };
        }

        case 'fixed': {
            const effectiveW = refW;
            const effectiveH = refH;
            return {
                scaleX: 1,
                scaleY: 1,
                offsetX: (actualWidth - effectiveW) / 2,
                offsetY: (actualHeight - effectiveH) / 2,
                effectiveWidth: effectiveW,
                effectiveHeight: effectiveH,
            };
        }

        default: {
            const modeKey = String((canvas as unknown as Record<string, unknown>)['scaleMode']);
            if (!warnedScaleModes.has(modeKey)) {
                warnedScaleModes.add(modeKey);
                console.warn(
                    `[ui/canvas-scaler] Unknown scale mode "${modeKey}". Falling back to "fill".`
                );
            }
            // Fallback: treat unknown mode as fill
            return {
                scaleX: scaleW,
                scaleY: scaleH,
                offsetX: 0,
                offsetY: 0,
                effectiveWidth: actualWidth,
                effectiveHeight: actualHeight,
            };
        }
    }
}

/**
 * Builds an AffineTransform2D from a CanvasScaleResult.
 * The transform maps reference-space coordinates to viewport-space coordinates:
 *   screenX = x * scaleX + offsetX
 *   screenY = y * scaleY + offsetY
 *
 * AffineTransform2D format: [a, b, c, d, e, f]
 * where: x' = a*x + c*y + e, y' = b*x + d*y + f
 */
export function canvasScaleToTransform(result: CanvasScaleResult): readonly [number, number, number, number, number, number] {
    return [
        result.scaleX,  // a
        0,              // b
        0,              // c
        result.scaleY,  // d
        result.offsetX, // e
        result.offsetY, // f
    ];
}

const INVERSE_SCALE_EPSILON = 1e-9;

/**
 * Maps a point from viewport (screen) space back into reference canvas space.
 * This is the inverse of the render transform produced by `canvasScaleToTransform`
 * and is used to route pointer input into the reference-resolution layout:
 *   canvasX = (viewportX - offsetX) / scaleX
 *   canvasY = (viewportY - offsetY) / scaleY
 *
 * Points inside letterbox/pillarbox bands map outside the reference bounds,
 * so hit-testing naturally misses them.
 * Degenerate scales (<= epsilon) fall back to an identity mapping.
 */
export function mapViewportPointToCanvas(
    scale: CanvasScaleResult,
    viewportX: number,
    viewportY: number
): Readonly<IVec2Like> {
    const x = Math.abs(scale.scaleX) <= INVERSE_SCALE_EPSILON
        ? viewportX
        : (viewportX - scale.offsetX) / scale.scaleX;
    const y = Math.abs(scale.scaleY) <= INVERSE_SCALE_EPSILON
        ? viewportY
        : (viewportY - scale.offsetY) / scale.scaleY;
    return { x, y };
}
