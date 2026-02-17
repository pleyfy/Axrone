import type {
    IDistribution,
    DistributionSample,
    RandomEngineType,
    SeedSource,
    IRandomState,
    RandomResult,
} from '../../core/src/random/';

import { Random, rand, NormalDistribution as CoreNormalDistribution } from '../../core/src/random/';

export type BoxMullerOptions = {
    readonly mean?: number;
    readonly standardDeviation?: number;
    readonly useCache?: boolean;
    readonly algorithm?: 'standard' | 'polar' | 'ziggurat';
    readonly optimizeFor?: 'speed' | 'memory';
    readonly engineType?: RandomEngineType;
    readonly seed?: SeedSource;
};

export class BoxMullerNormalDistribution implements IDistribution<number> {
    constructor(
        private readonly _mean: number = 0,
        private readonly _stdDev: number = 1,
        private readonly algorithm: 'standard' | 'polar' | 'ziggurat' = 'polar',
        private readonly useCache: boolean = true
    ) {
        validateFinite(_mean, 'mean');
        validateFinite(_stdDev, 'standardDeviation');
        validatePositive(_stdDev, 'standardDeviation');
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.sample(state);
    };

    public sampleMany = (state: IRandomState, count: number): RandomResult<readonly number[]> => {
        validatePositive(count, 'count');
        validateInteger(count, 'count');

        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.sampleMany!(state, count);
    };

    public sampleWithMetadata = (state: IRandomState): RandomResult<DistributionSample<number>> => {
        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.sampleWithMetadata!(state);
    };

    public sampleManyWithMetadata = (
        state: IRandomState,
        count: number
    ): RandomResult<readonly DistributionSample<number>[]> => {
        validatePositive(count, 'count');
        validateInteger(count, 'count');

        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.sampleManyWithMetadata!(state, count);
    };

    public probability = (x: number): number => {
        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.probability!(x);
    };

    public cumulativeProbability = (x: number): number => {
        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.cumulativeProbability!(x);
    };

    public quantile = (p: number): number => {
        const coreDistribution = new CoreNormalDistribution(
            this._mean,
            this._stdDev,
            this.algorithm,
            this.useCache
        );
        return coreDistribution.quantile!(p);
    };

    public mean = (): number => this._mean;
    public variance = (): number => this._stdDev * this._stdDev;
    public standardDeviation = (): number => this._stdDev;
}

export class BoxMullerError extends Error {
    readonly code: (typeof ErrorCodes)[keyof typeof ErrorCodes];

    constructor(code: (typeof ErrorCodes)[keyof typeof ErrorCodes], message: string) {
        super(message);
        this.code = code;
        this.name = 'BoxMullerError';

        Object.setPrototypeOf(this, BoxMullerError.prototype);
    }
}

export const ErrorCodes = {
    INVALID_PARAMETER: 'INVALID_PARAMETER',
    RUNTIME_ERROR: 'RUNTIME_ERROR',
    INVALID_STATE: 'INVALID_STATE',
    INVALID_OPERATION: 'INVALID_OPERATION',
    PRECISION_ERROR: 'PRECISION_ERROR',
} as const;

export type PrecisionMode = 'high' | 'standard' | 'low';

export type DistributionMetadata = {
    readonly mean: number;
    readonly standardDeviation: number;
    readonly variance: number;
    readonly algorithm: 'standard' | 'polar' | 'ziggurat';
};

const DEFAULT_MEAN = 0;
const DEFAULT_STD_DEV = 1;
const DEFAULT_CACHE = true;
const DEFAULT_ALGORITHM = 'polar';
const DEFAULT_OPTIMIZATION = 'speed';
const DEFAULT_PRECISION = 'standard';
const TWO_PI = 2.0 * Math.PI;
const SQRT_TWO_PI = Math.sqrt(2.0 * Math.PI);
const INV_SQRT_TWO_PI = 1.0 / SQRT_TWO_PI;
const LN_2 = Math.log(2);
const MAX_ITERATIONS = 100;
const EPSILON = 1e-10;

