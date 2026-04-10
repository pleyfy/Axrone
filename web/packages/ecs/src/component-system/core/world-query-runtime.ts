import { Archetype } from '../archetype/archetype';
import { OptimizedQueryCache } from '../archetype/query-cache';
import type { ArchetypeId, BitMask, ComponentRegistry } from '../types/core';

export interface WorldQueryRuntimeOptions<R extends ComponentRegistry> {
    readonly cache: OptimizedQueryCache;
    readonly getArchetypes: () => Iterable<Archetype<R>>;
    readonly createBitMask: (components: readonly string[]) => BitMask;
}

export class WorldQueryRuntime<R extends ComponentRegistry> {
    constructor(private readonly _options: WorldQueryRuntimeOptions<R>) {}

    resolveMatchingArchetypes(components: readonly string[]): readonly ArchetypeId[] {
        const queryKey = this._createQueryKey(components);
        let matchingArchetypes = this._options.cache.getQuery(queryKey);

        if (!matchingArchetypes) {
            const queryMask = this._options.createBitMask(components);
            matchingArchetypes = [];

            for (const archetype of this._options.getArchetypes()) {
                if ((archetype.mask & queryMask) === queryMask) {
                    matchingArchetypes.push(archetype.id);
                }
            }

            this._options.cache.setQuery(queryKey, matchingArchetypes);
        }

        return matchingArchetypes;
    }

    private _createQueryKey(components: readonly string[]): string {
        if (components.length === 1) {
            return components[0]!;
        }

        return [...components].sort().join(',');
    }
}
