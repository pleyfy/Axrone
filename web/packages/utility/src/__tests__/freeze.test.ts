import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../freeze';

describe('deepFreeze', () => {
    it('freezes nested objects without throwing on binary buffer views', () => {
        const buffer = new ArrayBuffer(8);
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        const value = {
            nested: {
                list: [{ enabled: true }],
            },
            buffer,
            bytes,
            view,
        };

        expect(() => deepFreeze(value)).not.toThrow();

        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.nested)).toBe(true);
        expect(Object.isFrozen(value.nested.list)).toBe(true);
        expect(Object.isFrozen(value.nested.list[0])).toBe(true);
        expect(value.buffer).toBe(buffer);
        expect(value.bytes).toBe(bytes);
        expect(value.view).toBe(view);
    });

    it('preserves cyclic references', () => {
        const value: { self?: unknown; nested: { ready: boolean } } = {
            nested: { ready: true },
        };
        value.self = value;

        expect(() => deepFreeze(value)).not.toThrow();
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.nested)).toBe(true);
        expect(value.self).toBe(value);
    });
});