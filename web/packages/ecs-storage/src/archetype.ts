import { ComponentPool } from './component-pool';
import type {
    StorageArchetypeId,
    StorageArchetypeSignature,
    StorageBitMask,
    StorageComponentMask,
    StorageComponentPool,
    StorageComponentRegistry,
} from './types';

export class Archetype<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = StorageArchetypeId,
> {
    readonly id: TArchetypeId;
    readonly signature: StorageArchetypeSignature;
    readonly mask: StorageBitMask;
    readonly componentMask: StorageComponentMask;
    readonly entities: TEntity[] = [];
    readonly components = new Map<string, StorageComponentPool<any, TEntity>>();
    readonly edges = new Map<string, TArchetypeId>();

    entityCount = 0;

    private readonly entityToIndex = new Map<TEntity, number>();

    constructor(
        signature: StorageArchetypeSignature,
        mask: StorageBitMask,
        registry: R,
        componentMask: StorageComponentMask
    ) {
        this.signature = signature;
        this.mask = mask;
        this.componentMask = componentMask;
        this.id = (signature.length === 0 ? 'EMPTY' : signature.join('|')) as TArchetypeId;

        for (const componentName of signature) {
            const Constructor = registry[componentName];
            if (Constructor) {
                this.components.set(componentName, new ComponentPool<any, TEntity>(Constructor));
            }
        }
    }

    addEntity(entity: TEntity, components: Record<string, any> = {}): void {
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

    removeEntity(entity: TEntity): Record<string, any> {
        const index = this.entityToIndex.get(entity);
        if (index === undefined) {
            return {};
        }

        const lastIndex = this.entityCount - 1;
        const lastEntity = this.entities[lastIndex]!;
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

    hasEntity(entity: TEntity): boolean {
        return this.entityToIndex.has(entity);
    }

    getComponent<T>(entity: TEntity, componentName: string): T | undefined {
        const index = this.entityToIndex.get(entity);
        if (index === undefined) {
            return undefined;
        }

        const pool = this.components.get(componentName);
        return pool?.dense[index] as T;
    }
}