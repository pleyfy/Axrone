import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validateProbability } from '../constants';
import { createEngineFactory } from '../engines';
import {
    sampleManyFromDistribution,
    sampleManyWithDistributionMetadata,
    sampleWithDistributionMetadata,
} from '../internal/distribution-sampling';

export class GeometricDistribution implements IDistribution<number> {
    constructor(private readonly p: number) {
        validateProbability(p, 'p');

        if (p === 0) {
            throw new RangeError('p must be greater than 0');
        }
    }

    private readonly _createSample = (value: number): DistributionSample<number> => ({
        value,
        metadata: {
            p: this.p,
            mean: this.mean(),
            variance: this.variance(),
            standardDeviation: this.standardDeviation(),
        },
    });

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        const u = engine.next01();

        const value = Math.floor(Math.log1p(-u) / Math.log1p(-this.p));

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

    public probability = (k: number | boolean): number => {
        const val = typeof k === 'boolean' ? (k ? 1 : 0) : k;
        if (!Number.isInteger(val) || val < 0) {
            return 0;
        }
        return Math.pow(1 - this.p, val) * this.p;
    };

    public cumulativeProbability = (k: number | boolean): number => {
        const val = typeof k === 'boolean' ? (k ? 1 : 0) : k;
        if (!Number.isInteger(val) || val < 0) {
            return 0;
        }
        return 1 - Math.pow(1 - this.p, val + 1);
    };

    public quantile = (prob: number): number => {
        if (prob < 0 || prob > 1 || !Number.isFinite(prob)) {
            throw new RangeError('Probability must be between 0 and 1');
        }
        if (prob === 0) return 0;
        if (prob === 1) return Infinity;

        return Math.floor(Math.log(1 - prob) / Math.log(1 - this.p));
    };

    public mean = (): number => (1 - this.p) / this.p;
    public variance = (): number => (1 - this.p) / (this.p * this.p);
    public standardDeviation = (): number => Math.sqrt(this.variance());
}
