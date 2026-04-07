import { describe, test, expect } from 'vitest';
import { Equatable, isEquatable, EqualityComparer, EqualityComparerOptions } from '../../index';

class TestEquatable implements Equatable {
    constructor(
        public id: number,
        public name: string
    ) {}

    equals(other: unknown): boolean {
        if (!(other instanceof TestEquatable)) return false;
        return this.id === other.id && this.name === other.name;
    }

    getHashCode(): number {
        return this.id * 31 + this.name.length;
    }
}

class ComplexEquatable implements Equatable {
    constructor(
        public value: Equatable,
        public nested: { data: Equatable }
    ) {}

    equals(other: unknown): boolean {
        if (!(other instanceof ComplexEquatable)) return false;
        return this.value.equals(other.value) && this.nested.data.equals(other.nested.data);
    }

    getHashCode(): number {
        return this.value.getHashCode() * 31 + this.nested.data.getHashCode();
    }
}

class CustomEqualityComparer<T> implements EqualityComparer<T> {
    constructor(private options?: EqualityComparerOptions) {}

    equals(a: T, b: T): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;

        if (typeof a === 'string' && typeof b === 'string' && this.options?.ignoreCase) {
            return a.toLowerCase() === b.toLowerCase();
        }

        if (isEquatable(a) && isEquatable(b)) {
            return a.equals(b);
        }

        if (this.options?.customizer) {
            return this.options.customizer(a, b);
        }

        if (this.options?.deep && typeof a === 'object' && typeof b === 'object') {
            return this.deepEquals(a as Record<string, unknown>, b as Record<string, unknown>);
        }

        return this.options?.strict ? a === b : a == b;
    }

    hash(obj: T): number {
        if (obj === null || obj === undefined) return 0;
        if (typeof obj === 'number') return obj | 0;
        if (typeof obj === 'boolean') return obj ? 1 : 0;
        if (typeof obj === 'string') {
            const str = this.options?.ignoreCase ? (obj as string).toLowerCase() : (obj as string);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = (hash << 5) - hash + str.charCodeAt(i);
                hash |= 0;
            }
            return hash;
        }
        if (isEquatable(obj)) {
            return obj.getHashCode();
        }

        return JSON.stringify(obj).length;
    }

    private deepEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        return keysA.every((key) => {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;

            const valA = a[key];
            const valB = b[key];

            if (isEquatable(valA) && isEquatable(valB)) {
                return valA.equals(valB);
            }

            if (
                typeof valA === 'object' &&
                valA !== null &&
                typeof valB === 'object' &&
                valB !== null
            ) {
                return this.deepEquals(
                    valA as Record<string, unknown>,
                    valB as Record<string, unknown>
                );
            }

            return this.options?.strict ? valA === valB : valA == valB;
        });
    }
}

