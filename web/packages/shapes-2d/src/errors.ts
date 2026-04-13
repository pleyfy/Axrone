export const SHAPES_2D_ERROR_CODE = {
    INVALID_NUMBER: 'INVALID_NUMBER',
    INVALID_POINT: 'INVALID_POINT',
    INVALID_COLOR: 'INVALID_COLOR',
    INVALID_PAINT: 'INVALID_PAINT',
    INVALID_GRADIENT: 'INVALID_GRADIENT',
    INVALID_STROKE: 'INVALID_STROKE',
    INVALID_SHAPE: 'INVALID_SHAPE',
    INVALID_SERIALIZED_PAYLOAD: 'INVALID_SERIALIZED_PAYLOAD',
    REGISTRY_DISPOSED: 'REGISTRY_DISPOSED',
    SHAPE_NOT_FOUND: 'SHAPE_NOT_FOUND',
    CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
} as const;

export type Shapes2DErrorCode =
    (typeof SHAPES_2D_ERROR_CODE)[keyof typeof SHAPES_2D_ERROR_CODE];

export interface Shapes2DErrorOptions {
    readonly cause?: unknown;
    readonly details?: Record<string, unknown>;
}

export class Shapes2DError extends Error {
    readonly code: Shapes2DErrorCode;
    readonly details?: Readonly<Record<string, unknown>>;
    override readonly cause?: unknown;

    constructor(
        code: Shapes2DErrorCode,
        message: string,
        options: Shapes2DErrorOptions = {}
    ) {
        super(message);
        this.name = 'Shapes2DError';
        this.code = code;
        this.details = options.details;
        this.cause = options.cause;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ShapeValidationError extends Shapes2DError {
    constructor(message: string, options: Shapes2DErrorOptions = {}) {
        super(SHAPES_2D_ERROR_CODE.INVALID_SHAPE, message, options);
        this.name = 'ShapeValidationError';
    }
}

export class PaintValidationError extends Shapes2DError {
    constructor(message: string, options: Shapes2DErrorOptions = {}) {
        super(SHAPES_2D_ERROR_CODE.INVALID_PAINT, message, options);
        this.name = 'PaintValidationError';
    }
}

export class SerializationError extends Shapes2DError {
    constructor(message: string, options: Shapes2DErrorOptions = {}) {
        super(SHAPES_2D_ERROR_CODE.INVALID_SERIALIZED_PAYLOAD, message, options);
        this.name = 'SerializationError';
    }
}

export class ShapeRegistryError extends Shapes2DError {
    constructor(code: Shapes2DErrorCode, message: string, options: Shapes2DErrorOptions = {}) {
        super(code, message, options);
        this.name = 'ShapeRegistryError';
    }
}
