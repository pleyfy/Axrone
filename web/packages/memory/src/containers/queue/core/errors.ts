export type QueueErrorCode =
    | 'QUEUE_EMPTY'
    | 'QUEUE_FULL'
    | 'QUEUE_CLOSED'
    | 'QUEUE_ABORTED'
    | 'QUEUE_UNDERFLOW'
    | 'QUEUE_INVALID_CAPACITY';

export abstract class QueueDomainError extends Error {
    public abstract readonly code: QueueErrorCode;

    constructor(message: string) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class QueueEmptyError extends QueueDomainError {
    public override readonly code = 'QUEUE_EMPTY';
    public static readonly INSTANCE = new QueueEmptyError();

    constructor(message: string = 'Queue is empty.') {
        super(message);
    }
}

export class QueueFullError extends QueueDomainError {
    public override readonly code = 'QUEUE_FULL';
    public static readonly INSTANCE = new QueueFullError();

    constructor(message: string = 'Queue is full.') {
        super(message);
    }
}

export class QueueClosedError extends QueueDomainError {
    public override readonly code = 'QUEUE_CLOSED';
    public static readonly INSTANCE = new QueueClosedError();

    constructor(message: string = 'Queue is closed.') {
        super(message);
    }
}

export class QueueAbortError extends QueueDomainError {
    public override readonly code = 'QUEUE_ABORTED';
    public readonly reason: unknown;

    constructor(reason: unknown = undefined) {
        super(`Queue operation aborted: ${reason === undefined ? 'no reason provided' : String(reason)}`);
        this.reason = reason;
    }
}

export class QueueUnderflowError extends QueueDomainError {
    public override readonly code = 'QUEUE_UNDERFLOW';

    constructor(requested: number, actual: number) {
        super(`Requested ${requested} items, but only ${actual} available.`);
    }
}

export class QueueInvalidCapacityError extends QueueDomainError {
    public override readonly code = 'QUEUE_INVALID_CAPACITY';

    constructor(value: number) {
        super(`Specified capacity ${value} is invalid. Expected positive safe integer.`);
    }
}

export function assertNever(x: never, message: string = 'Unreachable branch'): never {
    throw new Error(`${message}: ${String(x)}`);
}

export function throwCorruptedSlot(): never {
    throw new Error('Queue memory chunk slot corruption detected.');
}
