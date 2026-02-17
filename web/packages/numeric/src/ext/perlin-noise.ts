import { rand, Random } from '@axrone/core';
import { IVec2Like, Vec2 } from '../vec2';
import { IVec3Like, Vec3 } from '../vec3';

export type NoiseFunction1D = (x: number) => number;
export type NoiseFunction2D = (x: number, y: number) => number;
export type NoiseFunction3D = (x: number, y: number, z: number) => number;

export interface NoiseConfig {
    readonly seed?: number;
    readonly octaves?: number;
    readonly amplitude?: number;
    readonly frequency?: number;
    readonly persistence?: number;
    readonly lacunarity?: number;
}

export interface NoiseGenerator {
    noise1D: NoiseFunction1D;
    noise2D: NoiseFunction2D;
    noise3D: NoiseFunction3D;
    fbm1D: NoiseFunction1D;
    fbm2D: NoiseFunction2D;
    fbm3D: NoiseFunction3D;
}

export class NoiseError extends Error {
    constructor(
        message: string,
        public readonly code: string
    ) {
        super(message);
        this.name = 'NoiseError';
    }
}

export class InvalidSeedError extends NoiseError {
    constructor(seed: number) {
        super(`Invalid seed: ${seed}. Must be a finite number.`, 'INVALID_SEED');
    }
}

export class InvalidOctavesError extends NoiseError {
    constructor(octaves: number) {
        super(`Invalid octaves: ${octaves}. Must be a positive integer.`, 'INVALID_OCTAVES');
    }
}

type PermutationTable = readonly number[];
type GradientTable1D = readonly number[];
type GradientTable2D = readonly IVec2Like[];
type GradientTable3D = readonly IVec3Like[];

const DEFAULT_PERMUTATION: PermutationTable = Object.freeze([
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
    142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
    203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
    220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76,
    132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186,
    3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59,
    227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70,
    221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178,
    185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81,
    51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115,
    121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195,
    78, 66, 215, 61, 156, 180,
] as const);

const GRADIENT_1D: GradientTable1D = Object.freeze([1, -1] as const);

const GRADIENT_2D: GradientTable2D = Object.freeze([
    new Vec2(1, 1),
    new Vec2(-1, 1),
    new Vec2(1, -1),
    new Vec2(-1, -1),
    new Vec2(1, 0),
    new Vec2(-1, 0),
    new Vec2(0, 1),
    new Vec2(0, -1),
]);

const GRADIENT_3D: GradientTable3D = Object.freeze([
    new Vec3(1, 1, 0),
    new Vec3(-1, 1, 0),
    new Vec3(1, -1, 0),
    new Vec3(-1, -1, 0),
    new Vec3(1, 0, 1),
    new Vec3(-1, 0, 1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, -1),
    new Vec3(0, 1, 1),
    new Vec3(0, -1, 1),
    new Vec3(0, 1, -1),
    new Vec3(0, -1, -1),
]);

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);
const fastFloor = (x: number): number => (x > 0 ? Math.floor(x) : Math.floor(x) - 1);

class PermutationGenerator {
    private readonly permutation: PermutationTable;
    private readonly doublePermutation: PermutationTable;

    constructor(seed?: number) {
        if (seed !== undefined) {
            if (!Number.isFinite(seed)) {
                throw new InvalidSeedError(seed);
            }
            const random = new Random(seed);
            this.permutation = random.shuffle(DEFAULT_PERMUTATION);
        } else {
            this.permutation = DEFAULT_PERMUTATION;
        }
        this.doublePermutation = Object.freeze([...this.permutation, ...this.permutation]);
    }

    at(index: number): number {
        return this.doublePermutation[index & 511];
    }

    getTable(): PermutationTable {
        return this.permutation;
    }
}

class GradientCalculator {
    private static dot1D(gradient: number, x: number): number {
        return gradient * x;
    }

    private static dot2D(gradient: IVec2Like, x: number, y: number): number {
        return gradient.x * x + gradient.y * y;
    }

    private static dot3D(gradient: IVec3Like, x: number, y: number, z: number): number {
        return gradient.x * x + gradient.y * y + gradient.z * z;
    }

    static gradient1D(hash: number, x: number): number {
        return this.dot1D(GRADIENT_1D[hash & 1], x);
    }

    static gradient2D(hash: number, x: number, y: number): number {
        return this.dot2D(GRADIENT_2D[hash & 7], x, y);
    }

    static gradient3D(hash: number, x: number, y: number, z: number): number {
        return this.dot3D(GRADIENT_3D[hash & 11], x, y, z);
    }
}

class NoiseCore {
    private readonly permutation: PermutationGenerator;

    constructor(seed?: number) {
        this.permutation = new PermutationGenerator(seed);
    }

    noise1D(x: number): number {
        const X = fastFloor(x) & 255;
        x -= fastFloor(x);
        const u = fade(x);

        const a = this.permutation.at(X);
        const b = this.permutation.at(X + 1);

        return lerp(
            GradientCalculator.gradient1D(a, x),
            GradientCalculator.gradient1D(b, x - 1),
            u
        );
    }

    noise2D(x: number, y: number): number {
        const X = fastFloor(x) & 255;
        const Y = fastFloor(y) & 255;
        x -= fastFloor(x);
        y -= fastFloor(y);
        const u = fade(x);
        const v = fade(y);

        const aa = this.permutation.at(this.permutation.at(X) + Y);
        const ab = this.permutation.at(this.permutation.at(X) + Y + 1);
        const ba = this.permutation.at(this.permutation.at(X + 1) + Y);
        const bb = this.permutation.at(this.permutation.at(X + 1) + Y + 1);

        return lerp(
            lerp(
                GradientCalculator.gradient2D(aa, x, y),
                GradientCalculator.gradient2D(ba, x - 1, y),
                u
            ),
            lerp(
                GradientCalculator.gradient2D(ab, x, y - 1),
                GradientCalculator.gradient2D(bb, x - 1, y - 1),
                u
            ),
            v
        );
    }

