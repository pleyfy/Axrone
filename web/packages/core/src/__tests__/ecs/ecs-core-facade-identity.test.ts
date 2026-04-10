import { describe, expect, it } from 'vitest';
import {
    Actor as CoreActor,
    ActorError as CoreActorError,
} from '../../component-system/core/actor';
import {
    Component as CoreComponent,
    getComponentMetadata as getCoreComponentMetadata,
    script as coreScript,
} from '../../component-system/core/component';
import { World as CoreWorld } from '../../component-system/core/world';
import { Hierarchy as CoreHierarchy } from '../../component-system/components/hierarchy';
import { Transform as CoreTransform } from '../../component-system/components/transform';
import {
    SystemManager as CoreSystemManager,
    SystemPhase as CoreSystemPhase,
} from '../../component-system/systems/system-manager';
import { Archetype as CoreArchetype } from '../../component-system/archetype/archetype';
import { OptimizedQueryCache as CoreOptimizedQueryCache } from '../../component-system/archetype/query-cache';
import { WorldStorageRuntime as CoreWorldStorageRuntime } from '../../component-system/core/world-storage-runtime';
import {
    Actor,
    ActorError,
    Archetype,
    Component,
    getComponentMetadata,
    Hierarchy,
    OptimizedQueryCache,
    script,
    SystemManager,
    SystemPhase,
    Transform,
    World,
    WorldStorageRuntime,
} from '@axrone/ecs';

describe('ecs core facade identity', () => {
    it('keeps core component-system facades aligned with the ecs package owner', () => {
        expect(CoreComponent).toBe(Component);
        expect(coreScript).toBe(script);
        expect(getCoreComponentMetadata).toBe(getComponentMetadata);
        expect(CoreActor).toBe(Actor);
        expect(CoreActorError).toBe(ActorError);
        expect(CoreWorld).toBe(World);
        expect(CoreHierarchy).toBe(Hierarchy);
        expect(CoreTransform).toBe(Transform);
        expect(CoreSystemManager).toBe(SystemManager);
        expect(CoreSystemPhase).toBe(SystemPhase);
        expect(CoreArchetype).toBe(Archetype);
        expect(CoreOptimizedQueryCache).toBe(OptimizedQueryCache);
        expect(CoreWorldStorageRuntime).toBe(WorldStorageRuntime);
    });
});