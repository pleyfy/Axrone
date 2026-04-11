import { Vec3, Vec4 } from '@axrone/numeric';

export const DEFAULT_SCENE_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
export const DEFAULT_SCENE_AMBIENT_LIGHT = new Vec3(0.08, 0.08, 0.1);
export const DEFAULT_SCENE_WIDTH = 1280;
export const DEFAULT_SCENE_HEIGHT = 720;
export const DEFAULT_SCENE_RENDER_PASS_ID = 'main';

export const resolveSceneClearColor = (
    value?: Vec4 | readonly [number, number, number, number] | null,
    fallback: Vec4 = DEFAULT_SCENE_CLEAR_COLOR
): Vec4 => {
    if (value instanceof Vec4) {
        return new Vec4(value.x, value.y, value.z, value.w);
    }

    if (Array.isArray(value) && value.length === 4) {
        return new Vec4(value[0], value[1], value[2], value[3]);
    }

    return new Vec4(fallback.x, fallback.y, fallback.z, fallback.w);
};

export const resolveSceneAmbientLight = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_SCENE_AMBIENT_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    if (Array.isArray(value) && value.length === 3) {
        return new Vec3(value[0], value[1], value[2]);
    }

    return new Vec3(fallback.x, fallback.y, fallback.z);
};