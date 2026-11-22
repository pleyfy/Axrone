export const TilemapAssetErrorCode = {
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
    INVALID_TILESET: 'INVALID_TILESET',
    INVALID_TILEMAP: 'INVALID_TILEMAP',
    MALFORMED_SOURCE: 'MALFORMED_SOURCE',
    UNSUPPORTED_PROJECTION: 'UNSUPPORTED_PROJECTION',
    UNSUPPORTED_ENCODING: 'UNSUPPORTED_ENCODING',
    UNSUPPORTED_COMPRESSION: 'UNSUPPORTED_COMPRESSION',
    UNSUPPORTED_LAYER_TYPE: 'UNSUPPORTED_LAYER_TYPE',
    MISSING_TILESET: 'MISSING_TILESET',
    TILED_ID_OUT_OF_RANGE: 'TILED_ID_OUT_OF_RANGE',
    INVALID_CHUNK_ASSET: 'INVALID_CHUNK_ASSET',
    ASSET_IO_ERROR: 'ASSET_IO_ERROR',
} as const;

export type TilemapAssetErrorCode =
    (typeof TilemapAssetErrorCode)[keyof typeof TilemapAssetErrorCode];

/** Recoverable import/validation failure, carried inside a `Result`. */
export interface TilemapAssetError {
    readonly code: TilemapAssetErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
}

export interface TilemapAssetErrorOptions {
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
}

export const tilemapAssetError = (
    code: TilemapAssetErrorCode,
    message: string,
    options: TilemapAssetErrorOptions = {}
): TilemapAssetError => {
    const error: {
        code: TilemapAssetErrorCode;
        message: string;
        details?: Readonly<Record<string, unknown>>;
        cause?: unknown;
    } = { code, message };
    if (options.details !== undefined) error.details = options.details;
    if (options.cause !== undefined) error.cause = options.cause;
    return Object.freeze(error);
};

export const isTilemapAssetError = (
    value: unknown
): value is TilemapAssetError =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string';

/**
 * Thrown only for programming errors: invalid importer/pipeline wiring or
 * misuse of the package API. Source data problems are returned as
 * `Result.err(TilemapAssetError)`.
 */
export class TilemapAssetFault extends Error {
    readonly code: TilemapAssetErrorCode;
    readonly details?: Readonly<Record<string, unknown>>;

    constructor(
        message: string,
        code: TilemapAssetErrorCode = TilemapAssetErrorCode.INVALID_TILEMAP,
        details?: Readonly<Record<string, unknown>>
    ) {
        super(`TilemapAsset: ${message}`);
        this.name = 'TilemapAssetFault';
        this.code = code;
        this.details = details;
        Object.setPrototypeOf(this, TilemapAssetFault.prototype);
    }
}

export const isTilemapAssetFault = (
    value: unknown
): value is TilemapAssetFault => value instanceof TilemapAssetFault;
