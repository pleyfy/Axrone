type BrandedNumber<T extends string> = number & { readonly __brand: T };

type FiniteNumber = BrandedNumber<'finite'>;

type ClampedNumber<Min extends number, Max extends number> = BrandedNumber<`clamped-${Min}-${Max}`>;

type IsFiniteNumber<T> = T extends number ? (number extends T ? false : true) : false;

type ValidateBounds<Min extends number, Max extends number> = [
    IsFiniteNumber<Min>,
    IsFiniteNumber<Max>,
] extends [true, true]
    ? [Min, Max]
    : never;

type IsWithinBounds<Value, Min, Max> = Value extends number
    ? Min extends number
        ? Max extends number
            ? true
            : false
        : false
    : false;

type ComputeClampedValue<Value, Min, Max> = Value extends number
    ? Min extends number
        ? Max extends number
            ? Value
            : never
        : never
    : never;

export type ClampResult<Value extends number, Min extends number, Max extends number> =
    ValidateBounds<Min, Max> extends [infer NormMin, infer NormMax]
        ? NormMin extends number
            ? NormMax extends number
                ? IsWithinBounds<Value, NormMin, NormMax> extends true
                    ? Value
                    : ComputeClampedValue<Value, NormMin, NormMax>
                : never
            : never
        : never;

export class NumericRangeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NumericRangeError';
        (this as any).__proto__ = NumericRangeError.prototype;
    }
}

const isFiniteNumber = (value: unknown): value is FiniteNumber =>
    typeof value === 'number' && value === value && isFinite(value);

const fastClamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

const validateNumber = (value: unknown, context: string): void => {
    if (process.env.NODE_ENV !== 'production' && !isFiniteNumber(value)) {
        throw new NumericRangeError(`${context} must be a finite number`);
    }
};

const validateBounds = (min: number, max: number): void => {
    if (process.env.NODE_ENV !== 'production') {
        validateNumber(min, 'Minimum bound');
        validateNumber(max, 'Maximum bound');
    }
};

export function clamp<const Min extends number, const Max extends number>(
    value: number,
    min: Min,
    max: Max
): ValidateBounds<Min, Max> extends [infer NormMin, infer NormMax]
    ? NormMin extends number
        ? NormMax extends number
            ? ClampedNumber<NormMin, NormMax>
            : never
        : never
    : never;

export function clamp(value: number, min: number, max: number): number;

export function clamp(value: number, min: number, max: number): number {
    validateNumber(value, 'Value');
    validateBounds(min, max);

    return min <= max ? fastClamp(value, min, max) : fastClamp(value, max, min);
}

export function createBoundedClamp<const Min extends number, const Max extends number>(
    min: Min,
    max: Max
): ValidateBounds<Min, Max> extends [infer NormMin, infer NormMax]
    ? NormMin extends number
        ? NormMax extends number
            ? (value: number) => ClampedNumber<NormMin, NormMax>
            : never
        : never
    : never;

export function createBoundedClamp(min: number, max: number): (value: number) => number;

export function createBoundedClamp(min: number, max: number) {
    validateBounds(min, max);
    const [lowerBound, upperBound] = min <= max ? [min, max] : [max, min];

    return (value: number): number => {
        validateNumber(value, 'Value');
        return fastClamp(value, lowerBound, upperBound);
    };
}

export const clampUnsafe = (value: number, min: number, max: number): number =>
    fastClamp(value, min <= max ? min : max, min <= max ? max : min);

export const clampInt = (value: number, min: number, max: number): number => {
    const intValue = value | 0;
    const intMin = min | 0;
    const intMax = max | 0;
    const [lower, upper] = intMin <= intMax ? [intMin, intMax] : [intMax, intMin];
    return fastClamp(intValue, lower, upper);
};

export const clamp01 = (value: number): number => fastClamp(value, 0, 1);

export const clamp0255 = (value: number): number => fastClamp(value, 0, 255);

export const clampNegOneOne = (value: number): number => fastClamp(value, -1, 1);

export type { FiniteNumber, ClampedNumber, BrandedNumber, ValidateBounds, IsFiniteNumber };
