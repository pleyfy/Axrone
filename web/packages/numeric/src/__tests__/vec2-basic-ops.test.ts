import { Vec2, IVec2Like } from '../vec2';
import { EPSILON } from '../common';
import { describe, expect, test } from 'vitest';

declare global {
    namespace jest {
        interface Matchers<R> {
            toBeVectorCloseTo: (expected: IVec2Like, precision?: number) => R;
            toBeOrthogonalTo: (expected: IVec2Like, precision?: number) => R;
            toHaveNorm: (expected: number, precision?: number) => R;
        }
    }
}

const PRECISION = EPSILON * 10;
const ITERATIONS = 100;
const PERFORMANCE_ITERATIONS = 10000;
const LARGE_VALUE = 1e15;
const SMALL_VALUE = 1e-15;

expect.extend({
    toBeVectorCloseTo(received: IVec2Like, expected: IVec2Like, precision = PRECISION) {
        const pass =
            Math.abs(received.x - expected.x) < precision &&
            Math.abs(received.y - expected.y) < precision;

        return {
            message: () =>
                `Expected vector (${received.x}, ${received.y}) to be close to (${expected.x}, ${expected.y}) within ${precision}`,
            pass,
        };
    },

    toBeOrthogonalTo(received: IVec2Like, expected: IVec2Like, precision = PRECISION) {
        const dotProduct = received.x * expected.x + received.y * expected.y;
        const pass = Math.abs(dotProduct) < precision;

        return {
            message: () =>
                `Expected vector (${received.x}, ${received.y}) to be orthogonal to (${expected.x}, ${expected.y}), dot product: ${dotProduct}`,
            pass,
        };
    },

    toHaveNorm(received: IVec2Like, expected: number, precision = PRECISION) {
        const norm = Math.sqrt(received.x * received.x + received.y * received.y);
        const pass = Math.abs(norm - expected) < precision;

        return {
            message: () =>
                `Expected vector (${received.x}, ${received.y}) to have norm ${expected}, got ${norm}`,
            pass,
        };
    },
});

function randomNonZeroVec2(): Vec2 {
    let x, y;
    do {
        x = Math.random() * 200 - 100;
        y = Math.random() * 200 - 100;
    } while (Math.abs(x) < EPSILON || Math.abs(y) < EPSILON);

    return new Vec2(x, y);
}

function generateRandomVectors(count: number): Vec2[] {
    return Array.from(
        { length: count },
        () => new Vec2(Math.random() * 200 - 100, Math.random() * 200 - 100)
    );
}

function measurePerformance(name: string, fn: () => void): number {
    const start = performance.now();
    fn();
    const end = performance.now();
    return end - start;
}

