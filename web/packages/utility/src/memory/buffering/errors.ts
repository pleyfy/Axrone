abstract class BaseBufferError extends Error {
    constructor(
        name: string,
        message: string,
        public readonly code?: string
    ) {
        super(message);
        this.name = name;
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace?.(this, new.target);
    }
}

export class BufferOverflowError extends BaseBufferError {
    constructor(
        message = 'Buffer overflow',
        public readonly requestedSize?: number,
        public readonly availableSize?: number
    ) {
        super('BufferOverflowError', message, 'BUFFER_OVERFLOW');
    }
}

export class BufferUnderflowError extends BaseBufferError {
    constructor(
        message = 'Buffer underflow',
        public readonly requestedBytes?: number,
        public readonly availableBytes?: number
    ) {
        super('BufferUnderflowError', message, 'BUFFER_UNDERFLOW');
    }
}

export class ReadOnlyBufferError extends BaseBufferError {
    constructor(message = 'Buffer is read-only') {
        super('ReadOnlyBufferError', message, 'BUFFER_READONLY');
    }
}

export class InvalidMarkError extends BaseBufferError {
    constructor(message = 'Mark not defined') {
        super('InvalidMarkError', message, 'INVALID_MARK');
    }
}

export class BufferAlignmentError extends BaseBufferError {
    constructor(
        message = 'Invalid buffer alignment',
        public readonly alignment?: number
    ) {
        super('BufferAlignmentError', message, 'BUFFER_ALIGNMENT');
    }
}

export class BufferReleasedError extends BaseBufferError {
    constructor(message = 'Buffer has been released to pool') {
        super('BufferReleasedError', message, 'BUFFER_RELEASED');
    }
}

export class BufferStateError extends BaseBufferError {
    constructor(
        message: string,
        public readonly currentState?: string,
        public readonly expectedState?: string
    ) {
        super('BufferStateError', message, 'BUFFER_STATE');
    }
}

export class BufferCapacityError extends BaseBufferError {
    constructor(
        message: string,
        public readonly requestedCapacity?: number,
        public readonly maxCapacity?: number
    ) {
        super('BufferCapacityError', message, 'BUFFER_CAPACITY');
    }
}
