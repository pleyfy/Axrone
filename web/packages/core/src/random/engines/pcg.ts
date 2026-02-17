import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType, SeedSource } from '../types';
import { UINT64_MAX, INV_UINT32_MAX } from '../constants';
import { hashSeedToState } from '../seed-utils';

export class PCGEngine implements IRandomEngine {
    private state: UInt64;
    private inc: UInt64;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.PCG_XSH_RR;

    constructor(seed: SeedSource = null) {
        const seedState = hashSeedToState(seed);
        this.state = seedState.vector[0];
        this.inc = (seedState.vector[1] << 1n) | 1n;
        this.counter = seedState.counter;
        this.warmup();
    }

    public next01 = (): Float64 => {
        return this.nextUint32() * INV_UINT32_MAX;
    };

    public nextUint32 = (): UInt32 => {
        this.counter++;
        const oldState = this.state;

        this.state = (oldState * 6364136223846793005n + this.inc) & UINT64_MAX;

        const xorshifted = Number(((oldState >> 18n) ^ oldState) >> 27n) >>> 0;
        const rot = Number(oldState >> 59n);

        return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
    };

    public nextUint64 = (): UInt64 => {
        const lo = BigInt(this.nextUint32());
        const hi = BigInt(this.nextUint32());
        return ((hi << 32n) | lo) & UINT64_MAX;
    };

    public jumpAhead = (steps: UInt64 = 1n): void => {
        if (steps <= 0n) return;

        if (steps < 16n) {
            for (let i = 0n; i < steps; i++) {
                this.nextUint32();
            }
            return;
        }

        const oldState = this.state;
        let curMult = 6364136223846793005n;
        let curPlus = this.inc;

        let accMult = 1n;
        let accPlus = 0n;
        let ssteps = steps;

        while (ssteps > 0n) {
            if (ssteps & 1n) {
                accMult = (accMult * curMult) & UINT64_MAX;
                accPlus = (accPlus * curMult + curPlus) & UINT64_MAX;
            }

            curPlus = ((curMult + 1n) * curPlus) & UINT64_MAX;
            curMult = (curMult * curMult) & UINT64_MAX;
            ssteps >>= 1n;
        }

        this.state = (accMult * oldState + accPlus) & UINT64_MAX;
        this.counter += steps;
    };

    public getState = (): IRandomState => {
        return {
            vector: [this.state, this.inc, 0n, 0n],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.state = state.vector[0];
        this.inc = state.vector[1];
        this.counter = state.counter;
    };

    public clone = (): IRandomEngine => {
        const copy = new PCGEngine();
        copy.state = this.state;
        copy.inc = this.inc;
        copy.counter = this.counter;
        return copy;
    };

    private warmup = (): void => {
        for (let i = 0; i < 16; i++) {
            this.nextUint32();
        }
        this.counter = 0n;
    };
}
