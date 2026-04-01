import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType, SeedSource } from '../types';
import { UINT64_MAX } from '../constants';
import { hashSeedToState } from '../seed-utils';

export class Xoroshiro128PlusPlus implements IRandomEngine {
    private s0: UInt64;
    private s1: UInt64;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.XOROSHIRO128_PLUS_PLUS;

    constructor(seed: SeedSource = null) {
        const state = hashSeedToState(seed);
        this.s0 = state.vector[0];
        this.s1 = state.vector[1];
        this.counter = state.counter;
        this.warmup();
    }

    public next01 = (): Float64 => {
        const result = Number(this.nextUint64() >> 11n) * (1.0 / 9007199254740992.0);
        return result;
    };

    public nextUint32 = (): UInt32 => {
        return Number(this.nextUint64() & 0xffffffffn) >>> 0;
    };

    public nextUint64 = (): UInt64 => {
        this.counter++;

        const result = (this.rotl(this.s0 + this.s1, 17n) + this.s0) & UINT64_MAX;

        const t = (this.s1 << 41n) & UINT64_MAX;

        this.s1 ^= this.s0;
        this.s0 = this.rotl(this.s0, 49n) ^ this.s1 ^ (this.s1 << 21n);
        this.s1 = this.rotl(this.s1, 28n);

        return result;
    };

    public jumpAhead = (steps: UInt64 = 1n): void => {
        if (steps <= 0n) return;

        if (steps < 16n) {
            for (let i = 0n; i < steps; i++) {
                this.nextUint64();
            }
            return;
        }

        const JUMP = [0xdf900294d8f554a5n, 0x170865df4b3201fcn];

        let js0 = 0n;
        let js1 = 0n;

        for (const jump of JUMP) {
            for (let b = 0n; b < 64n; b++) {
                if ((jump & (1n << b)) !== 0n) {
                    js0 ^= this.s0;
                    js1 ^= this.s1;
                }
                this.nextUint64();
            }
        }

        this.s0 = js0;
        this.s1 = js1;
        this.counter += steps - 1n;
    };

    public getState = (): IRandomState => {
        return {
            vector: [this.s0, this.s1, 0n, 0n],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.s0 = state.vector[0];
        this.s1 = state.vector[1];
        this.counter = state.counter;
    };

    public clone = (): IRandomEngine => {
        const copy = new Xoroshiro128PlusPlus();
        copy.s0 = this.s0;
        copy.s1 = this.s1;
        copy.counter = this.counter;
        return copy;
    };

    private rotl = (x: UInt64, k: UInt64): UInt64 => {
        return ((x << k) | (x >> (64n - k))) & UINT64_MAX;
    };

    private warmup = (): void => {
        for (let i = 0; i < 32; i++) {
            this.nextUint64();
        }
        this.counter = 0n;
    };
}
