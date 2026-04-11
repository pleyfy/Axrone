export interface WorldQueryCache<TArchetypeId extends string = string> {
    readonly queries: Map<string, readonly TArchetypeId[]>;
    readonly bitQueries: Map<bigint, readonly TArchetypeId[]>;
    invalidate(): void;
    getQuery(key: string): readonly TArchetypeId[] | undefined;
    setQuery(key: string, archetypes: readonly TArchetypeId[]): void;
    getBitQuery(mask: bigint): readonly TArchetypeId[] | undefined;
    setBitQuery(mask: bigint, archetypes: readonly TArchetypeId[]): void;
}

export class OptimizedQueryCache<TArchetypeId extends string = string>
    implements WorldQueryCache<TArchetypeId>
{
    readonly queries = new Map<string, readonly TArchetypeId[]>();
    readonly bitQueries = new Map<bigint, readonly TArchetypeId[]>();

    invalidate(): void {
        this.queries.clear();
        this.bitQueries.clear();
    }

    getQuery(key: string): readonly TArchetypeId[] | undefined {
        return this.queries.get(key);
    }

    setQuery(key: string, archetypes: readonly TArchetypeId[]): void {
        this.queries.set(key, archetypes);
    }

    getBitQuery(mask: bigint): readonly TArchetypeId[] | undefined {
        return this.bitQueries.get(mask);
    }

    setBitQuery(mask: bigint, archetypes: readonly TArchetypeId[]): void {
        this.bitQueries.set(mask, archetypes);
    }
}
