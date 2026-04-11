import { Archetype } from './archetype';
import type {
    StorageArchetypeId,
    StorageBitMask,
    StorageComponentMask,
    StorageComponentRegistry,
} from './types';

export interface WorldArchetypeResolution<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = StorageArchetypeId,
> {
    readonly archetype: Archetype<R, TEntity, TArchetypeId>;
    readonly created: boolean;
}

export class ArchetypeStore<
    R extends StorageComponentRegistry,
    TEntity extends number = number,
    TArchetypeId extends string = StorageArchetypeId,
> {
    private readonly _componentMask: StorageComponentMask;
    private readonly _archetypes = new Map<TArchetypeId, Archetype<R, TEntity, TArchetypeId>>();

    constructor(private readonly _registry: R) {
        this._componentMask = this._createComponentMask();
    }

    get archetypeCount(): number {
        return this._archetypes.size;
    }

    getArchetypes(): Iterable<Archetype<R, TEntity, TArchetypeId>> {
        return this._archetypes.values();
    }

    getArchetype(id: TArchetypeId): Archetype<R, TEntity, TArchetypeId> | undefined {
        return this._archetypes.get(id);
    }

    createBitMask(components: readonly string[]): StorageBitMask {
        let mask = 0n;

        for (let index = 0; index < components.length; index += 1) {
            const bit = this._componentMask.get(components[index]!);
            if (bit !== undefined) {
                mask |= 1n << BigInt(bit);
            }
        }

        return mask;
    }

    getOrCreateArchetype(signature: readonly string[]): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        const sortedSignature = signature.length <= 1 ? signature : [...signature].sort();
        const id = (sortedSignature.length === 0 ? 'EMPTY' : sortedSignature.join('|')) as TArchetypeId;
        const existing = this._archetypes.get(id);

        if (existing) {
            return { archetype: existing, created: false };
        }

        const archetype = new Archetype<R, TEntity, TArchetypeId>(
            sortedSignature,
            this.createBitMask(sortedSignature),
            this._registry,
            this._componentMask
        );
        this._archetypes.set(id, archetype);

        return { archetype, created: true };
    }

    resolveAddComponentArchetype(
        currentArchetype: Archetype<R, TEntity, TArchetypeId>,
        componentName: string
    ): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        return this._resolveComponentTransition(currentArchetype, 'add', componentName);
    }

    resolveRemoveComponentArchetype(
        currentArchetype: Archetype<R, TEntity, TArchetypeId>,
        componentName: string
    ): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        return this._resolveComponentTransition(currentArchetype, 'remove', componentName);
    }

    registerComponent(componentName: string): void {
        this._componentMask.set(componentName, this._componentMask.size);
    }

    reset(): void {
        this._archetypes.clear();
    }

    getDebugInfo(): ReadonlyArray<{
        readonly id: TArchetypeId;
        readonly signature: readonly string[];
        readonly entityCount: number;
        readonly mask: string;
    }> {
        return Array.from(this._archetypes.entries()).map(([id, archetype]) => ({
            id,
            signature: archetype.signature,
            entityCount: archetype.entityCount,
            mask: archetype.mask.toString(2),
        }));
    }

    private _createComponentMask(): StorageComponentMask {
        const mask = new Map<string, number>();
        let bit = 0;

        for (const componentName of Object.keys(this._registry)) {
            mask.set(componentName, bit);
            bit += 1;
        }

        return mask;
    }

    private _resolveComponentTransition(
        currentArchetype: Archetype<R, TEntity, TArchetypeId>,
        action: 'add' | 'remove',
        componentName: string
    ): WorldArchetypeResolution<R, TEntity, TArchetypeId> {
        const edgeKey = `${action}:${componentName}`;
        const cachedArchetypeId = currentArchetype.edges.get(edgeKey);

        if (cachedArchetypeId) {
            const cachedArchetype = this._archetypes.get(cachedArchetypeId);
            if (cachedArchetype) {
                return { archetype: cachedArchetype, created: false };
            }

            currentArchetype.edges.delete(edgeKey);
        }

        const nextSignature =
            action === 'add'
                ? this._createAddSignature(currentArchetype.signature, componentName)
                : this._createRemoveSignature(currentArchetype.signature, componentName);
        const resolution = this.getOrCreateArchetype(nextSignature);

        currentArchetype.edges.set(edgeKey, resolution.archetype.id);
        resolution.archetype.edges.set(
            `${action === 'add' ? 'remove' : 'add'}:${componentName}`,
            currentArchetype.id
        );

        return resolution;
    }

    private _createAddSignature(
        signature: readonly string[],
        componentName: string
    ): readonly string[] {
        if (signature.length === 0) {
            return [componentName];
        }

        const nextSignature = new Array<string>(signature.length + 1);
        let sourceIndex = 0;
        let targetIndex = 0;
        let inserted = false;

        while (sourceIndex < signature.length) {
            const currentComponent = signature[sourceIndex]!;
            if (!inserted && componentName < currentComponent) {
                nextSignature[targetIndex] = componentName;
                targetIndex += 1;
                inserted = true;
            }

            nextSignature[targetIndex] = currentComponent;
            targetIndex += 1;
            sourceIndex += 1;
        }

        if (!inserted) {
            nextSignature[targetIndex] = componentName;
        }

        return nextSignature;
    }

    private _createRemoveSignature(
        signature: readonly string[],
        componentName: string
    ): readonly string[] {
        if (signature.length <= 1) {
            return [];
        }

        const nextSignature = new Array<string>(signature.length - 1);
        let targetIndex = 0;

        for (let sourceIndex = 0; sourceIndex < signature.length; sourceIndex += 1) {
            const currentComponent = signature[sourceIndex]!;
            if (currentComponent === componentName) {
                continue;
            }

            nextSignature[targetIndex] = currentComponent;
            targetIndex += 1;
        }

        return nextSignature;
    }
}