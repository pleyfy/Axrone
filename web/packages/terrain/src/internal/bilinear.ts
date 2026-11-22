/**
 * Generic bilinear sampler for typed arrays.
 * @internal
 */

/**
 * Bilinear sample from a single-channel typed array at normalized [0, 1] coordinates.
 * Returns the interpolated value (not normalized — caller divides by scale if needed).
 */
export const bilinearSample = (
    data: ArrayLike<number>,
    resolution: number,
    u: number,
    v: number
): number => {
    const clampedU = u < 0 ? 0 : u > 1 ? 1 : u;
    const clampedV = v < 0 ? 0 : v > 1 ? 1 : v;
    const gridX = clampedU * (resolution - 1);
    const gridZ = clampedV * (resolution - 1);
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;

    const topLeft = data[z0 * resolution + x0]!;
    const topRight = data[z0 * resolution + x1]!;
    const bottomLeft = data[z1 * resolution + x0]!;
    const bottomRight = data[z1 * resolution + x1]!;

    const top = topLeft + (topRight - topLeft) * tx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
    return top + (bottom - top) * tz;
};

/**
 * Bilinear sample from a 4-channel (RGBA) typed array at normalized [0, 1] coordinates.
 * Returns interpolated values for all 4 channels.
 */
export const bilinearSample4 = (
    data: ArrayLike<number>,
    resolution: number,
    u: number,
    v: number
): [number, number, number, number] => {
    const clampedU = u < 0 ? 0 : u > 1 ? 1 : u;
    const clampedV = v < 0 ? 0 : v > 1 ? 1 : v;
    const texelX = clampedU * (resolution - 1);
    const texelZ = clampedV * (resolution - 1);
    const x0 = Math.floor(texelX);
    const z0 = Math.floor(texelZ);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const tx = texelX - x0;
    const tz = texelZ - z0;

    const weights: [number, number, number, number] = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = data[(z0 * resolution + x0) * 4 + channel]!;
        const topRight = data[(z0 * resolution + x1) * 4 + channel]!;
        const bottomLeft = data[(z1 * resolution + x0) * 4 + channel]!;
        const bottomRight = data[(z1 * resolution + x1) * 4 + channel]!;
        const top = topLeft + (topRight - topLeft) * tx;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
        weights[channel] = top + (bottom - top) * tz;
    }

    return weights;
};
