import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validateProbability } from '../constants';
import { createEngineFactory } from '../engines';
import {
    sampleManyFromDistribution,
    sampleManyWithDistributionMetadata,
    sampleWithDistributionMetadata,
} from '../internal/distribution-sampling';

export class BernoulliDistribution implements IDistribution<boolean> {
    constructor(private readonly p: number = 0.5) {
        validateProbability(p, 'p');
    }

    private readonly _createSample = (value: boolean): DistributionSample<boolean> => ({
        value,
        metadata: {
            p: this.p,
            mean: this.mean(),
            variance: this.variance(),
            standardDeviation: this.standardDeviation(),
        },
    });

    public sample = (state: IRandomState): RandomResult<boolean> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        const value = engine.next01() < this.p;

        return [value, engine.getState()];
    };

    public sampleMany = (state: IRandomState, count: number): RandomResult<readonly boolean[]> =>
        sampleManyFromDistribution(state, count, this.sample);

    public sampleWithMetadata = (state: IRandomState): RandomResult<DistributionSample<boolean>> =>
        sampleWithDistributionMetadata(state, this.sample, this._createSample);

    public sampleManyWithMetadata = (
        state: IRandomState,
        count: number
    ): RandomResult<readonly DistributionSample<boolean>[]> =>
        sampleManyWithDistributionMetadata(state, count, this.sampleMany, this._createSample);

    public probability = (x: boolean | number): number => {
        const val = typeof x === 'boolean' ? x : x === 1;
        return val ? this.p : 1 - this.p;
    };

    public cumulativeProbability = (x: boolean | number): number => {
        const val = typeof x === 'boolean' ? x : x === 1;
        return val ? 1.0 : 1 - this.p;
    };

    public quantile = (prob: number): boolean => {
        if (prob < 0 || prob > 1 || !Number.isFinite(prob)) {
            throw new RangeError('Probability must be between 0 and 1');
        }
        return prob > 1 - this.p;
    };

    public mean = (): number => this.p;
    public variance = (): number => this.p * (1 - this.p);
    public standardDeviation = (): number => Math.sqrt(this.p * (1 - this.p));
}
