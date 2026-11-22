import { describe, expect, it } from 'vitest';
import {
    SCENE_MIXED_RUNTIME_PROFILE_ID,
    getMixedSceneRuntimeProfile,
} from '../scene-mixed-profile';
import { resolvePhysicsBridgesForProfile } from '../scene-profile';
import * as barrelExports from '../index';

describe('scene mixed runtime profile', () => {
    it('pins the profile ID to the stable scene/mixed-default identifier', () => {
        expect(SCENE_MIXED_RUNTIME_PROFILE_ID).toBe('scene/mixed-default');
    });

    it('returns the same frozen profile instance on repeated calls', () => {
        const first = getMixedSceneRuntimeProfile();
        const second = getMixedSceneRuntimeProfile();

        expect(first).toBe(second);
        expect(first.id).toBe('scene/mixed-default');
        expect(typeof first.resolveRegistry).toBe('function');
        expect(Object.isFrozen(first)).toBe(true);
    });

    it('resolves a registry with both 2d and 3d built-ins', () => {
        const registry = getMixedSceneRuntimeProfile().resolveRegistry({});

        expect(registry.Camera).toBeDefined();
        expect(registry.SpriteRenderer).toBeDefined();
        expect(registry.SpriteAnimator).toBeDefined();
        expect(registry.SpriteMask).toBeDefined();
        expect(registry.MeshRenderer).toBeDefined();
        expect(registry.DirectionalLight).toBeDefined();
        expect(registry.Terrain).toBeDefined();
        expect(registry.ParticleSystem).toBeDefined();
    });

    it('is re-exported from the scene-profile and barrel index', async () => {
        const profileModule = await import('../scene-profile');

        expect(profileModule.SCENE_MIXED_RUNTIME_PROFILE_ID).toBe('scene/mixed-default');
        expect(profileModule.getMixedSceneRuntimeProfile).toBeDefined();
        expect((barrelExports as Record<string, unknown>).SCENE_MIXED_RUNTIME_PROFILE_ID).toBe(
            'scene/mixed-default'
        );
        expect((barrelExports as Record<string, unknown>).getMixedSceneRuntimeProfile).toBeDefined();
    });

    it('selects physics bridges per profile without taxing pure 3d runtimes', () => {
        expect(resolvePhysicsBridgesForProfile('scene/2d-default')).toEqual({
            bridge3D: false,
            bridge2D: true,
        });
        expect(resolvePhysicsBridgesForProfile('scene/mixed-default')).toEqual({
            bridge3D: true,
            bridge2D: true,
        });
        for (const profileId of ['scene/3d-default', 'scene/full-3d-default', 'scene/core-default', undefined]) {
            expect(resolvePhysicsBridgesForProfile(profileId)).toEqual({
                bridge3D: true,
                bridge2D: false,
            });
        }
    });
});
