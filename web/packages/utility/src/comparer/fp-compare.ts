type Brand<K, T> = K & { readonly __brand: T };
type Epsilon = Brand<number, 'Epsilon'>;
type ULPsTolerance = Brand<number, 'ULPsTolerance'>;

export type ComparisonStrategy = 'absolute' | 'relative' | 'ulps' | 'combined';
export type ComparisonResult = -1 | 0 | 1;
export type Numeric = number | bigint;
export type InfinityHandlingMode = 'strict' | 'signed' | 'equal';

export interface ComparisonContext<T extends Numeric = number> {
    readonly strategy: ComparisonStrategy;
    readonly epsilon: Epsilon;
    readonly relativeEpsilon: Epsilon;
    readonly absoluteEpsilon: Epsilon;
    readonly ulpsTolerance: ULPsTolerance;
    readonly treatNaNAsEqual: boolean;
    readonly infinityHandling: InfinityHandlingMode;
    readonly safetyChecks: boolean;
    readonly compare: (a: T, b: T) => ComparisonResult;
}

export interface ComparerOptions {
    readonly strategy?: ComparisonStrategy;
    readonly epsilon?: number;
    readonly relativeEpsilon?: number;
    readonly absoluteEpsilon?: number;
    readonly ulpsTolerance?: number;
    readonly treatNaNAsEqual?: boolean;
    readonly infinityHandling?: InfinityHandlingMode;
    readonly safetyChecks?: boolean;
}

const FLOAT64_BYTE_SIZE = 8;
const DEFAULT_EPSILON = Number.EPSILON;
const DEFAULT_ULPS_TOLERANCE = 1;
const DEFAULT_STRATEGY: ComparisonStrategy = 'combined';
const DEFAULT_INFINITY_HANDLING: InfinityHandlingMode = 'signed';
const MAX_ULPS_DISTANCE = Number.MAX_SAFE_INTEGER;
const MIN_NORMAL = 2.2250738585072014e-308; // Smallest positive normal number in IEEE 754

const enum FloatBitMasks {
    SIGN_MASK = 0x80000000,
    EXPONENT_MASK = 0x7ff00000,
    MANTISSA_HIGH_MASK = 0x000fffff,
}

const enum FloatBitShifts {
    SIGN_SHIFT = 31,
    EXPONENT_SHIFT = 20,
}

export class ComparisonError extends Error {
    readonly #code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'ComparisonError';
        this.#code = code;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ComparisonError);
        }
    }

    get code(): string {
        return this.#code;
    }
}

interface FloatBits {
    readonly sign: 0 | 1;
    readonly exponent: number;
    readonly mantissaHigh: number;
    readonly mantissaLow: number;
}

