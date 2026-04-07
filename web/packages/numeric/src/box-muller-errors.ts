export class BoxMullerError extends Error {
    readonly code: (typeof ErrorCodes)[keyof typeof ErrorCodes];

    constructor(code: (typeof ErrorCodes)[keyof typeof ErrorCodes], message: string) {
        super(message);
        this.code = code;
        this.name = 'BoxMullerError';

        Object.setPrototypeOf(this, BoxMullerError.prototype);
    }
}

export const ErrorCodes = {
    INVALID_PARAMETER: 'INVALID_PARAMETER',
    RUNTIME_ERROR: 'RUNTIME_ERROR',
    INVALID_STATE: 'INVALID_STATE',
    INVALID_OPERATION: 'INVALID_OPERATION',
    PRECISION_ERROR: 'PRECISION_ERROR',
} as const;

export const createError = (
    code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
    message: string
): BoxMullerError => new BoxMullerError(code, message);

export const validatePositive = (value: number, name: string): void | never => {
    if (value <= 0) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be positive`);
    }
};

export const validateFinite = (value: number, name: string): void | never => {
    if (!Number.isFinite(value)) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be finite`);
    }
};

export const validateInteger = (value: number, name: string): void | never => {
    if (!Number.isInteger(value)) {
        throw createError(ErrorCodes.INVALID_PARAMETER, `${name} must be an integer`);
    }
};

export const validateInRange = (
    value: number,
    min: number,
    max: number,
    name: string
): void | never => {
    if (value < min || value > max) {
        throw createError(
            ErrorCodes.INVALID_PARAMETER,
            `${name} must be between ${min} and ${max}`
        );
    }
};