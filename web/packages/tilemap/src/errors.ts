import type { ChunkKey } from './types/brands';

export const TilemapErrorCode = {
    INVALID_LAYER: 'INVALID_LAYER',
    INVALID_COORDINATE: 'INVALID_COORDINATE',
    INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
    INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
    CHUNK_POOL_EXHAUSTED: 'CHUNK_POOL_EXHAUSTED',
    CHUNK_PINNED: 'CHUNK_PINNED',
    CHUNK_DIRTY: 'CHUNK_DIRTY',
    PAGER_NOT_CONFIGURED: 'PAGER_NOT_CONFIGURED',
    PAGER_IO_ERROR: 'PAGER_IO_ERROR',
    CODEC_CORRUPT_PAYLOAD: 'CODEC_CORRUPT_PAYLOAD',
    CODEC_CHECKSUM_MISMATCH: 'CODEC_CHECKSUM_MISMATCH',
    ENGINE_CLOSED: 'ENGINE_CLOSED',
    OPERATION_ABORTED: 'OPERATION_ABORTED',
    UNSUPPORTED_PROJECTION: 'UNSUPPORTED_PROJECTION',
    PATH_POOL_EXHAUSTED: 'PATH_POOL_EXHAUSTED',
    PATH_BUFFER_TOO_SMALL: 'PATH_BUFFER_TOO_SMALL',
    LEASE_EXPIRED: 'LEASE_EXPIRED',
} as const;

export type TilemapErrorCode =
    (typeof TilemapErrorCode)[keyof typeof TilemapErrorCode];

/**
 * Error value carried inside `Result`. It is a plain readonly record so it can
 * cross worker boundaries and be serialized without class identity issues.
 */
export interface TilemapError {
    readonly code: TilemapErrorCode;
    readonly message: string;
    readonly chunkKey?: ChunkKey;
    readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>>;
}

export interface TilemapErrorOptions {
    readonly chunkKey?: ChunkKey;
    readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>>;
}

export const tilemapError = (
    code: TilemapErrorCode,
    message: string,
    options?: TilemapErrorOptions
): TilemapError => {
    const error: {
        code: TilemapErrorCode;
        message: string;
        chunkKey?: ChunkKey;
        cause?: unknown;
        details?: Readonly<Record<string, unknown>>;
    } = { code, message };
    if (options?.chunkKey !== undefined) error.chunkKey = options.chunkKey;
    if (options?.cause !== undefined) error.cause = options.cause;
    if (options?.details !== undefined) error.details = options.details;
    return Object.freeze(error);
};

export const isTilemapError = (value: unknown): value is TilemapError =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string';

/**
 * Thrown only for programming errors: invalid constructor arguments, invalid
 * branded values, or misuse of the typestate builder. Recoverable runtime
 * failures are returned as `Result.err(TilemapError)` instead.
 */
export class TilemapFault extends Error {
    readonly code: TilemapErrorCode;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly timestamp: number;

    constructor(
        message: string,
        code: TilemapErrorCode = TilemapErrorCode.INVALID_CONFIGURATION,
        details?: Readonly<Record<string, unknown>>
    ) {
        super(`Tilemap: ${message}`);
        this.name = 'TilemapFault';
        this.code = code;
        this.details = details;
        this.timestamp = Date.now();
        Object.setPrototypeOf(this, TilemapFault.prototype);
    }
}

export const isTilemapFault = (value: unknown): value is TilemapFault =>
    value instanceof TilemapFault;

/** Exhaustiveness helper for error-code switches. */
export const assertNever = (value: never): never => {
    throw new TilemapFault(
        `unexpected value: ${String(value)}`,
        TilemapErrorCode.INVALID_CONFIGURATION,
        { value }
    );
};

export const describeTilemapError = (error: TilemapError): string => {
    const chunk =
        error.chunkKey === undefined ? '' : ` [chunk ${error.chunkKey}]`;
    return `${error.code}${chunk}: ${error.message}`;
};
