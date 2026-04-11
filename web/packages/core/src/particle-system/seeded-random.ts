export class SeededRandom {
    private _state: number;

    constructor(seed: number) {
        const normalized = seed >>> 0;
        this._state = normalized === 0 ? 0x6d2b79f5 : normalized;
    }

    float(): number {
        let value = (this._state += 0x6d2b79f5);
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
}
