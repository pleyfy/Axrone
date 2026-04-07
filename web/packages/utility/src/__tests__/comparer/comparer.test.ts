import { describe, expect, test, it, beforeEach } from 'vitest';
import {
    CompareResult,
    Comparer,
    ComparerOptions,
    ComparerError,
    InvalidOperationError,
    isComparer,
} from '../../';

class NumberComparer implements Comparer<number> {
    constructor(private options?: ComparerOptions) {}

    compare(a: number, b: number): CompareResult {
        if (isNaN(a) && isNaN(b)) return 0;
        if (isNaN(a)) return this.options?.nullFirst ? -1 : 1;
        if (isNaN(b)) return this.options?.nullFirst ? 1 : -1;

        if (a === null && b === null) return 0;
        if (a === null) return this.options?.nullFirst ? -1 : 1;
        if (b === null) return this.options?.nullFirst ? 1 : -1;

        const multiplier = this.options?.descending ? -1 : 1;

        if (this.options?.precision !== undefined) {
            const factor = Math.pow(10, this.options.precision);
            a = Math.round(a * factor) / factor;
            b = Math.round(b * factor) / factor;
        }

        if (a < b) return (-1 * multiplier) as CompareResult;
        if (a > b) return (1 * multiplier) as CompareResult;
        return 0;
    }
}

class StringComparer implements Comparer<string> {
    constructor(private options?: ComparerOptions) {}

    compare(a: string, b: string): CompareResult {
        if (a === null && b === null) return 0;
        if (a === null) return this.options?.nullFirst ? -1 : 1;
        if (b === null) return this.options?.nullFirst ? 1 : -1;

        let strA = a;
        let strB = b;

        if (this.options?.ignoreCase) {
            strA = strA.toLowerCase();
            strB = strB.toLowerCase();
        }

        if (this.options?.locale) {
            const multiplier = this.options?.descending ? -1 : 1;
            const result = strA.localeCompare(strB, this.options.locale);
            if (result < 0) return (-1 * multiplier) as CompareResult;
            if (result > 0) return (1 * multiplier) as CompareResult;
            return 0;
        }

        const multiplier = this.options?.descending ? -1 : 1;
        if (strA < strB) return (-1 * multiplier) as CompareResult;
        if (strA > strB) return (1 * multiplier) as CompareResult;
        return 0;
    }
}

class DateComparer implements Comparer<Date> {
    constructor(private options?: ComparerOptions) {}

    compare(a: Date, b: Date): CompareResult {
        if (a === null && b === null) return 0;
        if (a === null) return this.options?.nullFirst ? -1 : 1;
        if (b === null) return this.options?.nullFirst ? 1 : -1;

        const aTime = a.getTime();
        const bTime = b.getTime();

        if (isNaN(aTime) && isNaN(bTime)) return 0;
        if (isNaN(aTime)) return this.options?.nullFirst ? -1 : 1;
        if (isNaN(bTime)) return this.options?.nullFirst ? 1 : -1;

        let timeA = aTime;
        let timeB = bTime;

        if (this.options?.timezone) {
            if (this.options.timezone === 'UTC') {
                timeA = Date.UTC(
                    a.getUTCFullYear(),
                    a.getUTCMonth(),
                    a.getUTCDate(),
                    a.getUTCHours(),
                    a.getUTCMinutes(),
                    a.getUTCSeconds(),
                    a.getUTCMilliseconds()
                );

                timeB = Date.UTC(
                    b.getUTCFullYear(),
                    b.getUTCMonth(),
                    b.getUTCDate(),
                    b.getUTCHours(),
                    b.getUTCMinutes(),
                    b.getUTCSeconds(),
                    b.getUTCMilliseconds()
                );
            }
        }

        const multiplier = this.options?.descending ? -1 : 1;

        if (timeA < timeB) return (-1 * multiplier) as CompareResult;
        if (timeA > timeB) return (1 * multiplier) as CompareResult;
        return 0;
    }
}