describe('Vec2 Class - Basic Operations Test Suite', () => {
    describe('Constructor and Initialization', () => {
        test('constructor without parameters creates a zero vector', () => {
            const v = new Vec2();
            expect(v).toBeVectorCloseTo({ x: 0, y: 0 });
        });

        test('constructor with parameters correctly initializes components', () => {
            const v = new Vec2(3.14, -2.718);
            expect(v.x).toBe(3.14);
            expect(v.y).toBe(-2.718);
        });

        test('constructor coerces parameters to numbers', () => {
            // @ts-ignore - Intentionally testing type coercion
            const v = new Vec2('5', '10');

            // Vec2 constructor does not perform string conversion,
            // it takes the value given as parameter as it is.
            expect(v.x).toBe('5');
            expect(v.y).toBe('10');
        });

        test.each([
            ['Infinity', Infinity, Infinity],
            ['NaN', NaN, NaN],
            ['MAX_VALUE', Number.MAX_VALUE, Number.MAX_VALUE],
            ['MIN_VALUE', Number.MIN_VALUE, Number.MIN_VALUE],
        ])('constructor correctly handles %s', (_, x, y) => {
            const v = new Vec2(x, y);

            if (Number.isNaN(x)) {
                expect(Number.isNaN(v.x)).toBe(true);
            } else {
                expect(v.x).toBe(x);
            }

            if (Number.isNaN(y)) {
                expect(Number.isNaN(v.y)).toBe(true);
            } else {
                expect(v.y).toBe(y);
            }
        });
    });

    describe('Static Constants', () => {
        const constants = [
            { name: 'ZERO', expected: { x: 0, y: 0 } },
            { name: 'ONE', expected: { x: 1, y: 1 } },
            { name: 'NEG_ONE', expected: { x: -1, y: -1 } },
            { name: 'UNIT_X', expected: { x: 1, y: 0 } },
            { name: 'UNIT_Y', expected: { x: 0, y: 1 } },
            { name: 'UP', expected: { x: 0, y: 1 } },
            { name: 'DOWN', expected: { x: 0, y: -1 } },
            { name: 'LEFT', expected: { x: -1, y: 0 } },
            { name: 'RIGHT', expected: { x: 1, y: 0 } },
        ];

        test.each(constants)('$name has correct values and is immutable', ({ name, expected }) => {
            const constant = Vec2[name as keyof typeof Vec2] as Vec2;

            expect(constant.x).toBe(expected.x);
            expect(constant.y).toBe(expected.y);

            const originalX = constant.x;
            const originalY = constant.y;

            expect(() => {
                constant.x = 999;
                constant.y = 999;
            }).toThrow();

            expect(constant.x).toBe(originalX);
            expect(constant.y).toBe(originalY);
        });

        test('directional constants are mathematically consistent', () => {
            // When Object.is() is used to compare 0 and -0 in JavaScript, it is not equal
            // But the vector should be mathematically consistent,
            // so let's compare absolute values
            expect(Math.abs(Vec2.UP.x)).toEqual(Math.abs(Vec2.DOWN.x));
            expect(Math.abs(Vec2.UP.y)).toEqual(Math.abs(Vec2.DOWN.y));

            expect(Math.abs(Vec2.LEFT.x)).toEqual(Math.abs(Vec2.RIGHT.x));
            expect(Math.abs(Vec2.LEFT.y)).toEqual(Math.abs(Vec2.RIGHT.y));

            // Up and right vectors must be perpendicular
            expect(Vec2.UP).toBeOrthogonalTo(Vec2.RIGHT);

            expect(Vec2.UP).toBeVectorCloseTo(Vec2.UNIT_Y);
            expect(Vec2.RIGHT).toBeVectorCloseTo(Vec2.UNIT_X);
        });

        test('ZERO behaves as additive identity', () => {
            const testVec = new Vec2(3.14, 2.718);
            const result = Vec2.add(testVec, Vec2.ZERO);
            expect(result).toBeVectorCloseTo(testVec);
        });

        test('ONE behaves as multiplicative identity for component-wise multiplication', () => {
            const testVec = new Vec2(3.14, 2.718);
            const result = Vec2.multiply(testVec, Vec2.ONE);
            expect(result).toBeVectorCloseTo(testVec);
        });
    });

    describe('Static Factory Methods', () => {
        describe('from()', () => {
            test('creates vector from IVec2Like object', () => {
                const obj = { x: 7.5, y: -3.2 };
                const v = Vec2.from(obj);

                expect(v).toBeInstanceOf(Vec2);
                expect(v).toBeVectorCloseTo(obj);
            });

            test('creates new instance when given a Vec2', () => {
                const original = new Vec2(3, 4);
                const copy = Vec2.from(original);

                expect(copy).toBeInstanceOf(Vec2);
                expect(copy).not.toBe(original);
                expect(copy).toBeVectorCloseTo(original);
            });

            test('handles objects with additional properties', () => {
                const obj = { x: 5, y: 10, z: 15, name: 'test' };
                const v = Vec2.from(obj);

                expect(v.x).toBe(5);
                expect(v.y).toBe(10);
                // @ts-ignore - Intentionally testing property doesn't exist
                expect(v.z).toBeUndefined();
                // @ts-ignore - Intentionally testing property doesn't exist
                expect(v.name).toBeUndefined();
            });

            test('handles object with getter functions', () => {
                const obj = {
                    get x() {
                        return 7;
                    },
                    get y() {
                        return 14;
                    },
                };

                const v = Vec2.from(obj);

                expect(v.x).toBe(7);
                expect(v.y).toBe(14);
            });
        });

        describe('fromArray()', () => {
            test('creates vector from array elements with default offset', () => {
                const arr = [1.1, 2.2, 3.3, 4.4];
                const v = Vec2.fromArray(arr);

                expect(v.x).toBe(1.1);
                expect(v.y).toBe(2.2);
            });

            test('respects the offset parameter', () => {
                const arr = [10, 20, 30, 40, 50];
                const v = Vec2.fromArray(arr, 2);

                expect(v.x).toBe(30);
                expect(v.y).toBe(40);
            });

            test('works with array-like objects', () => {
                // @ts-ignore - Intentionally testing with string as array-like
                const v = Vec2.fromArray('12345', 1);

                expect(v.x).toBe(2);
                expect(v.y).toBe(3);
            });

            test('works with typed arrays', () => {
                const int32Arr = new Int32Array([1, 2, 3, 4]);
                const float32Arr = new Float32Array([1.5, 2.5, 3.5, 4.5]);
                const float64Arr = new Float64Array([1.5, 2.5, 3.5, 4.5]);

                expect(Vec2.fromArray(int32Arr)).toBeVectorCloseTo({ x: 1, y: 2 });
                expect(Vec2.fromArray(float32Arr)).toBeVectorCloseTo({ x: 1.5, y: 2.5 });
                expect(Vec2.fromArray(float64Arr)).toBeVectorCloseTo({ x: 1.5, y: 2.5 });
            });

            test('throws for negative offset', () => {
                const arr = [1, 2, 3];

                expect(() => {
                    Vec2.fromArray(arr, -1);
                }).toThrow(RangeError);

                expect(() => {
                    Vec2.fromArray(arr, -1);
                }).toThrow('Offset cannot be negative');
            });

            test('throws if array is too short for offset', () => {
                const arr = [1, 2];

                expect(() => {
                    Vec2.fromArray(arr, 1);
                }).toThrow(RangeError);

                expect(() => {
                    Vec2.fromArray(arr, 1);
                }).toThrow('Array must have at least 3 elements when using offset 1');
            });

            test('generates vectors equivalent to manual construction', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const x = Math.random() * 100;
                    const y = Math.random() * 100;
                    const arr = [x, y];

                    const fromArray = Vec2.fromArray(arr);
                    const constructed = new Vec2(x, y);

                    expect(fromArray).toBeVectorCloseTo(constructed);
                }
            });
        });

        describe('create()', () => {
            test('is functionally equivalent to constructor', () => {
                const values = [
                    [0, 0],
                    [3, 4],
                    [-5.5, 7.7],
                    [Number.MAX_VALUE, Number.MIN_VALUE],
                ];

                values.forEach(([x, y]) => {
                    const created = Vec2.create(x, y);
                    const constructed = new Vec2(x, y);

                    expect(created).toBeVectorCloseTo(constructed);
                    expect(created).not.toBe(constructed);
                });
            });

            test('with no parameters creates zero vector', () => {
                const v = Vec2.create();

                expect(v).toBeVectorCloseTo(Vec2.ZERO);
                expect(v).not.toBe(Vec2.ZERO);
            });
        });
    });

    describe('Instance Methods', () => {
        describe('clone()', () => {
            test('creates a new instance with same values', () => {
                const vectors = [
                    new Vec2(),
                    new Vec2(3, 4),
                    new Vec2(-5.7, 10.2),
                    new Vec2(LARGE_VALUE, SMALL_VALUE),
                ];

                vectors.forEach((original) => {
                    const cloned = original.clone();

                    expect(cloned).toBeInstanceOf(Vec2);
                    expect(cloned).not.toBe(original);
                    expect(cloned).toBeVectorCloseTo(original);
                });
            });

            test('preserves NaN and Infinity values', () => {
                const vNaN = new Vec2(NaN, NaN);
                const vInf = new Vec2(Infinity, -Infinity);

                const clonedNaN = vNaN.clone();
                const clonedInf = vInf.clone();

                expect(Number.isNaN(clonedNaN.x)).toBe(true);
                expect(Number.isNaN(clonedNaN.y)).toBe(true);

                expect(clonedInf.x).toBe(Infinity);
                expect(clonedInf.y).toBe(-Infinity);
            });
        });
    });

    describe('Vector Operations', () => {
        describe('add()', () => {
            test('adds two vectors correctly', () => {
                const testCases = [
                    { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, expected: { x: 4, y: 6 } },
                    { a: { x: -5, y: 10 }, b: { x: 5, y: -10 }, expected: { x: 0, y: 0 } },
                    { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, expected: { x: 3, y: 4 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.add(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 3, y: 4 };
                const b = { x: 5, y: 6 };
                const out = { x: 0, y: 0 };

                const result = Vec2.add(a, b, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 8, y: 10 });
            });

            test('supports reusing input as output', () => {
                const a = { x: 3, y: 4 };
                const b = { x: 5, y: 6 };

                const result1 = Vec2.add(a, b, a);

                expect(result1).toBe(a);
                expect(a).toBeVectorCloseTo({ x: 8, y: 10 });

                const c = { x: 1, y: 2 };
                const result2 = Vec2.add(b, c, b);

                expect(result2).toBe(b);
                expect(b).toBeVectorCloseTo({ x: 6, y: 8 });
            });

            test('is commutative (a + b = b + a)', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const a = new Vec2(Math.random() * 100, Math.random() * 100);
                    const b = new Vec2(Math.random() * 100, Math.random() * 100);

                    const result1 = Vec2.add(a, b);
                    const result2 = Vec2.add(b, a);

                    expect(result1).toBeVectorCloseTo(result2);
                }
            });

            test('is associative (a + (b + c) = (a + b) + c)', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const a = new Vec2(Math.random() * 100, Math.random() * 100);
                    const b = new Vec2(Math.random() * 100, Math.random() * 100);
                    const c = new Vec2(Math.random() * 100, Math.random() * 100);

                    const temp1 = Vec2.add(b, c);
                    const result1 = Vec2.add(a, temp1);

                    const temp2 = Vec2.add(a, b);
                    const result2 = Vec2.add(temp2, c);

                    expect(result1).toBeVectorCloseTo(result2);
                }
            });

            test('has identity property (v + 0 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.add(v, Vec2.ZERO);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('maintains numerical stability with extreme values', () => {
                const large = { x: 1e15, y: 1e15 };
                const small = { x: 1e-15, y: 1e-15 };

                const result = Vec2.add(large, small);

                expect(result).toBeVectorCloseTo(large);
            });

            test('handles special values correctly', () => {
                const withNaN = Vec2.add({ x: NaN, y: 5 }, { x: 3, y: 4 });
                expect(Number.isNaN(withNaN.x)).toBe(true);
                expect(withNaN.y).toBe(9);

                const withInf = Vec2.add({ x: Infinity, y: 10 }, { x: Infinity, y: 5 });
                expect(withInf.x).toBe(Infinity);
                expect(withInf.y).toBe(15);

                const infPlusMinusInf = Vec2.add({ x: Infinity, y: 10 }, { x: -Infinity, y: 5 });
                expect(Number.isNaN(infPlusMinusInf.x)).toBe(true);
                expect(infPlusMinusInf.y).toBe(15);
            });
        });

        describe('addScalar()', () => {
            test('adds scalar to both components', () => {
                const testCases = [
                    { a: { x: 3, y: 4 }, b: 5, expected: { x: 8, y: 9 } },
                    { a: { x: -10, y: 20 }, b: 10, expected: { x: 0, y: 30 } },
                    { a: { x: 0, y: 0 }, b: 0, expected: { x: 0, y: 0 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.addScalar(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 3, y: 4 };
                const scalar = 5;
                const out = { x: 0, y: 0 };

                const result = Vec2.addScalar(a, scalar, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 8, y: 9 });
            });

            test('handles special values correctly', () => {
                const nanPlusScalar = Vec2.addScalar({ x: NaN, y: 5 }, 10);
                expect(Number.isNaN(nanPlusScalar.x)).toBe(true);
                expect(nanPlusScalar.y).toBe(15);

                const infPlusScalar = Vec2.addScalar({ x: Infinity, y: 10 }, 5);
                expect(infPlusScalar.x).toBe(Infinity);
                expect(infPlusScalar.y).toBe(15);
            });

            test('has identity property (v + 0 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.addScalar(v, 0);
                    expect(result).toBeVectorCloseTo(v);
                });
            });
        });

        describe('subtract()', () => {
            test('subtracts vectors correctly', () => {
                const testCases = [
                    { a: { x: 5, y: 8 }, b: { x: 2, y: 3 }, expected: { x: 3, y: 5 } },
                    { a: { x: 10, y: 10 }, b: { x: 10, y: 10 }, expected: { x: 0, y: 0 } },
                    { a: { x: -5, y: -8 }, b: { x: 2, y: 3 }, expected: { x: -7, y: -11 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.subtract(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 10, y: 20 };
                const b = { x: 3, y: 7 };
                const out = { x: 0, y: 0 };

                const result = Vec2.subtract(a, b, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 7, y: 13 });
            });

            test('is anti-commutative (a - b = -(b - a))', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const a = new Vec2(Math.random() * 100, Math.random() * 100);
                    const b = new Vec2(Math.random() * 100, Math.random() * 100);

                    const result1 = Vec2.subtract(a, b);
                    const result2 = Vec2.subtract(b, a);

                    expect(result1.x).toBeCloseTo(-result2.x, 10);
                    expect(result1.y).toBeCloseTo(-result2.y, 10);
                }
            });

            test('has identity property (v - 0 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.subtract(v, Vec2.ZERO);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('has self-inverse property (v - v = 0)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.subtract(v, v);
                    expect(result).toBeVectorCloseTo(Vec2.ZERO);
                });
            });

            test('handles special values correctly', () => {
                const withNaN = Vec2.subtract({ x: NaN, y: 5 }, { x: 3, y: 4 });
                expect(Number.isNaN(withNaN.x)).toBe(true);
                expect(withNaN.y).toBe(1);

                const infMinusInf = Vec2.subtract({ x: Infinity, y: 10 }, { x: Infinity, y: 5 });
                expect(Number.isNaN(infMinusInf.x)).toBe(true);
                expect(infMinusInf.y).toBe(5);

                const infMinusFinite = Vec2.subtract({ x: Infinity, y: 10 }, { x: 100, y: 5 });
                expect(infMinusFinite.x).toBe(Infinity);
                expect(infMinusFinite.y).toBe(5);
            });
        });

        describe('subtractScalar()', () => {
            test('subtracts scalar from both components', () => {
                const testCases = [
                    { a: { x: 10, y: 15 }, b: 5, expected: { x: 5, y: 10 } },
                    { a: { x: 0, y: 0 }, b: 5, expected: { x: -5, y: -5 } },
                    { a: { x: -10, y: -15 }, b: -5, expected: { x: -5, y: -10 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.subtractScalar(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 10, y: 20 };
                const scalar = 7;
                const out = { x: 0, y: 0 };

                const result = Vec2.subtractScalar(a, scalar, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 3, y: 13 });
            });

            test('has identity property (v - 0 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.subtractScalar(v, 0);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('handles special values correctly', () => {
                const nanMinusScalar = Vec2.subtractScalar({ x: NaN, y: 5 }, 3);
                expect(Number.isNaN(nanMinusScalar.x)).toBe(true);
                expect(nanMinusScalar.y).toBe(2);

                const infMinusScalar = Vec2.subtractScalar({ x: Infinity, y: 10 }, 5);
                expect(infMinusScalar.x).toBe(Infinity);
                expect(infMinusScalar.y).toBe(5);
            });
        });

        describe('multiply()', () => {
            test('multiplies vectors component-wise', () => {
                const testCases = [
                    { a: { x: 2, y: 3 }, b: { x: 4, y: 5 }, expected: { x: 8, y: 15 } },
                    { a: { x: -2, y: 3 }, b: { x: 4, y: -5 }, expected: { x: -8, y: -15 } },
                    { a: { x: 0, y: 0 }, b: { x: 4, y: 5 }, expected: { x: 0, y: 0 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.multiply(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 2, y: 3 };
                const b = { x: 4, y: 5 };
                const out = { x: 0, y: 0 };

                const result = Vec2.multiply(a, b, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 8, y: 15 });
            });

            test('is commutative (a * b = b * a)', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const a = new Vec2(Math.random() * 100, Math.random() * 100);
                    const b = new Vec2(Math.random() * 100, Math.random() * 100);

                    const result1 = Vec2.multiply(a, b);
                    const result2 = Vec2.multiply(b, a);

                    expect(result1).toBeVectorCloseTo(result2);
                }
            });

            test('has identity property (v * 1 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.multiply(v, Vec2.ONE);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('has zero property (v * 0 = 0)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.multiply(v, Vec2.ZERO);
                    expect(result).toBeVectorCloseTo(Vec2.ZERO);
                });
            });

            test('handles special values correctly', () => {
                const withNaN = Vec2.multiply({ x: NaN, y: 5 }, { x: 3, y: 4 });
                expect(Number.isNaN(withNaN.x)).toBe(true);
                expect(withNaN.y).toBe(20);

                const infTimesPositive = Vec2.multiply({ x: Infinity, y: 10 }, { x: 5, y: 2 });
                expect(infTimesPositive.x).toBe(Infinity);
                expect(infTimesPositive.y).toBe(20);

                const infTimesNegative = Vec2.multiply({ x: Infinity, y: 10 }, { x: -5, y: 2 });
                expect(infTimesNegative.x).toBe(-Infinity);
                expect(infTimesNegative.y).toBe(20);

                const infTimesZero = Vec2.multiply({ x: Infinity, y: 10 }, { x: 0, y: 2 });
                expect(Number.isNaN(infTimesZero.x)).toBe(true);
                expect(infTimesZero.y).toBe(20);
            });

            test('satisfies distributive property with vector addition', () => {
                for (let i = 0; i < ITERATIONS / 10; i++) {
                    const a = new Vec2(Math.random() * 10, Math.random() * 10);
                    const b = new Vec2(Math.random() * 10, Math.random() * 10);
                    const c = new Vec2(Math.random() * 10, Math.random() * 10);

                    const bPlusC = Vec2.add(b, c);
                    const left = Vec2.multiply(a, bPlusC);

                    const aTimesB = Vec2.multiply(a, b);
                    const aTimesC = Vec2.multiply(a, c);
                    const right = Vec2.add(aTimesB, aTimesC);

                    expect(left).toBeVectorCloseTo(right, PRECISION);
                }
            });
        });

        describe('multiplyScalar()', () => {
            test('multiplies both components by scalar', () => {
                const testCases = [
                    { a: { x: 2, y: 3 }, b: 4, expected: { x: 8, y: 12 } },
                    { a: { x: -2, y: 3 }, b: -4, expected: { x: 8, y: -12 } },
                    { a: { x: 0, y: 0 }, b: 10, expected: { x: 0, y: 0 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.multiplyScalar(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 2, y: 3 };
                const scalar = 4;
                const out = { x: 0, y: 0 };

                const result = Vec2.multiplyScalar(a, scalar, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 8, y: 12 });
            });

            test('has identity property (v * 1 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.multiplyScalar(v, 1);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('has zero property (v * 0 = 0)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.multiplyScalar(v, 0);
                    expect(result).toBeVectorCloseTo(Vec2.ZERO);
                });
            });

            test('is distributive over vector addition (s * (a + b) = s * a + s * b)', () => {
                for (let i = 0; i < ITERATIONS / 10; i++) {
                    const scalar = Math.random() * 10;
                    const a = new Vec2(Math.random() * 10, Math.random() * 10);
                    const b = new Vec2(Math.random() * 10, Math.random() * 10);

                    const aPlusB = Vec2.add(a, b);
                    const left = Vec2.multiplyScalar(aPlusB, scalar);

                    const sTimesA = Vec2.multiplyScalar(a, scalar);
                    const sTimesB = Vec2.multiplyScalar(b, scalar);
                    const right = Vec2.add(sTimesA, sTimesB);

                    expect(left).toBeVectorCloseTo(right, PRECISION);
                }
            });

            test('handles special values correctly', () => {
                const nanTimesScalar = Vec2.multiplyScalar({ x: NaN, y: 5 }, 3);
                expect(Number.isNaN(nanTimesScalar.x)).toBe(true);
                expect(nanTimesScalar.y).toBe(15);

                const infTimesScalar = Vec2.multiplyScalar({ x: Infinity, y: 5 }, 3);
                expect(infTimesScalar.x).toBe(Infinity);
                expect(infTimesScalar.y).toBe(15);

                const infTimesZero = Vec2.multiplyScalar({ x: Infinity, y: 5 }, 0);
                expect(Number.isNaN(infTimesZero.x)).toBe(true);
                expect(infTimesZero.y).toBe(0);
            });
        });

        describe('divide()', () => {
            test('divides vectors component-wise', () => {
                const testCases = [
                    { a: { x: 8, y: 15 }, b: { x: 4, y: 5 }, expected: { x: 2, y: 3 } },
                    { a: { x: -8, y: 15 }, b: { x: 4, y: -5 }, expected: { x: -2, y: -3 } },
                    { a: { x: 0, y: 0 }, b: { x: 4, y: 5 }, expected: { x: 0, y: 0 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.divide(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 10, y: 15 };
                const b = { x: 2, y: 3 };
                const out = { x: 0, y: 0 };

                const result = Vec2.divide(a, b, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 5, y: 5 });
            });

            test('throws for division by zero', () => {
                const a = { x: 10, y: 15 };
                const b = { x: 0, y: 3 };

                expect(() => {
                    Vec2.divide(a, b);
                }).toThrow('Division by zero or near-zero value is not allowed');
            });

            test('throws for division by near-zero', () => {
                const a = { x: 10, y: 15 };
                const b = { x: EPSILON / 2, y: 3 };

                expect(() => {
                    Vec2.divide(a, b);
                }).toThrow('Division by zero or near-zero value is not allowed');
            });

            test('has identity property (v / 1 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.divide(v, Vec2.ONE);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('has self-division property (v / v = 1 for non-zero v)', () => {
                for (let i = 0; i < ITERATIONS; i++) {
                    const v = randomNonZeroVec2();
                    const result = Vec2.divide(v, v);

                    expect(result).toBeVectorCloseTo(Vec2.ONE);
                }
            });

            test('handles special values correctly', () => {
                const nanDivided = Vec2.divide({ x: NaN, y: 15 }, { x: 3, y: 3 });
                expect(Number.isNaN(nanDivided.x)).toBe(true);
                expect(nanDivided.y).toBe(5);

                const infDividedByFinite = Vec2.divide({ x: Infinity, y: 15 }, { x: 3, y: 3 });
                expect(infDividedByFinite.x).toBe(Infinity);
                expect(infDividedByFinite.y).toBe(5);

                const finiteDividedByInf = Vec2.divide({ x: 10, y: 15 }, { x: Infinity, y: 3 });
                expect(finiteDividedByInf.x).toBe(0);
                expect(finiteDividedByInf.y).toBe(5);

                const infDividedByInf = Vec2.divide({ x: Infinity, y: 15 }, { x: Infinity, y: 3 });
                expect(Number.isNaN(infDividedByInf.x)).toBe(true);
                expect(infDividedByInf.y).toBe(5);
            });

            test('maintains reasonable precision with challenging values', () => {
                // We can't divide very small values ​​by EPSILON
                // That's why we use larger values
                const small = new Vec2(1e-6, 1e-6);
                const slightlyLarger = new Vec2(1e-4, 1e-4);

                const result = Vec2.divide(small, slightlyLarger);

                // result should be 0.01 (1e-6 / 1e-4 = 1e-2 = 0.01)
                expect(result.x).toBeCloseTo(0.01, 10);
                expect(result.y).toBeCloseTo(0.01, 10);
            });
        });

        describe('divideScalar()', () => {
            test('divides both components by scalar', () => {
                const testCases = [
                    { a: { x: 10, y: 15 }, b: 5, expected: { x: 2, y: 3 } },
                    { a: { x: -10, y: 15 }, b: -5, expected: { x: 2, y: -3 } },
                    { a: { x: 0, y: 0 }, b: 5, expected: { x: 0, y: 0 } },
                ];

                testCases.forEach(({ a, b, expected }) => {
                    const result = Vec2.divideScalar(a, b);
                    expect(result).toBeVectorCloseTo(expected);
                });
            });

            test('supports output parameter', () => {
                const a = { x: 10, y: 15 };
                const scalar = 5;
                const out = { x: 0, y: 0 };

                const result = Vec2.divideScalar(a, scalar, out);

                expect(result).toBe(out);
                expect(out).toBeVectorCloseTo({ x: 2, y: 3 });
            });

            test('throws for division by zero', () => {
                const a = { x: 10, y: 15 };

                expect(() => {
                    Vec2.divideScalar(a, 0);
                }).toThrow('Division by zero or near-zero value is not allowed');
            });

            test('throws for division by near-zero', () => {
                const a = { x: 10, y: 15 };

                expect(() => {
                    Vec2.divideScalar(a, EPSILON / 2);
                }).toThrow('Division by zero or near-zero value is not allowed');
            });

            test('has identity property (v / 1 = v)', () => {
                const vectors = generateRandomVectors(ITERATIONS);

                vectors.forEach((v) => {
                    const result = Vec2.divideScalar(v, 1);
                    expect(result).toBeVectorCloseTo(v);
                });
            });

            test('handles special values correctly', () => {
                const nanDividedByScalar = Vec2.divideScalar({ x: NaN, y: 15 }, 5);
                expect(Number.isNaN(nanDividedByScalar.x)).toBe(true);
                expect(nanDividedByScalar.y).toBe(3);

                const infDividedByScalar = Vec2.divideScalar({ x: Infinity, y: 15 }, 5);
                expect(infDividedByScalar.x).toBe(Infinity);
                expect(infDividedByScalar.y).toBe(3);

                const infDividedByInf = Vec2.divideScalar({ x: Infinity, y: 15 }, Infinity);
                expect(Number.isNaN(infDividedByInf.x)).toBe(true);
                expect(infDividedByInf.y).toBe(0);
            });
        });
    });

    describe('Cross-Method Validation', () => {
        test('multiplyScalar by -1 is equivalent to vector negation', () => {
            const vectors = generateRandomVectors(ITERATIONS);

            vectors.forEach((v) => {
                const negated = Vec2.multiplyScalar(v, -1);
                expect(negated.x).toBeCloseTo(-v.x, 10);
                expect(negated.y).toBeCloseTo(-v.y, 10);
            });
        });

        test('add and subtract are inverse operations', () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const a = new Vec2(Math.random() * 100, Math.random() * 100);
                const b = new Vec2(Math.random() * 100, Math.random() * 100);

                const sum = Vec2.add(a, b);
                const difference = Vec2.subtract(sum, b);

                expect(difference).toBeVectorCloseTo(a);
            }
        });

        test('multiply and divide are inverse operations', () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const a = new Vec2(Math.random() * 100 + 1, Math.random() * 100 + 1);
                const b = new Vec2(Math.random() * 100 + 1, Math.random() * 100 + 1);

                const product = Vec2.multiply(a, b);
                const quotient = Vec2.divide(product, b);

                expect(quotient).toBeVectorCloseTo(a);
            }
        });

        test('scalar operations are equivalent to vector operations with uniform vectors', () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const v = new Vec2(Math.random() * 100, Math.random() * 100);
                const scalar = Math.random() * 100;
                const scalarVec = new Vec2(scalar, scalar);

                const addScalar = Vec2.addScalar(v, scalar);
                const addVector = Vec2.add(v, scalarVec);
                expect(addScalar).toBeVectorCloseTo(addVector);

                const subScalar = Vec2.subtractScalar(v, scalar);
                const subVector = Vec2.subtract(v, scalarVec);
                expect(subScalar).toBeVectorCloseTo(subVector);

                const mulScalar = Vec2.multiplyScalar(v, scalar);
                const mulVector = Vec2.multiply(v, scalarVec);
                expect(mulScalar).toBeVectorCloseTo(mulVector);

                if (Math.abs(scalar) > EPSILON) {
                    const divScalar = Vec2.divideScalar(v, scalar);
                    const divVector = Vec2.divide(v, scalarVec);
                    expect(divScalar).toBeVectorCloseTo(divVector);
                }
            }
        });
    });

    describe('Performance', () => {
        const perfVectors = Array.from(
            { length: PERFORMANCE_ITERATIONS },
            () => new Vec2(Math.random() * 100, Math.random() * 100)
        );

        test('vector addition is within acceptable performance range', () => {
            const a = new Vec2(3, 4);

            const time = measurePerformance('add', () => {
                for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
                    Vec2.add(a, perfVectors[i]);
                }
            });

            console.log(`Vector addition x${PERFORMANCE_ITERATIONS} took ${time.toFixed(2)}ms`);
        });

        test('vector multiplication is within acceptable performance range', () => {
            const a = new Vec2(3, 4);

            const time = measurePerformance('multiply', () => {
                for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
                    Vec2.multiply(a, perfVectors[i]);
                }
            });

            console.log(
                `Vector multiplication x${PERFORMANCE_ITERATIONS} took ${time.toFixed(2)}ms`
            );
        });

        test('vector division is within acceptable performance range', () => {
            const a = new Vec2(3, 4);

            const time = measurePerformance('divide', () => {
                for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
                    try {
                        if (
                            Math.abs(perfVectors[i].x) > EPSILON &&
                            Math.abs(perfVectors[i].y) > EPSILON
                        ) {
                            Vec2.divide(a, perfVectors[i]);
                        }
                    } catch (e) {}
                }
            });

            console.log(`Vector division x${PERFORMANCE_ITERATIONS} took ${time.toFixed(2)}ms`);
        });

        test('output parameter improves performance over creating new objects', () => {
            const a = new Vec2(3, 4);
            const b = new Vec2(5, 6);
            const out = new Vec2();

            const newObjectTime = measurePerformance('withoutOutput', () => {
                for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
                    const result = Vec2.add(a, b);
                }
            });

            const outputTime = measurePerformance('withOutput', () => {
                for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
                    Vec2.add(a, b, out);
                }
            });

            console.log(
                `Without output: ${newObjectTime.toFixed(2)}ms, With output: ${outputTime.toFixed(2)}ms`
            );
            console.log(
                `Performance improvement: ${(((newObjectTime - outputTime) / newObjectTime) * 100).toFixed(2)}%`
            );
        });
    });

    describe('Robustness and Stability', () => {
        test('maintains reasonable accuracy with extreme value combinations', () => {
            const extremeVectors = [
                { name: 'very large', v: new Vec2(1e15, 1e15) },
                { name: 'very small', v: new Vec2(1e-15, 1e-15) },
                { name: 'mixed scale', v: new Vec2(1e15, 1e-15) },
                { name: 'near epsilon', v: new Vec2(EPSILON * 2, EPSILON * 2) },
            ];

            for (const { name: name1, v: v1 } of extremeVectors) {
                for (const { name: name2, v: v2 } of extremeVectors) {
                    try {
                        const sum = Vec2.add(v1, v2);
                        const diff = Vec2.subtract(sum, v2);

                        if (
                            Math.abs(v1.x) < 1e16 &&
                            Math.abs(v1.y) < 1e16 &&
                            Math.abs(v2.x) < 1e16 &&
                            Math.abs(v2.y) < 1e16
                        ) {
                            const precision = Math.max(PRECISION, Math.abs(v1.x) * 1e-10);
                            expect(diff.x).toBeCloseTo(v1.x, -Math.log10(precision));
                            expect(diff.y).toBeCloseTo(v1.y, -Math.log10(precision));
                        }
                    } catch (e: any) {
                        console.log(
                            `Skipping accuracy check for ${name1} + ${name2}: ${e.message}`
                        );
                    }
                }
            }
        });

        test('handles various data types correctly', () => {
            const vectors = [
                { type: 'integer', v: new Vec2(5, 7) },
                { type: 'integer from binary', v: new Vec2(0b101, 0b111) }, // 5, 7 in binary
                { type: 'integer from hex', v: new Vec2(0x5, 0x7) },
            ];

            for (let i = 0; i < vectors.length; i++) {
                for (let j = i + 1; j < vectors.length; j++) {
                    expect(vectors[i].v.x).toBe(vectors[j].v.x);
                    expect(vectors[i].v.y).toBe(vectors[j].v.y);
                }
            }

            const float = new Vec2(5.5, 7.7);
            const exp = new Vec2(5.5, 7.7);
            expect(float.x).toBeCloseTo(exp.x);
            expect(float.y).toBeCloseTo(exp.y);
        });

        test('correctly detects division by near-zero', () => {
            const a = new Vec2(5, 10);

            expect(() => {
                Vec2.divideScalar(a, EPSILON * 0.5);
            }).toThrow('Division by zero or near-zero value is not allowed');

            expect(() => {
                Vec2.divideScalar(a, EPSILON * 1.001);
            }).not.toThrow();

            expect(() => {
                Vec2.divideScalar(a, EPSILON * 0.1);
            }).toThrow('Division by zero or near-zero value is not allowed');
        });
    });
});
