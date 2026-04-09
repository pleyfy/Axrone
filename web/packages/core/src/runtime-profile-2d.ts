import { get2DSceneRuntimeProfile } from './scene/profile';

export type { SceneRuntimeProfile } from './scene/profile';
export {
    SCENE_2D_RUNTIME_PROFILE_ID,
    get2DSceneRuntimeProfile,
} from './scene/profile';

export const scene2DRuntimeProfile = get2DSceneRuntimeProfile;