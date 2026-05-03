export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

export const isPlainObject = (value: unknown): value is Record<string | number | symbol, unknown> => {
    if (!isRecord(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};