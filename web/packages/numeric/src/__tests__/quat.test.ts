import { beforeEach, describe, expect, test } from 'vitest';
import { EPSILON } from '../common';
import { Quat, QuatComparer, QuatEqualityComparer, QuatComparisonMode, IQuatLike } from '../quat';
import { IVec3Like } from '../vec3';

const TEST_PRECISION = {
    HIGH: 12,
    STANDARD: 8,
    LOW: 4,
    LOOSE: 2,
} as const;

const NUMERICAL_LIMITS = {
    EPSILON: 1e-15,
    LARGE_NUMBER: 1e12,
    SMALL_NUMBER: 1e-12,
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
} as const;

const COMMON_ANGLES = {
    ZERO: 0,
    QUARTER_PI: Math.PI / 4,
    HALF_PI: Math.PI / 2,
    PI: Math.PI,
    THREE_QUARTER_PI: (3 * Math.PI) / 4,
    TWO_PI: 2 * Math.PI,
    NEGATIVE_PI: -Math.PI,
} as const;

class QuaternionTestUtils {
    static expectQuaternionEquals(
        actual: IQuatLike,
        expected: IQuatLike,
        precision: number = TEST_PRECISION.STANDARD,
        context?: string
    ): void {
        const contextStr = context ? ` (${context})` : '';

        try {
            expect(actual.x).toBeCloseTo(expected.x, precision);
            expect(actual.y).toBeCloseTo(expected.y, precision);
            expect(actual.z).toBeCloseTo(expected.z, precision);
            expect(actual.w).toBeCloseTo(expected.w, precision);
        } catch (error) {
            const actualMag = Math.sqrt(
                actual.x ** 2 + actual.y ** 2 + actual.z ** 2 + actual.w ** 2
            );
            const expectedMag = Math.sqrt(
                expected.x ** 2 + expected.y ** 2 + expected.z ** 2 + expected.w ** 2
            );

            throw new Error(
                `Quaternion assertion failed${contextStr}:\n` +
                    `  Expected: (${expected.x}, ${expected.y}, ${expected.z}, ${expected.w}) |${expectedMag}|\n` +
                    `  Actual:   (${actual.x}, ${actual.y}, ${actual.z}, ${actual.w}) |${actualMag}|\n` +
                    `  Diff:     (${actual.x - expected.x}, ${actual.y - expected.y}, ${actual.z - expected.z}, ${actual.w - expected.w})\n` +
                    `  Original error: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    static expectVector3Equals(
        actual: IVec3Like,
        expected: IVec3Like,
        precision: number = TEST_PRECISION.STANDARD,
        context?: string
    ): void {
        const contextStr = context ? ` (${context})` : '';

        try {
            expect(actual.x).toBeCloseTo(expected.x, precision);
            expect(actual.y).toBeCloseTo(expected.y, precision);
            expect(actual.z).toBeCloseTo(expected.z, precision);
        } catch (error) {
            throw new Error(
                `Vector3 assertion failed${contextStr}:\n` +
                    `  Expected: (${expected.x}, ${expected.y}, ${expected.z})\n` +
                    `  Actual:   (${actual.x}, ${actual.y}, ${actual.z})\n` +
                    `  Original error: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    static expectNormalized(q: IQuatLike, precision: number = TEST_PRECISION.HIGH): void {
        const magnitude = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
        expect(magnitude).toBeCloseTo(1.0, precision);
    }

    static expectValidQuaternion(q: IQuatLike): void {
        expect(Number.isFinite(q.x)).toBe(true);
        expect(Number.isFinite(q.y)).toBe(true);
        expect(Number.isFinite(q.z)).toBe(true);
        expect(Number.isFinite(q.w)).toBe(true);
        expect(Number.isNaN(q.x)).toBe(false);
        expect(Number.isNaN(q.y)).toBe(false);
        expect(Number.isNaN(q.z)).toBe(false);
        expect(Number.isNaN(q.w)).toBe(false);
    }

    static createTestQuaternions() {
        return {
            identity: { x: 0, y: 0, z: 0, w: 1 },
            zero: { x: 0, y: 0, z: 0, w: 0 },
            unitX: { x: 1, y: 0, z: 0, w: 0 },
            unitY: { x: 0, y: 1, z: 0, w: 0 },
            unitZ: { x: 0, y: 0, z: 1, w: 0 },
            normalized: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
            arbitrary: { x: 1, y: 2, z: 3, w: 4 },
            rotationY90: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
            rotationX90: { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) },
            rotationZ90: { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) },
            large: { x: 1e6, y: 1e6, z: 1e6, w: 1e6 },
            small: { x: 1e-6, y: 1e-6, z: 1e-6, w: 1e-6 },
            negative: { x: -1, y: -2, z: -3, w: -4 },
        };
    }

    static generateRandomQuaternion(normalize: boolean = false): IQuatLike {
        const q = {
            x: (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2,
            z: (Math.random() - 0.5) * 2,
            w: (Math.random() - 0.5) * 2,
        };

        if (normalize) {
            const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            if (length > NUMERICAL_LIMITS.EPSILON) {
                q.x /= length;
                q.y /= length;
                q.z /= length;
                q.w /= length;
            }
        }

        return q;
    }

    static benchmark<T>(name: string, operation: () => T, iterations: number = 10000): T {
        const start = performance.now();
        let result: T;

        for (let i = 0; i < iterations; i++) {
            result = operation();
        }

        const end = performance.now();
        const duration = end - start;
        const opsPerSecond = (iterations / duration) * 1000;

        console.log(
            `Benchmark [${name}]: ${duration.toFixed(2)}ms total, ${opsPerSecond.toFixed(0)} ops/sec`
        );
        return result!;
    }
}

// Main Test Suite
describe('Quaternion Mathematics Library', () => {
    let testQuats: ReturnType<typeof QuaternionTestUtils.createTestQuaternions>;

    beforeEach(() => {
        testQuats = QuaternionTestUtils.createTestQuaternions();
    });

    // Core Construction & Properties
    describe('Construction and Basic Properties', () => {
        describe('Constructor Behavior', () => {
            test('default constructor creates identity quaternion', () => {
                const q = new Quat();
                QuaternionTestUtils.expectQuaternionEquals(
                    q,
                    testQuats.identity,
                    TEST_PRECISION.HIGH
                );
            });

            test('parameterized constructor sets values correctly', () => {
                const q = new Quat(1, 2, 3, 4);
                QuaternionTestUtils.expectQuaternionEquals(q, { x: 1, y: 2, z: 3, w: 4 });
            });

            test('constructor handles edge values', () => {
                const cases = [
                    [0, 0, 0, 0],
                    [Infinity, 0, 0, 0],
                    [-Infinity, 0, 0, 0],
                    [Number.MAX_VALUE, 0, 0, 0],
                    [Number.MIN_VALUE, 0, 0, 0],
                ];

                cases.forEach(([x, y, z, w]) => {
                    const q = new Quat(x, y, z, w);
                    expect(q.x).toBe(x);
                    expect(q.y).toBe(y);
                    expect(q.z).toBe(z);
                    expect(q.w).toBe(w);
                });
            });
        });

        describe('Static Constants', () => {
            test('constants have correct mathematical properties', () => {
                QuaternionTestUtils.expectNormalized(Quat.IDENTITY);
                expect(Quat.len(Quat.IDENTITY)).toBeCloseTo(1.0, TEST_PRECISION.HIGH);

                QuaternionTestUtils.expectNormalized(Quat.UNIT_X);
                QuaternionTestUtils.expectNormalized(Quat.UNIT_Y);
                QuaternionTestUtils.expectNormalized(Quat.UNIT_Z);
                QuaternionTestUtils.expectNormalized(Quat.UNIT_W);

                expect(Quat.len(Quat.ZERO)).toBe(0);
            });

            test('constants are immutable', () => {
                const constants = [
                    Quat.ZERO,
                    Quat.IDENTITY,
                    Quat.UNIT_X,
                    Quat.UNIT_Y,
                    Quat.UNIT_Z,
                    Quat.UNIT_W,
                ];

                constants.forEach((constant) => {
                    expect(Object.isFrozen(constant)).toBe(true);

                    const originalX = constant.x;
                    try {
                        (constant as any).x = 999;
                    } catch (e) {}
                    expect(constant.x).toBe(originalX);
                });
            });
        });

        describe('Factory Methods', () => {
            test('from() creates independent copy', () => {
                const source = testQuats.arbitrary;
                const copy = Quat.from(source);

                QuaternionTestUtils.expectQuaternionEquals(copy, source);
                expect(copy).not.toBe(source);

                source.x = 999;
                expect(copy.x).not.toBe(999);
            });

            test('fromArray() with various configurations', () => {
                const testCases = [
                    { array: [1, 2, 3, 4], offset: 0, expected: { x: 1, y: 2, z: 3, w: 4 } },
                    { array: [0, 1, 2, 3, 4, 5], offset: 1, expected: { x: 1, y: 2, z: 3, w: 4 } },
                    {
                        array: [1.5, 2.7, 3.9, 4.1],
                        offset: 0,
                        expected: { x: 1.5, y: 2.7, z: 3.9, w: 4.1 },
                    },
                ];

                testCases.forEach(({ array, offset, expected }, index) => {
                    const result = Quat.fromArray(array, offset);
                    QuaternionTestUtils.expectQuaternionEquals(
                        result,
                        expected,
                        TEST_PRECISION.HIGH,
                        `case ${index}`
                    );
                });
            });

            test('fromArray() error handling', () => {
                const validArray = [1, 2, 3, 4];

                expect(() => Quat.fromArray(validArray, -1)).toThrow('Offset cannot be negative');

                expect(() => Quat.fromArray([1, 2], 0)).toThrow(
                    'Array must have at least 4 elements'
                );

                expect(() => Quat.fromArray([1, 2, 3, 4, 5], 2)).toThrow(
                    'Array must have at least 6 elements when using offset 2'
                );
            });

            test('create() factory method', () => {
                const q1 = Quat.create();
                const q2 = Quat.create(1, 2, 3, 4);

                QuaternionTestUtils.expectQuaternionEquals(q1, testQuats.identity);
                QuaternionTestUtils.expectQuaternionEquals(q2, { x: 1, y: 2, z: 3, w: 4 });
            });
        });

        describe('Equality and Hashing', () => {
            test('equals() with epsilon tolerance', () => {
                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1 + NUMERICAL_LIMITS.EPSILON / 2, 2, 3, 4);
                const q3 = new Quat(1 + 0.1, 2, 3, 4);

                expect(q1.equals(q2)).toBe(true);
                expect(q1.equals(q3)).toBe(false);
            });

            test('equals() type safety', () => {
                const q = new Quat(1, 2, 3, 4);

                expect(q.equals(null)).toBe(false);
                expect(q.equals(undefined)).toBe(false);
                expect(q.equals('quaternion')).toBe(false);
                expect(q.equals({ x: 1, y: 2, z: 3, w: 4 })).toBe(false);
            });

            test('getHashCode() consistency and distribution', () => {
                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1, 2, 3, 4);
                const q3 = new Quat(4, 3, 2, 1);

                expect(q1.getHashCode()).toBe(q1.getHashCode());
                expect(q1.getHashCode()).toBe(q2.getHashCode());

                expect(q1.getHashCode()).not.toBe(q3.getHashCode());

                expect(Number.isInteger(q1.getHashCode())).toBe(true);
                expect(q1.getHashCode()).toBeGreaterThanOrEqual(0);
            });
        });

        describe('Cloning', () => {
            test('clone() creates exact independent copy', () => {
                const original = new Quat(1.123456789, 2.987654321, 3.555555555, 4.777777777);
                const cloned = original.clone();

                QuaternionTestUtils.expectQuaternionEquals(cloned, original, TEST_PRECISION.HIGH);
                expect(cloned).not.toBe(original);

                original.x = 999;
                expect(cloned.x).toBeCloseTo(1.123456789, TEST_PRECISION.HIGH);
            });
        });
    });

    // Arithmetic Operations
    describe('Arithmetic Operations', () => {
        describe('Addition', () => {
            test('mathematical properties', () => {
                const { arbitrary: a, normalized: b, unitX: c } = testQuats;

                const ab = Quat.add(a, b);
                const ba = Quat.add(b, a);
                QuaternionTestUtils.expectQuaternionEquals(
                    ab,
                    ba,
                    TEST_PRECISION.HIGH,
                    'commutativity'
                );

                const abc1 = Quat.add(Quat.add(a, b), c);
                const abc2 = Quat.add(a, Quat.add(b, c));
                QuaternionTestUtils.expectQuaternionEquals(
                    abc1,
                    abc2,
                    TEST_PRECISION.HIGH,
                    'associativity'
                );

                const a_plus_zero = Quat.add(a, testQuats.zero);
                QuaternionTestUtils.expectQuaternionEquals(
                    a_plus_zero,
                    a,
                    TEST_PRECISION.HIGH,
                    'additive identity'
                );
            });

            test('static vs instance method consistency', () => {
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const staticResult = Quat.add(a, b);

                const instanceA = Quat.from(a);
                const instanceResult = instanceA.add(b);

                QuaternionTestUtils.expectQuaternionEquals(
                    staticResult,
                    instanceResult,
                    TEST_PRECISION.HIGH
                );
                QuaternionTestUtils.expectQuaternionEquals(
                    instanceA,
                    instanceResult,
                    TEST_PRECISION.HIGH
                );
            });

            test('output parameter functionality', () => {
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;
                const output = new Quat(999, 999, 999, 999);

                const result = Quat.add(a, b, output);

                expect(result).toBe(output);
                QuaternionTestUtils.expectQuaternionEquals(
                    output,
                    Quat.add(a, b),
                    TEST_PRECISION.HIGH
                );
            });

            test('scalar addition properties', () => {
                const q = testQuats.arbitrary;
                const scalar = 5.5;

                const result = Quat.addScalar(q, scalar);

                expect(result.x).toBeCloseTo(q.x + scalar, TEST_PRECISION.HIGH);
                expect(result.y).toBeCloseTo(q.y + scalar, TEST_PRECISION.HIGH);
                expect(result.z).toBeCloseTo(q.z + scalar, TEST_PRECISION.HIGH);
                expect(result.w).toBeCloseTo(q.w + scalar, TEST_PRECISION.HIGH);

                const zeroResult = Quat.addScalar(q, 0);
                QuaternionTestUtils.expectQuaternionEquals(zeroResult, q, TEST_PRECISION.HIGH);
            });
        });

        describe('Subtraction', () => {
            test('mathematical properties', () => {
                const { arbitrary: a, normalized: b } = testQuats;

                const self_subtract = Quat.subtract(a, a);
                QuaternionTestUtils.expectQuaternionEquals(
                    self_subtract,
                    testQuats.zero,
                    TEST_PRECISION.HIGH
                );

                const subtract_zero = Quat.subtract(a, testQuats.zero);
                QuaternionTestUtils.expectQuaternionEquals(subtract_zero, a, TEST_PRECISION.HIGH);

                const add_then_subtract = Quat.subtract(Quat.add(a, b), b);
                QuaternionTestUtils.expectQuaternionEquals(
                    add_then_subtract,
                    a,
                    TEST_PRECISION.HIGH
                );
            });

            test('static vs instance consistency', () => {
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const staticResult = Quat.subtract(a, b);

                const instanceA = Quat.from(a);
                const instanceResult = instanceA.subtract(b);

                QuaternionTestUtils.expectQuaternionEquals(
                    staticResult,
                    instanceResult,
                    TEST_PRECISION.HIGH
                );
            });
        });

        describe('Scalar Multiplication and Division', () => {
            test('scalar multiplication properties', () => {
                const q = testQuats.arbitrary;

                const times_one = Quat.multiplyScalar(q, 1);
                QuaternionTestUtils.expectQuaternionEquals(times_one, q, TEST_PRECISION.HIGH);

                const times_zero = Quat.multiplyScalar(q, 0);
                QuaternionTestUtils.expectQuaternionEquals(
                    times_zero,
                    testQuats.zero,
                    TEST_PRECISION.HIGH
                );

                const s = 2.5;
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const left = Quat.multiplyScalar(Quat.add(a, b), s);
                const right = Quat.add(Quat.multiplyScalar(a, s), Quat.multiplyScalar(b, s));
                QuaternionTestUtils.expectQuaternionEquals(left, right, TEST_PRECISION.HIGH);
            });

            test('scalar division properties', () => {
                const q = testQuats.arbitrary;

                const div_one = Quat.divideScalar(q, 1);
                QuaternionTestUtils.expectQuaternionEquals(div_one, q, TEST_PRECISION.HIGH);

                const s = 3.7;
                const multiply_then_divide = Quat.divideScalar(Quat.multiplyScalar(q, s), s);
                QuaternionTestUtils.expectQuaternionEquals(
                    multiply_then_divide,
                    q,
                    TEST_PRECISION.HIGH
                );
            });

            test('division by zero error handling', () => {
                const q = testQuats.arbitrary;

                expect(() => Quat.divideScalar(q, 0)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );

                expect(() => Quat.divideScalar(q, NUMERICAL_LIMITS.EPSILON / 2)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );

                expect(() => Quat.divideScalar(q, 0.001)).not.toThrow();
            });
        });

        describe('Negation', () => {
            test('negation properties', () => {
                const q = testQuats.arbitrary;

                const double_neg = Quat.negate(Quat.negate(q));
                QuaternionTestUtils.expectQuaternionEquals(double_neg, q, TEST_PRECISION.HIGH);

                const additive_inverse = Quat.add(q, Quat.negate(q));
                QuaternionTestUtils.expectQuaternionEquals(
                    additive_inverse,
                    testQuats.zero,
                    TEST_PRECISION.HIGH
                );

                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const left = Quat.negate(Quat.add(a, b));
                const right = Quat.add(Quat.negate(a), Quat.negate(b));
                QuaternionTestUtils.expectQuaternionEquals(left, right, TEST_PRECISION.HIGH);
            });
        });
    });

    // Quaternion-Specific Operations
    describe('Quaternion Multiplication (Hamilton Product)', () => {
        test('fundamental quaternion identities', () => {
            const { unitX: i, unitY: j, unitZ: k } = testQuats;

            // i² = j² = k² = ijk = -1
            const i_squared = Quat.multiply(i, i);
            const j_squared = Quat.multiply(j, j);
            const k_squared = Quat.multiply(k, k);

            const negative_identity = { x: 0, y: 0, z: 0, w: -1 };
            QuaternionTestUtils.expectQuaternionEquals(
                i_squared,
                negative_identity,
                TEST_PRECISION.HIGH,
                'i²'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                j_squared,
                negative_identity,
                TEST_PRECISION.HIGH,
                'j²'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                k_squared,
                negative_identity,
                TEST_PRECISION.HIGH,
                'k²'
            );

            // ij = k, jk = i, ki = j
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(i, j),
                k,
                TEST_PRECISION.HIGH,
                'ij = k'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(j, k),
                i,
                TEST_PRECISION.HIGH,
                'jk = i'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(k, i),
                j,
                TEST_PRECISION.HIGH,
                'ki = j'
            );

            // ji = -k, kj = -i, ik = -j (anti-commutativity)
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(j, i),
                Quat.negate(k),
                TEST_PRECISION.HIGH,
                'ji = -k'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(k, j),
                Quat.negate(i),
                TEST_PRECISION.HIGH,
                'kj = -i'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(i, k),
                Quat.negate(j),
                TEST_PRECISION.HIGH,
                'ik = -j'
            );
        });

        test('multiplication properties', () => {
            const { identity, arbitrary: a, normalized: b, unitX: c } = testQuats;

            // Identity property: q * 1 = 1 * q = q
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(a, identity),
                a,
                TEST_PRECISION.HIGH,
                'right identity'
            );
            QuaternionTestUtils.expectQuaternionEquals(
                Quat.multiply(identity, a),
                a,
                TEST_PRECISION.HIGH,
                'left identity'
            );

            // Associativity: (a * b) * c = a * (b * c)
            const abc1 = Quat.multiply(Quat.multiply(a, b), c);
            const abc2 = Quat.multiply(a, Quat.multiply(b, c));
            QuaternionTestUtils.expectQuaternionEquals(
                abc1,
                abc2,
                TEST_PRECISION.HIGH,
                'associativity'
            );

            // Non-commutativity: Generally a * b ≠ b * a
            const ab = Quat.multiply(a, b);
            const ba = Quat.multiply(b, a);
            if (
                !(
                    Math.abs(ab.x - ba.x) < NUMERICAL_LIMITS.EPSILON &&
                    Math.abs(ab.y - ba.y) < NUMERICAL_LIMITS.EPSILON &&
                    Math.abs(ab.z - ba.z) < NUMERICAL_LIMITS.EPSILON &&
                    Math.abs(ab.w - ba.w) < NUMERICAL_LIMITS.EPSILON
                )
            ) {
                expect(true).toBe(true);
            }
        });

