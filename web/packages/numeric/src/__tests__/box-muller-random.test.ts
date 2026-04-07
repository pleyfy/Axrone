import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDefaultRandomGenerator, DefaultRandomGenerator } from '../box-muller';

describe('DefaultRandomGenerator', () => {
    test('getInstance should return the same instance (singleton)', () => {
        const instance1 = DefaultRandomGenerator.getInstance();
        const instance2 = DefaultRandomGenerator.getInstance();
        const instance3 = DefaultRandomGenerator.getInstance();

        expect(instance1).toBeInstanceOf(DefaultRandomGenerator);
        expect(instance1).toBe(instance2);
        expect(instance2).toBe(instance3);
    });

    test('float() should call Math.random and return its value', () => {
        const originalMathRandom = Math.random;
        const mockRandom = vi.fn();
        Math.random = mockRandom;

        try {
            mockRandom.mockReturnValue(0.123);
            const generator = new DefaultRandomGenerator();
            const result = generator.float();
            expect(result).toBe(0.123);

            mockRandom.mockReturnValue(0.987);
            expect(generator.float()).toBe(0.987);
        } finally {
            Math.random = originalMathRandom;
        }
    });

    test('floatBetween(min, max) should return a value within the range [min, max)', () => {
        const originalMathRandom = Math.random;
        const mockRandom = vi.fn();
        Math.random = mockRandom;

        try {
            const min = 5;
            const max = 15;
            const generator = new DefaultRandomGenerator();

            mockRandom.mockReturnValue(0);
            expect(generator.floatBetween(min, max)).toBe(min);

            mockRandom.mockReturnValue(0.999999999999999);
            const resultNearMax = generator.floatBetween(min, max);
            expect(resultNearMax).toBeGreaterThanOrEqual(min);
            expect(resultNearMax).toBeLessThan(max);

            mockRandom.mockReturnValue(0.5);
            const range = max - min;
            expect(generator.floatBetween(min, max)).toBe(min + range * 0.5);
        } finally {
            Math.random = originalMathRandom;
        }
    });

    test('int(min, max) should return an integer within the range [min, max]', () => {
        const originalMathRandom = Math.random;
        const mockRandom = vi.fn();
        Math.random = mockRandom;

        try {
            const min = 1;
            const max = 10;
            const generator = new DefaultRandomGenerator();

            mockRandom.mockReturnValue(0);
            expect(generator.int(min, max)).toBe(min);

            mockRandom.mockReturnValue(0.999999999999999);
            expect(generator.int(min, max)).toBe(max);

            mockRandom.mockReturnValue(0.4);
            expect(generator.int(min, max)).toBe(Math.floor(min + (max - min + 1) * 0.4));

            mockRandom.mockReturnValue(0.5);
            expect(generator.int(min, max)).toBe(Math.floor(min + (max - min + 1) * 0.5));
        } finally {
            Math.random = originalMathRandom;
        }
    });

    test('createDefaultRandomGenerator should return a new instance each time', () => {
        const generator1 = createDefaultRandomGenerator();
        const generator2 = createDefaultRandomGenerator();

        expect(generator1).toBeInstanceOf(DefaultRandomGenerator);
        expect(generator2).toBeInstanceOf(DefaultRandomGenerator);
        expect(generator1).not.toBe(generator2);
    });
});
