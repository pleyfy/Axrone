import { Float64, UInt32, UInt64 } from '../types';

export interface DistributionSample<T = number> {
    readonly value: T;
    readonly zscore?: number;
    readonly metadata?: Record<string, any>;
}

export interface IDistribution<T> {
    readonly sample: (state: IRandomState) => RandomResult<T>;
    readonly sampleMany?: (state: IRandomState, count: number) => RandomResult<readonly T[]>;
    readonly sampleWithMetadata?: (state: IRandomState) => RandomResult<DistributionSample<T>>;
    readonly sampleManyWithMetadata?: (
        state: IRandomState,
        count: number
    ) => RandomResult<readonly DistributionSample<T>[]>;

    // Statistical methods - these are optional and may not apply to all distributions
    readonly probability?: (value: T | number) => number;
    readonly cumulativeProbability?: (value: T | number) => number;
    readonly quantile?: (p: number) => T | number;
    readonly mean?: () => number;
    readonly variance?: () => number;
    readonly standardDeviation?: () => number;
}

export const enum RandomEngineType {
    XOROSHIRO128_PLUS_PLUS = 'xoroshiro128++',
    PCG_XSH_RR = 'pcg-xsh-rr',
    XOSHIRO256_PLUS_PLUS = 'xoshiro256++',
    SPLITMIX64 = 'splitmix64',
    CHACHA20 = 'chacha20',
    CRYPTO = 'crypto',
}

export const enum Endianness {
    LITTLE = 'little',
    BIG = 'big',
}

export type SeedSource = number | string | Uint8Array | Int32Array | BigInt64Array | null;
export type RandomStateVector = [UInt64, UInt64, UInt64, UInt64];

export interface IRandomState {
    readonly vector: RandomStateVector;
    readonly counter: UInt64;
    readonly engine: RandomEngineType;
}

export type RandomResult<T> = readonly [T, IRandomState];

export interface IRandomEngine {
    readonly next01: () => Float64;
    readonly nextUint32: () => UInt32;
    readonly nextUint64: () => UInt64;
    readonly jumpAhead: (steps?: UInt64) => void;
    readonly getState: () => IRandomState;
    readonly setState: (state: IRandomState) => void;
    readonly clone: () => IRandomEngine;
}

export interface IRandomSequence<T> {
    readonly next: () => T;
    readonly take: (count: number) => T[];
    readonly skip: (count: number) => void;
    readonly map: <U>(fn: (value: T) => U) => IRandomSequence<U>;
    readonly filter: (predicate: (value: T) => boolean) => IRandomSequence<T>;
}

export interface IRandomAPI {
    readonly float: () => number;
    readonly floatBetween: (min: number, max: number) => number;
    readonly int: (min: number, max: number) => number;
    readonly boolean: (probability?: number) => boolean;
    readonly pick: <T>(array: ReadonlyArray<T>) => T;
    readonly weighted: <T>(items: ReadonlyArray<[T, number]>) => T;
    readonly shuffle: <T>(array: ReadonlyArray<T>) => T[];
    readonly sample: <T>(array: ReadonlyArray<T>, count: number) => T[];
    readonly uuid: () => string;
    readonly bytes: (length: number) => Uint8Array;
    readonly string: (length: number, charset?: string) => string;
    readonly sequence: <T>(generator: () => T) => IRandomSequence<T>;
    readonly normal: (mean?: number, stdDev?: number) => number;
    readonly exponential: (lambda?: number) => number;
    readonly poisson: (lambda: number) => number;
    readonly bernoulli: (p?: number) => boolean;
    readonly binomial: (n: number, p: number) => number;
    readonly geometric: (p: number) => number;
    readonly distribution: <T>(distribution: IDistribution<T>) => T;
    readonly setSeed: (seed: SeedSource) => void;
    readonly getEngine: () => IRandomEngine;
    readonly setEngine: (engineType: RandomEngineType) => void;
    readonly getState: () => IRandomState;
    readonly setState: (state: IRandomState) => void;
    readonly fork: () => IRandomAPI;
}

export interface IRandomGenerator extends IRandomAPI {
    readonly normalWithMetadata: (mean?: number, stdDev?: number) => DistributionSample<number>;
    readonly normalMany: (count: number, mean?: number, stdDev?: number) => readonly number[];
    readonly normalManyWithMetadata: (
        count: number,
        mean?: number,
        stdDev?: number
    ) => readonly DistributionSample<number>[];

    readonly exponentialWithMetadata: (lambda?: number) => DistributionSample<number>;
    readonly exponentialMany: (count: number, lambda?: number) => readonly number[];
    readonly exponentialManyWithMetadata: (
        count: number,
        lambda?: number
    ) => readonly DistributionSample<number>[];

    readonly poissonWithMetadata: (lambda: number) => DistributionSample<number>;
    readonly poissonMany: (count: number, lambda: number) => readonly number[];
    readonly poissonManyWithMetadata: (
        count: number,
        lambda: number
    ) => readonly DistributionSample<number>[];

    readonly bernoulliWithMetadata: (p?: number) => DistributionSample<boolean>;
    readonly bernoulliMany: (count: number, p?: number) => readonly boolean[];
    readonly bernoulliManyWithMetadata: (
        count: number,
        p?: number
    ) => readonly DistributionSample<boolean>[];

    readonly binomialWithMetadata: (n: number, p: number) => DistributionSample<number>;
    readonly binomialMany: (count: number, n: number, p: number) => readonly number[];
    readonly binomialManyWithMetadata: (
        count: number,
        n: number,
        p: number
    ) => readonly DistributionSample<number>[];

    readonly geometricWithMetadata: (p: number) => DistributionSample<number>;
    readonly geometricMany: (count: number, p: number) => readonly number[];
    readonly geometricManyWithMetadata: (
        count: number,
        p: number
    ) => readonly DistributionSample<number>[];

    readonly analyzeSequence: (values: readonly number[]) => {
        mean: number;
        variance: number;
        standardDeviation: number;
        min: number;
        max: number;
        count: number;
    };

    readonly setNormalAlgorithm: (algorithm: 'standard' | 'polar' | 'ziggurat') => void;
}