    noise3D(x: number, y: number, z: number): number {
        const X = fastFloor(x) & 255;
        const Y = fastFloor(y) & 255;
        const Z = fastFloor(z) & 255;
        x -= fastFloor(x);
        y -= fastFloor(y);
        z -= fastFloor(z);
        const u = fade(x);
        const v = fade(y);
        const w = fade(z);

        const aaa = this.permutation.at(this.permutation.at(this.permutation.at(X) + Y) + Z);
        const aba = this.permutation.at(this.permutation.at(this.permutation.at(X) + Y + 1) + Z);
        const aab = this.permutation.at(this.permutation.at(this.permutation.at(X) + Y) + Z + 1);
        const abb = this.permutation.at(
            this.permutation.at(this.permutation.at(X) + Y + 1) + Z + 1
        );
        const baa = this.permutation.at(this.permutation.at(this.permutation.at(X + 1) + Y) + Z);
        const bba = this.permutation.at(
            this.permutation.at(this.permutation.at(X + 1) + Y + 1) + Z
        );
        const bab = this.permutation.at(
            this.permutation.at(this.permutation.at(X + 1) + Y) + Z + 1
        );
        const bbb = this.permutation.at(
            this.permutation.at(this.permutation.at(X + 1) + Y + 1) + Z + 1
        );

        return lerp(
            lerp(
                lerp(
                    GradientCalculator.gradient3D(aaa, x, y, z),
                    GradientCalculator.gradient3D(baa, x - 1, y, z),
                    u
                ),
                lerp(
                    GradientCalculator.gradient3D(aba, x, y - 1, z),
                    GradientCalculator.gradient3D(bba, x - 1, y - 1, z),
                    u
                ),
                v
            ),
            lerp(
                lerp(
                    GradientCalculator.gradient3D(aab, x, y, z - 1),
                    GradientCalculator.gradient3D(bab, x - 1, y, z - 1),
                    u
                ),
                lerp(
                    GradientCalculator.gradient3D(abb, x, y - 1, z - 1),
                    GradientCalculator.gradient3D(bbb, x - 1, y - 1, z - 1),
                    u
                ),
                v
            ),
            w
        );
    }
}

class FractionalBrownianMotion {
    private readonly core: NoiseCore;
    private readonly octaves: number;
    private readonly persistence: number;
    private readonly lacunarity: number;
    private readonly amplitude: number;
    private readonly frequency: number;

    constructor(config: NoiseConfig = {}) {
        this.core = new NoiseCore(config.seed);
        this.octaves = this.validateOctaves(config.octaves ?? 1);
        this.persistence = config.persistence ?? 0.5;
        this.lacunarity = config.lacunarity ?? 2.0;
        this.amplitude = config.amplitude ?? 1.0;
        this.frequency = config.frequency ?? 1.0;
    }

    private validateOctaves(octaves: number): number {
        if (!Number.isInteger(octaves) || octaves < 1) {
            throw new InvalidOctavesError(octaves);
        }
        return octaves;
    }

    fbm1D(x: number): number {
        let value = 0;
        let amplitude = this.amplitude;
        let frequency = this.frequency;

        for (let i = 0; i < this.octaves; i++) {
            value += this.core.noise1D(x * frequency) * amplitude;
            amplitude *= this.persistence;
            frequency *= this.lacunarity;
        }

        return value;
    }

    fbm2D(x: number, y: number): number {
        let value = 0;
        let amplitude = this.amplitude;
        let frequency = this.frequency;

        for (let i = 0; i < this.octaves; i++) {
            value += this.core.noise2D(x * frequency, y * frequency) * amplitude;
            amplitude *= this.persistence;
            frequency *= this.lacunarity;
        }

        return value;
    }

    fbm3D(x: number, y: number, z: number): number {
        let value = 0;
        let amplitude = this.amplitude;
        let frequency = this.frequency;

        for (let i = 0; i < this.octaves; i++) {
            value += this.core.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
            amplitude *= this.persistence;
            frequency *= this.lacunarity;
        }

        return value;
    }

    getCore(): NoiseCore {
        return this.core;
    }
}

export class PerlinNoise implements NoiseGenerator {
    private readonly core: NoiseCore;
    private readonly fbm: FractionalBrownianMotion;

    constructor(config: NoiseConfig = {}) {
        this.fbm = new FractionalBrownianMotion(config);
        this.core = this.fbm.getCore();
    }

    readonly noise1D: NoiseFunction1D = (x: number): number => {
        return this.core.noise1D(x);
    };

    readonly noise2D: NoiseFunction2D = (x: number, y: number): number => {
        return this.core.noise2D(x, y);
    };

    readonly noise3D: NoiseFunction3D = (x: number, y: number, z: number): number => {
        return this.core.noise3D(x, y, z);
    };

    readonly fbm1D: NoiseFunction1D = (x: number): number => {
        return this.fbm.fbm1D(x);
    };

    readonly fbm2D: NoiseFunction2D = (x: number, y: number): number => {
        return this.fbm.fbm2D(x, y);
    };

    readonly fbm3D: NoiseFunction3D = (x: number, y: number, z: number): number => {
        return this.fbm.fbm3D(x, y, z);
    };
}

export const createNoise = (config?: NoiseConfig): NoiseGenerator => {
    return new PerlinNoise(config);
};

export const createSeededNoise = (
    seed: number,
    config?: Omit<NoiseConfig, 'seed'>
): NoiseGenerator => {
    return new PerlinNoise({ ...config, seed });
};

export default PerlinNoise;
