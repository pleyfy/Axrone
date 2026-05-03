import { Vec3, Vec4 } from '@axrone/numeric';

export const DEFAULT_SCENE_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
export const DEFAULT_SCENE_AMBIENT_LIGHT = new Vec3(0.08, 0.08, 0.1);
export const DEFAULT_SCENE_SKY_LIGHT = new Vec3(0.08, 0.09, 0.11);
export const DEFAULT_SCENE_GROUND_LIGHT = new Vec3(0.04, 0.04, 0.045);
export const DEFAULT_SCENE_WIDTH = 1280;
export const DEFAULT_SCENE_HEIGHT = 720;
export const DEFAULT_SCENE_RENDER_PASS_ID = 'main';

export const resolveSceneClearColor = (
    value?: Vec4 | readonly [number, number, number, number] | null,
    fallback: Vec4 = DEFAULT_SCENE_CLEAR_COLOR
): Vec4 => {
    if (value instanceof Vec4) {
        return Vec4.from(value);
    }

    if (Array.isArray(value) && value.length === 4) {
        return Vec4.fromArray(value);
    }

    return Vec4.from(fallback);
};

export const resolveSceneAmbientLight = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_SCENE_AMBIENT_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return Vec3.from(fallback);
};

export const resolveSceneSkyLight = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_SCENE_SKY_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return Vec3.from(fallback);
};

export const resolveSceneGroundLight = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_SCENE_GROUND_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return Vec3.from(fallback);
};
