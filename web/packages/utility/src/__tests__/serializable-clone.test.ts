import { describe, expect, it } from 'vitest';

import { cloneSerializable } from '../clone/serializable-clone';

class CustomValue {
    constructor(readonly value: number) {}
}

describe('cloneSerializable', () => {
    it('clones enumerable object graphs and typed arrays into serializable data', () => {
        const source = {
            nested: new CustomValue(3),
            values: new Float32Array([1, 2, 3]),
            items: [new CustomValue(7)],
        };

        const cloned = cloneSerializable(source);

        expect(cloned).toEqual({
            nested: { value: 3 },
            values: new Float32Array([1, 2, 3]),
            items: [{ value: 7 }],
        });
        expect(cloned).not.toBe(source);
        expect(cloned.values).not.toBe(source.values);
        expect(Object.getPrototypeOf(cloned.nested)).toBe(Object.prototype);
    });

    it('optionally freezes cloned arrays and objects', () => {
        const source = {
            nested: { enabled: true },
            items: [{ value: 1 }],
            values: new Float32Array([4, 5]),
        };

        const cloned = cloneSerializable(source, { freeze: true });

        expect(Object.isFrozen(cloned)).toBe(true);
        expect(Object.isFrozen(cloned.nested)).toBe(true);
        expect(Object.isFrozen(cloned.items)).toBe(true);
        expect(Object.isFrozen(cloned.items[0])).toBe(true);
        expect(cloned.values).not.toBe(source.values);
    });
});