import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType } from '../types';
import { UINT64_MAX, INV_UINT32_MAX, hex } from '../constants';
import { Xoshiro256PlusPlus } from './xoshiro256-plus-plus';

export class CryptoEngine implements IRandomEngine {
    private s0: UInt64;
    private s1: UInt64;
    private s2: UInt64;
    private s3: UInt64;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.CRYPTO;
    private readonly buffer: Uint8Array;
    private bufferPosition: number;
    private readonly bufferSize = 1024;

    constructor() {
        this.buffer = new Uint8Array(this.bufferSize);
        this.bufferPosition = this.bufferSize;

        this.s0 = 0n;
        this.s1 = 0n;
        this.s2 = 0n;
        this.s3 = 0n;
        this.counter = 0n;

        this.refillBuffer();
    }

    public next01 = (): Float64 => {
        return this.nextUint32() * INV_UINT32_MAX;
    };

    public nextUint32 = (): UInt32 => {
        this.counter++;

        if (this.bufferPosition + 4 > this.bufferSize) {
            this.refillBuffer();
        }

        const value = new DataView(this.buffer.buffer).getUint32(this.bufferPosition, true);
        this.bufferPosition += 4;

        return value >>> 0;
    };

    public nextUint64 = (): UInt64 => {
        this.counter++;

        if (this.bufferPosition + 8 > this.bufferSize) {
            this.refillBuffer();
        }

        const view = new DataView(this.buffer.buffer);
        const lo = BigInt(view.getUint32(this.bufferPosition, true));
        const hi = BigInt(view.getUint32(this.bufferPosition + 4, true));
        this.bufferPosition += 8;

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

        this.counter += steps;

        this.bufferPosition = this.bufferSize;
    };

    public getState = (): IRandomState => {
        return {
            vector: [
                BigInt(
                    '0x' +
                        Array.from(this.buffer.slice(0, 8))
                            .map((b) => hex[b])
                            .join('')
                ),
                BigInt(
                    '0x' +
                        Array.from(this.buffer.slice(8, 16))
                            .map((b) => hex[b])
                            .join('')
                ),
                BigInt(
                    '0x' +
                        Array.from(this.buffer.slice(16, 24))
                            .map((b) => hex[b])
                            .join('')
                ),
                BigInt(
                    '0x' +
                        Array.from(this.buffer.slice(24, 32))
                            .map((b) => hex[b])
                            .join('')
                ),
            ],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.counter = state.counter;
        this.refillBuffer();
    };

    public clone = (): IRandomEngine => {
        const copy = new CryptoEngine();
        copy.counter = this.counter;
        return copy;
    };

    private refillBuffer = (): void => {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(this.buffer);
        } else {
            const seedArray = new BigInt64Array(4);
            seedArray[0] = BigInt(Date.now()) + this.counter;
            seedArray[1] = 1n + this.counter * 2n;
            seedArray[2] = 3n + this.counter * 4n;
            seedArray[3] = 5n + this.counter * 8n;

            const fallbackEngine = new Xoshiro256PlusPlus(seedArray);

            for (let i = 0; i < this.buffer.length; i += 8) {
                const value = fallbackEngine.nextUint64();

                for (let j = 0; j < 8 && i + j < this.buffer.length; j++) {
                    this.buffer[i + j] = Number((value >> BigInt(j * 8)) & 0xffn);
                }
            }
        }

        this.bufferPosition = 0;
    };
}
