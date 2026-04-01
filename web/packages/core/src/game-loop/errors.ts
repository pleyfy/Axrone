import type {
    GameLoopFailurePhase,
    GameLoopMessageCode,
    GameLoopValidationMessageCode,
} from './types';

export class GameLoopError extends Error {
    override readonly name: string;
    readonly code: GameLoopMessageCode;

    constructor(name: string, code: GameLoopMessageCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = name;
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class GameLoopConfigurationError extends GameLoopError {
    constructor(code: GameLoopValidationMessageCode, message: string, options?: ErrorOptions) {
        super('GameLoopConfigurationError', code, message, options);
    }
}

export class GameLoopDisposedError extends GameLoopError {
    constructor(message: string, options?: ErrorOptions) {
        super('GameLoopDisposedError', 'loop.disposed', message, options);
    }
}

export class GameLoopSchedulerError extends GameLoopError {
    constructor(
        code: 'loop.scheduler.request-failed' | 'loop.scheduler.cancel-failed',
        message: string,
        options?: ErrorOptions
    ) {
        super('GameLoopSchedulerError', code, message, options);
    }
}

export class GameLoopSnapshotError extends GameLoopError {
    constructor(message: string, options?: ErrorOptions) {
        super('GameLoopSnapshotError', 'loop.snapshot.invalid', message, options);
    }
}

export class GameLoopSystemError extends GameLoopError {
    readonly systemId: string;
    readonly phase: GameLoopFailurePhase;
    readonly attempt: number;

    constructor(
        message: string,
        systemId: string,
        phase: GameLoopFailurePhase,
        attempt: number,
        options?: ErrorOptions
    ) {
        super('GameLoopSystemError', 'loop.system.failed', message, options);
        this.systemId = systemId;
        this.phase = phase;
        this.attempt = attempt;
    }
}
