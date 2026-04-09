import { describe, expect, it } from 'vitest';
import {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    coreSceneRuntimeProfile,
    getCoreSceneRuntimeProfile,
} from '../../runtime-profile-core';
import {
    SCENE_3D_RUNTIME_PROFILE_ID,
    get3DSceneRuntimeProfile,
    scene3DRuntimeProfile,
} from '../../runtime-profile-3d';
import {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    fullSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
} from '../../runtime-profile-full';

describe('runtime profile entrypoints', () => {
    it('exposes the core runtime profile from its own entrypoint', () => {
        expect(getCoreSceneRuntimeProfile().id).toBe(CORE_SCENE_RUNTIME_PROFILE_ID);
        expect(coreSceneRuntimeProfile().id).toBe(CORE_SCENE_RUNTIME_PROFILE_ID);
    });

    it('exposes the 3d runtime profile from its own entrypoint', () => {
        expect(get3DSceneRuntimeProfile().id).toBe(DEFAULT_SCENE_RUNTIME_PROFILE_ID);
        expect(scene3DRuntimeProfile().id).toBe(DEFAULT_SCENE_RUNTIME_PROFILE_ID);
        expect(SCENE_3D_RUNTIME_PROFILE_ID).toBe('scene/3d-default');
    });

    it('exposes the full runtime profile from its own entrypoint', () => {
        expect(getDefaultSceneRuntimeProfile().id).toBe(DEFAULT_SCENE_RUNTIME_PROFILE_ID);
        expect(fullSceneRuntimeProfile().id).toBe(DEFAULT_SCENE_RUNTIME_PROFILE_ID);
    });
});
