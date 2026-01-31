import type {
    ComponentRegistry,
    ArchetypeId,
    ArchetypeSignature,
    BitMask,
    Entity,
    ComponentMask,
} from '../types/core';
import type { IArchetype } from '../types/archetype';
import type { IComponentPool } from '../types/component';
import { ComponentPool } from '../memory/component-pool';

export class Archetype<R extends ComponentRegistry> implements IArchetype<R> {
    readonly id: ArchetypeId;
    readonly signature: ArchetypeSignature;
    readonly mask: BitMask;
    readonly componentMask: ComponentMask;
    readonly entities: Entity[] = [];
    readonly components = new Map<string, IComponentPool<any>>();
    readonly edges = new Map<string, ArchetypeId>();

    entityCount = 0;

    private readonly entityToIndex = new Map<Entity, number>();

    constructor(
        signature: ArchetypeSignature,
        mask: BitMask,
        registry: R,
        componentMask: ComponentMask
    ) {
        this.signature = signature;
        this.mask = mask;
        this.componentMask = componentMask;
        this.id = (signature.length === 0 ? 'EMPTY' : signature.join('|')) as ArchetypeId;

        for (const componentName of signature) {
            const Constructor = registry[componentName];
            if (Constructor) {
                this.components.set(componentName, new ComponentPool(Constructor));
            }
        }
    }

    addEntity(entity: Entity, components: Record<string, any> = {}): void {
        const index = this.entityCount;
        this.entities[index] = entity;
        this.entityToIndex.set(entity, index);

        for (const [componentName, pool] of this.components) {
            const component = components[componentName] || pool.acquire();
            pool.dense[index] = component;
            pool.entities[index] = entity;
            pool.sparse[entity] = index;
            pool.size = Math.max(pool.size, index + 1);
        }

        this.entityCount++;
    }

    removeEntity(entity: Entity): Record<string, any> {
        const index = this.entityToIndex.get(entity);
        if (index === undefined) return {};

        const lastIndex = this.entityCount - 1;
        const lastEntity = this.entities[lastIndex];
        const removedComponents: Record<string, any> = {};

        for (const [componentName, pool] of this.components) {
            const component = pool.dense[index];
            removedComponents[componentName] = component;

            if (index !== lastIndex) {
                pool.dense[index] = pool.dense[lastIndex];
                pool.entities[index] = lastEntity;
                pool.sparse[lastEntity] = index;
            }

            pool.sparse[entity] = undefined;
            pool.size--;
        }

        if (index !== lastIndex) {
            this.entities[index] = lastEntity;
            this.entityToIndex.set(lastEntity, index);
        }

        this.entityToIndex.delete(entity);
        this.entityCount--;
        this.entities.length = this.entityCount;

        return removedComponents;
    }

    hasEntity(entity: Entity): boolean {
        return this.entityToIndex.has(entity);
    }

    getComponent<T>(entity: Entity, componentName: string): T | undefined {
        const index = this.entityToIndex.get(entity);
        if (index === undefined) return undefined;

        const pool = this.components.get(componentName);
        return pool?.dense[index] as T;
    }
}
