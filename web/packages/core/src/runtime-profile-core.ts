import { getCoreSceneRuntimeProfile } from './scene-runtime-profile';

export type { SceneRuntimeProfile } from './scene/profile';
export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    getCoreSceneRuntimeProfile,
} from './scene-runtime-profile';

export const coreSceneRuntimeProfile = getCoreSceneRuntimeProfile;
