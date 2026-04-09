import { get3DSceneRuntimeProfile } from './scene/profile';

export type { SceneRuntimeProfile } from './scene/profile';
export {
    SCENE_3D_RUNTIME_PROFILE_ID,
    get3DSceneRuntimeProfile,
} from './scene/profile';

export const scene3DRuntimeProfile = get3DSceneRuntimeProfile;
