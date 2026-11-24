export class EntityRegistry<TEntityId extends number = number, TEntity = unknown> {
    private readonly _entities = new Map<TEntityId, TEntity>();
    private _allEntitiesCache: readonly TEntity[] | null = null;

    register(entityId: TEntityId, entity: TEntity): void {
        this._entities.set(entityId, entity);
        this._allEntitiesCache = null;
    }

    unregister(entityId: TEntityId): TEntity | undefined {
        const entity = this._entities.get(entityId);
        if (entity === undefined) {
            return undefined;
        }

        this._entities.delete(entityId);
        this._allEntitiesCache = null;
        return entity;
    }

    get(entityId: TEntityId): TEntity | undefined {
        return this._entities.get(entityId);
    }

    getAll(): readonly TEntity[] {
        if (!this._allEntitiesCache) {
            this._allEntitiesCache = Object.freeze([...this._entities.values()]);
        }

        return this._allEntitiesCache;
    }

    clear(): void {
        if (this._entities.size === 0) {
            return;
        }

        this._entities.clear();
        this._allEntitiesCache = null;
    }

    get size(): number {
        return this._entities.size;
    }
}
