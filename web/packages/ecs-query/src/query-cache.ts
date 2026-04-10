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

    private generation = 0;
    private readonly queryGenerations = new Map<string, number>();

    invalidate(): void {
        this.generation += 1;
    }

    getQuery(key: string): readonly TArchetypeId[] | undefined {
        const generation = this.queryGenerations.get(key);
        if (generation !== this.generation) {
            this.queries.delete(key);
            this.queryGenerations.delete(key);
            return undefined;
        }

        return this.queries.get(key);
    }

    setQuery(key: string, archetypes: readonly TArchetypeId[]): void {
        this.queries.set(key, archetypes);
        this.queryGenerations.set(key, this.generation);
    }

    getBitQuery(mask: bigint): readonly TArchetypeId[] | undefined {
        return this.bitQueries.get(mask);
    }

    setBitQuery(mask: bigint, archetypes: readonly TArchetypeId[]): void {
        this.bitQueries.set(mask, archetypes);
    }
}