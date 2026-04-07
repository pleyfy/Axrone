import { StackSize, StackCapacity } from './types';

export abstract class StackError extends Error {
    abstract readonly code: string;
    abstract readonly severity: 'low' | 'medium' | 'high' | 'critical';
    abstract readonly recoverable: boolean;
    readonly timestamp = performance.now();
    readonly stackTrace = Error().stack;
}

export class StackCapacityError extends StackError {
    readonly code = 'E_CAPACITY_EXCEEDED';
    readonly severity = 'high' as const;
    readonly recoverable = false;
    constructor(
        readonly current: StackSize,
        readonly capacity: StackCapacity,
        readonly operation: string
    ) {
        super(`Capacity exceeded: ${operation} would exceed ${capacity} (current: ${current})`);
    }
}

export class StackIntegrityError extends StackError {
    readonly code = 'E_INTEGRITY_VIOLATION';
    readonly severity = 'critical' as const;
    readonly recoverable = false;
    constructor(
        readonly details: string,
        readonly context?: Record<string, unknown>
    ) {
        super(`Stack integrity violation: ${details}`);
    }
}

export class StackMemoryError extends StackError {
    readonly code = 'E_MEMORY_EXHAUSTED';
    readonly severity = 'critical' as const;
    readonly recoverable = true;
    constructor(
        readonly requested: number,
        readonly available: number
    ) {
        super(`Memory exhausted: requested ${requested} bytes, available ${available}`);
    }
}

export type StackErrorUnion = StackCapacityError | StackIntegrityError | StackMemoryError;
