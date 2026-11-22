/**
 * Generic binary codec for versioned base64 payloads.
 * @internal
 */

import { encode as encodeBytesToBase64, decode as decodeBase64ToBytes } from '@axrone/utility';
import { TerrainError, TerrainErrorCode } from '../errors';

/**
 * Encode a typed array into a versioned base64 string with the given prefix.
 */
export const encodeBuffer = (prefix: string, data: Readonly<Uint8Array>): string =>
    `${prefix}${encodeBytesToBase64(data as Uint8Array)}`;

/**
 * Decode a versioned base64 string, validating prefix and expected length.
 * Returns the raw bytes (caller converts to typed array as needed).
 */
export const decodeBuffer = (
    prefix: string,
    value: string,
    expectedLength: number,
    errorCode: typeof TerrainErrorCode[keyof typeof TerrainErrorCode]
): Uint8Array => {
    if (!value.startsWith(prefix)) {
        throw new TerrainError(
            'Payload is missing the expected version prefix.',
            TerrainErrorCode.SOURCE_DECODE_FAILED,
            { prefix: value.slice(0, 8) }
        );
    }

    let bytes: Uint8Array;
    try {
        bytes = decodeBase64ToBytes(value.slice(prefix.length));
    } catch {
        throw new TerrainError(
            'Payload contains an invalid base64 character.',
            TerrainErrorCode.SOURCE_DECODE_FAILED
        );
    }

    if (bytes.length !== expectedLength) {
        throw new TerrainError(
            `Payload length ${bytes.length} does not match expected ${expectedLength} bytes.`,
            errorCode,
            { expectedBytes: expectedLength, actualBytes: bytes.length }
        );
    }

    return bytes;
};

/**
 * Cheap shape check: is this a string starting with the expected prefix?
 */
export const isPayload = (prefix: string, value: unknown): value is string =>
    typeof value === 'string' && value.startsWith(prefix);
