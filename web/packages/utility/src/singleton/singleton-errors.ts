import type { SingletonKey, SingletonState } from './singleton-core';

export const enum SingletonErrorCode {
    INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
    ALREADY_INITIALIZED = 'ALREADY_INITIALIZED',
    NOT_INITIALIZED = 'NOT_INITIALIZED',
    DISPOSED = 'DISPOSED',
    ALREADY_REGISTERED = 'ALREADY_REGISTERED',
    NOT_FOUND = 'NOT_FOUND',
    CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
    DISPOSE_FAILED = 'DISPOSE_FAILED',
    TIMEOUT = 'TIMEOUT',
    MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
    INVALID_STATE = 'INVALID_STATE',
    SCOPE_DISPOSED = 'SCOPE_DISPOSED',
    INVALID_OPERATION = 'INVALID_OPERATION',
}

export class SingletonError extends Error {
    readonly code: SingletonErrorCode;
    readonly key?: SingletonKey;
    readonly timestamp: number;
    readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        code: SingletonErrorCode,
        key?: SingletonKey,
        details?: Record<string, unknown>
    ) {
        const keyStr = key !== undefined ? ` [${String(key)}]` : '';
        super(`Singleton${keyStr}: ${message}`);
        this.name = 'SingletonError';
        this.code = code;
        this.key = key;
        this.timestamp = Date.now();
        this.details = details;
        Object.setPrototypeOf(this, SingletonError.prototype);
    }

    static initializationFailed(key: SingletonKey, cause?: Error): SingletonError {
        return new SingletonError(
            `Initialization failed${cause ? `: ${cause.message}` : ''}`,
            SingletonErrorCode.INITIALIZATION_FAILED,
            key,
            cause ? { cause: cause.message, stack: cause.stack } : undefined
        );
    }

    static alreadyInitialized(key: SingletonKey): SingletonError {
        return new SingletonError(
            'Instance already initialized',
            SingletonErrorCode.ALREADY_INITIALIZED,
            key
        );
    }

    static notInitialized(key: SingletonKey): SingletonError {
        return new SingletonError(
            'Instance not initialized',
            SingletonErrorCode.NOT_INITIALIZED,
            key
        );
    }

    static disposed(key: SingletonKey): SingletonError {
        return new SingletonError('Instance has been disposed', SingletonErrorCode.DISPOSED, key);
    }

    static alreadyRegistered(key: SingletonKey): SingletonError {
        return new SingletonError(
            'Key already registered in registry',
            SingletonErrorCode.ALREADY_REGISTERED,
            key
        );
    }

    static notFound(key: SingletonKey): SingletonError {
        return new SingletonError('Key not found in registry', SingletonErrorCode.NOT_FOUND, key);
    }

    static circularDependency(cycle: readonly SingletonKey[]): SingletonError {
        return new SingletonError(
            `Circular dependency detected: ${cycle.map(String).join(' -> ')}`,
            SingletonErrorCode.CIRCULAR_DEPENDENCY,
            undefined,
            { cycle }
        );
    }

    static disposeFailed(key: SingletonKey, cause: Error): SingletonError {
        return new SingletonError(
            `Dispose failed: ${cause.message}`,
            SingletonErrorCode.DISPOSE_FAILED,
            key,
            { cause: cause.message, stack: cause.stack }
        );
    }

    static timeout(key: SingletonKey, timeoutMs: number): SingletonError {
        return new SingletonError(
            `Initialization timed out after ${timeoutMs}ms`,
            SingletonErrorCode.TIMEOUT,
            key,
            { timeoutMs }
        );
    }

    static maxRetriesExceeded(
        key: SingletonKey,
        retryCount: number,
        lastError?: Error
    ): SingletonError {
        return new SingletonError(
            `Max retries (${retryCount}) exceeded${lastError ? `: ${lastError.message}` : ''}`,
            SingletonErrorCode.MAX_RETRIES_EXCEEDED,
            key,
            { retryCount, lastError: lastError?.message }
        );
    }

    static invalidState(
        key: SingletonKey,
        currentState: SingletonState,
        expectedStates: SingletonState[]
    ): SingletonError {
        return new SingletonError(
            `Invalid state: expected [${expectedStates.join(', ')}], got '${currentState}'`,
            SingletonErrorCode.INVALID_STATE,
            key,
            { currentState, expectedStates }
        );
    }

    static scopeDisposed(scopeId: string): SingletonError {
        return new SingletonError(
            `Scope '${scopeId}' has been disposed`,
            SingletonErrorCode.SCOPE_DISPOSED,
            undefined,
            { scopeId }
        );
    }

    static invalidOperation(message: string, key?: SingletonKey): SingletonError {
        return new SingletonError(message, SingletonErrorCode.INVALID_OPERATION, key);
    }
}
