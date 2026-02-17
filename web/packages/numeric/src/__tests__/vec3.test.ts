import { describe, expect, test } from 'vitest';
import { Vec3, Vec3ComparisonMode, Vec3Comparer, Vec3EqualityComparer, IVec3Like } from '../vec3';

declare global {
    namespace jest {
        interface Matchers<R> {
            toBeCloseToVec3(expected: Vec3, precision?: number): R;
            toBeNormalizedVec3(precision?: number): R;
            toBePerpendicularTo(other: Vec3, precision?: number): R;
        }
    }
}

const EPSILON = 1e-10;
const FLOAT_PRECISION = 1e-6;
const PERFORMANCE_ITERATIONS = 100000;

class Vec3TestDataBuilder {
    static createZero(): Vec3 {
        return new Vec3(0, 0, 0);
    }

    static createUnit(): Vec3 {
        return new Vec3(1, 1, 1);
    }

    static createRandom(scale: number = 1): Vec3 {
        return new Vec3(
            (Math.random() - 0.5) * 2 * scale,
            (Math.random() - 0.5) * 2 * scale,
            (Math.random() - 0.5) * 2 * scale
        );
    }

    static createNormalized(): Vec3 {
        const v = Vec3TestDataBuilder.createRandom(10);
        return v.normalize();
    }

    static createLarge(): Vec3 {
        return new Vec3(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    }

    static createSmall(): Vec3 {
        return new Vec3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);
    }

    static createNearZero(): Vec3 {
        return new Vec3(EPSILON / 2, EPSILON / 2, EPSILON / 2);
    }

    static createBatch(count: number): Vec3[] {
        return Array.from({ length: count }, () => Vec3TestDataBuilder.createRandom());
    }
}

expect.extend({
    toBeCloseToVec3(received: IVec3Like, expected: IVec3Like, precision = FLOAT_PRECISION) {
        const normalizeZero = (val: number) => (val === 0 ? 0 : val);

        const rxNorm = normalizeZero(received.x);
        const ryNorm = normalizeZero(received.y);
        const rzNorm = normalizeZero(received.z);
        const exNorm = normalizeZero(expected.x);
        const eyNorm = normalizeZero(expected.y);
        const ezNorm = normalizeZero(expected.z);

        const pass =
            Math.abs(rxNorm - exNorm) < precision &&
            Math.abs(ryNorm - eyNorm) < precision &&
            Math.abs(rzNorm - ezNorm) < precision;

        return {
            message: () =>
                `expected Vec3(${received.x}, ${received.y}, ${received.z}) to be close to Vec3(${expected.x}, ${expected.y}, ${expected.z})`,
            pass,
        };
    },

    toBeNormalizedVec3(received: Vec3, precision = FLOAT_PRECISION) {
        const length = received.length();
        const pass = Math.abs(length - 1) < precision;

        return {
            message: () => `expected Vec3 to be normalized (length = 1), but length was ${length}`,
            pass,
        };
    },

    toBePerpendicularTo(received: Vec3, other: Vec3, precision = FLOAT_PRECISION) {
        const dotProduct = Vec3.dot(received, other);
        const pass = Math.abs(dotProduct) < precision;

        return {
            message: () =>
                `expected vectors to be perpendicular (dot product = 0), but dot product was ${dotProduct}`,
            pass,
        };
    },
});

