import { EntityRegistry } from '../../support/entity-registry';
import type { EntityId } from '../types/core';
import type { Entity } from './entity';

export class WorldEntityRegistry extends EntityRegistry<EntityId, Entity> {
    private readonly _tagIndex = new Map<string, Set<EntityId>>();
    private readonly _layerIndex = new Map<number, Set<EntityId>>();
    private readonly _entityTagMap = new Map<EntityId, string>();
    private readonly _entityLayerMap = new Map<EntityId, number>();
    private readonly _unsubscribers = new Map<EntityId, () => void>();

    override register(entityId: EntityId, entity: Entity): void {
        super.register(entityId, entity);
        this._indexEntity(entityId, entity.tag as string, entity.layer as number);
        if (typeof entity.subscribeIndexChanges === 'function') {
            const unsub = entity.subscribeIndexChanges((kind, oldValue, newValue) => {
                if (kind === 'tag') {
                    this._removeFromTagIndex(entityId, oldValue as string);
                    this._addToTagIndex(entityId, newValue as string);
                    this._entityTagMap.set(entityId, newValue as string);
                } else if (kind === 'layer') {
                    this._removeFromLayerIndex(entityId, oldValue as number);
                    this._addToLayerIndex(entityId, newValue as number);
                    this._entityLayerMap.set(entityId, newValue as number);
                }
            });
            this._unsubscribers.set(entityId, unsub);
        }
    }

    override unregister(entityId: EntityId): Entity | undefined {
        const unsub = this._unsubscribers.get(entityId);
        if (unsub) {
            unsub();
            this._unsubscribers.delete(entityId);
        }
        this._removeFromIndices(entityId);
        return super.unregister(entityId);
    }

    override clear(): void {
        super.clear();
        this._tagIndex.clear();
        this._layerIndex.clear();
        this._entityTagMap.clear();
        this._entityLayerMap.clear();
        for (const unsub of this._unsubscribers.values()) {
            unsub();
        }
        this._unsubscribers.clear();
    }

    getByTag(tag: string): readonly Entity[] {
        const entityIds = this._tagIndex.get(tag);
        if (!entityIds || entityIds.size === 0) return [];
        const result: Entity[] = [];
        for (const entityId of entityIds) {
            const entity = super.get(entityId);
            if (entity) result.push(entity);
        }
        return result;
    }

    getByLayer(layer: number): readonly Entity[] {
        const entityIds = this._layerIndex.get(layer);
        if (!entityIds || entityIds.size === 0) return [];
        const result: Entity[] = [];
        for (const entityId of entityIds) {
            const entity = super.get(entityId);
            if (entity) result.push(entity);
        }
        return result;
    }

    private _indexEntity(entityId: EntityId, tag: string, layer: number): void {
        this._addToTagIndex(entityId, tag);
        this._addToLayerIndex(entityId, layer);
        this._entityTagMap.set(entityId, tag);
        this._entityLayerMap.set(entityId, layer);
    }

    private _removeFromIndices(entityId: EntityId): void {
        const tag = this._entityTagMap.get(entityId);
        if (tag !== undefined) {
            this._removeFromTagIndex(entityId, tag);
            this._entityTagMap.delete(entityId);
        }
        const layer = this._entityLayerMap.get(entityId);
        if (layer !== undefined) {
            this._removeFromLayerIndex(entityId, layer);
            this._entityLayerMap.delete(entityId);
        }
    }

    private _addToTagIndex(entityId: EntityId, tag: string): void {
        let set = this._tagIndex.get(tag);
        if (!set) {
            set = new Set();
            this._tagIndex.set(tag, set);
        }
        set.add(entityId);
    }

    private _removeFromTagIndex(entityId: EntityId, tag: string): void {
        const set = this._tagIndex.get(tag);
        if (set) {
            set.delete(entityId);
            if (set.size === 0) this._tagIndex.delete(tag);
        }
    }

    private _addToLayerIndex(entityId: EntityId, layer: number): void {
        let set = this._layerIndex.get(layer);
        if (!set) {
            set = new Set();
            this._layerIndex.set(layer, set);
        }
        set.add(entityId);
    }

    private _removeFromLayerIndex(entityId: EntityId, layer: number): void {
        const set = this._layerIndex.get(layer);
        if (set) {
            set.delete(entityId);
            if (set.size === 0) this._layerIndex.delete(layer);
        }
    }
}
