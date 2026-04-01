import { IDistribution, IRandomState, RandomResult } from '../types';
import { validateInteger } from '../constants';
import { createEngineFactory } from '../engines';

export class IntegerDistribution implements IDistribution<number> {
    constructor(
        private readonly min: number,
        private readonly max: number
    ) {
        validateInteger(min, 'min');
        validateInteger(max, 'max');

        if (min > max) {
            throw new RangeError('Min must be less than or equal to max');
        }
    }

    public sample = (state: IRandomState): RandomResult<number> => {
        const engine = createEngineFactory(state.engine)();
        engine.setState(state);

        let value: number;
        const range = this.max - this.min + 1;

        if (range <= 0) {
            throw new RangeError('Range is too large and would cause integer overflow');
        }

        if (range <= 0x100000000) {
            value = this.min + Math.floor(range * engine.next01());
        } else {
            const limit = Math.floor(0x100000000 * Math.floor(range / 0x100000000));
            let x: number;

            do {
                x = engine.nextUint32() * 0x100000000 + engine.nextUint32();
            } while (x >= limit);

            value = this.min + (x % range);
        }

        return [value, engine.getState()];
    };
}
