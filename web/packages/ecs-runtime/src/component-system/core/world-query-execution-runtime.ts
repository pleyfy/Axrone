import type { Archetype } from '../../storage/archetype';
import type { StorageComponentPool } from '../../storage/types';
import type { WorldQueryRuntime } from '../../query/world-query-runtime';
import type { ArchetypeId, ComponentInstance, ComponentRegistry, EntityId } from '../types/core';
import type { QueryResult } from '../types/system';

const EMPTY_QUERY_RESULTS = Object.freeze([]) as readonly never[];

export interface WorldQueryExecutionRuntimeOptions<
    R extends ComponentRegistry,
    TArchetypeId extends string = ArchetypeId,
> {
    readonly queryRuntime: WorldQueryRuntime<TArchetypeId>;
    readonly getArchetype: (id: TArchetypeId) => Archetype<R, EntityId, TArchetypeId> | undefined;
    readonly onQueryResolved?: () => void;
}

export class WorldQueryExecutionRuntime<
    R extends ComponentRegistry,
    TArchetypeId extends string = ArchetypeId,
> {
    constructor(private readonly _options: WorldQueryExecutionRuntimeOptions<R, TArchetypeId>) {}

    execute<Q extends readonly (keyof R)[]>(...components: Q): readonly QueryResult<R, Q>[] {
        this._options.onQueryResolved?.();

        const matchingArchetypes = this._options.queryRuntime.resolveMatchingArchetypes(
            components as readonly string[]
        );

        if (matchingArchetypes.length === 0) {
            return EMPTY_QUERY_RESULTS as readonly QueryResult<R, Q>[];
        }

        const resolvedArchetypes = new Array<Archetype<R, EntityId, TArchetypeId>>(
            matchingArchetypes.length
        );
        let resolvedArchetypeCount = 0;
        let totalEntityCount = 0;

        for (let i = 0; i < matchingArchetypes.length; i++) {
            const archetype = this._options.getArchetype(matchingArchetypes[i]!);
            if (
                !archetype ||
                archetype.entityCount === 0 ||
                !this._archetypeHasAllComponents(archetype, components)
            ) {
                continue;
            }

            resolvedArchetypes[resolvedArchetypeCount++] = archetype;
            totalEntityCount += archetype.entityCount;
        }

        if (totalEntityCount === 0) {
            return EMPTY_QUERY_RESULTS as readonly QueryResult<R, Q>[];
        }

        const results = new Array<QueryResult<R, Q>>(totalEntityCount);
        let resultIndex = 0;

        for (let i = 0; i < resolvedArchetypeCount; i++) {
            resultIndex = this._appendArchetypeResults(
                results,
                resultIndex,
                resolvedArchetypes[i]!,
                components
            );
        }

        return results;
    }

    private _archetypeHasAllComponents<Q extends readonly (keyof R)[]>(
        archetype: Archetype<R, EntityId, TArchetypeId>,
        components: Q
    ): boolean {
        for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
            if (!archetype.components.has(components[componentIndex] as string)) {
                return false;
            }
        }

        return true;
    }

    private _appendArchetypeResults<Q extends readonly (keyof R)[]>(
        results: Array<QueryResult<R, Q>>,
        resultIndex: number,
        archetype: Archetype<R, EntityId, TArchetypeId>,
        components: Q
    ): number {
        const componentPools = new Array<StorageComponentPool<any, EntityId>>(components.length);

        for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
            const componentName = components[componentIndex] as string;
            const componentPool = archetype.components.get(componentName);
            if (!componentPool) {
                return resultIndex;
            }

            componentPools[componentIndex] = componentPool;
        }

        for (let entityIndex = 0; entityIndex < archetype.entityCount; entityIndex++) {
            const entity = archetype.entities[entityIndex]!;
            const componentData = {} as { [K in Q[number]]: ComponentInstance<R[K]> };

            for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
                const componentName = components[componentIndex]!;
                componentData[componentName] = componentPools[componentIndex]!.dense[
                    entityIndex
                ] as ComponentInstance<R[typeof componentName]>;
            }

            results[resultIndex++] = {
                entity,
                components: componentData,
            };
        }

        return resultIndex;
    }
}