const internalCreateComparer = <T extends Numeric = number>(
    options: ComparerOptions = {}
): ComparisonContext<T> => {
    const strategy = options.strategy ?? DEFAULT_STRATEGY;
    const epsilon = (options.epsilon ?? DEFAULT_EPSILON) as Epsilon;
    const relativeEpsilon = (options.relativeEpsilon ?? DEFAULT_EPSILON) as Epsilon;
    const absoluteEpsilon = (options.absoluteEpsilon ?? DEFAULT_EPSILON) as Epsilon;
    const ulpsTolerance = (options.ulpsTolerance ?? DEFAULT_ULPS_TOLERANCE) as ULPsTolerance;
    const treatNaNAsEqual = options.treatNaNAsEqual ?? false;
    const infinityHandling = options.infinityHandling ?? DEFAULT_INFINITY_HANDLING;
    const safetyChecks = options.safetyChecks ?? true;

    const validateNumeric = (value: unknown): value is T => {
        return typeof value === 'number' || typeof value === 'bigint';
    };

    const compareWithContext = (a: T, b: T): ComparisonResult => {
        if (safetyChecks && (!validateNumeric(a) || !validateNumeric(b))) {
            throw new ComparisonError(
                'Both values must be numeric (number or bigint)',
                'INVALID_INPUT'
            );
        }

        if (typeof a === 'number' && typeof b === 'number') {
            const specialCaseResult = handleSpecialFloatCases(a, b);
            if (specialCaseResult !== null) {
                return specialCaseResult;
            }

            return compareFloats(a, b);
        }

        if (a === b) {
            return 0;
        }

        return a < b ? -1 : 1;
    };

    const handleSpecialFloatCases = (a: number, b: number): ComparisonResult | null => {
        const aIsNaN = Number.isNaN(a);
        const bIsNaN = Number.isNaN(b);

        if (aIsNaN && bIsNaN) {
            return treatNaNAsEqual ? 0 : -1;
        }

        if (aIsNaN) return -1;
        if (bIsNaN) return 1;

        const aIsInfinite = !Number.isFinite(a);
        const bIsInfinite = !Number.isFinite(b);

        if (aIsInfinite && bIsInfinite) {
            switch (infinityHandling) {
                case 'equal':
                    return 0;
                case 'signed':
                    return a === b ? 0 : a < b ? -1 : 1;
                case 'strict':
                default:
                    return a === b ? 0 : a < b ? -1 : 1;
            }
        }

        if (aIsInfinite) return a < 0 ? -1 : 1;
        if (bIsInfinite) return b < 0 ? 1 : -1;

        if (Object.is(a, -0) && Object.is(b, 0)) return -1;
        if (Object.is(a, 0) && Object.is(b, -0)) return 1;

        if (a === 0 && b === 0) return 0;

        return null;
    };

    const compareFloats = (a: number, b: number): ComparisonResult => {
        switch (strategy) {
            case 'absolute':
                return compareAbsolute(a, b);
            case 'relative':
                return compareRelative(a, b);
            case 'ulps':
                return compareUlps(a, b);
            case 'combined':
            default:
                return compareCombined(a, b);
        }
    };

    const compareAbsolute = (a: number, b: number): ComparisonResult => {
        const diff = Math.abs(a - b);
        const maxMagnitude = Math.max(Math.abs(a), Math.abs(b));

        if (maxMagnitude < MIN_NORMAL) {
            return a < b ? -1 : 1;
        }

        if (diff < absoluteEpsilon) return 0;
        return a < b ? -1 : 1;
    };

    const compareRelative = (a: number, b: number): ComparisonResult => {
        const absA = Math.abs(a);
        const absB = Math.abs(b);
        const maxMagnitude = Math.max(absA, absB);
        if (maxMagnitude === 0) return 0;

        const relDiff = Math.abs(a - b) / maxMagnitude;
        if (relDiff < relativeEpsilon) return 0;
        return a < b ? -1 : 1;
    };

    const compareUlps = (a: number, b: number): ComparisonResult => {
        const ulpsDistance = computeUlpsDistance(a, b);
        if (ulpsDistance < Number(ulpsTolerance)) return 0;
        return a < b ? -1 : 1;
    };

    const compareCombined = (a: number, b: number): ComparisonResult => {
        const absResult = compareAbsolute(a, b);
        if (absResult === 0) return 0;

        const relResult = compareRelative(a, b);
        if (relResult === 0) return 0;

        const ulpsResult = compareUlps(a, b);
        return ulpsResult;
    };

    const getFloatBits = (value: number): FloatBits => {
        const buffer = new ArrayBuffer(FLOAT64_BYTE_SIZE);
        const float64 = new Float64Array(buffer);
        const uint32 = new Uint32Array(buffer);
        float64[0] = value;

        const highBits = uint32[1];
        const lowBits = uint32[0];

        const sign = ((highBits & FloatBitMasks.SIGN_MASK) >>> FloatBitShifts.SIGN_SHIFT) as 0 | 1;
        const exponent = (highBits & FloatBitMasks.EXPONENT_MASK) >>> FloatBitShifts.EXPONENT_SHIFT;
        const mantissaHigh = highBits & FloatBitMasks.MANTISSA_HIGH_MASK;

        return {
            sign,
            exponent,
            mantissaHigh,
            mantissaLow: lowBits,
        };
    };

    const computeUlpsDistance = (a: number, b: number): number => {
        if (Object.is(a, b)) return 0;

        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return MAX_ULPS_DISTANCE;
        }

        const buffer = new ArrayBuffer(8);
        const f64 = new Float64Array(buffer);
        const u8 = new Uint8Array(buffer);

        const floatToOrderedInt = (v: number): bigint => {
            f64[0] = v;
            let lo = 0n;
            let hi = 0n;
            // lower 4 bytes
            lo |= BigInt(u8[0]);
            lo |= BigInt(u8[1]) << 8n;
            lo |= BigInt(u8[2]) << 16n;
            lo |= BigInt(u8[3]) << 24n;
            // upper 4 bytes
            hi |= BigInt(u8[4]);
            hi |= BigInt(u8[5]) << 8n;
            hi |= BigInt(u8[6]) << 16n;
            hi |= BigInt(u8[7]) << 24n;

            const uint64 = (hi << 32n) | lo;

            // map to signed ordering that preserves numeric order when compared as integers
            const signBit = uint64 >> 63n;
            return signBit === 0n ? uint64 | (1n << 63n) : ~uint64 & ((1n << 64n) - 1n);
        };

        const intA = floatToOrderedInt(a);
        const intB = floatToOrderedInt(b);
        const diff = intA >= intB ? intA - intB : intB - intA;
        if (diff > BigInt(Number.MAX_SAFE_INTEGER)) return MAX_ULPS_DISTANCE;
        return Number(diff);
    };

    return Object.freeze({
        strategy,
        epsilon,
        relativeEpsilon,
        absoluteEpsilon,
        ulpsTolerance,
        treatNaNAsEqual,
        infinityHandling,
        safetyChecks,
        compare: compareWithContext,
    });
};

