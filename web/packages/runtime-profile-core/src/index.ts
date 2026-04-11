import { getCoreSceneRuntimeProfile } from '@axrone/scene-runtime';
import { INPUT_CORE_CAPABILITY_PACKAGE } from '@axrone/input-core';

export type { SceneRuntimeProfile } from '@axrone/scene-runtime';
export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    getCoreSceneRuntimeProfile,
} from '@axrone/scene-runtime';

export const RUNTIME_PROFILE_CORE_CAPABILITY_PACKAGES = Object.freeze([
    '@axrone/scene-runtime',
    INPUT_CORE_CAPABILITY_PACKAGE,
]) as readonly string[];

export const coreSceneRuntimeProfile = getCoreSceneRuntimeProfile;