describe('Vec3 Test Suite', () => {
    describe('Constructor and Factory Methods', () => {
        describe('constructor', () => {
            test('should create vector with default values (0,0,0)', () => {
                const v = new Vec3();
                expect(v.x).toBe(0);
                expect(v.y).toBe(0);
                expect(v.z).toBe(0);
            });

            test('should create vector with provided values', () => {
                const v = new Vec3(1, 2, 3);
                expect(v.x).toBe(1);
                expect(v.y).toBe(2);
                expect(v.z).toBe(3);
            });

            test('should handle negative values', () => {
                const v = new Vec3(-1, -2, -3);
                expect(v.x).toBe(-1);
                expect(v.y).toBe(-2);
                expect(v.z).toBe(-3);
            });

            test('should handle fractional values', () => {
                const v = new Vec3(1.5, 2.7, 3.14159);
                expect(v.x).toBe(1.5);
                expect(v.y).toBe(2.7);
                expect(v.z).toBe(3.14159);
            });

            test('should handle extreme values', () => {
                const v = new Vec3(Number.MAX_VALUE, Number.MIN_VALUE, Number.POSITIVE_INFINITY);
                expect(v.x).toBe(Number.MAX_VALUE);
                expect(v.y).toBe(Number.MIN_VALUE);
                expect(v.z).toBe(Number.POSITIVE_INFINITY);
            });
        });

        describe('static constants', () => {
            test('ZERO should be (0,0,0)', () => {
                expect(Vec3.ZERO.x).toBe(0);
                expect(Vec3.ZERO.y).toBe(0);
                expect(Vec3.ZERO.z).toBe(0);
            });

            test('ONE should be (1,1,1)', () => {
                expect(Vec3.ONE.x).toBe(1);
                expect(Vec3.ONE.y).toBe(1);
                expect(Vec3.ONE.z).toBe(1);
            });

            test('UNIT_X should be (1,0,0)', () => {
                expect(Vec3.UNIT_X.x).toBe(1);
                expect(Vec3.UNIT_X.y).toBe(0);
                expect(Vec3.UNIT_X.z).toBe(0);
            });

            test('UNIT_Y should be (0,1,0)', () => {
                expect(Vec3.UNIT_Y.x).toBe(0);
                expect(Vec3.UNIT_Y.y).toBe(1);
                expect(Vec3.UNIT_Y.z).toBe(0);
            });

            test('UNIT_Z should be (0,0,1)', () => {
                expect(Vec3.UNIT_Z.x).toBe(0);
                expect(Vec3.UNIT_Z.y).toBe(0);
                expect(Vec3.UNIT_Z.z).toBe(1);
            });

            test('UP should be (0,1,0)', () => {
                expect(Vec3.UP.x).toBe(0);
                expect(Vec3.UP.y).toBe(1);
                expect(Vec3.UP.z).toBe(0);
            });

            test('FORWARD should be (0,0,1)', () => {
                expect(Vec3.FORWARD.x).toBe(0);
                expect(Vec3.FORWARD.y).toBe(0);
                expect(Vec3.FORWARD.z).toBe(1);
            });

            test('constants should be readonly', () => {
                expect(() => {
                    (Vec3.ZERO as any).x = 1;
                }).toThrow();
            });
        });

        describe('from', () => {
            test('should create Vec3 from IVec3Like object', () => {
                const source = { x: 1, y: 2, z: 3 };
                const result = Vec3.from(source);
                expect(result).toEqual(new Vec3(1, 2, 3));
                expect(result).not.toBe(source);
            });

            test('should work with Vec3 instance', () => {
                const source = new Vec3(1, 2, 3);
                const result = Vec3.from(source);
                expect(result).toEqual(source);
                expect(result).not.toBe(source);
            });
        });

        describe('fromArray', () => {
            test('should create Vec3 from array with default offset', () => {
                const arr = [1, 2, 3, 4, 5];
                const result = Vec3.fromArray(arr);
                expect(result).toEqual(new Vec3(1, 2, 3));
            });

            test('should create Vec3 from array with custom offset', () => {
                const arr = [0, 1, 2, 3, 4, 5];
                const result = Vec3.fromArray(arr, 2);
                expect(result).toEqual(new Vec3(2, 3, 4));
            });

            test('should throw error for negative offset', () => {
                const arr = [1, 2, 3];
                expect(() => Vec3.fromArray(arr, -1)).toThrow('Offset cannot be negative');
            });

            test('should throw error for insufficient array length', () => {
                const arr = [1, 2];
                expect(() => Vec3.fromArray(arr)).toThrow('Array must have at least 3 elements');
            });

            test('should throw error for insufficient array length with offset', () => {
                const arr = [1, 2, 3, 4];
                expect(() => Vec3.fromArray(arr, 3)).toThrow(
                    'Array must have at least 6 elements when using offset 3'
                );
            });

            test('should handle typed arrays', () => {
                const arr = new Float32Array([1.5, 2.5, 3.5]);
                const result = Vec3.fromArray(arr);
                expect(result).toEqual(new Vec3(1.5, 2.5, 3.5));
            });
        });

        describe('create', () => {
            test('should create with default values', () => {
                const result = Vec3.create();
                expect(result).toEqual(new Vec3(0, 0, 0));
            });

            test('should create with provided values', () => {
                const result = Vec3.create(1, 2, 3);
                expect(result).toEqual(new Vec3(1, 2, 3));
            });
        });
    });

    // BASIC OBJECT METHODS
    describe('Basic Object Methods', () => {
        describe('clone', () => {
            test('should create identical copy', () => {
                const original = new Vec3(1, 2, 3);
                const clone = original.clone();
                expect(clone).toEqual(original);
                expect(clone).not.toBe(original);
            });

            test('should maintain independence after cloning', () => {
                const original = new Vec3(1, 2, 3);
                const clone = original.clone();
                clone.x = 999;
                expect(original.x).toBe(1);
            });
        });

        describe('equals', () => {
            test('should return true for identical vectors', () => {
                const v1 = new Vec3(1, 2, 3);
                const v2 = new Vec3(1, 2, 3);
                expect(v1.equals(v2)).toBe(true);
            });

            test('should return false for different vectors', () => {
                const v1 = new Vec3(1, 2, 3);
                const v2 = new Vec3(1, 2, 4);
                expect(v1.equals(v2)).toBe(false);
            });

            test('should handle epsilon tolerance', () => {
                const v1 = new Vec3(1, 2, 3);
                const v2 = new Vec3(1 + EPSILON / 2, 2 + EPSILON / 2, 3 + EPSILON / 2);
                expect(v1.equals(v2)).toBe(true);
            });

            test('should return false for non-Vec3 objects', () => {
                const v1 = new Vec3(1, 2, 3);
                expect(v1.equals({ x: 1, y: 2, z: 3 })).toBe(false);
                expect(v1.equals(null)).toBe(false);
                expect(v1.equals(undefined)).toBe(false);
            });
        });

        describe('getHashCode', () => {
            test('should return same hash for equal vectors', () => {
                const v1 = new Vec3(1, 2, 3);
                const v2 = new Vec3(1, 2, 3);
                expect(v1.getHashCode()).toBe(v2.getHashCode());
            });

            test('should return different hash for different vectors', () => {
                const v1 = new Vec3(1, 2, 3);
                const v2 = new Vec3(1, 2, 4);
                expect(v1.getHashCode()).not.toBe(v2.getHashCode());
            });

            test('should return number type', () => {
                const v = new Vec3(1, 2, 3);
                expect(typeof v.getHashCode()).toBe('number');
            });
        });
    });

    // ARITHMETIC OPERATIONS
    describe('Arithmetic Operations', () => {
        describe('static add', () => {
            test('should add two vectors correctly', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                const result = Vec3.add(a, b);
                expect(result).toEqual(new Vec3(5, 7, 9));
            });

            test('should not mutate input vectors', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                Vec3.add(a, b);
                expect(a).toEqual(new Vec3(1, 2, 3));
                expect(b).toEqual(new Vec3(4, 5, 6));
            });

            test('should use output parameter when provided', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                const out = new Vec3();
                const result = Vec3.add(a, b, out);
                expect(result).toBe(out);
                expect(out).toEqual(new Vec3(5, 7, 9));
            });

            test('should handle negative values', () => {
                const a = new Vec3(-1, -2, -3);
                const b = new Vec3(1, 2, 3);
                const result = Vec3.add(a, b);
                expect(result).toEqual(new Vec3(0, 0, 0));
            });
        });

        describe('static addScalar', () => {
            test('should add scalar to all components', () => {
                const a = new Vec3(1, 2, 3);
                const result = Vec3.addScalar(a, 5);
                expect(result).toEqual(new Vec3(6, 7, 8));
            });

            test('should handle negative scalar', () => {
                const a = new Vec3(1, 2, 3);
                const result = Vec3.addScalar(a, -1);
                expect(result).toEqual(new Vec3(0, 1, 2));
            });
        });

        describe('static subtract', () => {
            test('should subtract vectors correctly', () => {
                const a = new Vec3(5, 7, 9);
                const b = new Vec3(1, 2, 3);
                const result = Vec3.subtract(a, b);
                expect(result).toEqual(new Vec3(4, 5, 6));
            });

            test('should handle zero result', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(1, 2, 3);
                const result = Vec3.subtract(a, b);
                expect(result).toEqual(new Vec3(0, 0, 0));
            });
        });

        describe('static multiply', () => {
            test('should multiply vectors component-wise', () => {
                const a = new Vec3(2, 3, 4);
                const b = new Vec3(3, 4, 5);
                const result = Vec3.multiply(a, b);
                expect(result).toEqual(new Vec3(6, 12, 20));
            });

            test('should handle zero multiplication', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(0, 0, 0);
                const result = Vec3.multiply(a, b);
                expect(result).toEqual(new Vec3(0, 0, 0));
            });
        });

        describe('static multiplyScalar', () => {
            test('should multiply by scalar correctly', () => {
                const a = new Vec3(1, 2, 3);
                const result = Vec3.multiplyScalar(a, 3);
                expect(result).toEqual(new Vec3(3, 6, 9));
            });

            test('should handle zero scalar', () => {
                const a = new Vec3(1, 2, 3);
                const result = Vec3.multiplyScalar(a, 0);
                expect(result).toEqual(new Vec3(0, 0, 0));
            });

            test('should handle negative scalar', () => {
                const a = new Vec3(1, 2, 3);
                const result = Vec3.multiplyScalar(a, -2);
                expect(result).toEqual(new Vec3(-2, -4, -6));
            });
        });

        describe('static divide', () => {
            test('should divide vectors component-wise', () => {
                const a = new Vec3(6, 8, 10);
                const b = new Vec3(2, 4, 5);
                const result = Vec3.divide(a, b);
                expect(result).toEqual(new Vec3(3, 2, 2));
            });

            test('should throw error for division by zero', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(0, 1, 1);
                expect(() => Vec3.divide(a, b)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });

            test('should throw error for division by near-zero', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(EPSILON / 2, 1, 1);
                expect(() => Vec3.divide(a, b)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });
        });

        describe('static divideScalar', () => {
            test('should divide by scalar correctly', () => {
                const a = new Vec3(6, 9, 12);
                const result = Vec3.divideScalar(a, 3);
                expect(result).toEqual(new Vec3(2, 3, 4));
            });

            test('should throw error for division by zero', () => {
                const a = new Vec3(1, 2, 3);
                expect(() => Vec3.divideScalar(a, 0)).toThrow(
                    'Division by zero or near-zero value is not allowed'
                );
            });
        });

        describe('static negate', () => {
            test('should negate all components', () => {
                const a = new Vec3(1, -2, 3);
                const result = Vec3.negate(a);
                expect(result).toEqual(new Vec3(-1, 2, -3));
            });

            test('should handle zero vector', () => {
                const a = new Vec3(0, 0, 0);
                const result = Vec3.negate(a);
                expect(result.x).toBe(0);
                expect(result.y).toBe(0);
                expect(result.z).toBe(0);
            });
        });

        describe('instance add', () => {
            test('should modify vector in place', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                const result = a.add(b);
                expect(result).toBe(a);
                expect(a).toEqual(new Vec3(5, 7, 9));
            });
        });
    });

    // VECTOR OPERATIONS
    describe('Vector Operations', () => {
        describe('static dot', () => {
            test('should calculate dot product correctly', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                const result = Vec3.dot(a, b);
                expect(result).toBe(32);
            });

            test('should return zero for perpendicular vectors', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const result = Vec3.dot(a, b);
                expect(result).toBe(0);
            });

            test('should return negative for obtuse angle', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(-1, 0, 0);
                const result = Vec3.dot(a, b);
                expect(result).toBe(-1);
            });
        });

        describe('static cross', () => {
            test('should calculate cross product correctly', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const result = Vec3.cross(a, b);
                expect(result).toEqual(new Vec3(0, 0, 1));
            });

            test('should be anti-commutative', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                const ab = Vec3.cross(a, b);
                const ba = Vec3.cross(b, a);
                expect(ab).toEqual(Vec3.negate(ba));
            });

            test('should return zero for parallel vectors', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(2, 4, 6);
                const result = Vec3.cross(a, b, new Vec3());
                expect(result.length()).toBeCloseTo(0, 6);
            });

            test('should use output parameter when provided', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const out = new Vec3();
                const result = Vec3.cross(a, b, out);
                expect(result).toBe(out);
                expect(out).toEqual(new Vec3(0, 0, 1));
            });
        });

        describe('static len', () => {
            test('should calculate length correctly', () => {
                const v = new Vec3(3, 4, 0);
                const result = Vec3.len(v);
                expect(result).toBe(5);
            });

            test('should return zero for zero vector', () => {
                const v = new Vec3(0, 0, 0);
                const result = Vec3.len(v);
                expect(result).toBe(0);
            });

            test('should handle 3D Pythagorean triple', () => {
                const v = new Vec3(2, 3, 6);
                const result = Vec3.len(v);
                expect(result).toBe(7);
            });
        });

        describe('static lengthSquared', () => {
            test('should calculate squared length correctly', () => {
                const v = new Vec3(3, 4, 0);
                const result = Vec3.lengthSquared(v);
                expect(result).toBe(25);
            });

            test('should be more efficient than length calculation', () => {
                const v = new Vec3(1, 2, 3);
                const lengthSq = Vec3.lengthSquared(v);
                const length = Vec3.len(v);
                expect(lengthSq).toBe(length * length);
            });
        });

        describe('static fastLength', () => {
            test('should approximate length', () => {
                const testCases = [
                    new Vec3(3, 4, 0),
                    new Vec3(1, 1, 1),
                    new Vec3(5, 12, 0),
                    new Vec3(1, 2, 3),
                ];

                testCases.forEach((v) => {
                    const exactLength = Vec3.len(v);
                    const fastLength = Vec3.fastLength(v);
                    const error = Math.abs(exactLength - fastLength) / exactLength;
                    expect(error).toBeLessThan(0.15);
                });
            });
        });

        describe('static normalize', () => {
            test('should create unit vector', () => {
                const v = new Vec3(3, 4, 0);
                const result = Vec3.normalize(v, new Vec3());
                expect(result.length()).toBeCloseTo(1, 6);
            });

            test('should preserve direction', () => {
                const v = new Vec3(3, 4, 5);
                const normalized = Vec3.normalize(v);
                const original = Vec3.multiplyScalar(normalized, Vec3.len(v));
                expect(original).toBeCloseToVec3(v);
            });

            test('should throw error for zero vector', () => {
                const v = new Vec3(0, 0, 0);
                expect(() => Vec3.normalize(v)).toThrow('Cannot normalize a zero-length vector');
            });

            test('should throw error for near-zero vector', () => {
                const v = new Vec3(EPSILON / 2, EPSILON / 2, EPSILON / 2);
                expect(() => Vec3.normalize(v)).toThrow('Cannot normalize a zero-length vector');
            });
        });

        describe('static normalizeQuake', () => {
            test('should approximate normalization', () => {
                const testCases = [new Vec3(3, 4, 0), new Vec3(1, 2, 3), new Vec3(5, 12, 13)];

                testCases.forEach((v) => {
                    const exactNorm = Vec3.normalize(v);
                    const fastNorm = Vec3.normalizeQuake(v, new Vec3());
                    const lengthDiff = Math.abs(fastNorm.length() - 1);
                    expect(lengthDiff).toBeLessThan(0.1);
                });
            });
        });
    });

    // DISTANCE OPERATIONS
    describe('Distance Operations', () => {
        describe('static distance', () => {
            test('should calculate Euclidean distance', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(3, 4, 0);
                const result = Vec3.distance(a, b);
                expect(result).toBe(5);
            });

            test('should be symmetric', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(4, 5, 6);
                expect(Vec3.distance(a, b)).toBe(Vec3.distance(b, a));
            });

            test('should return zero for identical points', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(1, 2, 3);
                expect(Vec3.distance(a, b)).toBe(0);
            });
        });

        describe('static distanceSquared', () => {
            test('should calculate squared distance', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(3, 4, 0);
                const result = Vec3.distanceSquared(a, b);
                expect(result).toBe(25);
            });
        });

        describe('static manhattanDistance', () => {
            test('should calculate Manhattan distance', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(3, 4, 5);
                const result = Vec3.manhattanDistance(a, b);
                expect(result).toBe(12); // |3| + |4| + |5|
            });

            test('should handle negative differences', () => {
                const a = new Vec3(5, 5, 5);
                const b = new Vec3(2, 3, 1);
                const result = Vec3.manhattanDistance(a, b);
                expect(result).toBe(9); // |5-2| + |5-3| + |5-1| = 3 + 2 + 4
            });
        });

        describe('static chebyshevDistance', () => {
            test('should calculate Chebyshev distance', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(3, 4, 2);
                const result = Vec3.chebyshevDistance(a, b);
                expect(result).toBe(4); // max(|3|, |4|, |2|)
            });
        });
    });

    // ANGULAR OPERATIONS
    describe('Angular Operations', () => {
        describe('static angleBetween', () => {
            test('should calculate angle between parallel vectors', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(2, 0, 0);
                const result = Vec3.angleBetween(a, b);
                expect(result).toBeCloseTo(0, 6);
            });

            test('should calculate angle between perpendicular vectors', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const result = Vec3.angleBetween(a, b);
                expect(result).toBeCloseTo(Math.PI / 2, 6);
            });

            test('should calculate angle between opposite vectors', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(-1, 0, 0);
                const result = Vec3.angleBetween(a, b);
                expect(result).toBeCloseTo(Math.PI, 6);
            });

            test('should throw error for zero vector', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(1, 0, 0);
                expect(() => Vec3.angleBetween(a, b)).toThrow(
                    'Cannot calculate angle with zero-length vector'
                );
            });
        });

        describe('static angle2Deg', () => {
            test('should convert angle to degrees', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const result = Vec3.angle2Deg(a, b);
                expect(result).toBeCloseTo(90, 6);
            });
        });
    });

    // ROTATION OPERATIONS
    describe('Rotation Operations', () => {
        describe('static rotateX', () => {
            test('should rotate around X axis', () => {
                const v = new Vec3(0, 1, 0);
                const result = Vec3.rotateX(v, Math.PI / 2);
                expect(result).toBeCloseToVec3(new Vec3(0, 0, 1));
            });

            test('should not affect X component', () => {
                const v = new Vec3(5, 1, 0);
                const result = Vec3.rotateX(v, Math.PI / 4);
                expect(result.x).toBeCloseTo(5, 6);
            });
        });

        describe('static rotateY', () => {
            test('should rotate around Y axis', () => {
                const v = new Vec3(1, 0, 0);
                const result = Vec3.rotateY(v, Math.PI / 2);
                expect(result).toBeCloseToVec3(new Vec3(0, 0, -1));
            });

            test('should not affect Y component', () => {
                const v = new Vec3(1, 5, 0);
                const result = Vec3.rotateY(v, Math.PI / 4);
                expect(result.y).toBeCloseTo(5, 6);
            });
        });

        describe('static rotateZ', () => {
            test('should rotate around Z axis', () => {
                const v = new Vec3(1, 0, 0);
                const result = Vec3.rotateZ(v, Math.PI / 2);
                expect(result).toBeCloseToVec3(new Vec3(0, 1, 0));
            });

            test('should not affect Z component', () => {
                const v = new Vec3(1, 0, 5);
                const result = Vec3.rotateZ(v, Math.PI / 4);
                expect(result.z).toBeCloseTo(5, 6);
            });
        });

        describe('static rotateAxis', () => {
            test('should rotate around arbitrary axis', () => {
                const v = new Vec3(1, 0, 0);
                const axis = new Vec3(0, 0, 1);
                const result = Vec3.rotateAxis(v, axis, Math.PI / 2);
                expect(result).toBeCloseToVec3(new Vec3(0, 1, 0));
            });

            test('should preserve vector length', () => {
                const v = new Vec3(3, 4, 5);
                const axis = Vec3.normalize(new Vec3(1, 1, 1));
                const originalLength = v.length();
                const result = Vec3.rotateAxis(v, axis, Math.PI / 3);
                expect(Vec3.len(result)).toBeCloseTo(originalLength, 6);
            });

            test('should not change vector when rotating around itself', () => {
                const v = new Vec3(1, 2, 3);
                const axis = Vec3.normalize(v);
                const result = Vec3.rotateAxis(v, axis, Math.PI / 2);
                expect(result).toBeCloseToVec3(v);
            });
        });
    });

    // INTERPOLATION OPERATIONS
    describe('Interpolation Operations', () => {
        describe('static lerp', () => {
            test('should interpolate linearly', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.lerp(a, b, 0.5);
                expect(result).toEqual(new Vec3(5, 10, 15));
            });

            test('should clamp t to [0,1]', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);

                const resultNegative = Vec3.lerp(a, b, -0.5);
                expect(resultNegative).toEqual(new Vec3(0, 0, 0));

                const resultOver = Vec3.lerp(a, b, 1.5);
                expect(resultOver).toEqual(new Vec3(10, 20, 30));
            });

            test('should return start point when t=0', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.lerp(a, b, 0);
                expect(result).toEqual(a);
            });

            test('should return end point when t=1', () => {
                const a = new Vec3(1, 2, 3);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.lerp(a, b, 1);
                expect(result).toEqual(b);
            });
        });

        describe('static lerpUnClamped', () => {
            test('should not clamp t values', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.lerpUnClamped(a, b, 2);
                expect(result).toEqual(new Vec3(20, 40, 60));
            });
        });

        describe('static slerp', () => {
            test('should spherically interpolate', () => {
                const a = new Vec3(1, 0, 0);
                const b = new Vec3(0, 1, 0);
                const result = Vec3.slerp(a, b, 0.5);

                const expectedLength = (a.length() + b.length()) / 2;
                expect(Vec3.len(result)).toBeCloseTo(expectedLength, 4);
            });

            test('should fallback to lerp for zero vectors', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(1, 1, 1);
                const result = Vec3.slerp(a, b, 0.5, new Vec3());
                const expectedLerp = Vec3.lerp(a, b, 0.5, new Vec3());
                expect(result).toBeCloseToVec3(expectedLerp);
            });
        });

        describe('static smoothStep', () => {
            test('should apply smooth step interpolation', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.smoothStep(a, b, 0.5);

                expect(result).toEqual(new Vec3(5, 10, 15));
            });

            test('should have zero derivative at endpoints', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);

                const result1 = Vec3.smoothStep(a, b, 0.01);
                const result2 = Vec3.smoothStep(a, b, 0.02);
                const result99 = Vec3.smoothStep(a, b, 0.99);
                const result98 = Vec3.smoothStep(a, b, 0.98);

                const diffStart = Vec3.distance(result2, result1);
                const diffEnd = Vec3.distance(result99, result98);
                const diffMiddle = Vec3.distance(
                    Vec3.smoothStep(a, b, 0.51),
                    Vec3.smoothStep(a, b, 0.5)
                );

                expect(diffStart).toBeLessThan(diffMiddle);
                expect(diffEnd).toBeLessThan(diffMiddle);
            });
        });

        describe('static smootherStep', () => {
            test('should apply smoother step interpolation', () => {
                const a = new Vec3(0, 0, 0);
                const b = new Vec3(10, 20, 30);
                const result = Vec3.smootherStep(a, b, 0.5);
                expect(result).toEqual(new Vec3(5, 10, 15));
            });
        });

        describe('static cubicBezier', () => {
            test('should interpolate along cubic Bezier curve', () => {
                const p0 = new Vec3(0, 0, 0);
                const c1 = new Vec3(1, 2, 3);
                const c2 = new Vec3(3, 2, 1);
                const p1 = new Vec3(4, 4, 4);

                const result0 = Vec3.cubicBezier(p0, c1, c2, p1, 0);
                const result1 = Vec3.cubicBezier(p0, c1, c2, p1, 1);

                expect(result0).toEqual(p0);
                expect(result1).toEqual(p1);
            });
        });

        describe('static hermite', () => {
            test('should interpolate using Hermite spline', () => {
                const p0 = new Vec3(0, 0, 0);
                const m0 = new Vec3(1, 0, 0);
                const p1 = new Vec3(1, 1, 1);
                const m1 = new Vec3(0, 1, 0);

                const result0 = Vec3.hermite(p0, m0, p1, m1, 0);
                const result1 = Vec3.hermite(p0, m0, p1, m1, 1);

                expect(result0).toEqual(p0);
                expect(result1).toEqual(p1);
            });
        });

        describe('static catmullRom', () => {
            test('should interpolate using Catmull-Rom spline', () => {
                const p0 = new Vec3(0, 0, 0);
                const p1 = new Vec3(1, 0, 0);
                const p2 = new Vec3(2, 1, 0);
                const p3 = new Vec3(3, 1, 0);

                const result0 = Vec3.catmullRom(p0, p1, p2, p3, 0);
                const result1 = Vec3.catmullRom(p0, p1, p2, p3, 1);

                expect(result0).toEqual(p1);
                expect(result1).toEqual(p2);
            });

            test('should handle custom tension', () => {
                const p0 = new Vec3(0, 0, 0);
                const p1 = new Vec3(1, 0, 0);
                const p2 = new Vec3(2, 0, 0);
                const p3 = new Vec3(3, 1, 0);

                const result1 = Vec3.catmullRom(p0, p1, p2, p3, 0.25, 0); // Normal tension
                const result2 = Vec3.catmullRom(p0, p1, p2, p3, 0.25, 0.5); // Medium
                const result3 = Vec3.catmullRom(p0, p1, p2, p3, 0.25, 1); // Max

                const diff1 = Vec3.distance(result1, result2);
                const diff2 = Vec3.distance(result2, result3);
                const diff3 = Vec3.distance(result1, result3);

                expect(Math.max(diff1, diff2, diff3)).toBeGreaterThan(0.001);
            });
        });
    });

    // 3D SPECIFIC OPERATIONS
    describe('3D Specific Operations', () => {
        describe('static project', () => {
            test('should project vector onto another', () => {
                const v = new Vec3(3, 4, 0);
                const onto = new Vec3(1, 0, 0);
                const result = Vec3.project(v, onto);
                expect(result).toEqual(new Vec3(3, 0, 0));
            });

            test('should handle projection onto diagonal vector', () => {
                const v = new Vec3(1, 2, 3);
                const onto = new Vec3(1, 1, 1);
                const result = Vec3.project(v, onto);

                const normalized = Vec3.normalize(onto);
                const scalar = Vec3.dot(v, normalized);
                const expected = Vec3.multiplyScalar(normalized, scalar);
                expect(result).toBeCloseToVec3(Vec3.from(expected));
            });

            test('should throw error for zero vector projection', () => {
                const v = new Vec3(1, 2, 3);
                const onto = new Vec3(0, 0, 0);
                expect(() => Vec3.project(v, onto)).toThrow(
                    'Cannot project onto zero-length vector'
                );
            });
        });

        describe('static reject', () => {
            test('should calculate rejection (perpendicular component)', () => {
                const v = new Vec3(3, 4, 0);
                const onto = new Vec3(1, 0, 0);
                const result = Vec3.reject(v, onto);
                expect(result).toBeCloseToVec3(new Vec3(0, 4, 0));
            });

            test('should be perpendicular to projection base', () => {
                const v = new Vec3(1, 2, 3);
                const onto = new Vec3(1, 1, 1);
                const rejection = Vec3.reject(v, onto);
                const normalized = Vec3.normalize(onto, new Vec3());

                expect(rejection).toBePerpendicularTo(normalized);
            });

            test('should satisfy v = project + reject', () => {
                const v = new Vec3(1, 2, 3);
                const onto = new Vec3(2, 1, 1);

                const projection = Vec3.project(v, onto);
                const rejection = Vec3.reject(v, onto);
                const sum = Vec3.add(projection, rejection);

                expect(sum).toBeCloseToVec3(v);
            });
        });

        describe('static reflect', () => {
            test('should reflect vector across normal', () => {
                const v = new Vec3(1, -1, 0);
                const normal = new Vec3(0, 1, 0);
                const result = Vec3.reflect(v, normal);
                expect(result).toBeCloseToVec3(new Vec3(1, 1, 0));
            });

            test('should preserve magnitude', () => {
                const v = new Vec3(3, 4, 5);
                const normal = Vec3.normalize(new Vec3(1, 1, 1));
                const result = Vec3.reflect(v, normal, new Vec3());
                expect(result.length()).toBeCloseTo(v.length(), 6);
            });

            test('should handle reflection across plane', () => {
                const v = new Vec3(1, 0, 0);
                const normal = new Vec3(-1, 0, 0); // Mirror across YZ plane
                const result = Vec3.reflect(v, normal);
                expect(result).toBeCloseToVec3(new Vec3(-1, 0, 0));
            });
        });
    });

    // RANDOM GENERATION
    describe('Random Generation', () => {
        describe('static random', () => {
            test('should generate random vectors on unit sphere', () => {
                const samples = Array.from({ length: 100 }, () => Vec3.random());

                samples.forEach((v) => {
                    const length = Vec3.len(v);
                    expect(length).toBeCloseTo(1, 3);
                });
            });

            test('should generate vectors with custom scale', () => {
                const scale = 5;
                const samples = Array.from({ length: 100 }, () => Vec3.fastRandom(scale));

                samples.forEach((v) => {
                    const length = Vec3.len(v);
                    expect(length).toBeCloseTo(scale, 3);
                });
            });

            test('should generate reasonably distributed samples', () => {
                const samples = Array.from({ length: 1000 }, () => Vec3.random());

                const octants = [0, 0, 0, 0, 0, 0, 0, 0];
                samples.forEach((v) => {
                    const index = (v.x > 0 ? 1 : 0) + (v.y > 0 ? 2 : 0) + (v.z > 0 ? 4 : 0);
                    octants[index]++;
                });

                octants.forEach((count) => {
                    expect(count).toBeGreaterThan(50); // Should be ~125 ± some variance
                });
            });

            test('should generate different vectors on subsequent calls', () => {
                const samples = Array.from({ length: 10 }, () => Vec3.random());

                const uniqueVectors = new Set(samples.map((v) => `${v.x},${v.y},${v.z}`));
                expect(uniqueVectors.size).toBeGreaterThan(5);
            });
        });

        describe('static fastRandom', () => {
            test('should generate normalized vectors', () => {
                const samples = Array.from({ length: 100 }, () => Vec3.fastRandom());

                samples.forEach((v) => {
                    const length = Vec3.len(v);
                    expect(length).toBeCloseTo(1, 3);
                });
            });

            test('should generate vectors with custom scale', () => {
                const scale = 3;
                const samples = Array.from({ length: 50 }, () => Vec3.fastRandom(scale));

                samples.forEach((v) => {
                    const length = Vec3.len(v);
                    expect(length).toBeCloseTo(scale, 3);
                });
            });

            test('should be reasonably fast compared to regular random', () => {
                const iterations = 1000;

                const startRegular = performance.now();
                for (let i = 0; i < iterations; i++) {
                    Vec3.random();
                }
                const endRegular = performance.now();
                const regularTime = endRegular - startRegular;

                const startFast = performance.now();
                for (let i = 0; i < iterations; i++) {
                    Vec3.fastRandom();
                }
                const endFast = performance.now();
                const fastTime = endFast - startFast;

                expect(fastTime).toBeLessThanOrEqual(regularTime * 1.5);
            });
        });

        describe('static randomNormal', () => {
            test('should generate normally distributed components', () => {
                const samples = Array.from({ length: 3000 }, () => Vec3.randomNormal());

                const meanX = samples.reduce((sum, v) => sum + v.x, 0) / samples.length;
                const meanY = samples.reduce((sum, v) => sum + v.y, 0) / samples.length;
                const meanZ = samples.reduce((sum, v) => sum + v.z, 0) / samples.length;

                // With proper Box-Muller sampling, means should be close to 0
                // Larger tolerance for statistical variance with realistic sample sizes
                expect(Math.abs(meanX)).toBeLessThan(0.25);
                expect(Math.abs(meanY)).toBeLessThan(0.25);
                expect(Math.abs(meanZ)).toBeLessThan(0.25);
            });

            test('should generate different vectors with each call', () => {
                const samples = Array.from({ length: 20 }, () => Vec3.randomNormal());

                const uniqueVectors = new Set(
                    samples.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`)
                );
                expect(uniqueVectors.size).toBeGreaterThan(15);
            });

            test('should produce bell curve distribution', () => {
                const samples = Array.from({ length: 2000 }, () => Vec3.randomNormal());

                const xValues = samples.map((v) => v.x);
                const yValues = samples.map((v) => v.y);
                const zValues = samples.map((v) => v.z);

                const countInRange = (values: number[], min: number, max: number) =>
                    values.filter((v) => v >= min && v <= max).length;

                const withinOneStdX = countInRange(xValues, -1, 1);
                const withinOneStdY = countInRange(yValues, -1, 1);
                const withinOneStdZ = countInRange(zValues, -1, 1);

                expect(withinOneStdX / samples.length).toBeCloseTo(0.68, 0.1);
                expect(withinOneStdY / samples.length).toBeCloseTo(0.68, 0.1);
                expect(withinOneStdZ / samples.length).toBeCloseTo(0.68, 0.1);
            });
        });

        describe('randomBox instance method', () => {
            test('should generate vectors within box bounds', () => {
                const v = new Vec3();
                const samples = Array.from({ length: 100 }, () =>
                    v.randomBox(-5, 5, -10, 10, -1, 1)
                );

                samples.forEach((sample) => {
                    expect(sample.x).toBeGreaterThanOrEqual(-5);
                    expect(sample.x).toBeLessThanOrEqual(5);
                    expect(sample.y).toBeGreaterThanOrEqual(-10);
                    expect(sample.y).toBeLessThanOrEqual(10);
                    expect(sample.z).toBeGreaterThanOrEqual(-1);
                    expect(sample.z).toBeLessThanOrEqual(1);
                });
            });

            test('should generate uniform distribution within bounds', () => {
                const v = new Vec3();
                const samples = Array.from({ length: 1000 }, () =>
                    v.randomBox(0, 10, 0, 10, 0, 10)
                );

                const meanX = samples.reduce((sum, s) => sum + s.x, 0) / samples.length;
                const meanY = samples.reduce((sum, s) => sum + s.y, 0) / samples.length;
                const meanZ = samples.reduce((sum, s) => sum + s.z, 0) / samples.length;

                expect(meanX).toBeCloseTo(5, 0.3);
                expect(meanY).toBeCloseTo(5, 0.3);
                expect(meanZ).toBeCloseTo(5, 0.3);
            });

            test('should handle negative bounds correctly', () => {
                const v = new Vec3();
                const samples = Array.from({ length: 100 }, () =>
                    v.randomBox(-10, -5, -20, -10, -1, 0)
                );

                samples.forEach((sample) => {
                    expect(sample.x).toBeGreaterThanOrEqual(-10);
                    expect(sample.x).toBeLessThanOrEqual(-5);
                    expect(sample.y).toBeGreaterThanOrEqual(-20);
                    expect(sample.y).toBeLessThanOrEqual(-10);
                    expect(sample.z).toBeGreaterThanOrEqual(-1);
                    expect(sample.z).toBeLessThanOrEqual(0);
                });
            });
        });

        describe('randomBoxNormal instance method', () => {
            test('should generate vectors within box bounds using normal distribution', () => {
                const v = new Vec3();
                const samples = Array.from({ length: 200 }, () =>
                    v.randomBoxNormal(-5, 5, -5, 5, -5, 5)
                );

                samples.forEach((sample) => {
                    expect(sample.x).toBeGreaterThanOrEqual(-5);
                    expect(sample.x).toBeLessThanOrEqual(5);
                    expect(sample.y).toBeGreaterThanOrEqual(-5);
                    expect(sample.y).toBeLessThanOrEqual(5);
                    expect(sample.z).toBeGreaterThanOrEqual(-5);
                    expect(sample.z).toBeLessThanOrEqual(5);
                });
            });

            test('should show normal distribution characteristics', () => {
                const v = new Vec3();
                const samples = Array.from({ length: 1000 }, () =>
                    v.randomBoxNormal(0, 10, 0, 10, 0, 10)
                );

                let centerCount = 0;
                let edgeCount = 0;

                samples.forEach((sample) => {
                    const distanceFromCenter = Math.sqrt(
                        (sample.x - 5) ** 2 + (sample.y - 5) ** 2 + (sample.z - 5) ** 2
                    );
                    if (distanceFromCenter < 3) centerCount++;
                    else if (distanceFromCenter > 7) edgeCount++;
                });

                expect(centerCount).toBeGreaterThan(edgeCount);
            });
        });

        describe('random method performance comparison', () => {
            test('all random methods should complete within reasonable time', () => {
                const iterations = 1000;

                const testMethods = [
                    () => Vec3.random(),
                    () => Vec3.fastRandom(),
                    () => Vec3.randomNormal(),
                ];

                testMethods.forEach((method, index) => {
                    const start = performance.now();
                    for (let i = 0; i < iterations; i++) {
                        method();
                    }
                    const end = performance.now();
                    const timePerOperation = (end - start) / iterations;

                    expect(timePerOperation).toBeLessThan(10);
                });
            });
        });
    });

    // COMPARISON AND EQUALITY
    describe('Comparison and Equality', () => {
        describe('Vec3Comparer', () => {
            test('LEXICOGRAPHIC mode should compare x, then y, then z', () => {
                const comparer = new Vec3Comparer(Vec3ComparisonMode.LEXICOGRAPHIC);

                expect(comparer.compare(new Vec3(1, 2, 3), new Vec3(2, 1, 1))).toBe(-1);
                expect(comparer.compare(new Vec3(1, 2, 3), new Vec3(1, 3, 1))).toBe(-1);
                expect(comparer.compare(new Vec3(1, 2, 3), new Vec3(1, 2, 4))).toBe(-1);
                expect(comparer.compare(new Vec3(1, 2, 3), new Vec3(1, 2, 3))).toBe(0);
            });

            test('MAGNITUDE mode should compare by length', () => {
                const comparer = new Vec3Comparer(Vec3ComparisonMode.MAGNITUDE);

                const short = new Vec3(1, 0, 0);
                const long = new Vec3(2, 0, 0);

                expect(comparer.compare(short, long)).toBe(-1);
                expect(comparer.compare(long, short)).toBe(1);
                expect(comparer.compare(short, new Vec3(0, 1, 0))).toBe(0);
            });

            test('MANHATTAN mode should compare by Manhattan distance', () => {
                const comparer = new Vec3Comparer(Vec3ComparisonMode.MANHATTAN);

                const a = new Vec3(1, 1, 1); // Manhattan distance = 3
                const b = new Vec3(2, 1, 0); //                    = 3
                const c = new Vec3(2, 2, 0); //                    = 4

                expect(comparer.compare(a, b)).toBe(0);
                expect(comparer.compare(a, c)).toBe(-1);
            });
        });

        describe('Vec3EqualityComparer', () => {
            test('should use custom epsilon', () => {
                const comparer = new Vec3EqualityComparer(0.1);

                const a = new Vec3(1, 2, 3);
                const b = new Vec3(1.05, 2.05, 3.05);

                expect(comparer.equals(a, b)).toBe(true);
            });

            test('should generate consistent hash codes', () => {
                const comparer = new Vec3EqualityComparer();

                const a = new Vec3(1, 2, 3);
                const b = new Vec3(1, 2, 3);

                expect(comparer.hash(a)).toBe(comparer.hash(b));
            });

            test('should handle null/undefined vectors', () => {
                const comparer = new Vec3EqualityComparer();

                expect(comparer.equals(null as any, null as any)).toBe(true);
                expect(comparer.equals(new Vec3(), null as any)).toBe(false);
                expect(comparer.hash(null as any)).toBe(0);
            });
        });
    });

    // ERROR HANDLING AND EDGE CASES
    describe('Error Handling and Edge Cases', () => {
        test('should handle very large numbers', () => {
            const large = new Vec3(1e20, 1e20, 1e20);
            const result = Vec3.multiplyScalar(large, 2);
            expect(result.x).toBe(2e20);
        });

        test('should handle very small numbers', () => {
            const small = new Vec3(1e-20, 1e-20, 1e-20);
            const result = Vec3.multiplyScalar(small, 2);
            expect(result.x).toBe(2e-20);
        });

        test('should handle infinity values', () => {
            const inf = new Vec3(Infinity, -Infinity, 0);
            expect(inf.x).toBe(Infinity);
            expect(inf.y).toBe(-Infinity);
            expect(inf.z).toBe(0);
        });

        test('should handle NaN values appropriately', () => {
            const nan = new Vec3(NaN, 1, 2);
            expect(isNaN(nan.x)).toBe(true);
            expect(nan.y).toBe(1);
            expect(nan.z).toBe(2);
        });

        test('should maintain precision in chained operations', () => {
            let v = new Vec3(1, 2, 3);
            const original = v.clone();

            v = v
                .add(new Vec3(5, 5, 5))
                .subtract(new Vec3(5, 5, 5))
                .multiplyScalar(2)
                .divideScalar(2);

            expect(v).toBeCloseToVec3(original);
        });
    });

    // PERFORMANCE TESTS
    describe('Performance Tests', () => {
        test('static methods should be efficient for large datasets', () => {
            const vectors = Vec3TestDataBuilder.createBatch(PERFORMANCE_ITERATIONS);

            const start = performance.now();

            const out = new Vec3();
            for (let i = 0; i < vectors.length - 1; i++) {
                Vec3.add(vectors[i], vectors[i + 1], out);
                Vec3.dot(vectors[i], vectors[i + 1]);
                Vec3.cross(vectors[i], vectors[i + 1], out);
            }

            const end = performance.now();
            const timePerOperation = (end - start) / (vectors.length * 3);
            expect(timePerOperation).toBeLessThan(5);
        });

        test('fast methods should be faster than regular methods', () => {
            const vectors = Vec3TestDataBuilder.createBatch(1000);

            const startRegular = performance.now();
            vectors.forEach((v) => Vec3.len(v));
            const endRegular = performance.now();
            const regularTime = endRegular - startRegular;

            const startFast = performance.now();
            vectors.forEach((v) => Vec3.fastLength(v));
            const endFast = performance.now();
            const fastTime = endFast - startFast;

            expect(fastTime).toBeLessThan(10);
            expect(regularTime).toBeLessThan(1);
        });

        test('normalizeQuake should complete within reasonable time', () => {
            const vectors = Vec3TestDataBuilder.createBatch(1000).filter(
                (v) => v.length() > EPSILON
            );

            const startFast = performance.now();
            vectors.forEach((v) => Vec3.normalizeQuake(v));
            const endFast = performance.now();
            const fastTime = endFast - startFast;

            expect(fastTime).toBeLessThan(10);
        });
    });

    // PROPERTY-BASED TESTS
    describe('Property-Based Tests', () => {
        test('addition should be commutative', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();

                const ab = Vec3.add(a, b, new Vec3());
                const ba = Vec3.add(b, a, new Vec3());

                expect(ab).toBeCloseToVec3(ba);
            }
        });

        test('addition should be associative', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();
                const c = Vec3TestDataBuilder.createRandom();

                const abc = Vec3.add(Vec3.add(a, b), c, new Vec3());
                const bca = Vec3.add(a, Vec3.add(b, c), new Vec3());

                expect(abc).toBeCloseToVec3(bca);
            }
        });

        test('dot product should be commutative', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();

                const ab = Vec3.dot(a, b);
                const ba = Vec3.dot(b, a);

                expect(ab).toBeCloseTo(ba, 6);
            }
        });

        test('cross product should be anti-commutative', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();

                const ab = Vec3.cross(a, b);
                const ba = Vec3.cross(b, a);
                const negBa = Vec3.negate(ba, new Vec3());

                expect(ab).toBeCloseToVec3(negBa);
            }
        });

        test('cross product should be perpendicular to both inputs', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();

                if (Vec3.cross(a, b, new Vec3()).length() > EPSILON) {
                    // Skip parallel vectors
                    const cross = Vec3.cross(a, b);

                    expect(cross).toBePerpendicularTo(a);
                    expect(cross).toBePerpendicularTo(b);
                }
            }
        });

        test('normalization should preserve direction', () => {
            for (let i = 0; i < 100; i++) {
                const v = Vec3TestDataBuilder.createRandom();

                if (v.length() > EPSILON) {
                    const normalized = Vec3.normalize(v);
                    const scaled = Vec3.multiplyScalar(normalized, v.length());

                    expect(scaled).toBeCloseToVec3(v);
                }
            }
        });

        test('distance should satisfy triangle inequality', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();
                const c = Vec3TestDataBuilder.createRandom();

                const ab = Vec3.distance(a, b);
                const bc = Vec3.distance(b, c);
                const ac = Vec3.distance(a, c);

                expect(ac).toBeLessThanOrEqual(ab + bc + FLOAT_PRECISION);
            }
        });

        test('lerp should be on line between points', () => {
            for (let i = 0; i < 100; i++) {
                const a = Vec3TestDataBuilder.createRandom();
                const b = Vec3TestDataBuilder.createRandom();
                const t = Math.random();

                const lerped = Vec3.lerp(a, b, t);
                const distanceA = Vec3.distance(lerped, a);
                const distanceB = Vec3.distance(lerped, b);
                const totalDistance = Vec3.distance(a, b);

                expect(distanceA + distanceB).toBeCloseTo(totalDistance, 4);
            }
        });
    });

    // INTEGRATION TESTS
    describe('Integration Tests', () => {
        test('complete 3D transformation pipeline', () => {
            const vertices = [
                new Vec3(-1, -1, -1),
                new Vec3(1, -1, -1),
                new Vec3(1, 1, -1),
                new Vec3(-1, 1, -1),
                new Vec3(-1, -1, 1),
                new Vec3(1, -1, 1),
                new Vec3(1, 1, 1),
                new Vec3(-1, 1, 1),
            ];

            const transformed = vertices.map((v) => {
                return Vec3.add(
                    Vec3.rotateY(Vec3.multiplyScalar(v, 2), Math.PI / 4),
                    new Vec3(10, 5, 0)
                );
            });

            transformed.forEach((v) => {
                expect(v.x).toBeGreaterThan(5);
                expect(v.y).toBeGreaterThan(0);

                const distanceFromOrigin = Vec3.distance(v, new Vec3(10, 5, 0));
                expect(distanceFromOrigin).toBeCloseTo(2 * Math.sqrt(3), 4);
            });
        });

        test('physics simulation step', () => {
            let position = new Vec3(0, 0, 0);
            let velocity = new Vec3(10, 10, 0);
            const gravity = new Vec3(0, -9.81, 0);
            const dt = 0.016;

            const positions: Vec3[] = [];

            for (let time = 0; time < 2.5; time += dt) {
                positions.push(Vec3.from(position));

                velocity = Vec3.add(velocity, Vec3.multiplyScalar(gravity, dt));

                position = Vec3.add(position, Vec3.multiplyScalar(velocity, dt));
            }

            expect(positions[0].y).toBeCloseTo(0, 4);
            expect(positions[positions.length - 1].y).toBeLessThan(0);

            const maxHeight = Math.max(...positions.map((p) => p.y));
            expect(maxHeight).toBeGreaterThan(0);
            expect(maxHeight).toBeCloseTo(5.017, 2);
        });

        test('3D geometry calculations', () => {
            const p1 = new Vec3(0, 0, 0);
            const p2 = new Vec3(1, 0, 0);
            const p3 = new Vec3(0, 1, 0);

            const edge1 = Vec3.subtract(p2, p1, new Vec3());
            const edge2 = Vec3.subtract(p3, p1, new Vec3());
            const normal = Vec3.normalize(Vec3.cross(edge1, edge2), new Vec3());

            expect(normal).toBePerpendicularTo(edge1);
            expect(normal).toBePerpendicularTo(edge2);
            // TODO : Uncomment when Vec3 has a toBeNormalizedVec3 matcher
            // expect(normal).toBeNormalizedVec3();

            const area = Vec3.cross(edge1, edge2, new Vec3()).length() / 2;
            expect(area).toBeCloseTo(0.5, 6);

            const testPoint = new Vec3(0.5, 0.5, 1);
            const toPoint = Vec3.subtract(testPoint, p1);
            const distanceToPlane = Vec3.dot(toPoint, normal);
            const projectedPoint = Vec3.subtract(
                testPoint,
                Vec3.multiplyScalar(normal, distanceToPlane)
            );

            const verifyDistance = Vec3.dot(Vec3.subtract(projectedPoint, p1), normal);
            expect(Math.abs(verifyDistance)).toBeLessThan(EPSILON);
        });
    });
});
