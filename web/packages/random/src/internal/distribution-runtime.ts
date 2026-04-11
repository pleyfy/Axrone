import {
    BernoulliDistribution,
    BinomialDistribution,
    ExponentialDistribution,
    GeometricDistribution,
    NormalDistribution,
    PoissonDistribution,
} from '../distributions';
import type {
    DistributionSample,
    IDistribution,
    IRandomState,
} from '../types';

type NormalAlgorithm = 'standard' | 'polar' | 'ziggurat';

interface RandomDistributionHost {
    readonly getState: () => IRandomState;
    readonly setState: (state: IRandomState) => void;
    readonly getNormalAlgorithm: () => NormalAlgorithm;
}

export class RandomDistributionRuntime {
    constructor(private readonly _host: RandomDistributionHost) {}

    public normal(mean: number = 0, stdDev: number = 1): number {
        return this.distribution<number>(
            new NormalDistribution(mean, stdDev, this._host.getNormalAlgorithm())
        );
    }

    public exponential(lambda: number = 1): number {
        return this.distribution<number>(new ExponentialDistribution(lambda));
    }

    public poisson(lambda: number): number {
        return this.distribution<number>(new PoissonDistribution(lambda));
    }

    public bernoulli(p: number = 0.5): boolean {
        return this.distribution<boolean>(new BernoulliDistribution(p));
    }

    public binomial(n: number, p: number): number {
        return this.distribution<number>(new BinomialDistribution(n, p));
    }

    public geometric(p: number): number {
        return this.distribution<number>(new GeometricDistribution(p));
    }

    public distribution<T>(distribution: IDistribution<T>): T {
        const [value, nextState] = distribution.sample(this._host.getState());
        this._host.setState(nextState);
        return value;
    }

    public normalWithMetadata(
        mean: number = 0,
        stdDev: number = 1
    ): DistributionSample<number> {
        return this.sampleWithMetadata<number>(
            new NormalDistribution(mean, stdDev, this._host.getNormalAlgorithm())
        );
    }

    public normalMany(
        count: number,
        mean: number = 0,
        stdDev: number = 1
    ): readonly number[] {
        return this.sampleMany<number>(
            new NormalDistribution(mean, stdDev, this._host.getNormalAlgorithm()),
            count
        );
    }

    public normalManyWithMetadata(
        count: number,
        mean: number = 0,
        stdDev: number = 1
    ): readonly DistributionSample<number>[] {
        return this.sampleManyWithMetadata<number>(
            new NormalDistribution(mean, stdDev, this._host.getNormalAlgorithm()),
            count
        );
    }

    public exponentialWithMetadata(lambda: number = 1): DistributionSample<number> {
        return this.sampleWithMetadata<number>(new ExponentialDistribution(lambda));
    }

    public exponentialMany(count: number, lambda: number = 1): readonly number[] {
        return this.sampleMany<number>(new ExponentialDistribution(lambda), count);
    }

    public exponentialManyWithMetadata(
        count: number,
        lambda: number = 1
    ): readonly DistributionSample<number>[] {
        return this.sampleManyWithMetadata<number>(new ExponentialDistribution(lambda), count);
    }

    public poissonWithMetadata(lambda: number): DistributionSample<number> {
        return this.sampleWithMetadata<number>(new PoissonDistribution(lambda));
    }

    public poissonMany(count: number, lambda: number): readonly number[] {
        return this.sampleMany<number>(new PoissonDistribution(lambda), count);
    }

    public poissonManyWithMetadata(
        count: number,
        lambda: number
    ): readonly DistributionSample<number>[] {
        return this.sampleManyWithMetadata<number>(new PoissonDistribution(lambda), count);
    }

    public bernoulliWithMetadata(p: number = 0.5): DistributionSample<boolean> {
        return this.sampleWithMetadata<boolean>(new BernoulliDistribution(p));
    }

    public bernoulliMany(count: number, p: number = 0.5): readonly boolean[] {
        return this.sampleMany<boolean>(new BernoulliDistribution(p), count);
    }

    public bernoulliManyWithMetadata(
        count: number,
        p: number = 0.5
    ): readonly DistributionSample<boolean>[] {
        return this.sampleManyWithMetadata<boolean>(new BernoulliDistribution(p), count);
    }

    public binomialWithMetadata(n: number, p: number): DistributionSample<number> {
        return this.sampleWithMetadata<number>(new BinomialDistribution(n, p));
    }

    public binomialMany(count: number, n: number, p: number): readonly number[] {
        return this.sampleMany<number>(new BinomialDistribution(n, p), count);
    }

    public binomialManyWithMetadata(
        count: number,
        n: number,
        p: number
    ): readonly DistributionSample<number>[] {
        return this.sampleManyWithMetadata<number>(new BinomialDistribution(n, p), count);
    }

    public geometricWithMetadata(p: number): DistributionSample<number> {
        return this.sampleWithMetadata<number>(new GeometricDistribution(p));
    }

    public geometricMany(count: number, p: number): readonly number[] {
        return this.sampleMany<number>(new GeometricDistribution(p), count);
    }

    public geometricManyWithMetadata(
        count: number,
        p: number
    ): readonly DistributionSample<number>[] {
        return this.sampleManyWithMetadata<number>(new GeometricDistribution(p), count);
    }

    private sampleWithMetadata<T>(distribution: IDistribution<T>): DistributionSample<T> {
        const [sample, nextState] = distribution.sampleWithMetadata!(this._host.getState());
        this._host.setState(nextState);
        return sample;
    }

    private sampleMany<T>(distribution: IDistribution<T>, count: number): readonly T[] {
        const [values, nextState] = distribution.sampleMany!(this._host.getState(), count);
        this._host.setState(nextState);
        return values;
    }

    private sampleManyWithMetadata<T>(
        distribution: IDistribution<T>,
        count: number
    ): readonly DistributionSample<T>[] {
        const [samples, nextState] = distribution.sampleManyWithMetadata!(
            this._host.getState(),
            count
        );
        this._host.setState(nextState);
        return samples;
    }
}