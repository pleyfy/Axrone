import { get2DSceneRuntimeProfile } from '@axrone/scene-2d';
import { ASSET_2D_CAPABILITY_PACKAGE } from '@axrone/asset-2d';
import { INPUT_CORE_CAPABILITY_PACKAGE } from '@axrone/input-core';
import { RENDER_2D_CAPABILITY_PACKAGE } from '@axrone/render-2d';

export type { SceneRuntimeProfile } from '@axrone/scene-2d';
export {
    SCENE_2D_RUNTIME_PROFILE_ID,
    get2DSceneRuntimeProfile,
} from '@axrone/scene-2d';

export const RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES = Object.freeze([
    '@axrone/scene-runtime',
    '@axrone/scene-2d',
    INPUT_CORE_CAPABILITY_PACKAGE,
    ASSET_2D_CAPABILITY_PACKAGE,
    RENDER_2D_CAPABILITY_PACKAGE,
    '@axrone/physics-core',
    '@axrone/physics-2d',
]) as readonly string[];

export const scene2DRuntimeProfile = get2DSceneRuntimeProfile;