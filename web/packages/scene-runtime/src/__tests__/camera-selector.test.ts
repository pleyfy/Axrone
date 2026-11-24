import { describe, expect, it } from 'vitest';
import { selectSceneCamera } from '../camera-selector';
import { Camera } from '../components/camera';
import { Entity, World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '../scene-registry';

const createWorldWithEntities = (...cameraConfigs: Array<{ primary?: boolean; enabled?: boolean; active?: boolean }>): { world: World; entities: EntityId[] } => {
    const world = new World(createSceneRegistry());
    const entities: EntityId[] = [];

    for (const config of cameraConfigs) {
        const entity = new Entity(world);
        const camera = entity.addComponent(Camera, {
            primary: config.primary ?? false,
        });
        if (config.enabled === false) {
            camera.enabled = false;
        }
        if (config.active === false) {
            entity.active = false;
        }
        entities.push(entity);
    }

    return { world, entities };
};

describe('selectSceneCamera', () => {
    it('returns undefined for empty entity list', () => {
        expect(selectSceneCamera([])).toBeUndefined();
    });

    it('returns the primary camera when one exists', () => {
        const { entities } = createWorldWithEntities(
            { primary: false },
            { primary: true },
            { primary: false }
        );
        const selected = selectSceneCamera(entities);
        expect(selected).toBeDefined();
        expect(selected!.primary).toBe(true);
    });

    it('returns the first enabled camera as fallback when no primary', () => {
        const { entities } = createWorldWithEntities(
            { primary: false },
            { primary: false }
        );
        const selected = selectSceneCamera(entities);
        expect(selected).toBeDefined();
        expect(selected!.primary).toBe(false);
    });

    it('skips disabled cameras', () => {
        const { entities } = createWorldWithEntities(
            { enabled: false },
            { primary: false }
        );
        const selected = selectSceneCamera(entities);
        expect(selected).toBeDefined();
        expect(selected!.enabled).toBe(true);
    });

    it('skips inactive entities', () => {
        const { entities } = createWorldWithEntities(
            { active: false, primary: true },
            { primary: false }
        );
        const selected = selectSceneCamera(entities);
        expect(selected).toBeDefined();
        expect(selected!.primary).toBe(false);
    });

    it('returns undefined when all cameras are disabled', () => {
        const { entities } = createWorldWithEntities(
            { enabled: false },
            { enabled: false }
        );
        expect(selectSceneCamera(entities)).toBeUndefined();
    });

    it('returns undefined when all entities are inactive', () => {
        const { entities } = createWorldWithEntities(
            { active: false },
            { active: false }
        );
        expect(selectSceneCamera(entities)).toBeUndefined();
    });

    it('prefers primary over non-primary even if non-primary comes first', () => {
        const { entities } = createWorldWithEntities(
            { primary: false },
            { primary: true }
        );
        const selected = selectSceneCamera(entities);
        expect(selected!.primary).toBe(true);
    });
});
