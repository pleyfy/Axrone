import { ObserverCallback, ObserverId, NotificationData } from './definition';

export class BaseObserverError extends Error {
    public readonly code: string;
    public readonly timestamp: number;

    constructor(message: string, code: string = 'OBSERVER_ERROR') {
        super(message);
        this.name = 'BaseObserverError';
        this.code = code;
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class ObserverError extends BaseObserverError {
    constructor(message: string, code: string = 'OBSERVER_ERROR') {
        super(message, code);
        this.name = 'ObserverError';
    }
}

export class SubjectError extends BaseObserverError {
    public readonly subjectId?: symbol;

    constructor(message: string, subjectId?: symbol, code: string = 'SUBJECT_ERROR') {
        super(message, code);
        this.name = 'SubjectError';
        this.subjectId = subjectId;
    }
}

export class ObserverNotFoundError extends ObserverError {
    public readonly observerId?: ObserverId;

    constructor(observerId?: ObserverId) {
        const message = observerId
            ? `Observer with ID ${String(observerId)} not found`
            : 'Observer not found';
        super(message, 'OBSERVER_NOT_FOUND');
        this.name = 'ObserverNotFoundError';
        this.observerId = observerId;
    }
}

export class SubjectCompletedError extends SubjectError {
    constructor(subjectId?: symbol) {
        super('Cannot operate on completed subject', subjectId, 'SUBJECT_COMPLETED');
        this.name = 'SubjectCompletedError';
    }
}

export class SubjectDisposedError extends SubjectError {
    constructor(subjectId?: symbol) {
        super('Cannot operate on disposed subject', subjectId, 'SUBJECT_DISPOSED');
        this.name = 'SubjectDisposedError';
    }
}

export class MaxObserversExceededError extends SubjectError {
    public readonly maxObservers: number;
    public readonly currentCount: number;

    constructor(maxObservers: number, currentCount: number, subjectId?: symbol) {
        super(
            `Maximum number of observers exceeded. Max: ${maxObservers}, Current: ${currentCount}`,
            subjectId,
            'MAX_OBSERVERS_EXCEEDED'
        );
        this.name = 'MaxObserversExceededError';
        this.maxObservers = maxObservers;
        this.currentCount = currentCount;
    }
}

export class ObserverExecutionError extends ObserverError {
    public readonly observerId: ObserverId;
    public readonly originalError: Error;
    public readonly notificationData: NotificationData;

    constructor(observerId: ObserverId, originalError: Error, notificationData: NotificationData) {
        super(`Observer execution failed: ${originalError.message}`, 'OBSERVER_EXECUTION_ERROR');
        this.name = 'ObserverExecutionError';
        this.observerId = observerId;
        this.originalError = originalError;
        this.notificationData = notificationData;
    }
}

export class ValidationError extends SubjectError {
    public readonly invalidData: any;

    constructor(message: string, invalidData: any, subjectId?: symbol) {
        super(message, subjectId, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
        this.invalidData = invalidData;
    }
}

export class ConcurrencyLimitError extends SubjectError {
    public readonly limit: number;
    public readonly current: number;

    constructor(limit: number, current: number, subjectId?: symbol) {
        super(
            `Concurrency limit exceeded. Limit: ${limit}, Current: ${current}`,
            subjectId,
            'CONCURRENCY_LIMIT_ERROR'
        );
        this.name = 'ConcurrencyLimitError';
        this.limit = limit;
        this.current = current;
    }
}

export class FilterError extends ObserverError {
    public readonly filterFunction: Function;
    public readonly originalError: Error;

    constructor(originalError: Error, filterFunction: Function) {
        super(`Observer filter execution failed: ${originalError.message}`, 'FILTER_ERROR');
        this.name = 'FilterError';
        this.filterFunction = filterFunction;
        this.originalError = originalError;
    }
}

export class TransformError extends ObserverError {
    public readonly transformFunction: Function;
    public readonly originalError: Error;
    public readonly inputData: any;

    constructor(originalError: Error, transformFunction: Function, inputData: any) {
        super(`Observer transform execution failed: ${originalError.message}`, 'TRANSFORM_ERROR');
        this.name = 'TransformError';
        this.transformFunction = transformFunction;
        this.originalError = originalError;
        this.inputData = inputData;
    }
}
