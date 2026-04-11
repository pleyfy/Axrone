import type { WorldQueryCache } from './query-cache';

export interface WorldQueryArchetype<TArchetypeId extends string = string> {
    readonly id: TArchetypeId;
    readonly mask: bigint;
}

export interface WorldQueryRuntimeOptions<TArchetypeId extends string = string> {
    readonly cache: WorldQueryCache<TArchetypeId>;
    readonly getArchetypes: () => Iterable<WorldQueryArchetype<TArchetypeId>>;
    readonly createBitMask: (components: readonly string[]) => bigint;
}

export class WorldQueryRuntime<TArchetypeId extends string = string> {
    constructor(private readonly _options: WorldQueryRuntimeOptions<TArchetypeId>) {}

    resolveMatchingArchetypes(components: readonly string[]): readonly TArchetypeId[] {
        const queryMask = this._options.createBitMask(components);
        let matchingArchetypes = this._options.cache.getBitQuery(queryMask);

        if (!matchingArchetypes) {
            const queryKey = this._createQueryKey(components);
            matchingArchetypes = this._options.cache.getQuery(queryKey);

            if (!matchingArchetypes) {
                const resolvedMatches: TArchetypeId[] = [];

                for (const archetype of this._options.getArchetypes()) {
                    if ((archetype.mask & queryMask) === queryMask) {
                        resolvedMatches.push(archetype.id);
                    }
                }

                matchingArchetypes = resolvedMatches;
                this._options.cache.setQuery(queryKey, matchingArchetypes);
            }

            this._options.cache.setBitQuery(queryMask, matchingArchetypes);
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
