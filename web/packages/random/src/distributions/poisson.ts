import { IDistribution, IRandomState, RandomResult, DistributionSample } from '../types';
import { validatePositive, PI, factorial } from '../constants';
import { createEngineFactory } from '../engines';

export class PoissonDistribution implements IDistribution<number> {
    constructor(private readonly lambda: number) {
        validatePositive(lambda, 'lambda');
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        if (this.lambda < 10) {
            // For small lambda, use Knuth's algorithm
            const L = Math.exp(-this.lambda);
            let k = 0;
            let p = 1;

            do {
                k++;
                p *= engine.next01();
            } while (p > L);

            return [k - 1, engine.getState()];
        } else {
            // For larger lambda, use the "rejection method" algorithm
            const c = 0.767 - 3.36 / this.lambda;
            const beta = PI / Math.sqrt(3.0 * this.lambda);
            const alpha = beta * this.lambda;
            const k = Math.log(c) - this.lambda - Math.log(beta);

            while (true) {
                const u = engine.next01();
                const x = (alpha - Math.log((1.0 - u) / u)) / beta;
                const n = Math.floor(x + 0.5);

                if (n < 0) continue;

                const v = engine.next01();
                const y = alpha - beta * x;
                const lhs = y + Math.log(v / Math.pow(1.0 + Math.exp(y), 2));
                const rhs = k + n * Math.log(this.lambda) - Math.log(factorial(n));

                if (lhs <= rhs) {
                    return [n, engine.getState()];
                }
            }
        }
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

    public probability = (k: number): number => {
        if (!Number.isInteger(k) || k < 0) {
            throw new RangeError('Value must be a non-negative integer');
        }
        return (Math.pow(this.lambda, k) * Math.exp(-this.lambda)) / factorial(k);
    };

    public cumulativeProbability = (k: number): number => {
        if (!Number.isInteger(k) || k < 0) {
            throw new RangeError('Value must be a non-negative integer');
        }

        let sum = 0;
        for (let i = 0; i <= k; i++) {
            sum += this.probability(i);
        }
        return sum;
    };

    public quantile = (p: number): number => {
        if (p < 0 || p > 1 || !Number.isFinite(p)) {
            throw new RangeError('Probability must be between 0 and 1');
        }

        if (p === 0) return 0;
        if (p === 1) return Infinity;

        let k = 0;
        let cumulative = 0;

        while (cumulative < p) {
            cumulative += this.probability(k);
            if (cumulative >= p) break;
            k++;
        }

        return k;
    };

    public mean = (): number => this.lambda;
    public variance = (): number => this.lambda;
    public standardDeviation = (): number => Math.sqrt(this.lambda);
}
