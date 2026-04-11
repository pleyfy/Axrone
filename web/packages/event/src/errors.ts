export abstract class BaseError extends Error {
    override readonly name: string;

    constructor(name: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = name;
        Object.setPrototypeOf(this, new.target.prototype);
        (Error as any).captureStackTrace?.(this, this.constructor);
    }
}

export class EventError extends BaseError {
    constructor(message: string, options?: ErrorOptions) {
        super('EventError', message, options);
    }
}

export class EventNotFoundError extends EventError {
    readonly eventName: string;

    constructor(eventName: string) {
        super(`Event "${eventName}" not found`);
        this.eventName = eventName;
    }
}

export class EventQueueFullError extends EventError {
    readonly eventName: string;

    constructor(eventName: string, bufferSize: number) {
        super(`Event queue for "${eventName}" is full (${bufferSize} items)`);
        this.eventName = eventName;
    }
}

export class EventHandlerError extends EventError {
    readonly originalError: unknown;
    readonly eventName: string;

    constructor(eventName: string, originalError: unknown) {
        const message =
            originalError instanceof Error ? originalError.message : String(originalError);
        super(`Handler error for "${eventName}": ${message}`);
        this.eventName = eventName;
        this.originalError = originalError;

        if (originalError instanceof Error && originalError.stack) {
            this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
        }
    }
}
