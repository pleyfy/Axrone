import { TerrainError, TerrainErrorCode } from '../errors';
import type { TerrainResolution } from '../types';
import { TerrainHeightmap } from './terrain-heightmap';

/**
 * Structural stand-in for DOM `ImageData` so the terrain package stays
 * DOM-independent. Callers (e.g. the editor) decode image assets and pass the
 * raw RGBA pixels here.
 */
export interface HeightmapImageSource {
    readonly data: ArrayLike<number>;
    readonly width: number;
    readonly height: number;
}

const RED_LUMINANCE = 0.2126;
const GREEN_LUMINANCE = 0.7152;
const BLUE_LUMINANCE = 0.0722;

/**
 * Decodes RGBA pixel data into a normalized heightmap by bilinear-resampling
 * the source luminance onto the requested grid resolution.
 */
export const decodeHeightmapFromImageData = (
    source: HeightmapImageSource,
    resolution: TerrainResolution
): TerrainHeightmap => {
    const { data, width, height } = source;

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
        throw new TerrainError(
            `Heightmap image must be at least 2x2 pixels, received ${width}x${height}.`,
            TerrainErrorCode.SOURCE_DECODE_FAILED,
            { width, height }
        );
    }

    if (data.length !== width * height * 4) {
        throw new TerrainError(
            `Heightmap pixel buffer length ${data.length} does not match ${width}x${height} RGBA layout.`,
            TerrainErrorCode.SOURCE_DECODE_FAILED,
            { width, height, actualLength: data.length }
        );
    }

    const luminanceAt = (x: number, z: number): number => {
        const pixelIndex = (z * width + x) * 4;
        const red = Number(data[pixelIndex]);
        const green = Number(data[pixelIndex + 1]);
        const blue = Number(data[pixelIndex + 2]);
        return (RED_LUMINANCE * red + GREEN_LUMINANCE * green + BLUE_LUMINANCE * blue) / 255;
    };

    const heights = new Float32Array(resolution * resolution);

    for (let gridZ = 0; gridZ < resolution; gridZ += 1) {
        const sourceZ = (gridZ / (resolution - 1)) * (height - 1);
        const z0 = Math.floor(sourceZ);
        const z1 = Math.min(z0 + 1, height - 1);
        const tz = sourceZ - z0;

        for (let gridX = 0; gridX < resolution; gridX += 1) {
            const sourceX = (gridX / (resolution - 1)) * (width - 1);
            const x0 = Math.floor(sourceX);
            const x1 = Math.min(x0 + 1, width - 1);
            const tx = sourceX - x0;

            const topLeft = luminanceAt(x0, z0);
            const topRight = luminanceAt(x1, z0);
            const bottomLeft = luminanceAt(x0, z1);
            const bottomRight = luminanceAt(x1, z1);

            const top = topLeft + (topRight - topLeft) * tx;
            const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
            heights[gridZ * resolution + gridX] = top + (bottom - top) * tz;
        }
    }

    return TerrainHeightmap.fromRawHeights(resolution, heights);
};
