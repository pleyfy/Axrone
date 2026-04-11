export class ActorRegistry<TEntity extends number = number, TActor = unknown> {
    private readonly _actors = new Map<TEntity, TActor>();
    private _allActorsCache: readonly TActor[] | null = null;

    register(entity: TEntity, actor: TActor): void {
        this._actors.set(entity, actor);
        this._allActorsCache = null;
    }

    unregister(entity: TEntity): TActor | undefined {
        const actor = this._actors.get(entity);
        if (actor === undefined) {
            return undefined;
        }

        this._actors.delete(entity);
        this._allActorsCache = null;
        return actor;
    }

    get(entity: TEntity): TActor | undefined {
        return this._actors.get(entity);
    }

    getAll(): readonly TActor[] {
        if (!this._allActorsCache) {
            this._allActorsCache = Object.freeze([...this._actors.values()]);
        }

        return this._allActorsCache;
    }

    clear(): void {
        if (this._actors.size === 0) {
            return;
        }

        this._actors.clear();
        this._allActorsCache = null;
    }

    get size(): number {
        return this._actors.size;
    }
}