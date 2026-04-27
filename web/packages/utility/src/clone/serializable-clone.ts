import type { TypedArray } from '../types';

export interface CloneSerializableOptions {
    readonly freeze?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const cloneArrayBufferView = <TValue extends ArrayBufferView>(value: TValue): TValue => {
    if (value instanceof DataView) {
        const clonedBytes = new Uint8Array(value.byteLength);
        clonedBytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        return new DataView(clonedBytes.buffer) as unknown as TValue;
    }

    const typedArray = value as unknown as TypedArray;
    return typedArray.slice() as unknown as TValue;
};

const maybeFreeze = <TValue>(value: TValue, freeze: boolean): TValue =>
    (freeze ? Object.freeze(value) : value);

const cloneSerializableInternal = (value: unknown, freeze: boolean): unknown => {
    if (Array.isArray(value)) {
        return maybeFreeze(value.map((entry) => cloneSerializableInternal(entry, freeze)), freeze);
    }

    if (ArrayBuffer.isView(value)) {
        return cloneArrayBufferView(value);
    }

    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }

    if (!isRecord(value)) {
        return value;
    }

    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        cloned[key] = cloneSerializableInternal(entry, freeze);
    }

    return maybeFreeze(cloned, freeze);
};

export const cloneSerializable = <TValue>(
    value: TValue,
    options: CloneSerializableOptions = {}
): TValue => cloneSerializableInternal(value, options.freeze ?? false) as TValue;