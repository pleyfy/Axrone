import type { StackId } from './types';

export class StackUnderflowError extends Error {
    readonly _tag = "StackUnderflowError" as const;
    constructor() {
        super("Stack underflow: cannot pop or peek from an empty stack.");
        this.name = "StackUnderflowError";
    }
}

export class StackOverflowError extends Error {
    readonly _tag = "StackOverflowError" as const;
    readonly limit: number;
    constructor(limit: number) {
        super(`Stack overflow: maximum capacity ${limit} reached.`);
        this.name = "StackOverflowError";
        this.limit = limit;
    }
}

export class StackDisposedError extends Error {
    readonly _tag = "StackDisposedError" as const;
    readonly id: StackId;
    readonly cause: Error | undefined;
    constructor(id: StackId, cause?: Error | undefined) {
        super(`Stack '${id}' is disposed and cannot process operations.`);
        this.name = "StackDisposedError";
        this.id = id;
        this.cause = cause;
    }
}

export class StackAbortError extends Error {
    readonly _tag = "StackAbortError" as const;
    readonly reason: unknown;
    constructor(reason: unknown) {
        super(`Stack operation was aborted: ${String(reason)}`);
        this.name = "StackAbortError";
        this.reason = reason;
    }
}

export type StackError =
    | StackUnderflowError
    | StackOverflowError
    | StackDisposedError
    | StackAbortError;
