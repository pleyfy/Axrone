import { NotificationData, ObserverCallback, ObserverId, SubjectId } from './definition';

const captureStack = (target: object, ctor: Function): void => {
    (
        Error as typeof Error & {
            captureStackTrace?: (instance: object, constructor: Function) => void;
        }
    ).captureStackTrace?.(target, ctor);
};

const normalizeError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));

export class BaseObserverError extends Error {
    readonly code: string;
    readonly timestamp: number;

    constructor(message: string, code: string = 'OBSERVER_ERROR') {
        super(message);
        this.name = new.target.name;
        this.code = code;
        this.timestamp = Date.now();
        Object.setPrototypeOf(this, new.target.prototype);
        captureStack(this, new.target);
    }
}

export class ObserverError extends BaseObserverError {
    constructor(message: string, code: string = 'OBSERVER_ERROR') {
        super(message, code);
    }
}

export class SubjectError extends BaseObserverError {
    readonly subjectId?: SubjectId;

    constructor(message: string, subjectId?: SubjectId, code: string = 'SUBJECT_ERROR') {
        super(message, code);
        this.subjectId = subjectId;
    }
}

export class ObserverNotFoundError extends ObserverError {
    readonly observerId?: ObserverId;

    constructor(observerId?: ObserverId) {
        super(
            observerId
                ? `Observer with ID ${String(observerId)} not found`
                : 'Observer not found',
            'OBSERVER_NOT_FOUND'
        );
        this.observerId = observerId;
    }
}

export class SubjectCompletedError extends SubjectError {
    constructor(subjectId?: SubjectId) {
        super('Cannot operate on completed subject', subjectId, 'SUBJECT_COMPLETED');
    }
}

export class SubjectDisposedError extends SubjectError {
    constructor(subjectId?: SubjectId) {
        super('Cannot operate on disposed subject', subjectId, 'SUBJECT_DISPOSED');
    }
}

export class MaxObserversExceededError extends SubjectError {
    readonly maxObservers: number;
    readonly currentCount: number;

    constructor(maxObservers: number, currentCount: number, subjectId?: SubjectId) {
        super(
            `Maximum number of observers exceeded. Max: ${maxObservers}, Current: ${currentCount}`,
            subjectId,
            'MAX_OBSERVERS_EXCEEDED'
        );
        this.maxObservers = maxObservers;
        this.currentCount = currentCount;
    }
}

export class ObserverExecutionError extends ObserverError {
    readonly observerId: ObserverId;
    readonly originalError: Error;
    readonly notificationData: NotificationData;

    constructor(observerId: ObserverId, originalError: Error, notificationData: NotificationData) {
        super(`Observer execution failed: ${originalError.message}`, 'OBSERVER_EXECUTION_ERROR');
        this.observerId = observerId;
        this.originalError = originalError;
        this.notificationData = notificationData;
        (this as { cause?: Error }).cause = originalError;
    }
}

export class ValidationError extends SubjectError {
    readonly invalidData: unknown;

    constructor(message: string, invalidData: unknown, subjectId?: SubjectId) {
        super(message, subjectId, 'VALIDATION_ERROR');
        this.invalidData = invalidData;
    }
}

export class ConcurrencyLimitError extends SubjectError {
    readonly limit: number;
    readonly current: number;

    constructor(limit: number, current: number, subjectId?: SubjectId) {
        super(
            `Concurrency limit exceeded. Limit: ${limit}, Current: ${current}`,
            subjectId,
            'CONCURRENCY_LIMIT_ERROR'
        );
        this.limit = limit;
        this.current = current;
    }
}

export class FilterError extends ObserverError {
    readonly filterFunction: Function;
    readonly originalError: Error;

    constructor(originalError: unknown, filterFunction: ObserverCallback<any> | Function) {
        const normalized = normalizeError(originalError);
        super(`Observer filter execution failed: ${normalized.message}`, 'FILTER_ERROR');
        this.filterFunction = filterFunction;
        this.originalError = normalized;
        (this as { cause?: Error }).cause = normalized;
    }
}

export class TransformError extends ObserverError {
    readonly transformFunction: Function;
    readonly originalError: Error;
    readonly inputData: unknown;

    constructor(originalError: unknown, transformFunction: Function, inputData: unknown) {
        const normalized = normalizeError(originalError);
        super(`Observer transform execution failed: ${normalized.message}`, 'TRANSFORM_ERROR');
        this.transformFunction = transformFunction;
        this.originalError = normalized;
        this.inputData = inputData;
        (this as { cause?: Error }).cause = normalized;
    }
}
