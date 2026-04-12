export class Render2DError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'Render2DError';
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & {
                captureStackTrace?: (target: object, ctor: Function) => void;
            }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class Render2DValidationError extends Render2DError {
    constructor(message: string, cause?: unknown) {
        super(message, 'RENDER_2D_VALIDATION_ERROR', cause);
        this.name = 'Render2DValidationError';
    }
}

export class Render2DCapacityError extends Render2DError {
    constructor(message: string, cause?: unknown) {
        super(message, 'RENDER_2D_CAPACITY_ERROR', cause);
        this.name = 'Render2DCapacityError';
    }
}