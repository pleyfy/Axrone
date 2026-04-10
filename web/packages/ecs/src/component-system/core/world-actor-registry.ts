import type { Entity } from '../types/core';
import type { Actor } from './actor';

export class WorldActorRegistry {
    private readonly _actors = new Map<Entity, Actor>();
    private _allActorsCache: readonly Actor[] | null = null;

    register(entity: Entity, actor: Actor): void {
        this._actors.set(entity, actor);
        this._allActorsCache = null;
    }

    unregister(entity: Entity): Actor | undefined {
        const actor = this._actors.get(entity);
        if (actor) {
            this._actors.delete(entity);
            this._allActorsCache = null;
        }

        return actor;
    }

    get(entity: Entity): Actor | undefined {
        return this._actors.get(entity);
    }

    getAll(): readonly Actor[] {
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
