import { ArchetypeStore, type WorldArchetypeResolution } from './archetype-store';
import { EntityStore } from './entity-store';
import type { Archetype } from './archetype';
import type { StorageComponentRegistry } from './types';

export interface WorldDestroyedEntity<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = string,
> {
    readonly archetype: Archetype<R, TEntity, TArchetypeId>;
    readonly removedComponents: Record<string, any>;
}

export interface WorldCreatedEntity<
    TEntity extends number = number,
    TArchetypeId extends string = string,
> {
    readonly entity: TEntity;
    readonly archetypeId: TArchetypeId;
    readonly createdArchetype: boolean;
}

export interface WorldStorageDebugInfo<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = string,
> {
    readonly freeEntityCount: number;
    readonly nextEntityId: number;
    readonly archetypes: ReadonlyArray<{
        readonly id: TArchetypeId;
        readonly signature: readonly string[];
        readonly entityCount: number;
        readonly mask: string;
    }>;
}

export class WorldStorageRuntime<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = string,
> {
    private readonly _entityStore = new EntityStore<TEntity, TArchetypeId>();
    private readonly _archetypeStore: ArchetypeStore<R, TEntity, TArchetypeId>;

    constructor(registry: R) {
        this._archetypeStore = new ArchetypeStore<R, TEntity, TArchetypeId>(registry);
        this._bootstrapEmptyArchetype();
    }

    get entityCount(): number {
        return this._entityStore.entityCount;
    }

    get archetypeCount(): number {
        return this._archetypeStore.archetypeCount;
    }

    get freeEntityCount(): number {
        return this._entityStore.freeEntityCount;
    }

    get nextEntityId(): number {
        return this._entityStore.nextEntityId;
    }

    createEntity(): TEntity {
        const { entity, archetypeId } = this._entityStore.createEntity();
        const emptyArchetype = this._archetypeStore.getArchetype(archetypeId);

        if (!emptyArchetype) {
            throw new Error('Empty archetype not found');
        }

        emptyArchetype.addEntity(entity);
        return entity;
    }

    createEntityWithComponents(
        components: Record<string, any>
    ): WorldCreatedEntity<TEntity, TArchetypeId> {
        const { entity } = this._entityStore.createEntity();
        const resolution = this._archetypeStore.getOrCreateArchetype(Object.keys(components));

        resolution.archetype.addEntity(entity, components);
        this._entityStore.setEntityArchetype(entity, resolution.archetype.id);

        return {
            entity,
            archetypeId: resolution.archetype.id,
            createdArchetype: resolution.created,
        };
    }

    destroyEntity(entity: TEntity): WorldDestroyedEntity<R, TEntity, TArchetypeId> | undefined {
        const archetypeId = this._entityStore.getEntityArchetypeId(entity);
        if (!archetypeId) {
            return undefined;
        }

        const archetype = this._archetypeStore.getArchetype(archetypeId);
        if (!archetype) {
            throw new Error('Archetype not found');
        }

        const removedComponents = archetype.removeEntity(entity);
        this._entityStore.destroyEntity(entity);

        return { archetype, removedComponents };
    }

    getAllEntities(): readonly TEntity[] {
        return this._entityStore.getAllEntities();
    }

    getArchetypes(): Iterable<Archetype<R, TEntity, TArchetypeId>> {
        return this._archetypeStore.getArchetypes();
    }

    getArchetype(id: TArchetypeId): Archetype<R, TEntity, TArchetypeId> | undefined {
        return this._archetypeStore.getArchetype(id);
    }

    resolveAddComponentArchetype(
        currentArchetype: Archetype<R, TEntity, TArchetypeId>,
        componentName: string
    ): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        return this._archetypeStore.resolveAddComponentArchetype(currentArchetype, componentName);
    }

    resolveRemoveComponentArchetype(
        currentArchetype: Archetype<R, TEntity, TArchetypeId>,
        componentName: string
    ): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        return this._archetypeStore.resolveRemoveComponentArchetype(
            currentArchetype,
            componentName
        );
    }

    getEntityArchetypeId(entity: TEntity): TArchetypeId | undefined {
        return this._entityStore.getEntityArchetypeId(entity);
    }

    setEntityArchetype(entity: TEntity, archetypeId: TArchetypeId): void {
        this._entityStore.setEntityArchetype(entity, archetypeId);
    }

    getComponent<T>(entity: TEntity, componentName: string): T | undefined {
        const archetypeId = this._entityStore.getEntityArchetypeId(entity);
        if (!archetypeId) {
            return undefined;
        }

        const archetype = this._archetypeStore.getArchetype(archetypeId);
        if (!archetype) {
            return undefined;
        }

        return archetype.getComponent(entity, componentName);
    }

    createBitMask(components: readonly string[]): bigint {
        return this._archetypeStore.createBitMask(components);
    }

    getOrCreateArchetype(signature: readonly string[]): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        return this._archetypeStore.getOrCreateArchetype(signature);
    }

    registerComponent(componentName: string): void {
        this._archetypeStore.registerComponent(componentName);
    }

    reset(): void {
        this._archetypeStore.reset();
        this._entityStore.reset();
        this._bootstrapEmptyArchetype();
    }

    getDebugInfo(): WorldStorageDebugInfo<R, TEntity, TArchetypeId> {
        return {
            freeEntityCount: this._entityStore.freeEntityCount,
            nextEntityId: this._entityStore.nextEntityId,
            archetypes: this._archetypeStore.getDebugInfo(),
        };
    }

    private _bootstrapEmptyArchetype(): void {
        const emptyArchetype = this._archetypeStore.getOrCreateArchetype([]).archetype;
        this._entityStore.setEmptyArchetypeId(emptyArchetype.id);
    }
}