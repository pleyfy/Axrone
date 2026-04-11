import type { ComponentRegistry, ArchetypeId, ArchetypeSignature, BitMask, Entity } from './core';
import type { IComponentPool } from './component';

export interface IArchetype<R extends ComponentRegistry> {
    readonly id: ArchetypeId;
    readonly signature: ArchetypeSignature;
    readonly mask: BitMask;
    readonly entities: Entity[];
    readonly components: Map<string, IComponentPool<any>>;
    readonly edges: Map<string, ArchetypeId>;
    entityCount: number;
}

export interface QueryCache {
    readonly queries: Map<string, ArchetypeId[]>;
    readonly bitQueries: Map<BitMask, ArchetypeId[]>;
    invalidate(): void;
}
