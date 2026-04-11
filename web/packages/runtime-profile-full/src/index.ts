import { getDefaultSceneRuntimeProfile } from '@axrone/scene-3d';
import { RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES } from '@axrone/runtime-profile-2d';
import { RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES } from '@axrone/runtime-profile-3d';

export type { SceneRuntimeProfile } from '@axrone/scene-3d';
export {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    getDefaultSceneRuntimeProfile,
} from '@axrone/scene-3d';

export const RUNTIME_PROFILE_FULL_CAPABILITY_PACKAGES = Object.freeze([
    ...new Set([
        ...RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES,
        ...RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES,
    ]),
]) as readonly string[];

export const fullSceneRuntimeProfile = getDefaultSceneRuntimeProfile;