import { getCoreSceneRuntimeProfile } from './scene/profile';

export type { SceneRuntimeProfile } from './scene/profile';
export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    getCoreSceneRuntimeProfile,
} from './scene/profile';

export const coreSceneRuntimeProfile = getCoreSceneRuntimeProfile;