export const createComparer = <T extends Numeric = number>(
    options: ComparerOptions = {}
): ((a: T, b: T) => ComparisonResult) => {
    const context = internalCreateComparer<T>(options);
    return (a: T, b: T): ComparisonResult => context.compare(a, b);
};

export interface ComparisonPredicates<T extends Numeric = number> {
    readonly equals: (a: T, b: T) => boolean;
    readonly notEquals: (a: T, b: T) => boolean;
    readonly lessThan: (a: T, b: T) => boolean;
    readonly greaterThan: (a: T, b: T) => boolean;
    readonly lessThanOrEqual: (a: T, b: T) => boolean;
    readonly greaterThanOrEqual: (a: T, b: T) => boolean;
}

export const createPredicates = <T extends Numeric = number>(
    comparer: (a: T, b: T) => ComparisonResult
): ComparisonPredicates<T> => {
    const equals = (a: T, b: T): boolean => comparer(a, b) === 0;
    const notEquals = (a: T, b: T): boolean => comparer(a, b) !== 0;
    const lessThan = (a: T, b: T): boolean => comparer(a, b) === -1;
    const greaterThan = (a: T, b: T): boolean => comparer(a, b) === 1;
    const lessThanOrEqual = (a: T, b: T): boolean => {
        const result = comparer(a, b);
        return result === -1 || result === 0;
    };
    const greaterThanOrEqual = (a: T, b: T): boolean => {
        const result = comparer(a, b);
        return result === 1 || result === 0;
    };

    return Object.freeze({
        equals,
        notEquals,
        lessThan,
        greaterThan,
        lessThanOrEqual,
        greaterThanOrEqual,
    });
};

export interface ComparisonOperators<T extends Numeric = number> {
    readonly eq: (a: T, b: T) => boolean;
    readonly neq: (a: T, b: T) => boolean;
    readonly lt: (a: T, b: T) => boolean;
    readonly gt: (a: T, b: T) => boolean;
    readonly lte: (a: T, b: T) => boolean;
    readonly gte: (a: T, b: T) => boolean;
}

export const createOperators = <T extends Numeric = number>(
    comparer: (a: T, b: T) => ComparisonResult
): ComparisonOperators<T> => {
    const predicates = createPredicates(comparer);

    return Object.freeze({
        eq: predicates.equals,
        neq: predicates.notEquals,
        lt: predicates.lessThan,
        gt: predicates.greaterThan,
        lte: predicates.lessThanOrEqual,
        gte: predicates.greaterThanOrEqual,
    });
};

export interface FloatingPointUtils {
    readonly isNaN: (value: number) => boolean;
    readonly isFinite: (value: number) => boolean;
    readonly isInfinite: (value: number) => boolean;
    readonly isNegativeZero: (value: number) => boolean;
    readonly isPositiveZero: (value: number) => boolean;
    readonly isZero: (value: number) => boolean;
    readonly isNormal: (value: number) => boolean;
    readonly isSubnormal: (value: number) => boolean;
}

export const floatUtils: FloatingPointUtils = Object.freeze({
    isNaN: Number.isNaN,
    isFinite: Number.isFinite,
    isInfinite: (value: number): boolean => !Number.isFinite(value) && !Number.isNaN(value),
    isNegativeZero: (value: number): boolean => Object.is(value, -0),
    isPositiveZero: (value: number): boolean => Object.is(value, 0) && !Object.is(value, -0),
    isZero: (value: number): boolean => value === 0,
    isNormal: (value: number): boolean => {
        if (!Number.isFinite(value) || value === 0) return false;
        return Math.abs(value) >= MIN_NORMAL;
    },
    isSubnormal: (value: number): boolean => {
        if (!Number.isFinite(value) || value === 0) return false;
        return Math.abs(value) < MIN_NORMAL;
    },
});

export const constants = Object.freeze({
    EPSILON: Number.EPSILON,
    MIN_VALUE: Number.MIN_VALUE,
    MAX_VALUE: Number.MAX_VALUE,
    MIN_NORMAL: 2.2250738585072014e-308,
    POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
    NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
    NaN: Number.NaN,
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    ULP_64: 2.220446049250313e-16,
});

const DEFAULT_COMPARER = createComparer();
const DEFAULT_PREDICATES = createPredicates(DEFAULT_COMPARER);
const DEFAULT_OPERATORS = createOperators(DEFAULT_COMPARER);

export const { equals, notEquals, lessThan, greaterThan, lessThanOrEqual, greaterThanOrEqual } =
    DEFAULT_PREDICATES;
export const { eq, neq, lt, gt, lte, gte } = DEFAULT_OPERATORS;
export const compare = DEFAULT_COMPARER;

export const FloatComparer = Object.freeze({
    compare,
    equals,
    notEquals,
    lessThan,
    greaterThan,
    lessThanOrEqual,
    greaterThanOrEqual,
    eq,
    neq,
    lt,
    gt,
    lte,
    gte,
    createComparer,
    createPredicates,
    createOperators,
    constants,
    utils: floatUtils,
    ComparisonError,
});

export default FloatComparer;
