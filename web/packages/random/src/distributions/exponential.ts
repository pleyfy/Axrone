import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validatePositive } from '../constants';
import { createEngineFactory } from '../engines';
import {
    sampleManyFromDistribution,
    sampleManyWithDistributionMetadata,
    sampleWithDistributionMetadata,
} from '../internal/distribution-sampling';

export class ExponentialDistribution implements IDistribution<number> {
    constructor(private readonly lambda: number = 1) {
        validatePositive(lambda, 'lambda');
    }

    private readonly _createSample = (value: number): DistributionSample<number> => ({
        value,
        metadata: {
            lambda: this.lambda,
            mean: this.mean(),
            variance: this.variance(),
            standardDeviation: this.standardDeviation(),
        },
    });

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);
        const u = engine.next01();
        const value = -Math.log(1 - u) / this.lambda;

        return [value, engine.getState()];
    };

    public sampleMany = (state: IRandomState, count: number): RandomResult<readonly number[]> =>
        sampleManyFromDistribution(state, count, this.sample);

    public sampleWithMetadata = (state: IRandomState): RandomResult<DistributionSample<number>> =>
        sampleWithDistributionMetadata(state, this.sample, this._createSample);

    public sampleManyWithMetadata = (
        state: IRandomState,
        count: number
    ): RandomResult<readonly DistributionSample<number>[]> =>
        sampleManyWithDistributionMetadata(state, count, this.sampleMany, this._createSample);

    public probability = (x: number): number => {
        if (!Number.isFinite(x)) {
            throw new RangeError('Value must be finite');
        }
        if (x < 0) return 0;
        return this.lambda * Math.exp(-this.lambda * x);
    };

    public cumulativeProbability = (x: number): number => {
        if (!Number.isFinite(x)) {
            throw new RangeError('Value must be finite');
        }
        if (x < 0) return 0;
        return 1 - Math.exp(-this.lambda * x);
    };

    public quantile = (p: number): number => {
        if (p < 0 || p > 1 || !Number.isFinite(p)) {
            throw new RangeError('Probability must be between 0 and 1');
        }
        if (p === 0) return 0;
        if (p === 1) return Infinity;
        return -Math.log(1 - p) / this.lambda;
    };

    public mean = (): number => 1 / this.lambda;
    public variance = (): number => 1 / (this.lambda * this.lambda);
    public standardDeviation = (): number => 1 / this.lambda;
}
