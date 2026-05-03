export type LightingErrorCode =
    | `lighting.rig.${string}`
    | `lighting.light.${string}`
    | `lighting.resolve.${string}`
    | `lighting.serialize.${string}`;

export type LightingErrorDetails = Readonly<Record<string, unknown>>;

export class LightingError extends Error {
    readonly code: LightingErrorCode;
    readonly details?: LightingErrorDetails;
    readonly cause?: Error;

    constructor(
        code: LightingErrorCode,
        message: string,
        details?: LightingErrorDetails,
        cause?: Error
    ) {
        super(message);
        this.code = code;
        this.details = details;
        this.cause = cause;
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class LightingValidationError extends LightingError {
    constructor(code: `lighting.light.${string}` | `lighting.rig.${string}`, message: string, details?: LightingErrorDetails) {
        super(code, message, details);
    }
}

export class LightingResolveError extends LightingError {
    constructor(code: `lighting.resolve.${string}`, message: string, details?: LightingErrorDetails) {
        super(code, message, details);
    }
}

export class LightingSerializationError extends LightingError {
    constructor(
        code: `lighting.serialize.${string}`,
        message: string,
        details?: LightingErrorDetails,
        cause?: Error
    ) {
        super(code, message, details, cause);
    }
}

export class LightingDisposedError extends LightingError {
    constructor(resource: string) {
        super('lighting.rig.disposed', `${resource} has already been disposed`, { resource });
    }
}