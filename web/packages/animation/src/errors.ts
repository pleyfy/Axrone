export class AnimationError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'AnimationError';
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class AnimationValidationError extends AnimationError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ANIMATION_VALIDATION_ERROR', cause);
        this.name = 'AnimationValidationError';
    }
}

export class AnimationSamplingError extends AnimationError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ANIMATION_SAMPLING_ERROR', cause);
        this.name = 'AnimationSamplingError';
    }
}

export class AnimationStateMachineError extends AnimationError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ANIMATION_STATE_MACHINE_ERROR', cause);
        this.name = 'AnimationStateMachineError';
    }
}

export class AnimationRetargetingError extends AnimationError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ANIMATION_RETARGETING_ERROR', cause);
        this.name = 'AnimationRetargetingError';
    }
}

export class AnimationIkError extends AnimationError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ANIMATION_IK_ERROR', cause);
        this.name = 'AnimationIkError';
    }
}