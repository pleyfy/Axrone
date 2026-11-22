/**
 * Shared math utilities for terrain package.
 * @internal
 */

/** Hermite interpolation between 0 and 1. */
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
