import { describe, test, it, expect } from 'vitest';
import {
    CompareResult,
    Comparer,
    EqualityComparer,
    Equatable,
    isEquatable,
    isComparer,
    isEqualityComparer,
    ComparerError,
    InvalidOperationError,
} from '../../';

describe('Type Guards', () => {
    describe('isEquatable', () => {
        test('should return true for objects implementing Equatable interface', () => {
            const equatable: Equatable = {
                equals: (other: unknown): boolean => false,
                getHashCode: (): number => 0,
            };
            expect(isEquatable(equatable)).toBe(true);
        });

        test('should return false for null', () => {
            expect(isEquatable(null)).toBe(false);
        });

        test('should return false for undefined', () => {
            expect(isEquatable(undefined)).toBe(false);
        });

        test('should return false for primitives', () => {
            expect(isEquatable(42)).toBe(false);
            expect(isEquatable('string')).toBe(false);
            expect(isEquatable(true)).toBe(false);
        });

        test('should return false for objects missing required methods', () => {
            expect(isEquatable({})).toBe(false);
            expect(isEquatable({ equals: 'not a function' })).toBe(false);
            expect(isEquatable({ equals: () => true })).toBe(false);
            expect(isEquatable({ getHashCode: () => 42 })).toBe(false);
        });
    });

    describe('isComparer', () => {
        test('should return true for objects implementing Comparer interface', () => {
            const comparer: Comparer<string> = {
                compare: (a: string, b: string): CompareResult => 0,
            };
            expect(isComparer(comparer)).toBe(true);
        });

        test('should return false for null and undefined', () => {
            expect(isComparer(null)).toBe(false);
            expect(isComparer(undefined)).toBe(false);
        });

        test('should return false for objects missing compare method', () => {
            expect(isComparer({})).toBe(false);
            expect(isComparer({ compare: 'not a function' })).toBe(false);
        });
    });

    describe('isEqualityComparer', () => {
        test('should return true for objects implementing EqualityComparer interface', () => {
            const equalityComparer: EqualityComparer<string> = {
                equals: (a: string, b: string): boolean => true,
                hash: (obj: string): number => 0,
            };
            expect(isEqualityComparer(equalityComparer)).toBe(true);
        });

        test('should return false for null and undefined', () => {
            expect(isEqualityComparer(null)).toBe(false);
            expect(isEqualityComparer(undefined)).toBe(false);
        });

        test('should return false for objects missing required methods', () => {
            expect(isEqualityComparer({})).toBe(false);
            expect(isEqualityComparer({ equals: 'not a function' })).toBe(false);
            expect(isEqualityComparer({ equals: () => true })).toBe(false);
            expect(isEqualityComparer({ hash: () => 42 })).toBe(false);
        });
    });
});

describe('Error Classes', () => {
    describe('CompareError', () => {
        test('should create an instance with the correct name and message', () => {
            const errorMessage = 'Cannot compare these values';
            const error = new ComparerError(errorMessage);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(ComparerError);
            expect(error.name).toBe('CompareError');
            expect(error.message).toBe(errorMessage);
        });

        test('should maintain prototype chain', () => {
            const error = new ComparerError('Test error');
            expect(Object.getPrototypeOf(error)).toBe(ComparerError.prototype);
        });
    });

    describe('InvalidOperationError', () => {
        test('should create an instance with the correct name and message', () => {
            const errorMessage = 'Operation is invalid';
            const error = new InvalidOperationError(errorMessage);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(InvalidOperationError);
            expect(error.name).toBe('InvalidOperationError');
            expect(error.message).toBe(errorMessage);
        });

        test('should maintain prototype chain', () => {
            const error = new InvalidOperationError('Test error');
            expect(Object.getPrototypeOf(error)).toBe(InvalidOperationError.prototype);
        });
    });
});

class Person implements Equatable {
    constructor(
        public name: string,
        public age: number
    ) {}

    equals(other: unknown): boolean {
        if (!(other instanceof Person)) return false;
        return this.name === other.name && this.age === other.age;
    }

    getHashCode(): number {
        return (this.name.length * 397) ^ this.age;
    }
}

class PersonAgeComparer implements Comparer<Person> {
    compare(a: Person, b: Person): CompareResult {
        if (a.age < b.age) return -1;
        if (a.age > b.age) return 1;
        return 0;
    }
}

class PersonEqualityComparer implements EqualityComparer<Person> {
    equals(a: Person, b: Person): boolean {
        return a.name === b.name && a.age === b.age;
    }

    hash(obj: Person): number {
        return (obj.name.length * 397) ^ obj.age;
    }
}

describe('Equatable Implementation', () => {
    test('Person.equals should correctly compare two Person instances', () => {
        const person1 = new Person('John', 30);
        const person2 = new Person('John', 30);
        const person3 = new Person('Jane', 25);

        expect(person1.equals(person2)).toBe(true);
        expect(person1.equals(person3)).toBe(false);
        expect(person1.equals('not a person')).toBe(false);
    });

    test('Person.getHashCode should return consistent hash codes', () => {
        const person1 = new Person('John', 30);
        const person2 = new Person('John', 30);
        const person3 = new Person('Jane', 25);

        expect(person1.getHashCode()).toBe(person2.getHashCode());
        expect(person1.getHashCode()).not.toBe(person3.getHashCode());
    });
});

describe('Comparer Implementation', () => {
    const comparer = new PersonAgeComparer();

    test('should correctly compare persons by age', () => {
        const younger = new Person('Jane', 25);
        const older = new Person('John', 30);

        expect(comparer.compare(younger, older)).toBe(-1);
        expect(comparer.compare(older, younger)).toBe(1);
        expect(comparer.compare(younger, new Person('Alice', 25))).toBe(0);
    });
});

describe('EqualityComparer Implementation', () => {
    const equalityComparer = new PersonEqualityComparer();

    test('should correctly check equality between persons', () => {
        const person1 = new Person('John', 30);
        const person2 = new Person('John', 30);
        const person3 = new Person('Jane', 25);

        expect(equalityComparer.equals(person1, person2)).toBe(true);
        expect(equalityComparer.equals(person1, person3)).toBe(false);
    });

    test('should return consistent hash codes for equal persons', () => {
        const person1 = new Person('John', 30);
        const person2 = new Person('John', 30);
        const person3 = new Person('Jane', 25);

        expect(equalityComparer.hash(person1)).toBe(equalityComparer.hash(person2));
        expect(equalityComparer.hash(person1)).not.toBe(equalityComparer.hash(person3));
    });
});
