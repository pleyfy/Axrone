import type { ArchetypeId, BitMask } from '../types/core';
import type { QueryCache } from '../types/archetype';

export class OptimizedQueryCache implements QueryCache {
    readonly queries = new Map<string, ArchetypeId[]>();
    readonly bitQueries = new Map<BitMask, ArchetypeId[]>();

    private generation = 0;
    private readonly queryGenerations = new Map<string, number>();

    invalidate(): void {
        this.generation++;
    }

    getQuery(key: string): ArchetypeId[] | undefined {
        const generation = this.queryGenerations.get(key);
        if (generation !== this.generation) {
            this.queries.delete(key);
            this.queryGenerations.delete(key);
            return undefined;
        }
        return this.queries.get(key);
    }

    setQuery(key: string, archetypes: ArchetypeId[]): void {
        this.queries.set(key, archetypes);
        this.queryGenerations.set(key, this.generation);
    }

    getBitQuery(mask: BitMask): ArchetypeId[] | undefined {
        return this.bitQueries.get(mask);
    }

    setBitQuery(mask: BitMask, archetypes: ArchetypeId[]): void {
        this.bitQueries.set(mask, archetypes);
    }
}
