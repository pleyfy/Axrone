import type { JsonValue } from '@axrone/utility';

type SerializedValue = JsonValue;
export type { JsonValue as SerializedValue };
import { Vec2 } from '../vec2';
import { Vec3 } from '../vec3';
import { Vec4 } from '../vec4';
import { Quat } from '../quat';
import { Mat4 } from '../mat4';
import { Rect } from '../rect';


/**
 * Rounds a Float32 value to 6 significant decimal digits before JSON
 * serialization. Float32 has ~7 significant digits; when spread into a JS
 * number (Float64) the extra digits are representation noise, not meaningful
 * data. Rounding cuts per-value text from ~18 chars to ~8 chars on average,
 * reducing animation keyframe and vertex data JSON by ~55%.
 */
export const roundFloat32ForJson = (value: number): number => {
    if (value === 0 || !Number.isFinite(value)) return value;
    const magnitude = Math.pow(10, 5 - Math.floor(Math.log10(Math.abs(value))));
    if (!Number.isFinite(magnitude)) return value;
    return Math.round(value * magnitude) / magnitude;
};

const asSerializedArray = (
    value: readonly unknown[],
    seen: WeakSet<object>,
    depth: number
): readonly SerializedValue[] =>
    value.map((item) => encodeValue(item, seen, depth));

const MAX_DEPTH = 100;

/**
 * Encodes an arbitrary runtime value into a JSON-serializable envelope.
 *
 * Numeric value objects (Vec2, Vec3, Vec4, Quat, Mat4) and typed arrays are
 * wrapped in `{ $type, value }` envelopes so they survive a JSON round-trip
 * and can be reconstructed by a matching decoder.
 *
 * Cycle detection and depth limiting prevent infinite recursion on object graphs.
 */
export const encodeValue = (
    value: unknown,
    seen: WeakSet<object> = new WeakSet(),
    depth: number = 0
): SerializedValue => {
    if (depth > MAX_DEPTH) {
        throw new Error(`encodeValue: maximum depth (${MAX_DEPTH}) exceeded`);
    }

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

    if (value instanceof Rect) {
        return { $type: 'Rect', value: [value.x, value.y, value.width, value.height] };
    }

    if (value instanceof Float32Array) {
        return {
            $type: 'Float32Array',
            value: Array.from(value, roundFloat32ForJson),
        };
    }

    if (
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
        return asSerializedArray(value, seen, depth + 1);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            throw new Error('encodeValue: circular reference detected');
        }
        seen.add(value);

        const encoded: Record<string, SerializedValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            if (Object.hasOwn(value, key)) {
                encoded[key] = encodeValue(entry, seen, depth + 1);
            }
        }

        return encoded;
    }

    return String(value);
};
