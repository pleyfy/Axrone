import { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type { GltfSerializedValue } from './asset-ir';

const asSerializedArray = (value: readonly unknown[]): readonly GltfSerializedValue[] =>
    value.map((item) => encodeGltfValue(item));

export const encodeGltfValue = (value: unknown): GltfSerializedValue => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (value instanceof Vec2) {
        return { $type: 'Vec2', value: [value.x, value.y] };
    }

    if (value instanceof Vec3) {
        return { $type: 'Vec3', value: [value.x, value.y, value.z] };
    }

    if (value instanceof Vec4) {
        return { $type: 'Vec4', value: [value.x, value.y, value.z, value.w] };
    }

    if (value instanceof Quat) {
        return { $type: 'Quat', value: [value.x, value.y, value.z, value.w] };
    }

    if (value instanceof Mat4) {
        return { $type: 'Mat4', value: [...value.data] };
    }

    if (
        value instanceof Float32Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof Uint16Array ||
        value instanceof Uint8Array
    ) {
        return {
            $type: value.constructor.name,
            value: [...value],
        };
    }

    if (Array.isArray(value)) {
        return asSerializedArray(value);
    }

    if (typeof value === 'object') {
        const encoded: Record<string, GltfSerializedValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            encoded[key] = encodeGltfValue(entry);
        }

        return encoded;
    }

    return String(value);
};