import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType, SeedSource } from '../types';
import { UINT64_MAX } from '../constants';
import { hashSeedToState } from '../seed-utils';

export class SplitMix64Engine implements IRandomEngine {
    private state: UInt64;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.SPLITMIX64;

    constructor(seed: SeedSource = null) {
        const seedState = hashSeedToState(seed);
        this.state = seedState.vector[0];
        this.counter = seedState.counter;
        this.warmup();
    }

    public next01 = (): Float64 => {
        return Number(this.nextUint64() >> 11n) * (1.0 / 9007199254740992.0);
    };

    public nextUint32 = (): UInt32 => {
        return Number(this.nextUint64() & 0xffffffffn) >>> 0;
    };

    public nextUint64 = (): UInt64 => {
        this.counter++;
        this.state = (this.state + 0x9e3779b97f4a7c15n) & UINT64_MAX;
        let z = this.state;
        z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & UINT64_MAX;
        z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & UINT64_MAX;
        return z ^ (z >> 31n);
    };

    public jumpAhead = (steps: UInt64 = 1n): void => {
        if (steps <= 0n) return;

        this.state = (this.state + steps * 0x9e3779b97f4a7c15n) & UINT64_MAX;
        this.counter += steps;
    };

    public getState = (): IRandomState => {
        return {
            vector: [this.state, 0n, 0n, 0n],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.state = state.vector[0];
        this.counter = state.counter;
    };

    public clone = (): IRandomEngine => {
        const copy = new SplitMix64Engine();
        copy.state = this.state;
        copy.counter = this.counter;
        return copy;
    };

    private warmup = (): void => {
        for (let i = 0; i < 8; i++) {
            this.nextUint64();
        }
        this.counter = 0n;
    };
}
