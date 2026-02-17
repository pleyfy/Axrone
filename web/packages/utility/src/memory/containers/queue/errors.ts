export abstract class QueueError extends Error {
    abstract readonly code: string;

    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

export class EmptyQueueError extends QueueError {
    readonly code = 'EMPTY_QUEUE' as const;

    constructor() {
        super('Queue is empty');
    }
}

export class InvalidCapacityError extends QueueError {
    readonly code = 'INVALID_CAPACITY' as const;

    constructor(capacity: number) {
        super(`Invalid capacity: ${capacity}`);
    }
}
