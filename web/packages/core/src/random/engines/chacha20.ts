import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType, SeedSource } from '../types';
import { UINT64_MAX, INV_UINT32_MAX } from '../constants';
import { hashSeedToState } from '../seed-utils';

export class ChaCha20Engine implements IRandomEngine {
    private state = new Uint32Array(16);
    private buffer = new Uint32Array(16);
    private index = 16;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.CHACHA20;

    constructor(seed: SeedSource = null) {
        this.counter = 0n;
        this.initializeState(seed);
    }

    public next01 = (): Float64 => {
        return this.nextUint32() * INV_UINT32_MAX;
    };

    public nextUint32 = (): UInt32 => {
        this.counter++;

        if (this.index >= 16) {
            this.generateBlock();
            this.index = 0;
        }

        return this.buffer[this.index++] >>> 0;
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

        const remainingInCurrentBlock = BigInt(16 - this.index);
        const stepsAfterCurrentBlock =
            steps > remainingInCurrentBlock ? steps - remainingInCurrentBlock : 0n;
        const fullBlocksToSkip = stepsAfterCurrentBlock >> 4n;
        const remainingSteps = stepsAfterCurrentBlock & 0xfn;

        if (fullBlocksToSkip > 0n) {
            const currentBlockCount = this.state[12] + (this.state[13] << 32);
            const newBlockCount = BigInt(currentBlockCount) + fullBlocksToSkip;

            this.state[12] = Number(newBlockCount & 0xffffffffn);
            this.state[13] = Number((newBlockCount >> 32n) & 0xffffffffn);

            this.index = 16;
        }

        for (let i = 0n; i < remainingSteps; i++) {
            this.nextUint32();
        }

        this.counter += steps;
    };

    public getState = (): IRandomState => {
        return {
            vector: [
                BigInt(this.state[0]) | (BigInt(this.state[1]) << 32n),
                BigInt(this.state[2]) | (BigInt(this.state[3]) << 32n),
                BigInt(this.state[4]) | (BigInt(this.state[5]) << 32n),
                BigInt(this.state[6]) | (BigInt(this.state[7]) << 32n),
            ],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.state[0] = Number(state.vector[0] & 0xffffffffn);
        this.state[1] = Number((state.vector[0] >> 32n) & 0xffffffffn);
        this.state[2] = Number(state.vector[1] & 0xffffffffn);
        this.state[3] = Number((state.vector[1] >> 32n) & 0xffffffffn);
        this.state[4] = Number(state.vector[2] & 0xffffffffn);
        this.state[5] = Number((state.vector[2] >> 32n) & 0xffffffffn);
        this.state[6] = Number(state.vector[3] & 0xffffffffn);
        this.state[7] = Number((state.vector[3] >> 32n) & 0xffffffffn);

        this.counter = state.counter;
        this.index = 16;
    };

    public clone = (): IRandomEngine => {
        const copy = new ChaCha20Engine();

        for (let i = 0; i < 16; i++) {
            copy.state[i] = this.state[i];
        }

        for (let i = 0; i < 16; i++) {
            copy.buffer[i] = this.buffer[i];
        }

        copy.index = this.index;
        copy.counter = this.counter;

        return copy;
    };

    private initializeState = (seed: SeedSource): void => {
        this.state[0] = 0x61707865;
        this.state[1] = 0x3320646e;
        this.state[2] = 0x79622d32;
        this.state[3] = 0x6b206574;

        if (seed === null) {
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                const randomBytes = new Uint8Array(32);
                crypto.getRandomValues(randomBytes);

                // Key: 8 words (32 bytes)
                for (let i = 0; i < 8; i++) {
                    const idx = i * 4;
                    this.state[4 + i] =
                        ((randomBytes[idx] << 0) |
                            (randomBytes[idx + 1] << 8) |
                            (randomBytes[idx + 2] << 16) |
                            (randomBytes[idx + 3] << 24)) >>>
                        0;
                }

                // Nonce and counter: 4 words (16 bytes)
                for (let i = 0; i < 4; i++) {
                    const idx = 32 + i * 4;
                    this.state[12 + i] =
                        ((randomBytes[idx % randomBytes.length] << 0) |
                            (randomBytes[(idx + 1) % randomBytes.length] << 8) |
                            (randomBytes[(idx + 2) % randomBytes.length] << 16) |
                            (randomBytes[(idx + 3) % randomBytes.length] << 24)) >>>
                        0;
                }
            } else {
                // Fallback for environments without crypto
                const now = Date.now();
                this.state[4] = now & 0xffffffff;
                this.state[5] = (now >> 16) & 0xffffffff;
                this.state[6] = 0x6a09e667;
                this.state[7] = 0xbb67ae85;
                this.state[8] = 0x3c6ef372;
                this.state[9] = 0xa54ff53a;
                this.state[10] = 0x510e527f;
                this.state[11] = 0x9b05688c;
                this.state[12] = 0; // Counter lo
                this.state[13] = 0; // Counter hi
                this.state[14] = 0x1f83d9ab; // Nonce
                this.state[15] = 0x5be0cd19; // Nonce
            }
        } else {
            const seedState = hashSeedToState(seed);

            // Key: 8 words (32 bytes)
            this.state[4] = Number(seedState.vector[0] & 0xffffffffn);
            this.state[5] = Number((seedState.vector[0] >> 32n) & 0xffffffffn);
            this.state[6] = Number(seedState.vector[1] & 0xffffffffn);
            this.state[7] = Number((seedState.vector[1] >> 32n) & 0xffffffffn);
            this.state[8] = Number(seedState.vector[2] & 0xffffffffn);
            this.state[9] = Number((seedState.vector[2] >> 32n) & 0xffffffffn);
            this.state[10] = Number(seedState.vector[3] & 0xffffffffn);
            this.state[11] = Number((seedState.vector[3] >> 32n) & 0xffffffffn);

            // Counter and nonce: 4 words (16 bytes)
            this.state[12] = 0; // Counter lo
            this.state[13] = 0; // Counter hi
            this.state[14] = Number((seedState.vector[0] ^ seedState.vector[2]) & 0xffffffffn); // Nonce
            this.state[15] = Number((seedState.vector[1] ^ seedState.vector[3]) & 0xffffffffn); // Nonce
        }
    };