class GenericComparer<T> implements Comparer<T> {
    constructor(private keySelector: (item: T) => number | string | Date) {}

    compare(a: T, b: T): CompareResult {
        const keyA = this.keySelector(a);
        const keyB = this.keySelector(b);

        if (typeof keyA === 'number' && typeof keyB === 'number') {
            return new NumberComparer().compare(keyA, keyB);
        }

        if (typeof keyA === 'string' && typeof keyB === 'string') {
            return new StringComparer().compare(keyA, keyB);
        }

        if (keyA instanceof Date && keyB instanceof Date) {
            return new DateComparer().compare(keyA, keyB);
        }

        throw new ComparerError('Unsupported key type for comparison');
    }
}

class CompositeComparer<T> implements Comparer<T> {
    private comparers: Array<Comparer<T>>;

    constructor(...comparers: Array<Comparer<T>>) {
        if (comparers.length === 0) {
            throw new InvalidOperationError('At least one comparer must be provided');
        }
        this.comparers = comparers;
    }

    compare(a: T, b: T): CompareResult {
        for (const comparer of this.comparers) {
            const result = comparer.compare(a, b);
            if (result !== 0) {
                return result;
            }
        }
        return 0;
    }
}

describe('Comparer Interface Implementation Tests', () => {
    describe('NumberComparer', () => {
        test('basic number comparison', () => {
            const comparer = new NumberComparer();

            expect(comparer.compare(1, 2)).toBe(-1);
            expect(comparer.compare(2, 1)).toBe(1);
            expect(comparer.compare(1, 1)).toBe(0);
        });

        test('descending order option', () => {
            const comparer = new NumberComparer({ descending: true });

            expect(comparer.compare(1, 2)).toBe(1);
            expect(comparer.compare(2, 1)).toBe(-1);
            expect(comparer.compare(1, 1)).toBe(0);
        });

        test('precision option', () => {
            const comparer = new NumberComparer({ precision: 2 });

            // Todo: Fix the precision test cases
            expect(comparer.compare(1.234, 1.236)).toBe(-1);
            expect(comparer.compare(1.23, 1.26)).toBe(-1);
            expect(comparer.compare(1.26, 1.23)).toBe(1);
        });

        test('nullFirst option', () => {
            const defaultComparer = new NumberComparer();
            const nullFirstComparer = new NumberComparer({ nullFirst: true });

            expect(defaultComparer.compare(NaN, 1)).toBe(1);
            expect(nullFirstComparer.compare(NaN, 1)).toBe(-1);

            expect(defaultComparer.compare(1, NaN)).toBe(-1);
            expect(nullFirstComparer.compare(1, NaN)).toBe(1);
        });
    });

    describe('StringComparer', () => {
        test('basic string comparison', () => {
            const comparer = new StringComparer();

            expect(comparer.compare('a', 'b')).toBe(-1);
            expect(comparer.compare('b', 'a')).toBe(1);
            expect(comparer.compare('a', 'a')).toBe(0);
        });

        test('ignoreCase option', () => {
            const caseSensitiveComparer = new StringComparer();
            const caseInsensitiveComparer = new StringComparer({ ignoreCase: true });

            expect(caseSensitiveComparer.compare('a', 'A')).toBe(1);
            expect(caseInsensitiveComparer.compare('a', 'A')).toBe(0);

            expect(caseSensitiveComparer.compare('A', 'a')).toBe(-1);
            expect(caseInsensitiveComparer.compare('A', 'a')).toBe(0);
        });

        test('locale option', () => {
            const defaultComparer = new StringComparer();
            const localeComparer = new StringComparer({ locale: 'tr' });

            expect(defaultComparer.compare('i', 'İ')).not.toBe(0);

            expect(localeComparer.compare('i', 'İ')).not.toBe(0);

            const turkishCaseInsensitiveComparer = new StringComparer({
                locale: 'tr',
                ignoreCase: true,
            });
        });

        test('descending option', () => {
            const comparer = new StringComparer({ descending: true });

            expect(comparer.compare('a', 'b')).toBe(1);
            expect(comparer.compare('b', 'a')).toBe(-1);
            expect(comparer.compare('a', 'a')).toBe(0);
        });
    });

    describe('DateComparer', () => {
        test('basic date comparison', () => {
            const comparer = new DateComparer();
            const earlier = new Date(2020, 0, 1);
            const later = new Date(2021, 0, 1);

            expect(comparer.compare(earlier, later)).toBe(-1);
            expect(comparer.compare(later, earlier)).toBe(1);
            expect(comparer.compare(earlier, new Date(2020, 0, 1))).toBe(0);
        });

        test('descending option', () => {
            const comparer = new DateComparer({ descending: true });
            const earlier = new Date(2020, 0, 1);
            const later = new Date(2021, 0, 1);

            expect(comparer.compare(earlier, later)).toBe(1);
            expect(comparer.compare(later, earlier)).toBe(-1);
        });

        test('timezone option', () => {
            const defaultComparer = new DateComparer();
            const utcComparer = new DateComparer({ timezone: 'UTC' });

            const date1 = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
            const date2 = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

            expect(defaultComparer.compare(date1, date2)).toBe(0);
            expect(utcComparer.compare(date1, date2)).toBe(0);
        });

        test('invalid date handling', () => {
            const comparer = new DateComparer();
            const validDate = new Date(2020, 0, 1);
            const invalidDate = new Date('invalid date');

            expect(comparer.compare(invalidDate, invalidDate)).toBe(0);
            expect(comparer.compare(invalidDate, validDate)).toBe(1);
            expect(comparer.compare(validDate, invalidDate)).toBe(-1);

            const nullFirstComparer = new DateComparer({ nullFirst: true });
            expect(nullFirstComparer.compare(invalidDate, validDate)).toBe(-1);
        });
    });

    describe('GenericComparer', () => {
        interface TestItem {
            id: number;
            name: string;
            date: Date;
        }

        const items: TestItem[] = [
            {
                id: 2,
                name: 'Beta',
                date: new Date(2021, 0, 1),
            },
            {
                id: 1,
                name: 'Alpha',
                date: new Date(2020, 0, 1),
            },
            {
                id: 3,
                name: 'Gamma',
                date: new Date(2022, 0, 1),
            },
        ];

        test('sorting by numeric property', () => {
            const comparer = new GenericComparer<TestItem>((item) => item.id);

            expect(comparer.compare(items[0], items[1])).toBe(1);
            expect(comparer.compare(items[1], items[0])).toBe(-1);
            expect(comparer.compare(items[0], items[0])).toBe(0);

            const sorted = [...items].sort((a, b) => comparer.compare(a, b));
            expect(sorted[0].id).toBe(1);
            expect(sorted[1].id).toBe(2);
            expect(sorted[2].id).toBe(3);
        });

        test('sorting by string property', () => {
            const comparer = new GenericComparer<TestItem>((item) => item.name);

            expect(comparer.compare(items[0], items[1])).toBe(1); // 'Beta' > 'Alpha'

            const sorted = [...items].sort((a, b) => comparer.compare(a, b));
            expect(sorted[0].name).toBe('Alpha');
            expect(sorted[1].name).toBe('Beta');
            expect(sorted[2].name).toBe('Gamma');
        });

        test('sorting by date property', () => {
            const comparer = new GenericComparer<TestItem>((item) => item.date);

            expect(comparer.compare(items[0], items[1])).toBe(1);

            const sorted = [...items].sort((a, b) => comparer.compare(a, b));
            expect(sorted[0].date.getFullYear()).toBe(2020);
            expect(sorted[1].date.getFullYear()).toBe(2021);
            expect(sorted[2].date.getFullYear()).toBe(2022);
        });

        test('should throw for unsupported types', () => {
            const symbolComparer = new GenericComparer<{ sym: symbol }>((item) => item.sym as any);

            expect(() => {
                symbolComparer.compare({ sym: Symbol('a') }, { sym: Symbol('b') });
            }).toThrow(ComparerError);
        });
    });

    describe('CompositeComparer', () => {
        interface Person {
            lastName: string;
            firstName: string;
            age: number;
        }

        const people: Person[] = [
            { lastName: 'Smith', firstName: 'John', age: 30 },
            { lastName: 'Smith', firstName: 'Jane', age: 25 },
            { lastName: 'Doe', firstName: 'John', age: 40 },
        ];

        const lastNameComparer = new GenericComparer<Person>((p) => p.lastName);
        const firstNameComparer = new GenericComparer<Person>((p) => p.firstName);
        const ageComparer = new GenericComparer<Person>((p) => p.age);

        test('should compare using multiple criteria in order', () => {
            const nameComparer = new CompositeComparer(lastNameComparer, firstNameComparer);

            expect(nameComparer.compare(people[0], people[1])).toBe(1);
            expect(nameComparer.compare(people[0], people[2])).toBe(1);

            const sorted = [...people].sort((a, b) => nameComparer.compare(a, b));
            expect(sorted[0].lastName).toBe('Doe');
            expect(sorted[1].lastName).toBe('Smith');
            expect(sorted[1].firstName).toBe('Jane');
            expect(sorted[2].firstName).toBe('John');
        });

        test('should return 0 when all comparers return 0', () => {
            const composite = new CompositeComparer(
                lastNameComparer,
                firstNameComparer,
                ageComparer
            );

            const person1 = { lastName: 'Smith', firstName: 'John', age: 30 };
            const person2 = { lastName: 'Smith', firstName: 'John', age: 30 };

            expect(composite.compare(person1, person2)).toBe(0);
        });

        test('should throw when constructed with no comparers', () => {
            expect(() => {
                new CompositeComparer();
            }).toThrow(InvalidOperationError);
        });
    });

    describe('Type Guard Tests', () => {
        test('isComparer should correctly identify Comparer implementations', () => {
            const validComparer = new NumberComparer();

            expect(isComparer(validComparer)).toBe(true);
            expect(isComparer(null)).toBe(false);
            expect(isComparer(undefined)).toBe(false);
            expect(isComparer({})).toBe(false);
            expect(isComparer({ compare: 'not a function' })).toBe(false);
            expect(isComparer({ compare: (a: any, b: any) => 0 })).toBe(true);
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('ComparerOptions should affect behavior correctly', () => {
            const stringComparer = new StringComparer({
                ignoreCase: true,
                descending: true,
            });

            expect(stringComparer.compare('a', 'A')).toBe(0);
            expect(stringComparer.compare('a', 'b')).toBe(1);

            const numberComparer = new NumberComparer({
                nullFirst: true,
                precision: 1,
                descending: true,
            });

            expect(numberComparer.compare(NaN, 1)).toBe(-1);
            expect(numberComparer.compare(1.24, 1.21)).toBe(0);
            expect(numberComparer.compare(1, 2)).toBe(1);
        });

        test('should handle extreme values', () => {
            const numberComparer = new NumberComparer();

            expect(numberComparer.compare(Number.MAX_VALUE, Number.MIN_VALUE)).toBe(1);
            expect(numberComparer.compare(Number.MIN_VALUE, Number.MAX_VALUE)).toBe(-1);
            expect(numberComparer.compare(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0);

            expect(numberComparer.compare(Infinity, -Infinity)).toBe(1);
            expect(numberComparer.compare(-Infinity, Infinity)).toBe(-1);
            expect(numberComparer.compare(Infinity, Infinity)).toBe(0);
        });

        test('should handle empty/null strings', () => {
            const stringComparer = new StringComparer();

            expect(stringComparer.compare('', '')).toBe(0);
            expect(stringComparer.compare('', 'a')).toBe(-1);
            expect(stringComparer.compare('a', '')).toBe(1);

            expect(stringComparer.compare(null as any, null as any)).toBe(0);
            expect(stringComparer.compare('', null as any)).toBe(-1);
        });
    });
});
