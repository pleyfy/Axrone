/**
 * Shared primitive value types for the hash package.
 *
 * Restored: every consumer below referenced this module, but the file was
 * never committed — `rollup-plugin-dts` failed to resolve the imports and
 * `yarn build` aborted engine-wide.
 */

/** Byte-sequence accepted by hashers and digest updates. */
export type BytesLike = Uint8Array | number[];

/** Unsigned 64-bit value (u64 range, held in a bigint). */
export type UInt64 = bigint;

/** Signed 64-bit value (i64 range, held in a bigint). */
export type Int64 = bigint;