    private generateBlock = (): void => {
        for (let i = 0; i < 16; i++) {
            this.buffer[i] = this.state[i];
        }

        // Apply ChaCha20 rounds
        for (let i = 0; i < 10; i++) {
            this.quarterRound(0, 4, 8, 12);
            this.quarterRound(1, 5, 9, 13);
            this.quarterRound(2, 6, 10, 14);
            this.quarterRound(3, 7, 11, 15);
            this.quarterRound(0, 5, 10, 15);
            this.quarterRound(1, 6, 11, 12);
            this.quarterRound(2, 7, 8, 13);
            this.quarterRound(3, 4, 9, 14);
        }

        for (let i = 0; i < 16; i++) {
            this.buffer[i] = (this.buffer[i] + this.state[i]) >>> 0;
        }

        const carry = (this.state[12] + 1) >>> 0 < this.state[12] ? 1 : 0;
        this.state[12] = (this.state[12] + 1) >>> 0;
        this.state[13] = (this.state[13] + carry) >>> 0;
    };

    private quarterRound = (a: number, b: number, c: number, d: number): void => {
        this.buffer[a] = (this.buffer[a] + this.buffer[b]) >>> 0;
        this.buffer[d] = this.rotl32(this.buffer[d] ^ this.buffer[a], 16);

        this.buffer[c] = (this.buffer[c] + this.buffer[d]) >>> 0;
        this.buffer[b] = this.rotl32(this.buffer[b] ^ this.buffer[c], 12);

        this.buffer[a] = (this.buffer[a] + this.buffer[b]) >>> 0;
        this.buffer[d] = this.rotl32(this.buffer[d] ^ this.buffer[a], 8);

        this.buffer[c] = (this.buffer[c] + this.buffer[d]) >>> 0;
        this.buffer[b] = this.rotl32(this.buffer[b] ^ this.buffer[c], 7);
    };

    private rotl32 = (x: number, n: number): number => {
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    };
}
