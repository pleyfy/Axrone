import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validateProbability } from '../constants';
import { createEngineFactory } from '../engines';

export class BernoulliDistribution implements IDistribution<boolean> {
    constructor(private readonly p: number = 0.5) {
        validateProbability(p, 'p');
    }

    public sample = (state: IRandomState): RandomResult<boolean> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        const value = engine.next01() < this.p;

        return [value, engine.getState()];
    };

    public sampleMany = (state: IRandomState, count: number): RandomResult<readonly boolean[]> => {
        if (count <= 0 || !Number.isInteger(count)) {
            throw new RangeError('Count must be a positive integer');
        }

        const result: boolean[] = [];
        let currentState = state;

        for (let i = 0; i < count; i++) {
            const [value, nextState] = this.sample(currentState);
            result.push(value);
            currentState = nextState;
        }

        return [result, currentState];
    };

    public sampleWithMetadata = (
        state: IRandomState
    ): RandomResult<DistributionSample<boolean>> => {
        const [value, nextState] = this.sample(state);

        const sample: DistributionSample<boolean> = {
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
    ): RandomResult<readonly DistributionSample<boolean>[]> => {
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
