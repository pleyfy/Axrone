import {
    IRandomGenerator,
    IRandomAPI,
    IRandomEngine,
    IRandomState,
    RandomEngineType,
    SeedSource,
    IRandomSequence,
} from './types';
import { validateNonNegative, validateInteger, validateProbability, hex } from './constants';
import { createEngineFactory } from './engines';
import { hashSeedToState } from './seed-utils';
import { RandomDistributionRuntime } from './internal/distribution-runtime';
import { RandomSequence } from './random-sequence';

export class Random implements IRandomGenerator {
    private engine: IRandomEngine;
    private normalAlgorithm: 'standard' | 'polar' | 'ziggurat' = 'polar';
    private readonly _distributions: RandomDistributionRuntime;
    private static readonly DEFAULT_CHARSET =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    private static readonly HEX_DIGITS = '0123456789abcdef';

    constructor(
        seed: SeedSource = null,
        engineType: RandomEngineType = RandomEngineType.XOROSHIRO128_PLUS_PLUS
    ) {
        this.engine = createEngineFactory(engineType)(seed);
        this._distributions = new RandomDistributionRuntime({
            getState: () => this.engine.getState(),
            setState: (state) => this.engine.setState(state),
            getNormalAlgorithm: () => this.normalAlgorithm,
        });
    }

    public float = (): number => {
        return this.engine.next01();
    };

    public floatBetween = (min: number, max: number): number => {
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            throw new RangeError('Bounds must be finite numbers');
        }

        if (min >= max) {
            throw new RangeError('Min must be less than max');
        }