export const createDefaultRandomGenerator = (): DefaultRandomGenerator =>
    new DefaultRandomGenerator();

export class DefaultRandomGenerator {
    private static instance: DefaultRandomGenerator | null = null;

    constructor() {}

    static getInstance(): DefaultRandomGenerator {
        if (!DefaultRandomGenerator.instance) {
            DefaultRandomGenerator.instance = new DefaultRandomGenerator();
        }
        return DefaultRandomGenerator.instance;
    }

    next(): number {
        return Math.random();
    }

    nextInRange(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    nextInt(min: number, max: number): number {
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    float(): number {
        return Math.random();
    }

    floatBetween(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    int(min: number, max: number): number {
        return Math.floor(min + Math.random() * (max - min + 1));
    }
}

export const createError = (
    code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
    message: string
): BoxMullerError => new BoxMullerError(code, message);
export const validatePositive = (value: number, name: string): void | never => {
    if (value <= 0) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be positive`);
    }
};

export const validateFinite = (value: number, name: string): void | never => {
    if (!Number.isFinite(value)) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be finite`);
    }
};

export const validateInteger = (value: number, name: string): void | never => {
    if (!Number.isInteger(value)) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be an integer`);
    }
};

export const validateInRange = (
    value: number,
    min: number,
    max: number,
    name: string
): void | never => {
    if (value < min || value > max) {
        throw createError(
            ErrorCodes.INVALID_PARAMETER,
            `${name} must be between ${min} and ${max}`
        );
    }
};

export const BoxMullerTransform = (options: BoxMullerOptions = {}): IDistribution<number> => {
    const mean = options.mean ?? DEFAULT_MEAN;
    const stdDev = options.standardDeviation ?? DEFAULT_STD_DEV;
    const useCache = options.useCache ?? DEFAULT_CACHE;
    const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;

    return new BoxMullerNormalDistribution(mean, stdDev, algorithm, useCache);
};

const getTransformedStatisticalMethods = <TInput, TOutput>(source: IDistribution<TInput>) => {
    return {
        probability: undefined,
        cumulativeProbability: undefined,
        quantile: undefined,
        mean: undefined,
        variance: undefined,
        standardDeviation: undefined,
    };
};

export const TransformedDistribution = <TInput, TOutput>(
    source: IDistribution<TInput>,
    transform: (value: TInput) => TOutput
): IDistribution<TOutput> => {
    const sample = (state: IRandomState): RandomResult<TOutput> => {
        const [value, nextState] = source.sample(state);
        return [transform(value), nextState];
    };

    const sampleMany = (state: IRandomState, count: number): RandomResult<readonly TOutput[]> => {
        validatePositive(count, 'count');
        validateInteger(count, 'count');

        if (!source.sampleMany) {
            const result: TOutput[] = [];
            let currentState = state;

            for (let i = 0; i < count; i++) {
                const [value, nextState] = sample(currentState);
                result.push(value);
                currentState = nextState;
            }

            return [result, currentState];
        }

        const [values, nextState] = source.sampleMany(state, count);
        if (!values) {
            throw new Error('Source sampleMany returned undefined values');
        }
        return [values.map(transform), nextState];
    };

    const sampleWithMetadata = source.sampleWithMetadata
        ? (state: IRandomState): RandomResult<DistributionSample<TOutput>> => {
              const [sample, nextState] = source.sampleWithMetadata!(state);
              return [
                  {
                      value: transform(sample.value),
                      zscore: sample.zscore,
                      metadata: sample.metadata,
                  },
                  nextState,
              ];
          }
        : undefined;

    const sampleManyWithMetadata = source.sampleManyWithMetadata
        ? (
              state: IRandomState,
              count: number
          ): RandomResult<readonly DistributionSample<TOutput>[]> => {
              validatePositive(count, 'count');
              validateInteger(count, 'count');

              const [samples, nextState] = source.sampleManyWithMetadata!(state, count);
              return [
                  samples.map((sample) => ({
                      value: transform(sample.value),
                      zscore: sample.zscore,
                      metadata: sample.metadata,
                  })),
                  nextState,
              ];
          }
        : undefined;

    return {
        sample,
        sampleMany,
        sampleWithMetadata,
        sampleManyWithMetadata,
        ...getTransformedStatisticalMethods(source),
    };
};

export const StandardNormal = (
    options: Omit<BoxMullerOptions, 'mean' | 'standardDeviation'> = {}
): IDistribution<number> =>
    BoxMullerTransform({
        ...options,
        mean: 0,
        standardDeviation: 1,
    });

export const isIDistribution = <T = number>(obj: unknown): obj is IDistribution<T> =>
    obj !== null &&
    typeof obj === 'object' &&
    'sample' in obj &&
    typeof (obj as IDistribution<T>).sample === 'function';

export const BoxMullerFactory = {
    createNormal: (
        mean: number,
        stdDev: number,
        options: Omit<BoxMullerOptions, 'mean' | 'standardDeviation'> = {}
    ): IDistribution<number> =>
        BoxMullerTransform({
            ...options,
            mean,
            standardDeviation: stdDev,
        }),

    createStandard: (
        options: Omit<BoxMullerOptions, 'mean' | 'standardDeviation'> = {}
    ): IDistribution<number> => StandardNormal(options),

    createTransformed: <TOutput>(
        transform: (value: number) => TOutput,
        options: BoxMullerOptions = {}
    ): IDistribution<TOutput> => {
        const source = BoxMullerTransform(options);
        return TransformedDistribution<number, TOutput>(source, transform);
    },

    createFromCoreDistribution: (coreDistribution: CoreNormalDistribution): IDistribution<number> =>
        coreDistribution,
};

export const sharedStandardNormal = StandardNormal({ algorithm: 'polar', useCache: false });
export const sharedBoxMullerRandom = BoxMullerFactory.createNormal(0, 1, {
    algorithm: 'polar',
    useCache: false,
});

let _boxMullerSpare: number | null = null;

export const sampleStandardNormal = (): number => {
    if (_boxMullerSpare !== null) {
        const val = _boxMullerSpare;
        _boxMullerSpare = null;
        return val;
    }

    // u1 must be in (0,1] to avoid log(0). rand.float() yields [0,1).
    let u1 = rand.float();
    if (u1 <= 0) u1 = Number.MIN_VALUE;
    const u2 = rand.float();

    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const theta = TWO_PI * u2;

    const z0 = mag * Math.cos(theta);
    const z1 = mag * Math.sin(theta);

    _boxMullerSpare = z1;
    return z0;
};

export const sampleBoundedNormal = (min: number = -1, max: number = 1): number => {
    const MAX_ATTEMPTS = 10;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const value = sampleStandardNormal();
        if (value >= min && value <= max) {
            return value;
        }
    }
    return Math.max(min, Math.min(max, sampleStandardNormal()));
};

export const sampleNormalInRange = (center: number, range: number): number => {
    const stdDev = range / 6; // 99.7% of values within bounds
    const value = center + sampleStandardNormal() * stdDev;
    const min = center - range / 2;
    const max = center + range / 2;

    return Math.max(min, Math.min(max, value));
};

export const sampleUniform = (): number => {
    return rand.float();
};

export const sampleUniformRange = (min: number, max: number): number => {
    return rand.floatBetween(min, max);
};

export default {
    BoxMullerTransform,
    StandardNormal,
    TransformedDistribution,
    BoxMullerNormalDistribution,
    DefaultRandomGenerator,
    BoxMullerFactory,
    createDefaultRandomGenerator,
    isIDistribution,
    ErrorCodes,
    Random,
    CoreNormalDistribution,
};
