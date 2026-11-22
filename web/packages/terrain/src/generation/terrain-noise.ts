import { createRandom } from '@axrone/random';
import type { ResolvedTerrainNoiseOptions, TerrainDescriptor, TerrainNoiseOptions } from '../types';
import { resolveTerrainNoiseOptions, validateTerrainDescriptor } from '../types';
import { TerrainHeightmap } from '../heightmap/terrain-heightmap';
import { smoothstep } from '../internal/math';

const LATTICE_SIZE = 256;
const LATTICE_MASK = LATTICE_SIZE - 1;

interface ValueNoiseLattice {
    readonly permutation: Uint8Array;
    readonly values: Float32Array;
}

/** Builds a deterministic value lattice from the seeded engine PRNG. */
const createValueNoiseLattice = (seed: number): ValueNoiseLattice => {
    const random = createRandom(seed);
    const permutation = new Uint8Array(LATTICE_SIZE * 2);
    const values = new Float32Array(LATTICE_SIZE);

    const identity = new Uint8Array(LATTICE_SIZE);
    for (let index = 0; index < LATTICE_SIZE; index += 1) {
        identity[index] = index;
    }

    for (let index = LATTICE_SIZE - 1; index > 0; index -= 1) {
        const swapIndex = random.int(0, index);
        const held = identity[index]!;
        identity[index] = identity[swapIndex]!;
        identity[swapIndex] = held;
    }

    for (let index = 0; index < LATTICE_SIZE; index += 1) {
        permutation[index] = identity[index]!;
        permutation[index + LATTICE_SIZE] = identity[index]!;
        values[index] = random.float();
    }

    return { permutation, values };
};

const latticeValueAt = (lattice: ValueNoiseLattice, x: number, z: number): number => {
    const hashed = lattice.permutation[lattice.permutation[x & LATTICE_MASK]! + (z & LATTICE_MASK)]!;
    return lattice.values[hashed]!;
};

const sampleValueNoise = (lattice: ValueNoiseLattice, x: number, z: number): number => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = smoothstep(x - x0);
    const tz = smoothstep(z - z0);

    const topLeft = latticeValueAt(lattice, x0, z0);
    const topRight = latticeValueAt(lattice, x0 + 1, z0);
    const bottomLeft = latticeValueAt(lattice, x0, z0 + 1);
    const bottomRight = latticeValueAt(lattice, x0 + 1, z0 + 1);

    const top = topLeft + (topRight - topLeft) * tx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
    return top + (bottom - top) * tz;
};

/**
 * Generates a normalized fractional-Brownian-motion heightmap. Identical
 * descriptor + options always yield the identical heightmap (deterministic
 * seeded engine PRNG).
 */
export const generateNoiseHeightmap = (
    descriptor: TerrainDescriptor,
    noiseOptions: TerrainNoiseOptions = {}
): TerrainHeightmap => {
    validateTerrainDescriptor(descriptor);
    const options: ResolvedTerrainNoiseOptions = resolveTerrainNoiseOptions(noiseOptions);
    const lattice = createValueNoiseLattice(options.seed);

    const { resolution, width, length } = descriptor;
    const heights = new Float32Array(resolution * resolution);

    let amplitudeSum = 0;
    let amplitude = 1;
    for (let octave = 0; octave < options.octaves; octave += 1) {
        amplitudeSum += amplitude;
        amplitude *= options.persistence;
    }

    for (let gridZ = 0; gridZ < resolution; gridZ += 1) {
        const worldZ = (gridZ / (resolution - 1)) * length + options.offsetZ;

        for (let gridX = 0; gridX < resolution; gridX += 1) {
            const worldX = (gridX / (resolution - 1)) * width + options.offsetX;

            let total = 0;
            let octaveAmplitude = 1;
            let octaveFrequency = options.frequency;

            for (let octave = 0; octave < options.octaves; octave += 1) {
                total +=
                    sampleValueNoise(lattice, worldX * octaveFrequency, worldZ * octaveFrequency) *
                    octaveAmplitude;
                octaveAmplitude *= options.persistence;
                octaveFrequency *= options.lacunarity;
            }

            heights[gridZ * resolution + gridX] = total / amplitudeSum;
        }
    }

    return TerrainHeightmap.fromRawHeights(resolution, heights);
};
