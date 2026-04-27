import { describe, expect, it } from 'vitest';

import { isPlainObject, isRecord } from '../object';

describe('object predicates', () => {
    it('treats non-array objects as records', () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord(Object.create(null))).toBe(true);
        expect(isRecord([])).toBe(false);
        expect(isRecord(null)).toBe(false);
    });

    it('accepts only plain object prototypes', () => {
        class Box {
            constructor(readonly value: number) {}
        }

        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
        expect(isPlainObject(new Box(1))).toBe(false);
        expect(isPlainObject(new Map())).toBe(false);
    });
});