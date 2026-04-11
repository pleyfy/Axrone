export const enum ParticleSystemError {
    SystemNotInitialized = 'SYSTEM_NOT_INITIALIZED',
    ParticleNotFound = 'PARTICLE_NOT_FOUND',
    ModuleNotFound = 'MODULE_NOT_FOUND',
    CapacityExceeded = 'CAPACITY_EXCEEDED',
    InvalidConfiguration = 'INVALID_CONFIGURATION',
    ResourceNotAvailable = 'RESOURCE_NOT_AVAILABLE',
    OperationNotSupported = 'OPERATION_NOT_SUPPORTED',
    MemoryAllocationFailed = 'MEMORY_ALLOCATION_FAILED',
    InvalidState = 'INVALID_STATE',
    ThreadSafetyViolation = 'THREAD_SAFETY_VIOLATION',
}

export class ParticleSystemException extends Error {
    public readonly code: ParticleSystemError;
    public readonly context?: Record<string, unknown>;

    constructor(code: ParticleSystemError, message?: string, context?: Record<string, unknown>) {
        super(message ?? code);
        this.name = 'ParticleSystemException';
        this.code = code;
        this.context = context;
        Object.setPrototypeOf(this, ParticleSystemException.prototype);
    }

    static systemNotInitialized(systemId?: unknown): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.SystemNotInitialized,
            'Particle system must be initialized before use',
            { systemId }
        );
    }

    static particleNotFound(particleId: unknown): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.ParticleNotFound,
            'Particle not found in system',
            { particleId }
        );
    }

    static moduleNotFound(moduleId: unknown): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.ModuleNotFound,
            'Module not found in system',
            { moduleId }
        );
    }

    static capacityExceeded(capacity: number, requested: number): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.CapacityExceeded,
            `Capacity exceeded: ${requested} > ${capacity}`,
            { capacity, requested }
        );
    }

    static invalidConfiguration(reason: string): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.InvalidConfiguration,
            `Invalid configuration: ${reason}`
        );
    }

    static resourceNotAvailable(resource: string): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.ResourceNotAvailable,
            `Resource not available: ${resource}`,
            { resource }
        );
    }

    static operationNotSupported(operation: string): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.OperationNotSupported,
            `Operation not supported: ${operation}`,
            { operation }
        );
    }

    static memoryAllocationFailed(size: number): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.MemoryAllocationFailed,
            `Memory allocation failed for size: ${size}`,
            { size }
        );
    }

    static invalidState(expected: string, actual: string): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.InvalidState,
            `Invalid state: expected ${expected}, got ${actual}`,
            { expected, actual }
        );
    }

    static threadSafetyViolation(operation: string): ParticleSystemException {
        return new ParticleSystemException(
            ParticleSystemError.ThreadSafetyViolation,
            `Thread safety violation in operation: ${operation}`,
            { operation }
        );
    }
}
