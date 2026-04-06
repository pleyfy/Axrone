import { IDistribution, IRandomState, RandomResult } from '../types';
import { createEngineFactory } from '../engines';

export class UniformDistribution implements IDistribution<number> {
    constructor(
        private readonly min: number = 0,
        private readonly max: number = 1
    ) {
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            throw new RangeError('Bounds must be finite numbers');
        }

        if (min > max) {
            throw new RangeError('Min must be less than or equal to max');
        }
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        const value = this.min + (this.max - this.min) * engine.next01();

        return [value, engine.getState()];
    };
}