describe('Equatable Interface Implementation Tests', () => {
    describe('Basic Equatable Implementation', () => {
        test('equals() should correctly identify same values', () => {
            const obj1 = new TestEquatable(1, 'test');
            const obj2 = new TestEquatable(1, 'test');
            const obj3 = new TestEquatable(2, 'test');

            expect(obj1.equals(obj2)).toBe(true);
            expect(obj1.equals(obj3)).toBe(false);
            expect(obj1.equals(null)).toBe(false);
            expect(obj1.equals({})).toBe(false);
        });

        test('getHashCode() should return consistent values for equal objects', () => {
            const obj1 = new TestEquatable(1, 'test');
            const obj2 = new TestEquatable(1, 'test');
            const obj3 = new TestEquatable(2, 'test');

            expect(obj1.getHashCode()).toBe(obj2.getHashCode());
            expect(obj1.getHashCode()).not.toBe(obj3.getHashCode());
        });

        test('hash consistency property should hold across multiple calls', () => {
            const obj = new TestEquatable(42, 'consistent');
            const firstHash = obj.getHashCode();

            for (let i = 0; i < 100; i++) {
                expect(obj.getHashCode()).toBe(firstHash);
            }
        });
    });

    describe('Complex Equatable Implementation', () => {
        test('should correctly compare nested Equatable objects', () => {
            const base1 = new TestEquatable(1, 'base');
            const base2 = new TestEquatable(1, 'base');
            const base3 = new TestEquatable(2, 'different');

            const nested1 = new TestEquatable(3, 'nested');
            const nested2 = new TestEquatable(3, 'nested');

            const complex1 = new ComplexEquatable(base1, { data: nested1 });
            const complex2 = new ComplexEquatable(base2, { data: nested2 });
            const complex3 = new ComplexEquatable(base3, { data: nested1 });

            expect(complex1.equals(complex2)).toBe(true);
            expect(complex1.equals(complex3)).toBe(false);

            expect(complex1.getHashCode()).toBe(complex2.getHashCode());
            expect(complex1.getHashCode()).not.toBe(complex3.getHashCode());
        });

        test('equals should handle null correctly in complex objects', () => {
            const validObj = new TestEquatable(1, 'test');
            expect(validObj.equals(null)).toBe(false);
        });
    });

    describe('Custom EqualityComparer Implementation', () => {
        test('string comparison with ignoreCase option', () => {
            const comparer = new CustomEqualityComparer<string>({ ignoreCase: true });

            expect(comparer.equals('TEST', 'test')).toBe(true);
            expect(comparer.equals('Hello', 'HELLO')).toBe(true);
            expect(comparer.equals('Hello', 'World')).toBe(false);

            expect(comparer.hash('TEST')).toBe(comparer.hash('test'));
            expect(comparer.hash('Hello')).toBe(comparer.hash('HELLO'));
        });

        test('deep equality comparison with deep option', () => {
            const comparer = new CustomEqualityComparer<Record<string, unknown>>({ deep: true });

            const obj1 = { a: 1, b: { c: 3 } };
            const obj2 = { a: 1, b: { c: 3 } };
            const obj3 = { a: 1, b: { c: 4 } };

            expect(comparer.equals(obj1, obj2)).toBe(true);
            expect(comparer.equals(obj1, obj3)).toBe(false);
        });

        test('strict equality comparison with strict option', () => {
            const strictComparer = new CustomEqualityComparer<unknown>({ strict: true });
            const looseComparer = new CustomEqualityComparer<unknown>({ strict: false });

            expect(strictComparer.equals(1, '1')).toBe(false);

            expect(looseComparer.equals(1, '1')).toBe(true);
        });

        test('custom comparison with customize option', () => {
            const comparer = new CustomEqualityComparer<string>({
                customizer: (a, b) => {
                    if (typeof a === 'string' && typeof b === 'string') {
                        return a.trim() === b.trim();
                    }
                    return false;
                },
            });

            expect(comparer.equals('test  ', '  test')).toBe(true);
            expect(comparer.equals('test', 'other')).toBe(false);
        });

        test('should handle Equatable objects correctly', () => {
            const comparer = new CustomEqualityComparer<Equatable>();

            const obj1 = new TestEquatable(1, 'test');
            const obj2 = new TestEquatable(1, 'test');
            const obj3 = new TestEquatable(2, 'test');

            expect(comparer.equals(obj1, obj2)).toBe(true);
            expect(comparer.equals(obj1, obj3)).toBe(false);

            expect(comparer.hash(obj1)).toBe(obj1.getHashCode());
            expect(comparer.hash(obj1)).toBe(comparer.hash(obj2));
            expect(comparer.hash(obj1)).not.toBe(comparer.hash(obj3));
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('should handle null and undefined values in equals and hash methods', () => {
            const comparer = new CustomEqualityComparer<unknown>();

            expect(comparer.equals(null, null)).toBe(true);
            expect(comparer.equals(undefined, undefined)).toBe(true);
            expect(comparer.equals(null, undefined)).toBe(false);

            expect(comparer.hash(null)).toBe(0);
            expect(comparer.hash(undefined)).toBe(0);
        });

        test('should handle arrays correctly', () => {
            const comparer = new CustomEqualityComparer<unknown[]>({ deep: true });

            expect(comparer.equals([1, 2, 3], [1, 2, 3])).toBe(true);
            expect(comparer.equals([1, 2, 3], [1, 2, 4])).toBe(false);

            const obj1 = new TestEquatable(1, 'test');
            const obj2 = new TestEquatable(1, 'test');
            const obj3 = new TestEquatable(2, 'test');

            expect(comparer.equals([obj1], [obj2])).toBe(true);
            expect(comparer.equals([obj1], [obj3])).toBe(false);
        });
    });
});
