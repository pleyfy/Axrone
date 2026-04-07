import { describe, it, expect, test, beforeEach } from 'vitest';
import {
    CompareResult,
    Comparer,
    EqualityComparer,
    Equatable,
    isEquatable,
    ComparerOptions,
    EqualityComparerOptions,
    KeySelector,
} from '../../';

class Person implements Equatable {
    constructor(
        public id: number,
        public firstName: string,
        public lastName: string,
        public age: number,
        public birthDate: Date
    ) {}

    equals(other: unknown): boolean {
        if (!(other instanceof Person)) return false;
        return this.id === other.id;
    }

    getHashCode(): number {
        return this.id;
    }
}

class PersonAgeComparer implements Comparer<Person> {
    constructor(private options?: ComparerOptions) {}

    compare(a: Person, b: Person): CompareResult {
        if (a === null && b === null) return 0;
        if (a === null) return this.options?.nullFirst ? -1 : 1;
        if (b === null) return this.options?.nullFirst ? 1 : -1;

        const multiplier = this.options?.descending ? -1 : 1;

        if (a.age < b.age) return (-1 * multiplier) as CompareResult;
        if (a.age > b.age) return (1 * multiplier) as CompareResult;
        return 0;
    }
}

class PersonNameComparer implements Comparer<Person> {
    constructor(private options?: ComparerOptions) {}

    compare(a: Person, b: Person): CompareResult {
        if (a === null && b === null) return 0;
        if (a === null) return this.options?.nullFirst ? -1 : 1;
        if (b === null) return this.options?.nullFirst ? 1 : -1;

        let lastNameResult: CompareResult = 0;

        if (a.lastName < b.lastName) lastNameResult = -1;
        else if (a.lastName > b.lastName) lastNameResult = 1;

        if (lastNameResult !== 0) {
            return this.options?.descending
                ? ((lastNameResult * -1) as CompareResult)
                : lastNameResult;
        }

        let firstNameResult: CompareResult = 0;

        if (a.firstName < b.firstName) firstNameResult = -1;
        else if (a.firstName > b.firstName) firstNameResult = 1;

        return this.options?.descending
            ? ((firstNameResult * -1) as CompareResult)
            : firstNameResult;
    }
}

class BirthdayEqualityComparer implements EqualityComparer<Date> {
    constructor(private options?: EqualityComparerOptions) {}

    equals(a: Date, b: Date): boolean {
        if (a === b) return true;
        if (!a || !b) return false;

        return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    hash(obj: Date): number {
        if (!obj) return 0;

        return obj.getMonth() * 31 + obj.getDate();
    }
}

class GenericEqualityComparer<T> implements EqualityComparer<T> {
    constructor(private options?: EqualityComparerOptions) {}

    equals(a: T, b: T): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;

        if (isEquatable(a) && b instanceof Object) {
            return a.equals(b);
        }

        if (typeof a === 'string' && typeof b === 'string' && this.options?.ignoreCase) {
            return a.toLowerCase() === b.toLowerCase();
        }

        if (this.options?.customizer) {
            return this.options.customizer(a, b);
        }

        if (this.options?.strict) {
            return a === b;
        }

        return a == b;
    }

    hash(obj: T): number {
        if (obj === null || obj === undefined) return 0;

        if (isEquatable(obj)) {
            return obj.getHashCode();
        }

        if (typeof obj === 'number') return obj | 0;
        if (typeof obj === 'boolean') return obj ? 1 : 0;

        if (typeof obj === 'string') {
            let str: string = obj;
            if (this.options?.ignoreCase) {
                str = str.toLowerCase();
            }

            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = (hash << 5) - hash + str.charCodeAt(i);
                hash |= 0; // Convert to 32bit integer
            }
            return hash;
        }

        return 0;
    }
}

class KeySelectorComparer<T, K> implements Comparer<T> {
    constructor(
        private keySelector: KeySelector<T, K>,
        private comparer: Comparer<K>
    ) {}

    compare(a: T, b: T): CompareResult {
        const keyA = this.keySelector(a);
        const keyB = this.keySelector(b);
        return this.comparer.compare(keyA, keyB);
    }
}

class SortedList<T> {
    private items: T[] = [];

    constructor(private comparer: Comparer<T>) {}

    add(item: T): void {
        this.items.push(item);
        this.sort();
    }

    addRange(items: T[]): void {
        this.items.push(...items);
        this.sort();
    }

    private sort(): void {
        this.items.sort((a, b) => this.comparer.compare(a, b));
    }

    getItems(): T[] {
        return [...this.items];
    }
}

class Dictionary<K, V> {
    private items: Map<number, [K, V]> = new Map();

    constructor(private keyComparer: EqualityComparer<K>) {}

