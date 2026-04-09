import { getDefaultSceneRuntimeProfile } from './scene/profile';

export type { SceneRuntimeProfile } from './scene/profile';
export {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    getDefaultSceneRuntimeProfile,
} from './scene/profile';

export const fullSceneRuntimeProfile = getDefaultSceneRuntimeProfile;
