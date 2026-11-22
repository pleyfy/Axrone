import { isTweenTypedArray } from './runtime-utils';

export interface TweenPropertyAccessor {
    readonly path: string;
    readonly parts: readonly string[];
    get(target: unknown): unknown;
    set(target: unknown, value: unknown): void;
}

const isNumericPathPart = (value: string | undefined): boolean =>
    typeof value === 'string' && /^\d+$/.test(value);

export const assignTweenPropertyValue = (existing: unknown, value: unknown): boolean => {
    if (
        isTweenTypedArray(existing) &&
        isTweenTypedArray(value) &&
        existing.length === value.length
    ) {
        // Narrowed by the guards above, but TypedArray union has no shared
        // `.set` signature, so the call goes through this minimal interface.
        (existing as { set(values: ArrayLike<number>): void }).set(value as ArrayLike<number>);
        return true;
    }

    if (Array.isArray(existing) && Array.isArray(value) && existing.length === value.length) {
        for (let index = 0; index < value.length; index += 1) {
            existing[index] = value[index] ?? 0;
        }
        return true;
    }

    return false;
};

export const createTweenPropertyAccessor = (path: string): TweenPropertyAccessor => {
    const parts = path.split('.');

    return {
        path,
        parts,
        get(target: unknown): unknown {
            if (!target) {
                return undefined;
            }

            // `unknown` in, dynamic walk out: each hop is reflectively read,
            // so the cursor is a string-keyed record by construction.
            let current: unknown = target;

            for (let index = 0; index < parts.length; index += 1) {
                if (current === undefined || current === null) {
                    return undefined;
                }

                current = (current as Record<string, unknown>)[parts[index]!];
            }

            return current;
        },
        set(target: unknown, value: unknown): void {
            if (!target || typeof target !== 'object') {
                return;
            }

            let current = target as Record<string, unknown>;

            for (let index = 0; index < parts.length - 1; index += 1) {
                const part = parts[index];

                if (current[part] === undefined || current[part] === null) {
                    current[part] = isNumericPathPart(parts[index + 1]) ? [] : {};
                }

                current = current[part] as Record<string, unknown>;
            }

            const lastPart = parts[parts.length - 1];
            const existing = current[lastPart];

            if (assignTweenPropertyValue(existing, value)) {
                return;
            }

            current[lastPart] = value;
        },
    };
};

export const getOrCreateTweenPropertyAccessor = (
    cache: Map<string, TweenPropertyAccessor>,
    path: string
): TweenPropertyAccessor => {
    const existing = cache.get(path);

    if (existing) {
        return existing;
    }

    const created = createTweenPropertyAccessor(path);
    cache.set(path, created);
    return created;
};