    set(key: K, value: V): void {
        const hash = this.keyComparer.hash(key);

        if (this.items.has(hash)) {
            const [existingKey] = this.items.get(hash)!;
            if (this.keyComparer.equals(existingKey, key)) {
                this.items.set(hash, [key, value]);
            } else {
                const newHash = hash ^ 1;
                this.items.set(newHash, [key, value]);
            }
        } else {
            this.items.set(hash, [key, value]);
        }
    }

    get(key: K): V | undefined {
        const hash = this.keyComparer.hash(key);

        if (!this.items.has(hash)) {
            const altHash = hash ^ 1;
            if (!this.items.has(altHash)) {
                return undefined;
            }

            const [existingKey, value] = this.items.get(altHash)!;
            return this.keyComparer.equals(existingKey, key) ? value : undefined;
        }

        const [existingKey, value] = this.items.get(hash)!;
        return this.keyComparer.equals(existingKey, key) ? value : undefined;
    }

    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    keys(): K[] {
        return Array.from(this.items.values()).map(([key]) => key);
    }

    values(): V[] {
        return Array.from(this.items.values()).map(([_, value]) => value);
    }

    entries(): [K, V][] {
        return Array.from(this.items.values());
    }
}

describe('Integration Tests', () => {
    const people = [
        new Person(1, 'John', 'Smith', 30, new Date(1993, 5, 15)),
        new Person(2, 'Jane', 'Smith', 28, new Date(1995, 8, 22)),
        new Person(3, 'Bob', 'Johnson', 45, new Date(1978, 3, 10)),
        new Person(4, 'Alice', 'Johnson', 33, new Date(1990, 11, 5)),
        new Person(5, 'Mike', 'Williams', 22, new Date(2001, 5, 15)),
    ];

    describe('Sorting Collections', () => {
        test('should sort people by age in ascending order', () => {
            const sortedList = new SortedList<Person>(new PersonAgeComparer());
            sortedList.addRange(people);

            const sorted = sortedList.getItems();
            expect(sorted[0].firstName).toBe('Mike');
            expect(sorted[1].firstName).toBe('Jane');
            expect(sorted[2].firstName).toBe('John');
            expect(sorted[3].firstName).toBe('Alice');
            expect(sorted[4].firstName).toBe('Bob');
        });

        test('should sort people by age in descending order', () => {
            const sortedList = new SortedList<Person>(new PersonAgeComparer({ descending: true }));
            sortedList.addRange(people);

            const sorted = sortedList.getItems();
            expect(sorted[0].firstName).toBe('Bob');
            expect(sorted[1].firstName).toBe('Alice');
            expect(sorted[2].firstName).toBe('John');
            expect(sorted[3].firstName).toBe('Jane');
            expect(sorted[4].firstName).toBe('Mike');
        });

        test('should sort people by lastname then firstname', () => {
            const sortedList = new SortedList<Person>(new PersonNameComparer());
            sortedList.addRange(people);

            const sorted = sortedList.getItems();

            // Johnson, Alice
            // Johnson, Bob
            // Smith, Jane
            // Smith, John
            // Williams, Mike

            expect(sorted[0].lastName).toBe('Johnson');
            expect(sorted[0].firstName).toBe('Alice');

            expect(sorted[1].lastName).toBe('Johnson');
            expect(sorted[1].firstName).toBe('Bob');

            expect(sorted[2].lastName).toBe('Smith');
            expect(sorted[2].firstName).toBe('Jane');

            expect(sorted[3].lastName).toBe('Smith');
            expect(sorted[3].firstName).toBe('John');

            expect(sorted[4].lastName).toBe('Williams');
        });

        test('should sort using KeySelector pattern', () => {
            const numberComparer: Comparer<number> = {
                compare: (a, b) => {
                    if (a < b) return -1;
                    if (a > b) return 1;
                    return 0;
                },
            };

            const ageSelector: KeySelector<Person, number> = (person) => person.age;

            const keySelectorComparer = new KeySelectorComparer(ageSelector, numberComparer);

            const sortedList = new SortedList<Person>(keySelectorComparer);
            sortedList.addRange(people);

            const sorted = sortedList.getItems();
            expect(sorted[0].age).toBe(22);
            expect(sorted[4].age).toBe(45);
        });
    });

    describe('Dictionary with Custom EqualityComparer', () => {
        test('should store and retrieve values using string keys with case insensitivity', () => {
            const caseInsensitiveComparer = new GenericEqualityComparer<string>({
                ignoreCase: true,
            });

            const dict = new Dictionary<string, Person>(caseInsensitiveComparer);

            dict.set('JOHN', people[0]);
            dict.set('JANE', people[1]);
            dict.set('BOB', people[2]);

            expect(dict.get('john')).toBe(people[0]);
            expect(dict.get('jane')).toBe(people[1]);
            expect(dict.get('bob')).toBe(people[2]);

            expect(dict.get('unknown')).toBeUndefined();

            expect(dict.has('JOHN')).toBe(true);
            expect(dict.has('john')).toBe(true);
            expect(dict.has('unknown')).toBe(false);
        });

        test('should handle Equatable objects as keys', () => {
            const personComparer: EqualityComparer<Person> = {
                equals: (a, b) => a.id === b.id,
                hash: (obj) => obj.id,
            };

            const dict = new Dictionary<Person, string>(personComparer);

            dict.set(people[0], 'Developer');
            dict.set(people[1], 'Designer');
            dict.set(people[2], 'Manager');

            const johnCopy = new Person(1, 'John', 'Smith', 30, new Date(1993, 5, 15));
            const janeCopy = new Person(2, 'Jane', 'Smith', 28, new Date(1995, 8, 22));

            expect(dict.get(johnCopy)).toBe('Developer');
            expect(dict.get(janeCopy)).toBe('Designer');

            const unknown = new Person(99, 'Unknown', 'Person', 0, new Date());
            expect(dict.get(unknown)).toBeUndefined();
        });

        test('should compare dates by month and day only using custom comparer', () => {
            const birthdayComparer = new BirthdayEqualityComparer();
            const dict = new Dictionary<Date, Person[]>(birthdayComparer);

            for (const person of people) {
                const birthday = person.birthDate;
                const existingGroup = dict.get(birthday) || [];
                existingGroup.push(person);
                dict.set(birthday, existingGroup);
            }

            const johnBirthday = people[0].birthDate;
            const mikeBirthday = people[4].birthDate;

            const johnGroup = dict.get(johnBirthday)!;
            expect(johnGroup).toHaveLength(2);
            expect(johnGroup).toContain(people[0]);
            expect(johnGroup).toContain(people[4]);

            expect(dict.get(mikeBirthday)).toBe(johnGroup);

            const bobBirthday = people[2].birthDate;
            const bobGroup = dict.get(bobBirthday)!;
            expect(bobGroup).toHaveLength(1);
            expect(bobGroup[0]).toBe(people[2]);
        });
    });

    describe('Comparer Composition', () => {
        test('should compose multiple comparers for complex sorting', () => {
            const lastNameSelector: KeySelector<Person, string> = (p) => p.lastName;
            const ageSelector: KeySelector<Person, number> = (p) => p.age;

            const stringComparer: Comparer<string> = {
                compare: (a, b) => {
                    if (a < b) return -1;
                    if (a > b) return 1;
                    return 0;
                },
            };

            const numberComparer: Comparer<number> = {
                compare: (a, b) => {
                    if (a < b) return -1;
                    if (a > b) return 1;
                    return 0;
                },
            };

            const lastNameComparer = new KeySelectorComparer(lastNameSelector, stringComparer);
            const ageComparer = new KeySelectorComparer(ageSelector, numberComparer);

            class CompositeComparer<T> implements Comparer<T> {
                constructor(private comparers: Comparer<T>[]) {}

                compare(a: T, b: T): CompareResult {
                    for (const comparer of this.comparers) {
                        const result = comparer.compare(a, b);
                        if (result !== 0) return result;
                    }
                    return 0;
                }
            }

            const compositeComparer = new CompositeComparer<Person>([
                lastNameComparer,
                ageComparer,
            ]);

            const sortedList = new SortedList<Person>(compositeComparer);
            sortedList.addRange(people);

            const sorted = sortedList.getItems();

            // 1. Johnson, Alice (33)
            // 2. Johnson, Bob (45)
            // 3. Smith, Jane (28)
            // 4. Smith, John (30)
            // 5. Williams, Mike (22)

            expect(sorted[0].lastName).toBe('Johnson');
            expect(sorted[0].firstName).toBe('Alice');

            expect(sorted[1].lastName).toBe('Johnson');
            expect(sorted[1].firstName).toBe('Bob');

            expect(sorted[2].lastName).toBe('Smith');
            expect(sorted[2].firstName).toBe('Jane');

            expect(sorted[3].lastName).toBe('Smith');
            expect(sorted[3].firstName).toBe('John');

            expect(sorted[4].lastName).toBe('Williams');
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('should handle null values according to nullFirst option', () => {
            const withoutNullFirst = new PersonAgeComparer();
            const withNullFirst = new PersonAgeComparer({ nullFirst: true });

            const person = people[0];
            const nullPerson = null as any;

            expect(withoutNullFirst.compare(person, nullPerson)).toBe(-1);
            expect(withoutNullFirst.compare(nullPerson, person)).toBe(1);

            expect(withNullFirst.compare(person, nullPerson)).toBe(1);
            expect(withNullFirst.compare(nullPerson, person)).toBe(-1);

            expect(withoutNullFirst.compare(nullPerson, nullPerson)).toBe(0);
            expect(withNullFirst.compare(nullPerson, nullPerson)).toBe(0);
        });
    });
});
