import { Vec4, Vec4ComparisonMode, Vec4Comparer, Vec4EqualityComparer, IVec4Like } from '../vec4';
import { EPSILON } from '../common';
import { clamp01 } from '../clamp';
import { describe, expect, test } from 'vitest';

const CUSTOM_EPSILON = 1e-10;
const LARGE_NUMBER = 1e6;
const SMALL_NUMBER = 1e-6;

const expectVectorClose = (actual: IVec4Like, expected: IVec4Like, epsilon = EPSILON) => {
    expect(Math.abs(actual.x - expected.x)).toBeLessThan(epsilon);
    expect(Math.abs(actual.y - expected.y)).toBeLessThan(epsilon);
    expect(Math.abs(actual.z - expected.z)).toBeLessThan(epsilon);
    expect(Math.abs(actual.w - expected.w)).toBeLessThan(epsilon);
};

const expectNumberClose = (actual: number, expected: number, epsilon = EPSILON) => {
    expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
};

const createRandomVec4 = (scale = 100): Vec4 => {
    return new Vec4(
        (Math.random() - 0.5) * scale,
        (Math.random() - 0.5) * scale,
        (Math.random() - 0.5) * scale,
        (Math.random() - 0.5) * scale
    );
};

describe('Vec4 Unit Tests', () => {
    describe('Constructor and Creation', () => {
        test('should create zero vector by default', () => {
            const vec = new Vec4();
            expectVectorClose(vec, { x: 0, y: 0, z: 0, w: 0 });
        });

        test('should create vector with specified components', () => {
            const vec = new Vec4(1, 2, 3, 4);
            expectVectorClose(vec, { x: 1, y: 2, z: 3, w: 4 });
        });

        test('should create vector with partial components', () => {
            const vec1 = new Vec4(5);
            expectVectorClose(vec1, { x: 5, y: 0, z: 0, w: 0 });

            const vec2 = new Vec4(5, 10);
            expectVectorClose(vec2, { x: 5, y: 10, z: 0, w: 0 });

            const vec3 = new Vec4(5, 10, 15);
            expectVectorClose(vec3, { x: 5, y: 10, z: 15, w: 0 });
        });

        test('should create from IVec4Like object', () => {
            const source = { x: 1.5, y: 2.5, z: 3.5, w: 4.5 };
            const vec = Vec4.from(source);
            expectVectorClose(vec, source);
        });

        test('should create from array with default offset', () => {
            const arr = [1, 2, 3, 4, 5, 6];
            const vec = Vec4.fromArray(arr);
            expectVectorClose(vec, { x: 1, y: 2, z: 3, w: 4 });
        });

        test('should create from array with custom offset', () => {
            const arr = [0, 0, 1, 2, 3, 4, 5];
            const vec = Vec4.fromArray(arr, 2);
            expectVectorClose(vec, { x: 1, y: 2, z: 3, w: 4 });
        });

        test('should throw error for negative offset', () => {
            const arr = [1, 2, 3, 4];
            expect(() => Vec4.fromArray(arr, -1)).toThrow('Offset cannot be negative');
        });

        test('should throw error for insufficient array length', () => {
            const arr = [1, 2];
            expect(() => Vec4.fromArray(arr)).toThrow('Array must have at least 4 elements');
            expect(() => Vec4.fromArray(arr, 1)).toThrow(
                'Array must have at least 5 elements when using offset 1'
            );
        });

        test('should create using static create method', () => {
            const vec = Vec4.create(1, 2, 3, 4);
            expectVectorClose(vec, { x: 1, y: 2, z: 3, w: 4 });
        });
    });

    describe('Static Constants', () => {
        test('should have correct static constant values', () => {
            expectVectorClose(Vec4.ZERO, { x: 0, y: 0, z: 0, w: 0 });
            expectVectorClose(Vec4.ONE, { x: 1, y: 1, z: 1, w: 1 });
            expectVectorClose(Vec4.NEG_ONE, { x: -1, y: -1, z: -1, w: -1 });
            expectVectorClose(Vec4.UNIT_X, { x: 1, y: 0, z: 0, w: 0 });
            expectVectorClose(Vec4.UNIT_Y, { x: 0, y: 1, z: 0, w: 0 });
            expectVectorClose(Vec4.UNIT_Z, { x: 0, y: 0, z: 1, w: 0 });
            expectVectorClose(Vec4.UNIT_W, { x: 0, y: 0, z: 0, w: 1 });
        });

        test('should have immutable static constants', () => {
            expect(Object.isFrozen(Vec4.ZERO)).toBe(true);
            expect(Object.isFrozen(Vec4.ONE)).toBe(true);
            expect(Object.isFrozen(Vec4.UNIT_X)).toBe(true);
        });
    });

    // CLONE AND EQUALITY TESTS
    describe('Clone and Equality', () => {
        test('should clone vector correctly', () => {
            const original = new Vec4(1, 2, 3, 4);
            const cloned = original.clone();

            expectVectorClose(cloned, original);
            expect(cloned).not.toBe(original);
        });

        test('should check equality correctly', () => {
            const vec1 = new Vec4(1, 2, 3, 4);
            const vec2 = new Vec4(1, 2, 3, 4);
            const vec3 = new Vec4(1, 2, 3, 4.1);

            expect(vec1.equals(vec2)).toBe(true);
            expect(vec1.equals(vec3)).toBe(false);
            expect(vec1.equals(null)).toBe(false);
            expect(vec1.equals('not a vector')).toBe(false);
        });

        test('should handle floating point precision in equality', () => {
            const vec1 = new Vec4(1, 2, 3, 4);
            const vec2 = new Vec4(
                1 + EPSILON * 0.5,
                2 + EPSILON * 0.5,
                3 + EPSILON * 0.5,
                4 + EPSILON * 0.5
            );

            expect(vec1.equals(vec2)).toBe(true);
        });

        test('should generate consistent hash codes', () => {
            const vec1 = new Vec4(1, 2, 3, 4);
            const vec2 = new Vec4(1, 2, 3, 4);
            const vec3 = new Vec4(5, 6, 7, 8);

            expect(vec1.getHashCode()).toBe(vec2.getHashCode());
            expect(vec1.getHashCode()).not.toBe(vec3.getHashCode());
        });
    });

    // BASIC ARITHMETIC OPERATIONS TESTS
    describe('Basic Arithmetic Operations', () => {
        describe('Addition', () => {
            test('should add vectors correctly (static)', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(5, 6, 7, 8);
                const result = Vec4.add(a, b);

                expectVectorClose(result, { x: 6, y: 8, z: 10, w: 12 });
            });

            test('should add vectors with output parameter', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(5, 6, 7, 8);
                const out = new Vec4();
                const result = Vec4.add(a, b, out);

                expect(result).toBe(out);
                expectVectorClose(out, { x: 6, y: 8, z: 10, w: 12 });
            });

            test('should add scalar correctly', () => {
                const a = new Vec4(1, 2, 3, 4);
                const result = Vec4.addScalar(a, 5);

                expectVectorClose(result, { x: 6, y: 7, z: 8, w: 9 });
            });

            test('should add vectors correctly (instance)', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(5, 6, 7, 8);
                const result = a.add(b);

                expect(result).toBe(a);
                expectVectorClose(a, { x: 6, y: 8, z: 10, w: 12 });
            });

            test('should add scalar correctly (instance)', () => {
                const a = new Vec4(1, 2, 3, 4);
                const result = a.addScalar(5);

                expect(result).toBe(a);
                expectVectorClose(a, { x: 6, y: 7, z: 8, w: 9 });
            });
        });

        describe('Subtraction', () => {
            test('should subtract vectors correctly (static)', () => {
                const a = new Vec4(5, 6, 7, 8);
                const b = new Vec4(1, 2, 3, 4);
                const result = Vec4.subtract(a, b);

                expectVectorClose(result, { x: 4, y: 4, z: 4, w: 4 });
            });

            test('should subtract scalar correctly', () => {
                const a = new Vec4(5, 6, 7, 8);
                const result = Vec4.subtractScalar(a, 2);

                expectVectorClose(result, { x: 3, y: 4, z: 5, w: 6 });
            });

            test('should subtract vectors correctly (instance)', () => {
                const a = new Vec4(5, 6, 7, 8);
                const b = new Vec4(1, 2, 3, 4);
                const result = a.subtract(b);

                expect(result).toBe(a);
                expectVectorClose(a, { x: 4, y: 4, z: 4, w: 4 });
            });
        });

        describe('Multiplication', () => {
            test('should multiply vectors correctly (static)', () => {
                const a = new Vec4(2, 3, 4, 5);
                const b = new Vec4(1, 2, 3, 4);
                const result = Vec4.multiply(a, b);

                expectVectorClose(result, { x: 2, y: 6, z: 12, w: 20 });
            });

            test('should multiply by scalar correctly', () => {
                const a = new Vec4(1, 2, 3, 4);
                const result = Vec4.multiplyScalar(a, 3);

                expectVectorClose(result, { x: 3, y: 6, z: 9, w: 12 });
            });

            test('should handle zero multiplication', () => {
                const a = new Vec4(1, 2, 3, 4);
                const result = Vec4.multiplyScalar(a, 0);

                expectVectorClose(result, { x: 0, y: 0, z: 0, w: 0 });
            });

            test('should handle negative scalar multiplication', () => {
                const a = new Vec4(1, 2, 3, 4);
                const result = Vec4.multiplyScalar(a, -2);

                expectVectorClose(result, { x: -2, y: -4, z: -6, w: -8 });
            });
        });

        describe('Division', () => {
            test('should divide vectors correctly (static)', () => {
                const a = new Vec4(6, 8, 12, 16);
                const b = new Vec4(2, 4, 3, 4);
                const result = Vec4.divide(a, b);

                expectVectorClose(result, { x: 3, y: 2, z: 4, w: 4 });
            });

            test('should divide by scalar correctly', () => {
                const a = new Vec4(6, 8, 12, 16);
                const result = Vec4.divideScalar(a, 2);

                expectVectorClose(result, { x: 3, y: 4, z: 6, w: 8 });
            });

            test('should throw error for division by zero vector', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(0, 1, 2, 3);

                expect(() => Vec4.divide(a, b)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });

            test('should throw error for division by zero scalar', () => {
                const a = new Vec4(1, 2, 3, 4);

                expect(() => Vec4.divideScalar(a, 0)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });

            test('should throw error for division by near-zero values', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(EPSILON * 0.5, 1, 2, 3);

                expect(() => Vec4.divide(a, b)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });
        });

        describe('Negation', () => {
            test('should negate vector correctly', () => {
                const a = new Vec4(1, -2, 3, -4);
                const result = Vec4.negate(a);

                expectVectorClose(result, { x: -1, y: 2, z: -3, w: 4 });
            });

            test('should handle zero negation correctly', () => {
                const a = new Vec4(0, 1, 0, -1);
                const result = Vec4.negate(a);

                expectVectorClose(result, { x: 0, y: -1, z: 0, w: 1 });
            });
        });

        describe('Inverse', () => {
            test('should calculate inverse correctly', () => {
                const a = new Vec4(2, 4, 0.5, 0.25);
                const result = Vec4.inverse(a);

                expectVectorClose(result, { x: 0.5, y: 0.25, z: 2, w: 4 });
            });

            test('should calculate safe inverse correctly', () => {
                const a = new Vec4(2, 1, 0.5, 0.25);
                const result = Vec4.inverseSafe(a, undefined, 999);

                expectVectorClose(result, { x: 0.5, y: 1, z: 2, w: 4 });
            });

            test('should throw error for inverse of zero', () => {
                const a = new Vec4(2, 0, 0.5, 1);

                expect(() => Vec4.inverseSafe(a)).toThrow('Inversion of zero or near-zero value');
            });
        });
    });

    // VECTOR MATHEMATICS TESTS
    describe('Vector Mathematics', () => {
        describe('Dot Product', () => {
            test('should calculate dot product correctly', () => {
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(5, 6, 7, 8);

                expect(Vec4.dot(a, b)).toBe(70);
                expect(a.dot(b)).toBe(70);
            });

            test('should calculate dot product with self (length squared)', () => {
                const a = new Vec4(1, 2, 3, 4);

                expect(Vec4.dot(a, a)).toBe(30);
                expect(a.lengthSquared()).toBe(30);
            });

            test('should return zero for orthogonal vectors', () => {
                const a = new Vec4(1, 0, 0, 0);
                const b = new Vec4(0, 1, 0, 0);

                expect(Vec4.dot(a, b)).toBe(0);
            });
        });

        describe('Cross Product (3D)', () => {
            test('should calculate 3D cross product correctly', () => {
                const a = new Vec4(1, 0, 0, 5);
                const b = new Vec4(0, 1, 0, 10);
                const result = Vec4.cross3D(a, b);

                expectVectorClose(result, { x: 0, y: 0, z: 1, w: 0 });
            });

            test('should calculate cross product with standard basis vectors', () => {
                const x = new Vec4(1, 0, 0, 0);
                const y = new Vec4(0, 1, 0, 0);
                const z = new Vec4(0, 0, 1, 0);

                expectVectorClose(Vec4.cross3D(x, y), { x: 0, y: 0, z: 1, w: 0 });
                expectVectorClose(Vec4.cross3D(y, z), { x: 1, y: 0, z: 0, w: 0 });
                expectVectorClose(Vec4.cross3D(z, x), { x: 0, y: 1, z: 0, w: 0 });
            });

            test('should return zero for parallel vectors', () => {
                const a = new Vec4(1, 2, 3, 0);
                const b = new Vec4(2, 4, 6, 0);
                const result = Vec4.cross3D(a, b);

                expectVectorClose(result, { x: 0, y: 0, z: 0, w: 0 });
            });
        });

        describe('Length and Normalization', () => {
            test('should calculate length correctly', () => {
                const a = new Vec4(3, 4, 0, 0);
                expect(Vec4.len(a)).toBe(5);
                expect(a.length()).toBe(5);
            });

            test('should calculate length squared correctly', () => {
                const a = new Vec4(1, 2, 3, 4);
                expect(Vec4.lengthSquared(a)).toBe(30);
                expect(a.lengthSquared()).toBe(30);
            });

            test('should calculate fast length approximation', () => {
                const a = new Vec4(3, 4, 0, 0);
                const fastLen = Vec4.fastLength(a);
                const realLen = Vec4.len(a);

                expect(Math.abs(fastLen - realLen) / realLen).toBeLessThan(0.3);
            });

            test('should normalize vector correctly', () => {
                const a = new Vec4(3, 4, 0, 0);
                const normalized = Vec4.normalize(a);

                expectNumberClose(Vec4.len(normalized), 1);
                expectVectorClose(normalized, { x: 0.6, y: 0.8, z: 0, w: 0 });
            });

            test('should normalize vector in place', () => {
                const a = new Vec4(3, 4, 0, 0);
                const result = a.normalize();

                expect(result).toBe(a);
                expectNumberClose(a.length(), 1);
            });

            test('should throw error when normalizing zero vector', () => {
                const zero = new Vec4(0, 0, 0, 0);

                expect(() => Vec4.normalize(zero)).toThrow('Cannot normalize a zero-length vector');
                expect(() => zero.normalize()).toThrow('Cannot normalize a zero-length vector');
            });

            test('should use Quake fast inverse square root', () => {
                const a = new Vec4(3, 4, 0, 0);
                const normalized = Vec4.normalizeQuake(a);

                // No 1e-3
                expectNumberClose(Vec4.len(normalized), 1, 0.002);
            });
        });
    });

    // DISTANCE CALCULATIONS TESTS
    describe('Distance Calculations', () => {
        test('should calculate Euclidean distance correctly', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(4, 6, 7, 8);

            const expected = Math.sqrt(57);

            expectNumberClose(Vec4.distance(a, b), expected);
            expectNumberClose(a.distance(b), expected);
        });

        test('should calculate distance squared correctly', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(4, 6, 7, 8);

            expect(Vec4.distanceSquared(a, b)).toBe(57);
            expect(a.distanceSquared(b)).toBe(57);
        });

        test('should calculate Manhattan distance correctly', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(4, 6, 7, 8);

            expect(Vec4.manhattanDistance(a, b)).toBe(15);
            expect(a.manhattanDistance(b)).toBe(15);
        });

        test('should calculate Chebyshev distance correctly', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(4, 6, 7, 8);

            expect(Vec4.chebyshevDistance(a, b)).toBe(4);
            expect(a.chebyshevDistance(b)).toBe(4);
        });

        test('should calculate fast distance approximation', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(4, 6, 7, 8);

            const fastDist = Vec4.distanceFast(a, b);
            const realDist = Vec4.distance(a, b);

            expect(Math.abs(fastDist - realDist) / realDist).toBeLessThan(0.3);
        });

        test('should return zero distance for same point', () => {
            const a = new Vec4(1, 2, 3, 4);

            expect(Vec4.distance(a, a)).toBe(0);
            expect(Vec4.manhattanDistance(a, a)).toBe(0);
            expect(Vec4.chebyshevDistance(a, a)).toBe(0);
        });
    });

    // ANGLE CALCULATIONS TESTS
    describe('Angle Calculations', () => {
        test('should calculate angle between vectors correctly', () => {
            const a = new Vec4(1, 0, 0, 0);
            const b = new Vec4(0, 1, 0, 0);

            expectNumberClose(Vec4.angleBetween(a, b), Math.PI / 2);
            expectNumberClose(a.angleBetween(b), Math.PI / 2);
        });

        test('should return zero angle for same direction', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(2, 4, 6, 8);

            expectNumberClose(Vec4.angleBetween(a, b), 0);
        });

        test('should return PI for opposite direction', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(-1, -2, -3, -4);

            expectNumberClose(Vec4.angleBetween(a, b), Math.PI);
        });

        test('should convert angle to degrees correctly', () => {
            const a = new Vec4(1, 0, 0, 0);
            const b = new Vec4(0, 1, 0, 0);

            expectNumberClose(Vec4.angle2Deg(a, b), 90);
            expectNumberClose(a.angle2Deg(b), 90);
        });

        test('should throw error for zero vector angle calculation', () => {
            const a = new Vec4(1, 2, 3, 4);
            const zero = new Vec4(0, 0, 0, 0);

            expect(() => Vec4.angleBetween(a, zero)).toThrow(
                'Cannot calculate angle with zero-length vector'
            );
        });
    });

    // 4D ROTATION TESTS
    describe('4D Rotations', () => {
        test('should rotate in XY plane correctly', () => {
            const vec = new Vec4(1, 0, 5, 10);
            const angle = Math.PI / 2;
            const result = Vec4.rotateXY(vec, angle);

            expectVectorClose(result, { x: 0, y: 1, z: 5, w: 10 }, 1e-10);
        });

        test('should rotate in XZ plane correctly', () => {
            const vec = new Vec4(1, 5, 0, 10);
            const angle = Math.PI / 2;
            const result = Vec4.rotateXZ(vec, angle);

            expectVectorClose(result, { x: 0, y: 5, z: -1, w: 10 }, 1e-10);
        });

        test('should rotate in XW plane correctly', () => {
            const vec = new Vec4(1, 5, 10, 0);
            const angle = Math.PI / 2;
            const result = Vec4.rotateXW(vec, angle);

            expectVectorClose(result, { x: 0, y: 5, z: 10, w: 1 }, 1e-10);
        });

        test('should rotate in YZ plane correctly', () => {
            const vec = new Vec4(5, 1, 0, 10);
            const angle = Math.PI / 2;
            const result = Vec4.rotateYZ(vec, angle);

            expectVectorClose(result, { x: 5, y: 0, z: 1, w: 10 }, 1e-10);
        });

        test('should rotate in YW plane correctly', () => {
            const vec = new Vec4(5, 1, 10, 0);
            const angle = Math.PI / 2;
            const result = Vec4.rotateYW(vec, angle);

            expectVectorClose(result, { x: 5, y: 0, z: 10, w: 1 }, 1e-10);
        });

        test('should rotate in ZW plane correctly', () => {
            const vec = new Vec4(5, 10, 1, 0);
            const angle = Math.PI / 2;
            const result = Vec4.rotateZW(vec, angle);

            expectVectorClose(result, { x: 5, y: 10, z: 0, w: 1 }, 1e-10);
        });

        test('should preserve vector length during rotation', () => {
            const vec = new Vec4(3, 4, 5, 6);
            const originalLength = vec.length();

            vec.rotateXY(Math.PI / 3);
            expectNumberClose(vec.length(), originalLength);

            vec.rotateZW(Math.PI / 4);
            expectNumberClose(vec.length(), originalLength);
        });

        test('should handle full rotation (2π)', () => {
            const original = new Vec4(1, 2, 3, 4);
            const vec = original.clone();

            vec.rotateXY(2 * Math.PI);
            expectVectorClose(vec, original, 1e-10);
        });
    });

    // INTERPOLATION TESTS
    describe('Interpolation', () => {
        describe('Linear Interpolation', () => {
            test('should lerp between vectors correctly', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(4, 4, 4, 4);

                expectVectorClose(Vec4.lerp(a, b, 0), a);
                expectVectorClose(Vec4.lerp(a, b, 1), b);
                expectVectorClose(Vec4.lerp(a, b, 0.5), { x: 2, y: 2, z: 2, w: 2 });
            });

            test('should clamp t parameter in lerp', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(4, 4, 4, 4);

                expectVectorClose(Vec4.lerp(a, b, -0.5), a);
                expectVectorClose(Vec4.lerp(a, b, 1.5), b);
            });

            test('should not clamp t parameter in lerpUnClamped', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(4, 4, 4, 4);

                expectVectorClose(Vec4.lerpUnClamped(a, b, -0.5), { x: -2, y: -2, z: -2, w: -2 });
                expectVectorClose(Vec4.lerpUnClamped(a, b, 1.5), { x: 6, y: 6, z: 6, w: 6 });
            });
        });

        describe('Spherical Linear Interpolation', () => {
            test('should slerp between unit vectors correctly', () => {
                const a = new Vec4(1, 0, 0, 0);
                const b = new Vec4(0, 1, 0, 0);

                const result = Vec4.slerp(a, b, 0.5);
                expectNumberClose(Vec4.len(result), 1, 1e-10);
            });

            test('should fallback to lerp for zero-length vectors', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(1, 1, 1, 1);

                const slerpResult = Vec4.slerp(a, b, 0.5);
                const lerpResult = Vec4.lerp(a, b, 0.5);

                expectVectorClose(slerpResult, lerpResult);
            });

            test('should fallback to lerp for nearly parallel vectors', () => {
                const a = new Vec4(1, 0, 0, 0);
                const b = new Vec4(1 + EPSILON * 0.1, 0, 0, 0);

                const slerpResult = Vec4.slerp(a, b, 0.5);
                const lerpResult = Vec4.lerp(a, b, 0.5);

                expectVectorClose(slerpResult, lerpResult, 1e-6);
            });
        });

        describe('Smooth Interpolation', () => {
            test('should smooth step between vectors', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(4, 4, 4, 4);

                const result = Vec4.smoothStep(a, b, 0.5);
                expectVectorClose(result, { x: 2, y: 2, z: 2, w: 2 });

                expectVectorClose(Vec4.smoothStep(a, b, 0), a);
                expectVectorClose(Vec4.smoothStep(a, b, 1), b);
            });

            test('should smoother step between vectors', () => {
                const a = new Vec4(0, 0, 0, 0);
                const b = new Vec4(4, 4, 4, 4);

                const result = Vec4.smootherStep(a, b, 0.5);
                expectVectorClose(result, { x: 2, y: 2, z: 2, w: 2 });
            });
        });

        describe('Cubic Bezier', () => {
            test('should interpolate cubic bezier curve correctly', () => {
                const p0 = new Vec4(0, 0, 0, 0);
                const c1 = new Vec4(1, 1, 1, 1);
                const c2 = new Vec4(2, 2, 2, 2);
                const p1 = new Vec4(3, 3, 3, 3);

                expectVectorClose(Vec4.cubicBezier(p0, c1, c2, p1, 0), p0);
                expectVectorClose(Vec4.cubicBezier(p0, c1, c2, p1, 1), p1);

                const mid = Vec4.cubicBezier(p0, c1, c2, p1, 0.5);
                expect(mid.x).toBeCloseTo(1.5, 10);
            });
        });

        describe('Hermite Interpolation', () => {
            test('should interpolate hermite spline correctly', () => {
                const p0 = new Vec4(0, 0, 0, 0);
                const m0 = new Vec4(1, 1, 1, 1);
                const p1 = new Vec4(2, 2, 2, 2);
                const m1 = new Vec4(1, 1, 1, 1);

                expectVectorClose(Vec4.hermite(p0, m0, p1, m1, 0), p0);
                expectVectorClose(Vec4.hermite(p0, m0, p1, m1, 1), p1);
            });
        });

        describe('Catmull-Rom Spline', () => {
            test('should interpolate catmull-rom spline correctly', () => {
                const p0 = new Vec4(0, 0, 0, 0);
                const p1 = new Vec4(1, 1, 1, 1);
                const p2 = new Vec4(2, 2, 2, 2);
                const p3 = new Vec4(3, 3, 3, 3);

                expectVectorClose(Vec4.catmullRom(p0, p1, p2, p3, 0), p1);
                expectVectorClose(Vec4.catmullRom(p0, p1, p2, p3, 1), p2);

                const mid = Vec4.catmullRom(p0, p1, p2, p3, 0.5);
                expectVectorClose(mid, { x: 1.5, y: 1.5, z: 1.5, w: 1.5 });
            });

            test('should handle different tension values', () => {
                const p0 = new Vec4(0, 0, 2, 1);
                const p1 = new Vec4(1, 2, 1, 2);
                const p2 = new Vec4(3, 1, 3, 1);
                const p3 = new Vec4(4, 3, 2, 3);

                const tightCurve = Vec4.catmullRom(p0, p1, p2, p3, 0.5, 0);
                const looseCurve = Vec4.catmullRom(p0, p1, p2, p3, 0.5, 1);

                expect(Vec4.distance(tightCurve, looseCurve)).toBeGreaterThan(0);
            });
        });
    });

    // RANDOM GENERATION TESTS
    describe('Random Generation', () => {
        test('should generate random unit vectors', () => {
            for (let i = 0; i < 10; i++) {
                const vec = Vec4.random();
                expectNumberClose(Vec4.len(vec), 1, 1e-10);
            }
        });

        test('should generate random vectors with custom scale', () => {
            const scale = 5;
            for (let i = 0; i < 10; i++) {
                const vec = Vec4.random(scale);
                expectNumberClose(Vec4.len(vec), scale, 1e-10);
            }
        });

        test('should generate fast random vectors', () => {
            for (let i = 0; i < 10; i++) {
                const vec = Vec4.fastRandom();
                expectNumberClose(Vec4.len(vec), 1, 1e-10);
            }
        });

        test('should generate normally distributed vectors', () => {
            const samples = [];
            for (let i = 0; i < 3000; i++) {
                samples.push(Vec4.randomNormal());
            }

            const means = {
                x: samples.reduce((sum, v) => sum + v.x, 0) / samples.length,
                y: samples.reduce((sum, v) => sum + v.y, 0) / samples.length,
                z: samples.reduce((sum, v) => sum + v.z, 0) / samples.length,
                w: samples.reduce((sum, v) => sum + v.w, 0) / samples.length,
            };

            expectNumberClose(means.x, 0, 0.25);
            expectNumberClose(means.y, 0, 0.25);
            expectNumberClose(means.z, 0, 0.25);
            expectNumberClose(means.w, 0, 0.25);

            const uniqueVectors = new Set(
                samples
                    .slice(0, 100)
                    .map(
                        (v) =>
                            `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)},${v.w.toFixed(3)}`
                    )
            );
            expect(uniqueVectors.size).toBeGreaterThan(50);
        });

        test('should generate random vectors in box', () => {
            for (let i = 0; i < 10; i++) {
                const vec = Vec4.randomBox(-5, 5, -10, 10, -15, 15, -20, 20);

                expect(vec.x).toBeGreaterThanOrEqual(-5);
                expect(vec.x).toBeLessThanOrEqual(5);
                expect(vec.y).toBeGreaterThanOrEqual(-10);
                expect(vec.y).toBeLessThanOrEqual(10);
                expect(vec.z).toBeGreaterThanOrEqual(-15);
                expect(vec.z).toBeLessThanOrEqual(15);
                expect(vec.w).toBeGreaterThanOrEqual(-20);
                expect(vec.w).toBeLessThanOrEqual(20);
            }
        });

        test('should generate normally distributed vectors in box', () => {
            for (let i = 0; i < 10; i++) {
                const vec = Vec4.randomBoxNormal(-5, 5, -10, 10, -15, 15, -20, 20);

                expect(vec.x).toBeGreaterThanOrEqual(-5);
                expect(vec.x).toBeLessThanOrEqual(5);
                expect(vec.y).toBeGreaterThanOrEqual(-10);
                expect(vec.y).toBeLessThanOrEqual(10);
                expect(vec.z).toBeGreaterThanOrEqual(-15);
                expect(vec.z).toBeLessThanOrEqual(15);
                expect(vec.w).toBeGreaterThanOrEqual(-20);
                expect(vec.w).toBeLessThanOrEqual(20);
            }
        });
    });

    // PROJECTION AND REFLECTION TESTS
    describe('Projection and Reflection', () => {
        test('should project vector correctly', () => {
            const a = new Vec4(3, 4, 0, 0);
            const b = new Vec4(1, 0, 0, 0);

            const projected = Vec4.project(a, b);
            expectVectorClose(projected, { x: 3, y: 0, z: 0, w: 0 });
        });

        test('should reject vector correctly', () => {
            const a = new Vec4(3, 4, 0, 0);
            const b = new Vec4(1, 0, 0, 0);

            const rejected = Vec4.reject(a, b);
            expectVectorClose(rejected, { x: 0, y: 4, z: 0, w: 0 });
        });

        test('should verify projection + rejection equals original', () => {
            const a = new Vec4(3, 4, 5, 6);
            const b = new Vec4(1, 1, 1, 1);

            const projected = Vec4.project(a, b);
            const rejected = Vec4.reject(a, b);
            const sum = Vec4.add(projected, rejected);

            expectVectorClose(sum, a);
        });

        test('should reflect vector correctly', () => {
            const incident = new Vec4(1, 1, 0, 0);
            const normal = new Vec4(0, 1, 0, 0);

            const reflected = Vec4.reflect(incident, normal);
            expectVectorClose(reflected, { x: 1, y: -1, z: 0, w: 0 });
        });

        test('should preserve vector length in reflection', () => {
            const incident = new Vec4(3, 4, 5, 6);
            const normal = Vec4.normalize(new Vec4(1, 1, 1, 1));

            const reflected = Vec4.reflect(incident, normal);
            expectNumberClose(Vec4.len(reflected), Vec4.len(incident));
        });

        test('should throw error for projection onto zero vector', () => {
            const a = new Vec4(1, 2, 3, 4);
            const zero = new Vec4(0, 0, 0, 0);

            expect(() => Vec4.project(a, zero)).toThrow('Cannot project onto zero-length vector');
        });
    });

    // COMPARISON TESTS
    describe('Comparison and Sorting', () => {
        describe('Vec4Comparer', () => {
            test('should compare lexicographically', () => {
                const comparer = new Vec4Comparer(Vec4ComparisonMode.LEXICOGRAPHIC);

                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(1, 2, 3, 5);
                const c = new Vec4(1, 2, 4, 3);

                expect(comparer.compare(a, b)).toBe(-1);
                expect(comparer.compare(b, a)).toBe(1);
                expect(comparer.compare(a, c)).toBe(-1);
                expect(comparer.compare(a, a)).toBe(0);
            });

            test('should compare by magnitude', () => {
                const comparer = new Vec4Comparer(Vec4ComparisonMode.MAGNITUDE);

                const a = new Vec4(1, 0, 0, 0);
                const b = new Vec4(2, 0, 0, 0);

                expect(comparer.compare(a, b)).toBe(-1);
                expect(comparer.compare(b, a)).toBe(1);
                expect(comparer.compare(a, a)).toBe(0);
            });

            test('should compare by Manhattan distance', () => {
                const comparer = new Vec4Comparer(Vec4ComparisonMode.MANHATTAN);

                const a = new Vec4(1, 1, 1, 1);
                const b = new Vec4(2, 2, 0, 0);
                const c = new Vec4(3, 0, 0, 0);

                expect(comparer.compare(a, b)).toBe(0);
                expect(comparer.compare(c, a)).toBe(-1);
            });

            test('should throw error for unsupported comparison mode', () => {
                const comparer = new Vec4Comparer(999 as Vec4ComparisonMode);
                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(5, 6, 7, 8);

                expect(() => comparer.compare(a, b)).toThrow('Unsupported Vec4 comparison mode');
            });
        });

        describe('Vec4EqualityComparer', () => {
            test('should compare equality with default epsilon', () => {
                const comparer = new Vec4EqualityComparer();

                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(1 + EPSILON * 0.5, 2, 3, 4);
                const c = new Vec4(1 + EPSILON * 2, 2, 3, 4);

                expect(comparer.equals(a, b)).toBe(true);
                expect(comparer.equals(a, c)).toBe(false);
            });

            test('should compare equality with custom epsilon', () => {
                const comparer = new Vec4EqualityComparer(1e-3);

                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(1.0005, 2, 3, 4);
                const c = new Vec4(1.002, 2, 3, 4);

                expect(comparer.equals(a, b)).toBe(true);
                expect(comparer.equals(a, c)).toBe(false);
            });

            test('should handle null/undefined in equality', () => {
                const comparer = new Vec4EqualityComparer();
                const a = new Vec4(1, 2, 3, 4);

                expect(comparer.equals(a, null as any)).toBe(false);
                expect(comparer.equals(null as any, a)).toBe(false);
                expect(comparer.equals(null as any, null as any)).toBe(false);
            });

            test('should generate consistent hash codes', () => {
                const comparer = new Vec4EqualityComparer();

                const a = new Vec4(1, 2, 3, 4);
                const b = new Vec4(1, 2, 3, 4);

                expect(comparer.hash(a)).toBe(comparer.hash(b));
                expect(comparer.hash(null as any)).toBe(0);
            });
        });
    });

    // EDGE CASES AND ERROR HANDLING TESTS
    describe('Edge Cases and Error Handling', () => {
        test('should handle very large numbers', () => {
            const large = new Vec4(LARGE_NUMBER, LARGE_NUMBER, LARGE_NUMBER, LARGE_NUMBER);

            expect(() => large.length()).not.toThrow();
            expect(large.length()).toBeGreaterThan(0);
            expect(isFinite(large.length())).toBe(true);
        });

        test('should handle very small numbers', () => {
            const small = new Vec4(SMALL_NUMBER, SMALL_NUMBER, SMALL_NUMBER, SMALL_NUMBER);

            expect(() => small.length()).not.toThrow();
            expect(small.length()).toBeGreaterThan(0);
            expect(isFinite(small.length())).toBe(true);
        });

        test('should handle mixed large and small numbers', () => {
            const mixed = new Vec4(LARGE_NUMBER, SMALL_NUMBER, -LARGE_NUMBER, -SMALL_NUMBER);

            expect(() => mixed.normalize()).not.toThrow();
            expectNumberClose(mixed.length(), 1);
        });

        test('should handle NaN inputs gracefully', () => {
            const withNaN = new Vec4(NaN, 1, 2, 3);

            expect(isNaN(withNaN.length())).toBe(true);
            expect(isNaN(Vec4.dot(withNaN, Vec4.ONE))).toBe(true);
        });

        test('should handle Infinity inputs', () => {
            const withInfinity = new Vec4(Infinity, 1, 2, 3);

            expect(withInfinity.length()).toBe(Infinity);
            expect(() => withInfinity.normalize()).toThrow();
        });

        test('should maintain precision with repeated operations', () => {
            let vec = new Vec4(1, 2, 3, 4);
            const original = vec.clone();

            for (let i = 0; i < 1000; i++) {
                vec.multiplyScalar(1.001).divideScalar(1.001);
            }

            expectVectorClose(vec, original, 1e-10);
        });

        test('should handle zero vectors consistently', () => {
            const zero = new Vec4(0, 0, 0, 0);

            expect(zero.length()).toBe(0);
            expect(zero.lengthSquared()).toBe(0);
            expect(Vec4.dot(zero, Vec4.ONE)).toBe(0);
            expect(() => zero.normalize()).toThrow();
        });
    });

    // PERFORMANCE AND STRESS TESTS
    describe('Performance and Stress Tests', () => {
        test('should handle large number of operations efficiently', () => {
            const vectors = Array.from({ length: 1000 }, () => createRandomVec4());

            const startTime = performance.now();

            for (let i = 0; i < vectors.length - 1; i++) {
                Vec4.add(vectors[i], vectors[i + 1]);
                Vec4.dot(vectors[i], vectors[i + 1]);
                Vec4.distance(vectors[i], vectors[i + 1]);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(10);
        });

        test('should maintain accuracy with batch operations', () => {
            const vectors = Array.from({ length: 100 }, () => createRandomVec4(1));

            const normalized = vectors.map((v) => Vec4.normalize(v.clone()));

            normalized.forEach((v) => {
                expectNumberClose(Vec4.len(v), 1, 1e-10);
            });
        });

        test('should handle output parameter reuse efficiently', () => {
            const a = createRandomVec4();
            const b = createRandomVec4();
            const output = new Vec4();

            for (let i = 0; i < 1000; i++) {
                Vec4.add(a, b, output);
                Vec4.multiply(output, Vec4.ONE, output);
            }

            const expected = Vec4.add(a, b);
            expectVectorClose(output, expected);
        });
    });

    // INTEGRATION TESTS
    describe('Integration Tests', () => {
        test('should work correctly in complete transformation pipeline', () => {
            let vertex = new Vec4(1, 2, 3, 1);

            vertex.multiplyScalar(2);
            expectVectorClose(vertex, { x: 2, y: 4, z: 6, w: 2 });

            vertex.rotateXY(Math.PI / 4);

            vertex.x += 5;
            vertex.y += 10;
            vertex.z += 15;

            vertex.x /= vertex.w;
            vertex.y /= vertex.w;
            vertex.z /= vertex.w;
            vertex.w = 1;

            expect(vertex.w).toBe(1);
            expect(isFinite(vertex.x)).toBe(true);
            expect(isFinite(vertex.y)).toBe(true);
            expect(isFinite(vertex.z)).toBe(true);
        });

        test('should work correctly with color operations', () => {
            const color1 = new Vec4(1.0, 0.5, 0.25, 0.8);
            const color2 = new Vec4(0.2, 0.8, 0.9, 0.6);

            const blended = Vec4.lerp(color1, color2, 0.5);

            blended.x = clamp01(blended.x);
            blended.y = clamp01(blended.y);
            blended.z = clamp01(blended.z);
            blended.w = clamp01(blended.w);

            expect(blended.x).toBeGreaterThanOrEqual(0);
            expect(blended.x).toBeLessThanOrEqual(1);
            expect(blended.y).toBeGreaterThanOrEqual(0);
            expect(blended.y).toBeLessThanOrEqual(1);
            expect(blended.z).toBeGreaterThanOrEqual(0);
            expect(blended.z).toBeLessThanOrEqual(1);
            expect(blended.w).toBeGreaterThanOrEqual(0);
            expect(blended.w).toBeLessThanOrEqual(1);
        });

        test('should maintain mathematical properties in complex operations', () => {
            const a = createRandomVec4();
            const b = createRandomVec4();
            const c = createRandomVec4();

            const dotSum = Vec4.dot(a, Vec4.add(b, c));
            const sumDots = Vec4.dot(a, b) + Vec4.dot(a, c);

            expectNumberClose(dotSum, sumDots, 1e-10);

            const addAB = Vec4.add(a, b);
            const addBA = Vec4.add(b, a);

            expectVectorClose(addAB, addBA);

            const leftAssoc = Vec4.add(Vec4.add(a, b), c);
            const rightAssoc = Vec4.add(a, Vec4.add(b, c));

            expectVectorClose(leftAssoc, rightAssoc);
        });
    });

    // ADDITIONAL HELPER TESTS
    describe('Test Utilities Validation', () => {
        test('should validate expectVectorClose helper', () => {
            const a = new Vec4(1, 2, 3, 4);
            const b = new Vec4(1.00001, 2.00001, 3.00001, 4.00001);

            expect(() => expectVectorClose(a, b, 1e-4)).not.toThrow();
            expect(() => expectVectorClose(a, b, 1e-6)).toThrow();
        });

        test('should validate expectNumberClose helper', () => {
            expect(() => expectNumberClose(1.0, 1.00001, 1e-4)).not.toThrow();
            expect(() => expectNumberClose(1.0, 1.00001, 1e-6)).toThrow();
        });

        test('should validate createRandomVec4 helper', () => {
            const vec = createRandomVec4(10);

            expect(Math.abs(vec.x)).toBeLessThanOrEqual(10);
            expect(Math.abs(vec.y)).toBeLessThanOrEqual(10);
            expect(Math.abs(vec.z)).toBeLessThanOrEqual(10);
            expect(Math.abs(vec.w)).toBeLessThanOrEqual(10);
        });
    });
});
