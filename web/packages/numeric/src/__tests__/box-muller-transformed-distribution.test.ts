import { vi, describe, test, expect, beforeEach } from 'vitest';
import { DistributionSample } from 'packages/core/src/random';
import {
    TransformedDistribution,
    BoxMullerNormalDistribution,
    validatePositive,
    validateInteger,
} from '../box-muller';

const dummyState = {} as any;

describe('TransformedDistribution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockDistribution = (
        sampleValues: number[],
        hasMetadataMethods: boolean = true
    ): BoxMullerNormalDistribution => {
        let sampleIndex = 0;
        const distBase: Partial<BoxMullerNormalDistribution> = {
            sample: vi.fn((state: any): [number, any] => [
                sampleValues[sampleIndex++ % sampleValues.length],
                state,
            ]),
            sampleMany: vi.fn((state: any, count: number): [number[], any] => {
                const result: number[] = [];
                for (let i = 0; i < count; i++) {
                    result.push(sampleValues[sampleIndex++ % sampleValues.length]);
                }
                return [result, state];
            }),
            probability: vi.fn((x: number) => 0.5),
            cumulativeProbability: vi.fn((x: number) => 0.5),
            quantile: vi.fn((p: number) => 0),
        };
        const dist = hasMetadataMethods
            ? {
                  ...distBase,
                  sampleWithMetadata: vi.fn((state: any): [any, any] => [
                      {
                          value: sampleValues[sampleIndex++ % sampleValues.length],
                          zscore: 0.5,
                      },
                      state,
                  ]),
                  sampleManyWithMetadata: vi.fn((state: any, count: number): [any[], any] => {
                      const result: DistributionSample<number>[] = [];
                      for (let i = 0; i < count; i++) {
                          result.push({
                              value: sampleValues[sampleIndex++ % sampleValues.length],
                              zscore: i * 0.1,
                          });
                      }
                      return [result, state];
                  }),
              }
            : distBase;
        return dist as BoxMullerNormalDistribution;
    };

    describe('Basic Transformation', () => {
        test('should transform single sample values correctly', () => {
            const sourceValues = [1, 2, 3, 4, 5];
            const source = createMockDistribution(sourceValues);
            const transform = (x: number) => x * 2;

            const transformed = TransformedDistribution(source, transform);
            const [sample1] = transformed.sample(dummyState);
            const [sample2] = transformed.sample(dummyState);

            expect((source.sample as any).mock.calls.length).toBe(2);
            expect(sample1).toBe(sourceValues[0] * 2);
            expect(sample2).toBe(sourceValues[1] * 2);
        });

        test('should transform multiple sample values correctly', () => {
            const sourceValues = [1, 2, 3, 4, 5];
            const source = createMockDistribution(sourceValues);
            const transform = (x: number) => x.toString();

            const transformed = TransformedDistribution(source, transform);
            const [samples] = transformed.sampleMany!(dummyState, 3);

            expect((source.sampleMany as any).mock.calls[0][1]).toBe(3);
            expect(samples).toEqual(['1', '2', '3']);
        });

        test('should apply complex transformations correctly', () => {
            interface Point {
                x: number;
                y: number;
            }
            const sourceValues = [1, 2, 3];
            const source = createMockDistribution(sourceValues);
            const transform = (value: number): Point => ({
                x: value,
                y: value * value,
            });

            const transformed = TransformedDistribution(source, transform);
            const [sample] = transformed.sample(dummyState);

            expect(sample).toEqual({ x: 1, y: 1 });
            const [samples] = transformed.sampleMany!(dummyState, 2);
            expect(samples).toEqual([
                { x: 2, y: 4 },
                { x: 3, y: 9 },
            ]);
        });
    });

    describe('Input Validation', () => {
        test('should validate count parameter in sampleMany', () => {
            const source = createMockDistribution([1, 2, 3]);
            const transform = (x: number) => x;

            const transformed = TransformedDistribution(source, transform);
            transformed.sampleMany!(dummyState, 5);

            // Ensure the request was forwarded to the source distribution with the same count
            expect((source.sampleMany as any).mock.calls[0][1]).toBe(5);
        });

        test('should validate count parameter in sampleManyWithMetadata', () => {
            const source = createMockDistribution([1, 2, 3]);
            const transform = (x: number) => x;

            const transformed = TransformedDistribution(source, transform);
            transformed.sampleManyWithMetadata!(dummyState, 5);

            // Ensure the request was forwarded to the source distribution with the same count
            expect((source.sampleManyWithMetadata as any).mock.calls[0][1]).toBe(5);
        });
    });

    describe('Metadata Handling', () => {
        test('should preserve z-scores in transformed samples with metadata', () => {
            const sourceValues = [10, 20, 30];
            const source = createMockDistribution(sourceValues);
            const transform = (x: number) => x / 10;

            const transformed = TransformedDistribution(source, transform);
            const [sampleWithMeta] = transformed.sampleWithMetadata!(dummyState);

            expect((source.sampleWithMetadata as any).mock.calls.length).toBe(1);
            expect(sampleWithMeta.value).toBe(1);
            expect(sampleWithMeta.zscore).toBe(0.5);
        });

        test('should preserve z-scores in multiple transformed samples with metadata', () => {
            const sourceValues = [10, 20, 30];
            const source = createMockDistribution(sourceValues);
            const transform = (x: number) => x / 10;

            const transformed = TransformedDistribution(source, transform);
            const [samplesWithMeta] = transformed.sampleManyWithMetadata!(dummyState, 3);

            expect((source.sampleManyWithMetadata as any).mock.calls[0][1]).toBe(3);
            expect(samplesWithMeta).toHaveLength(3);

            expect(samplesWithMeta[0].value).toBe(1);
            expect(samplesWithMeta[0].zscore).toBe(0);

            expect(samplesWithMeta[1].value).toBe(2);
            expect(samplesWithMeta[1].zscore).toBe(0.1);
        });

        test('should handle source distributions without metadata methods', () => {
            const sourceValues = [10, 20, 30];
            const source = createMockDistribution(sourceValues, false);
            const transform = (x: number) => x * 2;

            const transformed = TransformedDistribution(source, transform);

            expect(transformed.sampleWithMetadata).toBeUndefined();
            expect(transformed.sampleManyWithMetadata).toBeUndefined();

            const [val] = transformed.sample(dummyState);
            expect(val).toBe(20);
            const [vals] = transformed.sampleMany!(dummyState, 2);
            expect(vals).toEqual([40, 60]);
        });
    });

    describe('Type Transformation', () => {
        test('should transform between different types', () => {
            interface User {
                id: number;
                name: string;
            }

            const userSource = {
                sample: vi.fn((state: any) => [1, state]),
                sampleMany: vi.fn((state: any, count: number) => [[1, 2], state]),
            } as any;
            const transform = (id: number): User => ({
                id,
                name: `User ${id}`,
            });

            const transformed = TransformedDistribution(userSource, transform);
            const [sample] = transformed.sample(dummyState);
            const [samples] = transformed.sampleMany!(dummyState, 2);

            expect(sample).toEqual({ id: 1, name: 'User 1' });
            expect(samples).toEqual([
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' },
            ]);
        });

        test('should transform to primitive types', () => {
            interface Point {
                x: number;
                y: number;
            }

            const pointSource = {
                sample: vi.fn((state: any) => [{ x: 1, y: 2 }, state]),
                sampleMany: vi.fn((state: any, count: number) => [
                    [
                        { x: 3, y: 4 },
                        { x: 5, y: 6 },
                    ],
                    state,
                ]),
            } as any;
            const transform = (point: Point): number =>
                Math.sqrt(point.x * point.x + point.y * point.y);

            const transformed = TransformedDistribution(pointSource, transform);
            const [sample] = transformed.sample(dummyState);
            const [samples] = transformed.sampleMany!(dummyState, 2);

            const expected1 = Math.sqrt(1 * 1 + 2 * 2);
            const expected2 = Math.sqrt(3 * 3 + 4 * 4);
            const expected3 = Math.sqrt(5 * 5 + 6 * 6);

            expect(sample).toBeCloseTo(expected1);
            expect(samples[0]).toBeCloseTo(expected2);
            expect(samples[1]).toBeCloseTo(expected3);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty source arrays', () => {
            const source = createMockDistribution([]);
            const transform = (x: number) => x * 2;

            expect(() => TransformedDistribution(source, transform)).not.toThrow();
        });

        test('should handle identity transformation', () => {
            const sourceValues = [1, 2, 3];
            const source = createMockDistribution(sourceValues);
            const identity = (x: number) => x;

            const transformed = TransformedDistribution(source, identity);
            const [samples] = transformed.sampleMany!(dummyState, 3);
            expect(samples).toEqual(sourceValues);
        });

        test('should handle transformation that returns null or undefined', () => {
            const sourceValues = [1, 2, 3];
            const source = createMockDistribution(sourceValues);
            const nullTransform = (x: number) => (x % 2 === 0 ? null : undefined);

            const transformed = TransformedDistribution(source, nullTransform as any);
            const [samples] = transformed.sampleMany!(dummyState, 3);
            expect(samples).toEqual([undefined, null, undefined]);
        });
    });

    describe('Performance', () => {
        test('should efficiently transform large sample sets', () => {
            const largeSize = 10000;
            const sourceValues = Array.from({ length: largeSize }, (_, i) => i);
            const source = createMockDistribution(sourceValues);
            const transform = (x: number) => x * 2;

            (source.sampleMany as any).mockImplementationOnce((state: any, count: number) => {
                const values = Array.from({ length: count }, (_, i) => i);
                return [values, state];
            });

            const start = performance.now();
            const transformed = TransformedDistribution(source, transform);
            const [samples] = transformed.sampleMany!(dummyState, largeSize);
            const end = performance.now();

            expect(samples).toHaveLength(largeSize);
            expect(samples[0]).toBe(0);
            expect(samples[largeSize - 1]).toBe((largeSize - 1) * 2);

            expect(end - start).toBeLessThan(200);
        });
    });
});
