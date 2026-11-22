export const VEC2_MUTATION_KEYS = new Set<PropertyKey>(['x', 'y']);
export const COLOR_MUTATION_KEYS = new Set<PropertyKey>(['r', 'g', 'b', 'a']);
export const RECT_MUTATION_KEYS = new Set<PropertyKey>(['x', 'y', 'width', 'height']);
export const BORDER_MUTATION_KEYS = new Set<PropertyKey>(['left', 'right', 'top', 'bottom']);

/**
 * Wraps a live value object so in-place mutations (e.g. `sprite.color.r = 1`)
 * invalidate render caches even though they bypass the component setter.
 * Reads keep the original prototype/instance type and stay proxy-cheap; hot
 * render paths should use the component's raw backing accessors instead.
 */
export const trackLiveMutations = <T extends object>(
    target: T,
    keys: ReadonlySet<PropertyKey>,
    onChange: () => void
): T =>
    new Proxy(target, {
        set(target, property, value) {
            const record = target as Record<PropertyKey, unknown>;
            const changed = record[property] !== value;
            const result = Reflect.set(target, property, value);
            if (result && changed && keys.has(property)) {
                onChange();
            }
            return result;
        },
    }) as T;
