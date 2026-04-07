import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validateProbability } from '../constants';
import { createEngineFactory } from '../engines';

export class GeometricDistribution implements IDistribution<number> {
    constructor(private readonly p: number) {
        validateProbability(p, 'p');

        if (p === 0) {
            throw new RangeError('p must be greater than 0');
        }
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        const u = engine.next01();

        const value = Math.floor(Math.log1p(-u) / Math.log1p(-this.p));

        return [value, engine.getState()];
    };

    public sampleMany = (state: IRandomState, count: number): RandomResult<readonly number[]> => {
        if (count <= 0 || !Number.isInteger(count)) {
            throw new RangeError('Count must be a positive integer');
        }

        const result: number[] = [];
        let currentState = state;

        for (let i = 0; i < count; i++) {
            const [value, nextState] = this.sample(currentState);
            result.push(value);
            currentState = nextState;
        }

        return [result, currentState];
    };

    public sampleWithMetadata = (state: IRandomState): RandomResult<DistributionSample<number>> => {
        const [value, nextState] = this.sample(state);

        const sample: DistributionSample<number> = {
            value,
            metadata: {
                p: this.p,
                mean: this.mean(),
                variance: this.variance(),
                standardDeviation: this.standardDeviation(),
            },
        };

        return [sample, nextState];
    };

    public sampleManyWithMetadata = (
        state: IRandomState,
        count: number
    ): RandomResult<readonly DistributionSample<number>[]> => {
        const [values, nextState] = this.sampleMany(state, count);
        const samples = values.map((value) => ({
            value,
            metadata: {
                p: this.p,
                mean: this.mean(),
                variance: this.variance(),
                standardDeviation: this.standardDeviation(),
            },
        }));

        return [samples, nextState];
    };

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
