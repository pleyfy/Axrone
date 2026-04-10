import { Archetype } from '../archetype/archetype';
import type {
    ArchetypeId,
    BitMask,
    ComponentMask,
    ComponentRegistry,
    Entity,
} from '../types/core';

export interface WorldArchetypeResolution<R extends ComponentRegistry> {
    readonly archetype: Archetype<R>;
    readonly created: boolean;
}

export interface WorldDestroyedEntity<R extends ComponentRegistry> {
    readonly archetype: Archetype<R>;
    readonly removedComponents: Record<string, any>;
}

export interface WorldStorageDebugInfo<R extends ComponentRegistry> {
    readonly freeEntityCount: number;
    readonly nextEntityId: number;
    readonly archetypes: ReadonlyArray<{
        readonly id: ArchetypeId;
        readonly signature: readonly string[];
        readonly entityCount: number;
        readonly mask: string;
    }>;
}

export class WorldStorageRuntime<R extends ComponentRegistry> {
    private readonly _componentMask: ComponentMask;
    private readonly _archetypes = new Map<ArchetypeId, Archetype<R>>();
    private readonly _entityArchetypes = new Map<Entity, ArchetypeId>();
    private readonly _freeEntities: Entity[] = [];
    private _nextEntityId = 1;
    private _emptyArchetypeId: ArchetypeId;

    constructor(private readonly _registry: R) {
        this._componentMask = this._createComponentMask();
        this._emptyArchetypeId = this.getOrCreateArchetype([]).archetype.id;
    }

    get entityCount(): number {
        return this._entityArchetypes.size;
    }

    get archetypeCount(): number {
        return this._archetypes.size;
    }

    get freeEntityCount(): number {
        return this._freeEntities.length;
    }

    get nextEntityId(): number {
        return this._nextEntityId;
    }

    createEntity(): Entity {
        const entity = this._freeEntities.pop() ?? (this._nextEntityId++ as Entity);
        const emptyArchetype = this._archetypes.get(this._emptyArchetypeId);

        if (!emptyArchetype) {
            throw new Error('Empty archetype not found');
        }

        emptyArchetype.addEntity(entity);
        this._entityArchetypes.set(entity, this._emptyArchetypeId);

        return entity;
    }

    destroyEntity(entity: Entity): WorldDestroyedEntity<R> | undefined {
        const archetypeId = this._entityArchetypes.get(entity);
        if (!archetypeId) {
            return undefined;
        }

        const archetype = this._archetypes.get(archetypeId);
        if (!archetype) {
            throw new Error('Archetype not found');
        }

        const removedComponents = archetype.removeEntity(entity);
        this._entityArchetypes.delete(entity);
        this._freeEntities.push(entity);

        return { archetype, removedComponents };
    }

    getAllEntities(): readonly Entity[] {
        return Array.from(this._entityArchetypes.keys());
    }

    getArchetypes(): Iterable<Archetype<R>> {
        return this._archetypes.values();
    }

    getArchetype(id: ArchetypeId): Archetype<R> | undefined {
        return this._archetypes.get(id);
    }

    getEntityArchetypeId(entity: Entity): ArchetypeId | undefined {
        return this._entityArchetypes.get(entity);
    }

    setEntityArchetype(entity: Entity, archetypeId: ArchetypeId): void {
        this._entityArchetypes.set(entity, archetypeId);
    }

    getComponent<T>(entity: Entity, componentName: string): T | undefined {
        const archetypeId = this._entityArchetypes.get(entity);
        if (!archetypeId) {
            return undefined;
        }

        const archetype = this._archetypes.get(archetypeId);
        if (!archetype) {
            return undefined;
        }

        return archetype.getComponent(entity, componentName);
    }

    createBitMask(components: readonly string[]): BitMask {
        let mask = 0n;

        for (let index = 0; index < components.length; index += 1) {
            const bit = this._componentMask.get(components[index]!);
            if (bit !== undefined) {
                mask |= 1n << BigInt(bit);
            }
        }

        return mask;
    }

    getOrCreateArchetype(signature: readonly string[]): WorldArchetypeResolution<R> {
        const sortedSignature = signature.length <= 1 ? signature : [...signature].sort();
        const id = (sortedSignature.length === 0 ? 'EMPTY' : sortedSignature.join('|')) as ArchetypeId;
        const existing = this._archetypes.get(id);

        if (existing) {
            return { archetype: existing, created: false };
        }

        const archetype = new Archetype(
            sortedSignature,
            this.createBitMask(sortedSignature),
            this._registry,
            this._componentMask
        );
        this._archetypes.set(id, archetype);

        return { archetype, created: true };
    }

    registerComponent(componentName: string): void {
        this._componentMask.set(componentName, this._componentMask.size);
    }

    reset(): void {
        this._archetypes.clear();
        this._entityArchetypes.clear();
        this._freeEntities.length = 0;
        this._nextEntityId = 1;
        this._emptyArchetypeId = this.getOrCreateArchetype([]).archetype.id;
    }

    getDebugInfo(): WorldStorageDebugInfo<R> {
        return {
            freeEntityCount: this._freeEntities.length,
            nextEntityId: this._nextEntityId,
            archetypes: Array.from(this._archetypes.entries()).map(([id, archetype]) => ({
                id,
                signature: archetype.signature,
                entityCount: archetype.entityCount,
                mask: archetype.mask.toString(2),
            })),
        };
    }

    private _createComponentMask(): ComponentMask {
        const mask = new Map<string, number>();
        let bit = 0;

        for (const componentName of Object.keys(this._registry)) {
            mask.set(componentName, bit);
            bit += 1;
        }

        return mask;
    }
}