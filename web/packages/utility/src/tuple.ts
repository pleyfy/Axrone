/**
 * Zero-cost tuple utilities for compile-time immutability.
 *
 * These functions provide readonly tuple types without runtime Object.freeze overhead.
 * TypeScript's `readonly` modifier and `const` type parameters ensure immutability
 * at compile time, while the runtime just returns plain JavaScript arrays.
 *
 * Use these instead of Object.freeze([...]) for tuple creation in both setup and hot paths.
 */

/**
 * Creates a readonly tuple from the provided elements.
 * Uses `const` type parameter to preserve literal types.
 *
 * @example
 * const pos = tuple(10, 20, 30); // readonly [10, 20, 30]
 * const mixed = tuple(1, "hello", true); // readonly [1, "hello", true]
 */
export const tuple = <const T extends readonly unknown[]>(...elements: T): T => elements;

/**
 * Creates a readonly 2-tuple (pair) with heterogeneous type support.
 *
 * @example
 * const position = tuple2(10, 20); // readonly [10, 20]
 * const range = tuple2(0, 100); // readonly [0, 100]
 */
export const tuple2 = <const A, const B>(a: A, b: B): readonly [A, B] => [a, b];

/**
 * Creates a readonly 3-tuple (triple) with heterogeneous type support.
 *
 * @example
 * const position = tuple3(1, 2, 3); // readonly [1, 2, 3]
 * const color = tuple3(255, 128, 0); // readonly [255, 128, 0]
 */
export const tuple3 = <const A, const B, const C>(a: A, b: B, c: C): readonly [A, B, C] => [a, b, c];

/**
 * Creates a readonly 4-tuple (quad) with heterogeneous type support.
 *
 * @example
 * const quaternion = tuple4(0, 0, 0, 1); // readonly [0, 0, 0, 1]
 * const color = tuple4(1, 0, 0, 1); // readonly [1, 0, 0, 1]
 */
export const tuple4 = <const A, const B, const C, const D>(
    a: A,
    b: B,
    c: C,
    d: D
): readonly [A, B, C, D] => [a, b, c, d];
