/**
 * Defines a generic comparer interface for comparing two values.
 * @template T - The type of the values to be compared.
 */
export interface Comparer<T> {
    /**
     * Compares two values.
     * @param a - The first value.
     * @param b - The second value.
     * @returns A negative number if a < b, zero if a = b, a positive number if a > b.
     */
    compare(a: T, b: T): number;
}

/**
 * Compares two numbers in either ascending or descending order.
 */
export class NumberComparer implements Comparer<number> {
    /**
     * @param ascending - Determines the sort order. True for ascending, false for descending.
     */
    constructor(private ascending: boolean = true) {}

    /**
     * Compares two numbers.
     * @param a - The first number.
     * @param b - The second number.
     * @returns The difference between the two numbers based on the sort order.
     */
    compare(a: number, b: number): number {
        return this.ascending ? a - b : b - a;
    }
}

/**
 * Compares two strings with optional case sensitivity.
 */
export class StringComparer implements Comparer<string> {
    /**
     * @param caseSensitive - Determines if the comparison is case-sensitive.
     */
    constructor(private caseSensitive: boolean = true) {}

    /**
     * Compares two strings.
     * @param a - The first string.
     * @param b - The second string.
     * @returns A negative number if a < b, zero if a = b, a positive number if a > b.
     */
    compare(a: string, b: string): number {
        if (this.caseSensitive) {
            return a.localeCompare(b);
        } else {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        }
    }
}

/**
 * Compares two values using a custom comparison function.
 * @template T - The type of the values to be compared.
 */
export class CustomComparer<T> implements Comparer<T> {
    /**
     * @param compareFunction - The custom comparison function.
     */
    constructor(private compareFunction: (a: T, b: T) => number) {}

    /**
     * Compares two values using the custom comparison function.
     * @param a - The first value.
     * @param b - The second value.
     * @returns The result of the custom comparison function.
     */
    compare(a: T, b: T): number {
        return this.compareFunction(a, b);
    }
}

/**
 * Compares two Date objects.
 */
export class DateComparer implements Comparer<Date> {
    /**
     * Compares two dates.
     * @param a - The first date.
     * @param b - The second date.
     * @returns The difference in time between the two dates.
     */
    compare(a: Date, b: Date): number {
        return a.getTime() - b.getTime();
    }
}

/**
 * Compares two objects based on a specified property.
 * @template T - The type of the objects to be compared.
 */
export class ObjectPropertyComparer<T> implements Comparer<T> {
    /**
     * @param property - The property of the objects to compare.
     */
    constructor(private property: keyof T) {}

    /**
     * Compares two objects based on the specified property.
     * @param a - The first object.
     * @param b - The second object.
     * @returns A negative number if a[property] < b[property], zero if a[property] = b[property],
     * a positive number if a[property] > b[property].
     */
    compare(a: T, b: T): number {
        if (a[this.property] < b[this.property]) {
            return -1;
        } else if (a[this.property] > b[this.property]) {
            return 1;
        } else {
            return 0;
        }
    }
}

/**
 * Type definition for a constructor of a Comparer.
 * @template T - The type of the values to be compared.
 */
type ComparerConstructor<T> = new () => Comparer<T>;

/**
 * Factory class to create comparer instances based on type.
 */
export class ComparerFactory {
    private static comparerMap = new Map<string, ComparerConstructor<any>>([
        ['number', NumberComparer],
        ['string', StringComparer],
        ['date', DateComparer],
    ]);

    /**
     * Creates a comparer instance for the specified type or a custom comparer.
     * @template T - The type of the values to be compared.
     * @param type - The type of comparer to create.
     * @param customComparer - Optional custom comparison function.
     * @returns The comparer instance.
     * @throws If no comparer is found for the specified type.
     */
    static createComparer<T>(type: string, customComparer?: (a: T, b: T) => number): Comparer<T> {
        if (customComparer) {
            return new CustomComparer<T>(customComparer);
        }

        const comparerConstructor = this.comparerMap.get(type);
        if (!comparerConstructor) {
            throw new Error(`No comparer found for type: ${type}`);
        }

        return new comparerConstructor();
    }

    /**
     * Registers a new comparer type with its constructor.
     * @template T - The type of the values to be compared.
     * @param type - The type key for the comparer.
     * @param comparerConstructor - The constructor of the comparer.
     */
    static registerComparer<T>(type: string, comparerConstructor: ComparerConstructor<T>): void {
        this.comparerMap.set(type, comparerConstructor);
    }
}

/**
 * Interface for objects that can be compared for equality.
 * @template T - The type of the object to be compared.
 */
export interface IEquatable<T> {
    /**
     * Checks if the current object is equal to another object.
     * @param other - The object to compare with.
     * @returns True if the objects are equal, otherwise false.
     */
    equals(other: T): boolean;
}

/**
 * Base class for equatable objects, providing utility methods for comparison.
 * @template T - The type of the object to be compared.
 */
export abstract class EquatableBase<T> implements IEquatable<T> {
    abstract equals(other: T): boolean;

    /**
     * Compares two equatable objects for equality.
     * @template T - The type of the objects to be compared.
     * @param a - The first object.
     * @param b - The second object.
     * @returns True if the objects are equal, otherwise false.
     */
    static areEqual<T extends IEquatable<T>>(a: T, b: T): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;
        return a.equals(b);
    }

    /**
     * Compares two arrays of equatable objects for equality.
     * @template T - The type of the objects to be compared.
     * @param a - The first array.
     * @param b - The second array.
     * @returns True if the arrays are equal, otherwise false.
     */
    static areArraysEqual<T extends IEquatable<T>>(a: T[], b: T[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!a[i].equals(b[i])) return false;
        }
        return true;
    }

    /**
     * Performs a deep equality check on two objects.
     * @template T - The type of the objects to be compared.
     * @param a - The first object.
     * @param b - The second object.
     * @returns True if the objects are deeply equal, otherwise false.
     */
    static deepEqual<T extends Record<string, any>>(a: T, b: T): boolean {
        if (a === b) return true;
        if (typeof a !== 'object' || typeof b !== 'object') return false;
        if (a === null || b === null) return false;

        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!b.hasOwnProperty(key)) return false;
            if (!EquatableBase.deepEqual(a[key], b[key])) return false;
        }

        return true;
    }

    /**
     * Creates an instance of an equatable object from a JSON string.
     * @template T - The type of the object to be created.
     * @param json - The JSON string.
     * @param ctor - The constructor of the object.
     * @returns The created object.
     */
    static fromJSON<T extends EquatableBase<T>>(json: string, ctor: new () => T): T {
        const obj = new ctor();
        Object.assign(obj, JSON.parse(json));
        return obj;
    }

    /**
     * Generates a hash code for an object.
     * @template T - The type of the object.
     * @param obj - The object.
     * @returns The hash code.
     */
    static hashCode<T>(obj: T): number {
        const str = JSON.stringify(obj);
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0;
        }
        return hash;
    }
}
