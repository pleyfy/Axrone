import { describe, expect, test } from 'vitest';
import {
    validatePositive,
    createError,
    ErrorCodes,
    validateFinite,
    validateInteger,
    validateInRange,
    BoxMullerError,
} from '../box-muller';

describe('Error Utilities', () => {
    describe('createError', () => {
        test('should return a BoxMullerError instance', () => {
            const error = createError(ErrorCodes.INVALID_PARAMETER, 'Test error message');
            expect(error).toBeInstanceOf(BoxMullerError);
            expect(error).toBeInstanceOf(Error);
        });

        test('should set the correct code and message', () => {
            const errorCode = ErrorCodes.INVALID_PARAMETER;
            const errorMessage = 'Test error message';
            const error = createError(errorCode, errorMessage);

            expect(error.code).toBe(errorCode);
            expect(error.message).toBe(errorMessage);
        });

        test('should set the error name to BoxMullerError', () => {
            const error = createError(ErrorCodes.INVALID_PARAMETER, 'Test error message');
            expect(error.name).toBe('BoxMullerError');
        });

        test('should work with different error codes', () => {
            Object.values(ErrorCodes).forEach((code) => {
                const error = createError(code, `Error with code ${code}`);
                expect(error.code).toBe(code);
            });
        });

        test('should be catchable in try-catch blocks', () => {
            const errorCode = ErrorCodes.INVALID_PARAMETER;
            const errorMessage = 'Test error message';

            let caughtError: any;

            try {
                throw createError(errorCode, errorMessage);
            } catch (e) {
                caughtError = e;
            }

            expect(caughtError).toBeInstanceOf(BoxMullerError);
            expect(caughtError.code).toBe(errorCode);
            expect(caughtError.message).toBe(errorMessage);
        });

        test("should work with Jest's toThrow matcher", () => {
            const errorCode = ErrorCodes.INVALID_PARAMETER;
            const errorMessage = 'Test error message';

            const throwingFunction = () => {
                throw createError(errorCode, errorMessage);
            };

            expect(throwingFunction).toThrow();
            expect(throwingFunction).toThrow(Error);
            expect(throwingFunction).toThrow(BoxMullerError);
            expect(throwingFunction).toThrow(errorMessage);
            expect(throwingFunction).toThrow(createError(errorCode, errorMessage));
        });
    });
});

describe('Validation Utilities', () => {
    describe('validatePositive', () => {
        test('should not throw for positive numbers', () => {
            expect(() => validatePositive(10, 'testValue')).not.toThrow();
            expect(() => validatePositive(0.0001, 'testValue')).not.toThrow();
            expect(() => validatePositive(Infinity, 'testValue')).not.toThrow();
        });

        test('should throw INVALID_PARAMETER error for zero or negative numbers', () => {
            const paramName = 'testValue';

            expect(() => validatePositive(0, paramName)).toThrow();
            expect(() => validatePositive(0, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be positive`)
            );

            expect(() => validatePositive(-10, paramName)).toThrow();
            expect(() => validatePositive(-10, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be positive`)
            );
        });
    });

    describe('validateFinite', () => {
        test('should not throw for finite numbers', () => {
            expect(() => validateFinite(10, 'testValue')).not.toThrow();
            expect(() => validateFinite(-10, 'testValue')).not.toThrow();
            expect(() => validateFinite(0, 'testValue')).not.toThrow();
            expect(() => validateFinite(1.234, 'testValue')).not.toThrow();
        });

        test('should throw INVALID_PARAMETER error for Infinity, -Infinity, or NaN', () => {
            const paramName = 'testValue';

            expect(() => validateFinite(Infinity, paramName)).toThrow();
            expect(() => validateFinite(Infinity, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be finite`)
            );

            expect(() => validateFinite(-Infinity, paramName)).toThrow();
            expect(() => validateFinite(-Infinity, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be finite`)
            );

            expect(() => validateFinite(NaN, paramName)).toThrow();
            let thrownError: any;
            try {
                validateFinite(NaN, paramName);
            } catch (e) {
                thrownError = e;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError.code).toBe(ErrorCodes.INVALID_PARAMETER);
            expect(thrownError.message).toBe(`${paramName} must be finite`);
        });
    });

    describe('validateInteger', () => {
        test('should not throw for integer numbers', () => {
            expect(() => validateInteger(10, 'testValue')).not.toThrow();
            expect(() => validateInteger(-10, 'testValue')).not.toThrow();
            expect(() => validateInteger(0, 'testValue')).not.toThrow();
            expect(() => validateInteger(1000000, 'testValue')).not.toThrow();
        });

        test('should throw INVALID_PARAMETER error for non-integer numbers', () => {
            const paramName = 'testValue';

            expect(() => validateInteger(10.5, paramName)).toThrow();
            expect(() => validateInteger(10.5, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be an integer`)
            );

            expect(() => validateInteger(0.0001, paramName)).toThrow();
            expect(() => validateInteger(0.0001, paramName)).toThrow(
                createError(ErrorCodes.INVALID_PARAMETER, `${paramName} must be an integer`)
            );

            expect(() => validateInteger(Infinity, paramName)).toThrow();
            expect(() => validateInteger(-Infinity, paramName)).toThrow();
            expect(() => validateInteger(NaN, paramName)).toThrow();
        });
    });

    describe('validateInRange', () => {
        test('should not throw for numbers within the range (inclusive)', () => {
            const min = 0;
            const max = 10;
            const paramName = 'testValue';

            expect(() => validateInRange(0, min, max, paramName)).not.toThrow();
            expect(() => validateInRange(10, min, max, paramName)).not.toThrow();
            expect(() => validateInRange(5, min, max, paramName)).not.toThrow();
            expect(() => validateInRange(0.000001, min, max, paramName)).not.toThrow();
            expect(() => validateInRange(9.999999, min, max, paramName)).not.toThrow();
        });

        test('should throw INVALID_PARAMETER error for numbers outside the range', () => {
            const min = 0;
            const max = 10;
            const paramName = 'testValue';

            expect(() => validateInRange(-1, min, max, paramName)).toThrow();
            expect(() => validateInRange(-1, min, max, paramName)).toThrow(
                createError(
                    ErrorCodes.INVALID_PARAMETER,
                    `${paramName} must be between ${min} and ${max}`
                )
            );

            expect(() => validateInRange(11, min, max, paramName)).toThrow();
            expect(() => validateInRange(11, min, max, paramName)).toThrow(
                createError(
                    ErrorCodes.INVALID_PARAMETER,
                    `${paramName} must be between ${min} and ${max}`
                )
            );

            expect(() => validateInRange(-Infinity, min, max, paramName)).toThrow();
            expect(() => validateInRange(Infinity, min, max, paramName)).toThrow();
            // expect(() => validateInRange(NaN, min, max, paramName)).toThrow();
        });
    });
});
