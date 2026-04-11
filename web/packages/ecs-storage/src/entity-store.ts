export interface EntityStoreAllocation<
    TEntity extends number = number,
    TArchetypeId extends string = string,
> {
    readonly entity: TEntity;
    readonly archetypeId: TArchetypeId;
}

export class EntityStore<TEntity extends number = number, TArchetypeId extends string = string> {
    private readonly _entityArchetypes = new Map<TEntity, TArchetypeId>();
    private readonly _freeEntities: TEntity[] = [];
    private _nextEntityId = 1;
    private _emptyArchetypeId: TArchetypeId | undefined;

    get entityCount(): number {
        return this._entityArchetypes.size;
    }

    get freeEntityCount(): number {
        return this._freeEntities.length;
    }

    get nextEntityId(): number {
        return this._nextEntityId;
    }

    setEmptyArchetypeId(archetypeId: TArchetypeId): void {
        this._emptyArchetypeId = archetypeId;
    }

    createEntity(): EntityStoreAllocation<TEntity, TArchetypeId> {
        if (!this._emptyArchetypeId) {
            throw new Error('Empty archetype not configured');
        }

        const entity = this._freeEntities.pop() ?? (this._nextEntityId++ as TEntity);
        this._entityArchetypes.set(entity, this._emptyArchetypeId);

        return {
            entity,
            archetypeId: this._emptyArchetypeId,
        };
    }

    destroyEntity(entity: TEntity): TArchetypeId | undefined {
        const archetypeId = this._entityArchetypes.get(entity);
        if (!archetypeId) {
            return undefined;
        }

        this._entityArchetypes.delete(entity);
        this._freeEntities.push(entity);
        return archetypeId;
    }

    getAllEntities(): readonly TEntity[] {
        return Array.from(this._entityArchetypes.keys());
    }

    getEntityArchetypeId(entity: TEntity): TArchetypeId | undefined {
        return this._entityArchetypes.get(entity);
    }

    setEntityArchetype(entity: TEntity, archetypeId: TArchetypeId): void {
        this._entityArchetypes.set(entity, archetypeId);
    }

    reset(): void {
        this._entityArchetypes.clear();
        this._freeEntities.length = 0;
        this._nextEntityId = 1;
        this._emptyArchetypeId = undefined;
    }
}