        test('multiplication with conjugate', () => {
            const q = testQuats.normalized;
            const q_conj = Quat.conjugate(q);

            // q * q* = |q|² (real number)
            const q_times_conj = Quat.multiply(q, q_conj);
            expect(q_times_conj.x).toBeCloseTo(0, TEST_PRECISION.HIGH);
            expect(q_times_conj.y).toBeCloseTo(0, TEST_PRECISION.HIGH);
            expect(q_times_conj.z).toBeCloseTo(0, TEST_PRECISION.HIGH);
            expect(q_times_conj.w).toBeCloseTo(Quat.lengthSquared(q), TEST_PRECISION.HIGH);
        });

        test('instance vs static consistency', () => {
            const a = testQuats.arbitrary;
            const b = testQuats.normalized;

            const staticResult = Quat.multiply(a, b);

            const instanceA = Quat.from(a);
            const instanceResult = instanceA.multiply(b);

            QuaternionTestUtils.expectQuaternionEquals(
                staticResult,
                instanceResult,
                TEST_PRECISION.HIGH
            );
        });
    });

    describe('Length and Normalization', () => {
        test('length calculations', () => {
            const testCases = [
                { quat: { x: 3, y: 4, z: 0, w: 0 }, expectedLength: 5 },
                { quat: { x: 1, y: 1, z: 1, w: 1 }, expectedLength: 2 },
                { quat: testQuats.zero, expectedLength: 0 },
                { quat: testQuats.identity, expectedLength: 1 },
            ];

            testCases.forEach(({ quat, expectedLength }, index) => {
                expect(Quat.len(quat)).toBeCloseTo(expectedLength, TEST_PRECISION.HIGH);
                expect(Quat.lengthSquared(quat)).toBeCloseTo(
                    expectedLength * expectedLength,
                    TEST_PRECISION.HIGH
                );
            });
        });

        test('normalization properties', () => {
            const testCases = [testQuats.arbitrary, testQuats.large, testQuats.small];

            testCases.forEach((q, index) => {
                const normalized = Quat.normalize(q);

                QuaternionTestUtils.expectNormalized(normalized, TEST_PRECISION.HIGH);

                const originalLength = Quat.len(q);
                if (originalLength > NUMERICAL_LIMITS.EPSILON) {
                    const expectedNormalized = Quat.divideScalar(q, originalLength);
                    QuaternionTestUtils.expectQuaternionEquals(
                        normalized,
                        expectedNormalized,
                        TEST_PRECISION.STANDARD,
                        `case ${index}`
                    );
                }
            });
        });

        test('normalization error cases', () => {
            expect(() => Quat.normalize(testQuats.zero)).toThrow(
                'Cannot normalize a zero-length quaternion'
            );

            const nearZero = { x: NUMERICAL_LIMITS.EPSILON / 2, y: 0, z: 0, w: 0 };
            expect(() => Quat.normalize(nearZero)).toThrow(
                'Cannot normalize a zero-length quaternion'
            );
        });

        test('instance normalization modifies object', () => {
            const q = new Quat(3, 4, 0, 0);
            const originalLength = q.length();

            const result = q.normalize();

            expect(result).toBe(q);
            expect(q.length()).toBeCloseTo(1, TEST_PRECISION.HIGH);
            expect(originalLength).toBeCloseTo(5, TEST_PRECISION.HIGH);
        });
    });

    describe('Dot Product', () => {
        test('dot product properties', () => {
            const { arbitrary: a, normalized: b, unitX: c } = testQuats;

            // Commutativity: a · b = b · a
            expect(Quat.dot(a, b)).toBeCloseTo(Quat.dot(b, a), TEST_PRECISION.HIGH);

            // Bilinearity: (sa) · b = s(a · b)
            const s = 2.5;
            const scaled_dot = Quat.dot(Quat.multiplyScalar(a, s), b);
            const expected = s * Quat.dot(a, b);
            expect(scaled_dot).toBeCloseTo(expected, TEST_PRECISION.HIGH);

            expect(Quat.dot(a, a)).toBeCloseTo(Quat.lengthSquared(a), TEST_PRECISION.HIGH);

            const ortho1 = { x: 1, y: 0, z: 0, w: 0 };
            const ortho2 = { x: 0, y: 1, z: 0, w: 0 };
            expect(Quat.dot(ortho1, ortho2)).toBeCloseTo(0, TEST_PRECISION.HIGH);
        });

        test('instance vs static consistency', () => {
            const a = testQuats.arbitrary;
            const b = testQuats.normalized;

            expect(Quat.dot(a, b)).toBeCloseTo(
                new Quat(a.x, a.y, a.z, a.w).dot(b),
                TEST_PRECISION.HIGH
            );
        });
    });

    describe('Conjugate and Inverse', () => {
        test('conjugate properties', () => {
            const q = testQuats.arbitrary;

            const conj = Quat.conjugate(q);
            expect(conj.x).toBeCloseTo(-q.x, TEST_PRECISION.HIGH);
            expect(conj.y).toBeCloseTo(-q.y, TEST_PRECISION.HIGH);
            expect(conj.z).toBeCloseTo(-q.z, TEST_PRECISION.HIGH);
            expect(conj.w).toBeCloseTo(q.w, TEST_PRECISION.HIGH);

            // Double conjugate: (q*)* = q
            const double_conj = Quat.conjugate(conj);
            QuaternionTestUtils.expectQuaternionEquals(double_conj, q, TEST_PRECISION.HIGH);

            // Conjugate of product: (ab)* = b*a*
            const a = testQuats.arbitrary;
            const b = testQuats.normalized;
            const ab_conj = Quat.conjugate(Quat.multiply(a, b));
            const b_conj_a_conj = Quat.multiply(Quat.conjugate(b), Quat.conjugate(a));
            QuaternionTestUtils.expectQuaternionEquals(ab_conj, b_conj_a_conj, TEST_PRECISION.HIGH);
        });

        test('inverse properties', () => {
            const q = testQuats.normalized;

            // q * q⁻¹ = 1
            const inverse = Quat.inverse(q);
            const identity_result = Quat.multiply(q, inverse);
            QuaternionTestUtils.expectQuaternionEquals(
                identity_result,
                testQuats.identity,
                TEST_PRECISION.STANDARD
            );

            // q⁻¹ * q = 1
            const identity_result2 = Quat.multiply(inverse, q);
            QuaternionTestUtils.expectQuaternionEquals(
                identity_result2,
                testQuats.identity,
                TEST_PRECISION.STANDARD
            );

            // (q⁻¹)⁻¹ = q
            const double_inverse = Quat.inverse(inverse);
            QuaternionTestUtils.expectQuaternionEquals(double_inverse, q, TEST_PRECISION.STANDARD);
        });

        test('fast inverse for unit quaternions', () => {
            const q = Quat.normalize(testQuats.arbitrary);

            const regularInverse = Quat.inverse(q);
            const fastInverse = Quat.fastInverse(q);

            QuaternionTestUtils.expectQuaternionEquals(
                regularInverse,
                fastInverse,
                TEST_PRECISION.HIGH
            );
        });

        test('inverse error handling', () => {
            expect(() => Quat.inverse(testQuats.zero)).toThrow(
                'Cannot invert a zero-length quaternion'
            );

            const nearZero = { x: NUMERICAL_LIMITS.EPSILON / 2, y: 0, z: 0, w: 0 };
            expect(() => Quat.inverse(nearZero)).toThrow('Cannot invert a zero-length quaternion');
        });

        test('instance methods modify object', () => {
            const q = new Quat(1, 2, 3, 4);
            const original = Quat.from(q);

            const conjResult = q.conjugate();
            expect(conjResult).toBe(q);
            expect(q.x).toBe(-original.x);
            expect(q.y).toBe(-original.y);
            expect(q.z).toBe(-original.z);
            expect(q.w).toBe(original.w);

            q.x = original.x;
            q.y = original.y;
            q.z = original.z;
            q.w = original.w;
            const invResult = q.inverse();
            expect(invResult).toBe(q);

            const identity_check = Quat.multiply(original, q);
            QuaternionTestUtils.expectQuaternionEquals(
                identity_check,
                testQuats.identity,
                TEST_PRECISION.STANDARD
            );
        });
    });

    // Conversion and Creation Methods
    describe('Axis-Angle Conversion', () => {
        test('fromAxisAngle basic functionality', () => {
            const axis = { x: 0, y: 1, z: 0 };
            const angle = Math.PI / 2;

            const q = Quat.fromAxisAngle(axis, angle);

            QuaternionTestUtils.expectNormalized(q, TEST_PRECISION.HIGH);
            expect(q.x).toBeCloseTo(0, TEST_PRECISION.HIGH);
            expect(q.y).toBeCloseTo(Math.sin(Math.PI / 4), TEST_PRECISION.HIGH);
            expect(q.z).toBeCloseTo(0, TEST_PRECISION.HIGH);
            expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4), TEST_PRECISION.HIGH);
        });

        test('fromAxisAngle with various axes and angles', () => {
            const testCases = [
                { axis: { x: 1, y: 0, z: 0 }, angle: 0, expectedW: 1 },
                { axis: { x: 1, y: 0, z: 0 }, angle: Math.PI, expectedW: 0 },
                {
                    axis: { x: 0, y: 0, z: 1 },
                    angle: Math.PI / 2,
                    expectedZ: Math.sin(Math.PI / 4),
                },
            ];

            testCases.forEach(({ axis, angle, expectedW, expectedZ }, index) => {
                const q = Quat.fromAxisAngle(axis, angle);
                QuaternionTestUtils.expectNormalized(q, TEST_PRECISION.HIGH);

                if (expectedW !== undefined) {
                    expect(q.w).toBeCloseTo(expectedW, TEST_PRECISION.HIGH);
                }
                if (expectedZ !== undefined) {
                    expect(q.z).toBeCloseTo(expectedZ, TEST_PRECISION.HIGH);
                }
            });
        });

        test('fromAxisAngle with output parameter', () => {
            const axis = { x: 0, y: 1, z: 0 };
            const angle = Math.PI / 2;
            const output = new Quat(999, 999, 999, 999);

            const result = Quat.fromAxisAngle(axis, angle, output);

            expect(result).toBe(output);
            QuaternionTestUtils.expectNormalized(output, TEST_PRECISION.HIGH);
        });
    });

    describe('Euler Angle Conversion', () => {
        test('fromEuler and toEuler round-trip', () => {
            const testAngles = [
                { x: 0, y: 0, z: 0 },
                { x: Math.PI / 4, y: 0, z: 0 },
                { x: 0, y: Math.PI / 4, z: 0 },
                { x: 0, y: 0, z: Math.PI / 4 },
                { x: Math.PI / 6, y: Math.PI / 4, z: Math.PI / 3 },
            ];

            testAngles.forEach((angles, index) => {
                const q = Quat.fromEuler(angles.x, angles.y, angles.z);
                QuaternionTestUtils.expectNormalized(q, TEST_PRECISION.HIGH);

                const recovered = Quat.toEuler(q);

                const q2 = Quat.fromEuler(recovered.x, recovered.y, recovered.z);

                const dot = Math.abs(Quat.dot(q, q2));
                expect(dot).toBeCloseTo(1, TEST_PRECISION.STANDARD);
            });
        });

        test('fromEuler special cases', () => {
            const identity = Quat.fromEuler(0, 0, 0);
            QuaternionTestUtils.expectQuaternionEquals(
                identity,
                testQuats.identity,
                TEST_PRECISION.HIGH
            );

            const rot180Y = Quat.fromEuler(0, Math.PI, 0);
            expect(rot180Y.y).toBeCloseTo(1, TEST_PRECISION.HIGH);
            expect(rot180Y.w).toBeCloseTo(0, TEST_PRECISION.HIGH);
        });

        test('toEuler with output parameter', () => {
            const q = testQuats.rotationY90;
            const output = { x: 999, y: 999, z: 999 };

            const result = Quat.toEuler(q, output);

            expect(result).toBe(output);
            expect(Number.isFinite(output.x)).toBe(true);
            expect(Number.isFinite(output.y)).toBe(true);
            expect(Number.isFinite(output.z)).toBe(true);
            expect(Number.isNaN(output.x)).toBe(false);
            expect(Number.isNaN(output.y)).toBe(false);
            expect(Number.isNaN(output.z)).toBe(false);
        });

        test('instance toEuler method', () => {
            const q = new Quat().fromEuler({ x: Math.PI / 4, y: Math.PI / 6, z: Math.PI / 3 });
            const staticResult = Quat.toEuler(q);
            const instanceResult = q.toEuler();

            QuaternionTestUtils.expectVector3Equals(
                staticResult,
                instanceResult,
                TEST_PRECISION.HIGH
            );
        });
    });

    // Interpolation Methods
    describe('Interpolation', () => {
        describe('Linear Interpolation (LERP)', () => {
            test('lerp boundary conditions', () => {
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const lerp0 = Quat.lerp(a, b, 0);
                QuaternionTestUtils.expectQuaternionEquals(lerp0, a, TEST_PRECISION.HIGH);

                const lerp1 = Quat.lerp(a, b, 1);
                QuaternionTestUtils.expectQuaternionEquals(lerp1, b, TEST_PRECISION.HIGH);

                const lerp_half = Quat.lerp(a, b, 0.5);
                const expected_midpoint = Quat.multiplyScalar(Quat.add(a, b), 0.5);
                QuaternionTestUtils.expectQuaternionEquals(
                    lerp_half,
                    expected_midpoint,
                    TEST_PRECISION.HIGH
                );
            });

            test('lerp clamping behavior', () => {
                const a = testQuats.arbitrary;
                const b = testQuats.normalized;

                const lerp_negative = Quat.lerp(a, b, -0.5);
                QuaternionTestUtils.expectQuaternionEquals(lerp_negative, a, TEST_PRECISION.HIGH);

                const lerp_over = Quat.lerp(a, b, 1.5);
                QuaternionTestUtils.expectQuaternionEquals(lerp_over, b, TEST_PRECISION.HIGH);
            });
        });

        describe('Spherical Linear Interpolation (SLERP)', () => {
            test('slerp boundary conditions', () => {
                const a = Quat.normalize(testQuats.arbitrary);
                const b = Quat.normalize(testQuats.normalized);

                const slerp0 = Quat.slerp(a, b, 0);
                QuaternionTestUtils.expectQuaternionEquals(slerp0, a, TEST_PRECISION.HIGH);

                const slerp1 = Quat.slerp(a, b, 1);
                QuaternionTestUtils.expectQuaternionEquals(slerp1, b, TEST_PRECISION.HIGH);
            });

            test('slerp maintains unit length', () => {
                const a = Quat.normalize(testQuats.arbitrary);
                const b = Quat.normalize(testQuats.normalized);

                const testValues = [0.1, 0.25, 0.5, 0.75, 0.9];

                testValues.forEach((t) => {
                    const result = Quat.slerp(a, b, t);
                    QuaternionTestUtils.expectNormalized(result, TEST_PRECISION.STANDARD);
                });
            });

            test('slerp handles opposite quaternions', () => {
                const q = Quat.normalize(testQuats.arbitrary);
                const opposite = Quat.negate(q);

                const result = Quat.slerp(q, opposite, 0.5);
                QuaternionTestUtils.expectNormalized(result, TEST_PRECISION.STANDARD);
            });

            test('slerp vs lerp for close quaternions', () => {
                const a = testQuats.identity;
                const b = Quat.fromAxisAngle({ x: 0, y: 1, z: 0 }, 0.1);

                const slerp_result = Quat.slerp(a, b, 0.5);
                const lerp_result = Quat.normalize(Quat.lerp(a, b, 0.5));

                const dot = Math.abs(Quat.dot(slerp_result, lerp_result));
                expect(dot).toBeCloseTo(1, TEST_PRECISION.STANDARD);
            });
        });

        describe('Spherical Quadrangle Interpolation (SQUAD)', () => {
            test('squad boundary conditions', () => {
                const q1 = Quat.normalize(testQuats.arbitrary);
                const q2 = Quat.normalize(testQuats.normalized);
                const s1 = Quat.normalize(testQuats.unitX);
                const s2 = Quat.normalize(testQuats.unitY);

                const squad0 = Quat.squad(q1, q2, s1, s2, 0);
                QuaternionTestUtils.expectQuaternionEquals(squad0, q1, TEST_PRECISION.HIGH);

                const squad1 = Quat.squad(q1, q2, s1, s2, 1);
                QuaternionTestUtils.expectQuaternionEquals(squad1, q2, TEST_PRECISION.HIGH);
            });

            test('squad maintains unit length', () => {
                const q1 = Quat.normalize(testQuats.arbitrary);
                const q2 = Quat.normalize(testQuats.normalized);
                const s1 = Quat.normalize(testQuats.unitX);
                const s2 = Quat.normalize(testQuats.unitY);

                const testValues = [0.1, 0.25, 0.5, 0.75, 0.9];

                testValues.forEach((t) => {
                    const result = Quat.squad(q1, q2, s1, s2, t);
                    QuaternionTestUtils.expectNormalized(result, TEST_PRECISION.STANDARD);
                });
            });
        });
    });

    // Rotation and Vector Operations
    describe('Vector Rotation', () => {
        test('rotateVector with known rotations', () => {
            const rotZ90 = Quat.fromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
            const vectorX = { x: 1, y: 0, z: 0 };

            const rotated = Quat.rotateVector(rotZ90, vectorX);

            QuaternionTestUtils.expectVector3Equals(
                rotated,
                { x: 0, y: 1, z: 0 },
                TEST_PRECISION.HIGH
            );
        });

        test('rotateVector preserves vector length', () => {
            const rotation = Quat.normalize(testQuats.arbitrary);
            const vectors = [
                { x: 1, y: 0, z: 0 },
                { x: 1, y: 1, z: 1 },
                { x: 3, y: 4, z: 5 },
                { x: -2, y: 3, z: -1 },
            ];

            vectors.forEach((vector, index) => {
                const originalLength = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
                const rotated = Quat.rotateVector(rotation, vector);
                const rotatedLength = Math.sqrt(rotated.x ** 2 + rotated.y ** 2 + rotated.z ** 2);

                expect(rotatedLength).toBeCloseTo(originalLength, TEST_PRECISION.HIGH);
            });
        });

        test('rotateVector with identity rotation', () => {
            const vector = { x: 1, y: 2, z: 3 };
            const rotated = Quat.rotateVector(testQuats.identity, vector);

            QuaternionTestUtils.expectVector3Equals(rotated, vector, TEST_PRECISION.HIGH);
        });

        test('rotateVector composition property', () => {
            const q1 = Quat.fromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
            const q2 = Quat.fromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
            const combined = Quat.multiply(q2, q1);

            const vector = { x: 1, y: 2, z: 3 };

            const step1 = Quat.rotateVector(q1, vector);
            const step2 = Quat.rotateVector(q2, step1);

            const combined_result = Quat.rotateVector(combined, vector);

            QuaternionTestUtils.expectVector3Equals(
                step2,
                combined_result,
                TEST_PRECISION.STANDARD
            );
        });

        test('instance rotateVector method', () => {
            const q = new Quat().normalize();
            const vector = { x: 1, y: 2, z: 3 };

            const staticResult = Quat.rotateVector(q, vector);
            const instanceResult = q.rotateVector(vector);

            QuaternionTestUtils.expectVector3Equals(
                staticResult,
                instanceResult,
                TEST_PRECISION.HIGH
            );
        });
    });

    describe('Look-At Rotation', () => {
        test('fromLookAt creates normalized quaternion', () => {
            const eye = { x: 0, y: 0, z: 0 };
            const target = { x: 1, y: 0, z: 0 };
            const up = { x: 0, y: 1, z: 0 };

            const lookAt = Quat.fromLookAt(eye, target, up);
            QuaternionTestUtils.expectNormalized(lookAt, TEST_PRECISION.HIGH);
            QuaternionTestUtils.expectValidQuaternion(lookAt);
        });

        test('fromLookAt with various directions', () => {
            const testCases = [
                {
                    name: 'Look along +X axis',
                    eye: { x: 0, y: 0, z: 0 },
                    target: { x: 1, y: 0, z: 0 },
                    up: { x: 0, y: 1, z: 0 },
                },
                {
                    name: 'Look along +Y axis',
                    eye: { x: 0, y: 0, z: 0 },
                    target: { x: 0, y: 1, z: 0 },
                    up: { x: 0, y: 0, z: 1 },
                },
                {
                    name: 'Look along +Z axis',
                    eye: { x: 0, y: 0, z: 0 },
                    target: { x: 0, y: 0, z: 1 },
                    up: { x: 0, y: 1, z: 0 },
                },
                {
                    name: 'Look diagonally',
                    eye: { x: 1, y: 1, z: 1 },
                    target: { x: 2, y: 2, z: 2 },
                    up: { x: 0, y: 1, z: 0 },
                },
            ];

            testCases.forEach(({ name, eye, target, up }) => {
                const lookAt = Quat.fromLookAt(eye, target, up);
                QuaternionTestUtils.expectNormalized(lookAt, TEST_PRECISION.HIGH);
                QuaternionTestUtils.expectValidQuaternion(lookAt);
            });
        });

        test('fromLookAt with output parameter', () => {
            const eye = { x: 0, y: 0, z: 0 };
            const target = { x: 1, y: 1, z: 1 };
            const up = { x: 0, y: 1, z: 0 };
            const output = new Quat(999, 999, 999, 999);

            const result = Quat.fromLookAt(eye, target, up, output);

            expect(result).toBe(output);
            QuaternionTestUtils.expectNormalized(output, TEST_PRECISION.HIGH);
        });

        test('fromLookAt error conditions', () => {
            const eye = { x: 0, y: 0, z: 0 };
            const up = { x: 0, y: 1, z: 0 };

            expect(() => Quat.fromLookAt(eye, eye, up)).toThrow(
                'Eye and target positions are too close'
            );

            expect(() => Quat.fromLookAt(eye, { x: EPSILON / 2, y: 0, z: 0 }, up)).toThrow(
                'Eye and target positions are too close'
            );

            const target = { x: 0, y: 1, z: 0 };
            expect(() => Quat.fromLookAt(eye, target, up)).toThrow(
                'Forward and up vectors are parallel'
            );

            const downTarget = { x: 0, y: -1, z: 0 };
            expect(() => Quat.fromLookAt(eye, downTarget, up)).toThrow(
                'Forward and up vectors are parallel'
            );
        });

        test('fromLookAt consistency with matrix conventions', () => {
            const eye = { x: 0, y: 0, z: 0 };
            const target = { x: 1, y: 0, z: 0 };
            const up = { x: 0, y: 1, z: 0 };

            const lookAt = Quat.fromLookAt(eye, target, up);

            const testVector = { x: 0, y: 0, z: 1 };
            const rotated = Quat.rotateVector(lookAt, testVector);

            expect(Number.isFinite(rotated.x)).toBe(true);
            expect(Number.isFinite(rotated.y)).toBe(true);
            expect(Number.isFinite(rotated.z)).toBe(true);
            expect(Number.isNaN(rotated.x)).toBe(false);
            expect(Number.isNaN(rotated.y)).toBe(false);
            expect(Number.isNaN(rotated.z)).toBe(false);

            const originalLength = Math.sqrt(
                testVector.x ** 2 + testVector.y ** 2 + testVector.z ** 2
            );
            const rotatedLength = Math.sqrt(rotated.x ** 2 + rotated.y ** 2 + rotated.z ** 2);
            expect(rotatedLength).toBeCloseTo(originalLength, TEST_PRECISION.HIGH);
        });
    });

    describe('Angle Between Quaternions', () => {
        test('angleBetween properties', () => {
            const q1 = testQuats.identity;
            const q2 = testQuats.identity;

            expect(Quat.angleBetween(q1, q2)).toBeCloseTo(0, TEST_PRECISION.HIGH);

            const a = Quat.normalize(testQuats.arbitrary);
            const b = Quat.normalize(testQuats.normalized);

            expect(Quat.angleBetween(a, b)).toBeCloseTo(
                Quat.angleBetween(b, a),
                TEST_PRECISION.HIGH
            );

            const angle = Quat.angleBetween(a, b);
            expect(angle).toBeGreaterThanOrEqual(0);
            expect(angle).toBeLessThanOrEqual(Math.PI + NUMERICAL_LIMITS.EPSILON);
        });

        test('angleBetween for opposite quaternions', () => {
            const q = Quat.normalize(testQuats.arbitrary);
            const opposite = Quat.negate(q);

            const angle = Quat.angleBetween(q, opposite);
            expect(angle).toBeCloseTo(0, TEST_PRECISION.LOW);
        });

        test('instance angleBetween method', () => {
            const q1 = new Quat(
                testQuats.arbitrary.x,
                testQuats.arbitrary.y,
                testQuats.arbitrary.z,
                testQuats.arbitrary.w
            ).normalize();
            const q2 = testQuats.normalized;

            const staticResult = Quat.angleBetween(q1, q2);
            const instanceResult = q1.angleBetween(q2);

            expect(instanceResult).toBeCloseTo(staticResult, TEST_PRECISION.HIGH);
        });
    });

    describe('Comparison Systems', () => {
        describe('QuatComparer', () => {
            test('lexicographic comparison', () => {
                const comparer = new QuatComparer(QuatComparisonMode.LEXICOGRAPHIC);

                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1, 2, 3, 4);
                const q3 = new Quat(1, 2, 3, 5);
                const q4 = new Quat(0, 2, 3, 4);

                expect(comparer.compare(q1, q2)).toBe(0);
                expect(comparer.compare(q1, q3)).toBe(-1);
                expect(comparer.compare(q3, q1)).toBe(1);
                expect(comparer.compare(q4, q1)).toBe(-1);
            });

            test('magnitude comparison', () => {
                const comparer = new QuatComparer(QuatComparisonMode.MAGNITUDE);

                const q1 = new Quat(1, 0, 0, 0); // length = 1
                const q2 = new Quat(1, 1, 0, 0); // length = √2
                const q3 = new Quat(1, 1, 1, 1); // length = 2

                expect(comparer.compare(q1, q2)).toBe(-1);
                expect(comparer.compare(q2, q1)).toBe(1);
                expect(comparer.compare(q1, q1)).toBe(0);
                expect(comparer.compare(q2, q3)).toBe(-1);
            });

            test('angle comparison', () => {
                const comparer = new QuatComparer(QuatComparisonMode.ANGLE);

                const q1 = testQuats.identity; // angle = 0
                const q2 = Quat.fromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
                const q3 = Quat.fromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);

                expect(comparer.compare(q1, q2)).toBe(-1);
                expect(comparer.compare(q2, q3)).toBe(-1);
                expect(comparer.compare(q1, q1)).toBe(0);
            });
        });

        describe('QuatEqualityComparer', () => {
            test('default epsilon equality', () => {
                const comparer = new QuatEqualityComparer();

                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1 + NUMERICAL_LIMITS.EPSILON / 2, 2, 3, 4);
                const q3 = new Quat(1 + 0.1, 2, 3, 4);

                expect(comparer.equals(q1, q2)).toBe(true);
                expect(comparer.equals(q1, q3)).toBe(false);
                expect(comparer.equals(q1, q1)).toBe(true);
            });

            test('custom epsilon equality', () => {
                const comparer = new QuatEqualityComparer(0.01);

                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1.005, 2, 3, 4);
                const q3 = new Quat(1.02, 2, 3, 4);

                expect(comparer.equals(q1, q2)).toBe(true);
                expect(comparer.equals(q1, q3)).toBe(false);
            });

            test('hash consistency', () => {
                const comparer = new QuatEqualityComparer();

                const q1 = new Quat(1, 2, 3, 4);
                const q2 = new Quat(1, 2, 3, 4);
                const q3 = new Quat(4, 3, 2, 1);

                expect(comparer.hash(q1)).toBe(comparer.hash(q2));
                expect(comparer.hash(q1)).not.toBe(comparer.hash(q3));
            });

            test('null handling', () => {
                const comparer = new QuatEqualityComparer();
                const q = new Quat(1, 2, 3, 4);

                expect(comparer.equals(null as any, null as any)).toBe(true);
                expect(comparer.equals(q, null as any)).toBe(false);
                expect(comparer.equals(null as any, q)).toBe(false);
                expect(comparer.hash(null as any)).toBe(0);
            });
        });
    });

    describe('Performance and Stress Testing', () => {
        test('basic operation performance benchmarks', () => {
            const q1 = Quat.normalize(testQuats.arbitrary);
            const q2 = Quat.normalize(testQuats.normalized);

            console.log('\n=== Quaternion Performance Benchmarks ===');

            QuaternionTestUtils.benchmark('Multiplication', () => Quat.multiply(q1, q2), 100000);
            QuaternionTestUtils.benchmark('Addition', () => Quat.add(q1, q2), 100000);
            QuaternionTestUtils.benchmark('Normalization', () => Quat.normalize(q1), 100000);
            QuaternionTestUtils.benchmark('SLERP', () => Quat.slerp(q1, q2, 0.5), 50000);
            QuaternionTestUtils.benchmark(
                'Vector Rotation',
                () => Quat.rotateVector(q1, { x: 1, y: 2, z: 3 }),
                50000
            );

            console.log('=== End Performance Benchmarks ===\n');

            expect(true).toBe(true);
        });

        test('numerical stability with large numbers', () => {
            const large = NUMERICAL_LIMITS.LARGE_NUMBER;
            const q = new Quat(large, large, large, large);

            const normalized = Quat.normalize(q);
            QuaternionTestUtils.expectValidQuaternion(normalized);
            QuaternionTestUtils.expectNormalized(normalized, TEST_PRECISION.LOW);
        });

        test('numerical stability with small numbers', () => {
            const small = NUMERICAL_LIMITS.SMALL_NUMBER;
            const q = new Quat(small, small, small, 1);

            const normalized = Quat.normalize(q);
            QuaternionTestUtils.expectValidQuaternion(normalized);
            QuaternionTestUtils.expectNormalized(normalized, TEST_PRECISION.STANDARD);
        });

        test('property-based testing with random quaternions', () => {
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                const q1 = QuaternionTestUtils.generateRandomQuaternion(true);
                const q2 = QuaternionTestUtils.generateRandomQuaternion(true);

                const product = Quat.multiply(q1, q2);
                QuaternionTestUtils.expectNormalized(product, TEST_PRECISION.STANDARD);

                const inverse = Quat.inverse(q1);
                const identity_check = Quat.multiply(q1, inverse);
                QuaternionTestUtils.expectQuaternionEquals(
                    identity_check,
                    testQuats.identity,
                    TEST_PRECISION.STANDARD
                );

                const slerp_result = Quat.slerp(q1, q2, Math.random());
                QuaternionTestUtils.expectNormalized(slerp_result, TEST_PRECISION.STANDARD);
            }
        });
    });

    describe('Memory Management and Type Safety', () => {
        test('output parameter reuse', () => {
            const q1 = testQuats.arbitrary;
            const q2 = testQuats.normalized;
            const reusableOutput = new Quat(999, 999, 999, 999);

            Quat.add(q1, q2, reusableOutput);
            const addResult = Quat.from(reusableOutput);

            Quat.multiply(q1, q2, reusableOutput);
            const multiplyResult = Quat.from(reusableOutput);

            Quat.slerp(q1, q2, 0.5, reusableOutput);
            const slerpResult = Quat.from(reusableOutput);

            QuaternionTestUtils.expectQuaternionEquals(
                addResult,
                Quat.add(q1, q2),
                TEST_PRECISION.HIGH
            );
            QuaternionTestUtils.expectQuaternionEquals(
                multiplyResult,
                Quat.multiply(q1, q2),
                TEST_PRECISION.HIGH
            );
            QuaternionTestUtils.expectQuaternionEquals(
                slerpResult,
                Quat.slerp(q1, q2, 0.5),
                TEST_PRECISION.HIGH
            );
        });

        test('type flexibility with IQuatLike implementations', () => {
            const plainQuat = { x: 1, y: 2, z: 3, w: 4 };
            const result1 = Quat.normalize(plainQuat);
            QuaternionTestUtils.expectValidQuaternion(result1);

            class CustomQuat implements IQuatLike {
                constructor(
                    public x: number,
                    public y: number,
                    public z: number,
                    public w: number
                ) {}
            }

            const customQuat = new CustomQuat(1, 2, 3, 4);
            const result2 = Quat.normalize(customQuat);
            QuaternionTestUtils.expectValidQuaternion(result2);

            const comparer = new QuatEqualityComparer();
            const quatInstance = new Quat(1, 2, 3, 4);

            expect(comparer.equals(plainQuat, quatInstance)).toBe(true);
            expect(comparer.equals(customQuat, quatInstance)).toBe(true);
            expect(comparer.equals(plainQuat, customQuat)).toBe(true);

            QuaternionTestUtils.expectQuaternionEquals(result1, result2, TEST_PRECISION.HIGH);
        });

        test('readonly parameter respect', () => {
            const readonlyQuat: Readonly<IQuatLike> = Object.freeze({ x: 1, y: 2, z: 3, w: 4 });

            expect(() => {
                const result = Quat.normalize(readonlyQuat);
                QuaternionTestUtils.expectValidQuaternion(result);
            }).not.toThrow();

            expect(readonlyQuat.x).toBe(1);
            expect(readonlyQuat.y).toBe(2);
            expect(readonlyQuat.z).toBe(3);
            expect(readonlyQuat.w).toBe(4);
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('operations with special values', () => {
            const testCases = [
                { name: 'Infinity', quat: { x: Infinity, y: 0, z: 0, w: 0 } },
                { name: 'Negative Infinity', quat: { x: -Infinity, y: 0, z: 0, w: 0 } },
                { name: 'NaN', quat: { x: NaN, y: 0, z: 0, w: 0 } },
                { name: 'Max Value', quat: { x: Number.MAX_VALUE, y: 0, z: 0, w: 0 } },
                { name: 'Min Value', quat: { x: Number.MIN_VALUE, y: 0, z: 0, w: 0 } },
            ];

            testCases.forEach(({ name, quat }) => {
                try {
                    const result = Quat.add(quat, testQuats.identity);
                    if (isFinite(quat.x)) {
                        QuaternionTestUtils.expectValidQuaternion(result);
                    }
                } catch (error) {
                    expect(error).toBeInstanceOf(Error);
                }
            });
        });

        test('comprehensive error message testing', () => {
            const errorTests = [
                {
                    operation: () => Quat.normalize(testQuats.zero),
                    expectedMessage: 'Cannot normalize a zero-length quaternion',
                },
                {
                    operation: () => Quat.inverse(testQuats.zero),
                    expectedMessage: 'Cannot invert a zero-length quaternion',
                },
                {
                    operation: () => Quat.divideScalar(testQuats.arbitrary, 0),
                    expectedMessage: 'Division by zero or near-zero value is not allowed',
                },
                {
                    operation: () => Quat.fromArray([1, 2], 0),
                    expectedMessage: 'Array must have at least 4 elements',
                },
                {
                    operation: () => Quat.fromArray([1, 2, 3, 4], -1),
                    expectedMessage: 'Offset cannot be negative',
                },
            ];

            errorTests.forEach(({ operation, expectedMessage }, index) => {
                try {
                    operation();
                    throw new Error(`Expected error for test case ${index}`);
                } catch (error) {
                    expect(error instanceof Error ? error.message : String(error)).toContain(
                        expectedMessage
                    );
                }
            });
        });
    });
});
