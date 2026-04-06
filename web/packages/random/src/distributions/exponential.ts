import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validatePositive } from '../constants';
import { createEngineFactory } from '../engines';

export class ExponentialDistribution implements IDistribution<number> {
    constructor(private readonly lambda: number = 1) {
        validatePositive(lambda, 'lambda');
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);
        const u = engine.next01();
        const value = -Math.log(1 - u) / this.lambda;

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
                lambda: this.lambda,
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
                lambda: this.lambda,
                mean: this.mean(),
                variance: this.variance(),
                standardDeviation: this.standardDeviation(),
            },
        }));

        return [samples, nextState];
    };

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
