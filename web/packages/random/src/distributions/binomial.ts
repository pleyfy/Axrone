import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validateNonNegative, validateInteger, validateProbability } from '../constants';
import { createEngineFactory } from '../engines';
import {
    sampleManyFromDistribution,
    sampleManyWithDistributionMetadata,
    sampleWithDistributionMetadata,
} from '../internal/distribution-sampling';
import { NormalDistribution } from './normal';

export class BinomialDistribution implements IDistribution<number> {
    constructor(
        private readonly n: number,
        private readonly p: number
    ) {
        validateNonNegative(n, 'n');
        validateInteger(n, 'n');
        validateProbability(p, 'p');
    }

    private readonly _createSample = (value: number): DistributionSample<number> => ({
        value,
        metadata: {
            n: this.n,
            p: this.p,
            mean: this.mean(),
            variance: this.variance(),
            standardDeviation: this.standardDeviation(),
        },
    });

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        if (this.n === 0 || this.p === 0) return [0, engine.getState()];
        if (this.p === 1) return [this.n, engine.getState()];

        if (this.n < 100) {
            let successes = 0;

            for (let i = 0; i < this.n; i++) {
                if (engine.next01() < this.p) {
                    successes++;
                }
            }

            return [successes, engine.getState()];
        }

        const mean = this.n * this.p;
        const stdDev = Math.sqrt(this.n * this.p * (1 - this.p));

        const normalSample = new NormalDistribution(mean, stdDev).sample(engine.getState());
        engine.setState(normalSample[1]);

        const value = Math.max(0, Math.min(this.n, Math.round(normalSample[0])));

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
        if (!Number.isInteger(val) || val < 0 || val > this.n) {
            return 0;
        }

        const binomialCoeff = this.binomialCoefficient(this.n, val);
        return binomialCoeff * Math.pow(this.p, val) * Math.pow(1 - this.p, this.n - val);
    };

    public cumulativeProbability = (k: number | boolean): number => {
        const val = typeof k === 'boolean' ? (k ? 1 : 0) : k;
        if (!Number.isInteger(val) || val < 0) {
            return 0;
        }
        if (val >= this.n) {
            return 1;
        }

        let sum = 0;
        for (let i = 0; i <= val; i++) {
            sum += this.probability(i);
        }
        return sum;
    };

    public quantile = (prob: number): number => {
        if (prob < 0 || prob > 1 || !Number.isFinite(prob)) {
            throw new RangeError('Probability must be between 0 and 1');
        }

        if (prob === 0) return 0;
        if (prob === 1) return this.n;

        let k = 0;
        let cumulative = 0;

        while (cumulative < prob && k <= this.n) {
            cumulative += this.probability(k);
            if (cumulative >= prob) break;
            k++;
        }

        return k;
    };

    public mean = (): number => this.n * this.p;
    public variance = (): number => this.n * this.p * (1 - this.p);
    public standardDeviation = (): number => Math.sqrt(this.variance());

    private binomialCoefficient(n: number, k: number): number {
        if (k > n) return 0;
        if (k === 0 || k === n) return 1;

        k = Math.min(k, n - k);

        let result = 1;
        for (let i = 0; i < k; i++) {
            result = (result * (n - i)) / (i + 1);
        }

        return result;
    }
}