        return min + (max - min) * this.engine.next01();
    };

    public int = (min: number, max: number): number => {
        validateInteger(min, 'min');
        validateInteger(max, 'max');

        if (min > max) {
            throw new RangeError('Min must be less than or equal to max');
        }

        const range = max - min + 1;

        if (range <= 0) {
            throw new RangeError('Range is too large and would cause integer overflow');
        }

        if (range <= 0x100000000) {
            return min + Math.floor(range * this.engine.next01());
        }

        const bigRange = BigInt(range);
        const value = (this.engine.nextUint64() % bigRange) + BigInt(min);

        return Number(value);
    };

    public boolean = (probability: number = 0.5): boolean => {
        validateProbability(probability, 'probability');
        return this.engine.next01() < probability;
    };

    public pick = <T>(array: ReadonlyArray<T>): T => {
        if (array.length === 0) {
            throw new Error('Cannot pick from an empty array');
        }

        const index = this.int(0, array.length - 1);
        return array[index];
    };

    public weighted = <T>(items: ReadonlyArray<[T, number]>): T => {
        if (items.length === 0) {
            throw new Error('Cannot pick from an empty array');
        }

        let totalWeight = 0;
        for (const [_, weight] of items) {
            if (weight < 0) {
                throw new RangeError('Weights must be non-negative');
            }
            totalWeight += weight;
        }

        if (totalWeight <= 0) {
            throw new RangeError('Sum of weights must be positive');
        }

        const r = this.floatBetween(0, totalWeight);
        let cumulativeWeight = 0;

        for (const [item, weight] of items) {
            cumulativeWeight += weight;
            if (r < cumulativeWeight) {
                return item;
            }
        }

        return items[items.length - 1][0];
    };

    public shuffle = <T>(array: ReadonlyArray<T>): T[] => {
        if (array.length <= 1) return [...array];

        const result = [...array];

        for (let i = result.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }

        return result;
    };

    public sample = <T>(array: ReadonlyArray<T>, count: number): T[] => {
        validateNonNegative(count, 'count');
        validateInteger(count, 'count');

        if (count === 0 || array.length === 0) {
            return [];
        }

        if (count >= array.length) {
            return this.shuffle(array);
        }

        if (count < 0.15 * array.length) {
            const indices = new Set<number>();

            while (indices.size < count) {
                indices.add(this.int(0, array.length - 1));
            }

            return [...indices].map((i) => array[i]);
        } else {
            const result = [...array];

            for (let i = 0; i < count; i++) {
                const j = this.int(i, result.length - 1);
                [result[i], result[j]] = [result[j], result[i]];
            }

            return result.slice(0, count);
        }
    };

    public uuid = (): string => {
        const bytes = new Uint8Array(16);

        for (let i = 0; i < 16; i++) {
            bytes[i] = this.int(0, 255);
        }

        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        return (
            hex[bytes[0]] +
            hex[bytes[1]] +
            hex[bytes[2]] +
            hex[bytes[3]] +
            '-' +
            hex[bytes[4]] +
            hex[bytes[5]] +
            '-' +
            hex[bytes[6]] +
            hex[bytes[7]] +
            '-' +
            hex[bytes[8]] +
            hex[bytes[9]] +
            '-' +
            hex[bytes[10]] +
            hex[bytes[11]] +
            hex[bytes[12]] +
            hex[bytes[13]] +
            hex[bytes[14]] +
            hex[bytes[15]]
        );
    };

    public bytes = (length: number): Uint8Array => {
        validateNonNegative(length, 'length');
        validateInteger(length, 'length');

        const result = new Uint8Array(length);

        for (let i = 0; i < length; i++) {
            result[i] = this.int(0, 255);
        }

        return result;
    };

    public string = (length: number, charset: string = Random.DEFAULT_CHARSET): string => {
        validateNonNegative(length, 'length');
        validateInteger(length, 'length');

        if (charset.length === 0) {
            throw new Error('Charset must not be empty');
        }

        let result = '';

        const isPowerOf2 = (charset.length & (charset.length - 1)) === 0;
        const mask = isPowerOf2 ? charset.length - 1 : null;

        if (isPowerOf2) {
            for (let i = 0; i < length; i++) {
                const index = this.engine.nextUint32() & mask!;
                result += charset[index];
            }
        } else {
            for (let i = 0; i < length; i++) {
                const index = this.int(0, charset.length - 1);
                result += charset[index];
            }
        }

        return result;
    };

    public sequence = <T>(generator: () => T): IRandomSequence<T> => {
        return new RandomSequence<T>(generator);
    };

    public normal = (mean: number = 0, stdDev: number = 1): number => {
        return this._distributions.normal(mean, stdDev);
    };

    public exponential = (lambda: number = 1): number => {
        return this._distributions.exponential(lambda);
    };

    public poisson = (lambda: number): number => {
        return this._distributions.poisson(lambda);
    };

    public bernoulli = (p: number = 0.5): boolean => {
        return this._distributions.bernoulli(p);
    };

    public binomial = (n: number, p: number): number => {
        return this._distributions.binomial(n, p);
    };

    public geometric = (p: number): number => {
        return this._distributions.geometric(p);
    };

    public distribution = <T>(distribution: import('./types').IDistribution<T>): T => {
        return this._distributions.distribution(distribution);
    };

    public normalWithMetadata = (mean: number = 0, stdDev: number = 1) => {
        return this._distributions.normalWithMetadata(mean, stdDev);
    };

    public normalMany = (count: number, mean: number = 0, stdDev: number = 1): readonly number[] => {
        return this._distributions.normalMany(count, mean, stdDev);
    };

    public normalManyWithMetadata = (count: number, mean: number = 0, stdDev: number = 1) => {
        return this._distributions.normalManyWithMetadata(count, mean, stdDev);
    };

    public exponentialWithMetadata = (lambda: number = 1) => {
        return this._distributions.exponentialWithMetadata(lambda);
    };

    public exponentialMany = (count: number, lambda: number = 1): readonly number[] => {
        return this._distributions.exponentialMany(count, lambda);
    };

    public exponentialManyWithMetadata = (count: number, lambda: number = 1) => {
        return this._distributions.exponentialManyWithMetadata(count, lambda);
    };

    public poissonWithMetadata = (lambda: number) => {
        return this._distributions.poissonWithMetadata(lambda);
    };

    public poissonMany = (count: number, lambda: number): readonly number[] => {
        return this._distributions.poissonMany(count, lambda);
    };

    public poissonManyWithMetadata = (count: number, lambda: number) => {
        return this._distributions.poissonManyWithMetadata(count, lambda);
    };

    public bernoulliWithMetadata = (p: number = 0.5) => {
        return this._distributions.bernoulliWithMetadata(p);
    };

    public bernoulliMany = (count: number, p: number = 0.5): readonly boolean[] => {
        return this._distributions.bernoulliMany(count, p);
    };

    public bernoulliManyWithMetadata = (count: number, p: number = 0.5) => {
        return this._distributions.bernoulliManyWithMetadata(count, p);
    };

    public binomialWithMetadata = (n: number, p: number) => {
        return this._distributions.binomialWithMetadata(n, p);
    };

    public binomialMany = (count: number, n: number, p: number): readonly number[] => {
        return this._distributions.binomialMany(count, n, p);
    };

    public binomialManyWithMetadata = (count: number, n: number, p: number) => {
        return this._distributions.binomialManyWithMetadata(count, n, p);
    };

    public geometricWithMetadata = (p: number) => {
        return this._distributions.geometricWithMetadata(p);
    };

    public geometricMany = (count: number, p: number): readonly number[] => {
        return this._distributions.geometricMany(count, p);
    };

    public geometricManyWithMetadata = (count: number, p: number) => {
        return this._distributions.geometricManyWithMetadata(count, p);
    };

    public analyzeSequence = (values: readonly number[]) => {
        if (values.length === 0) {
            throw new Error('Cannot analyze empty sequence');
        }

        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance =
            values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const standardDeviation = Math.sqrt(variance);
        const min = Math.min(...values);
        const max = Math.max(...values);

        return {
            mean,
            variance,
            standardDeviation,
            min,
            max,
            count: values.length,
        };
    };

    public setNormalAlgorithm = (algorithm: 'standard' | 'polar' | 'ziggurat'): void => {
        this.normalAlgorithm = algorithm;
    };

    public setSeed = (seed: SeedSource): void => {
        const state = hashSeedToState(seed);
        this.engine.setState(state);
    };

    public getEngine = (): IRandomEngine => {
        return this.engine;
    };

    public setEngine = (engineType: RandomEngineType): void => {
        const currentState = this.engine.getState();
        this.engine = createEngineFactory(engineType)();

        try {
            this.engine.setState(currentState);
        } catch (e) {
            const derivedSeed = [
                currentState.vector[0] ^ currentState.counter,
                currentState.vector[1] ^ (currentState.counter << 1n),
                currentState.vector[2] ^ (currentState.counter << 2n),
                currentState.vector[3] ^ (currentState.counter << 3n),
            ];
            this.setSeed(new BigInt64Array(derivedSeed));
        }
    };

    public getState = (): IRandomState => {
        return this.engine.getState();
    };

    public setState = (state: IRandomState): void => {
        if (this.engine.getState().engine !== state.engine) {
            this.engine = createEngineFactory(state.engine)();
        }

        this.engine.setState(state);
    };

    public fork = (): IRandomGenerator => {
        const forked = new Random();

        const currentState = this.engine.getState();

        const forkedState: IRandomState = {
            vector: [
                currentState.vector[0] ^ currentState.counter,
                currentState.vector[1] ^ (currentState.counter << 1n),
                currentState.vector[2] ^ (currentState.counter << 2n),
                currentState.vector[3] ^ (currentState.counter << 3n),
            ],
            counter: 0n,
            engine: currentState.engine,
        };

        forked.setEngine(currentState.engine);
        forked.setState(forkedState);

        return forked;
    };
}

export class RandomBuilder {
    private seed: SeedSource = null;
    private engineType: RandomEngineType = RandomEngineType.XOROSHIRO128_PLUS_PLUS;

    public withSeed = (seed: SeedSource): RandomBuilder => {
        this.seed = seed;
        return this;
    };

    public withEngine = (engineType: RandomEngineType): RandomBuilder => {
        this.engineType = engineType;
        return this;
    };

    public build = (): IRandomGenerator => {
        return new Random(this.seed, this.engineType);
    };
}
