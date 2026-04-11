import type { SceneMeshSemantic } from './types';

export const DEFAULT_SCENE_ATTRIBUTE_NAMES: Readonly<Record<SceneMeshSemantic, string>> =
    Object.freeze({
        position: 'a_Position',
        normal: 'a_Normal',
        uv0: 'a_UV0',
        uv1: 'a_UV1',
        tangent: 'a_Tangent',
        color0: 'a_Color0',
        joints0: 'a_Joints0',
        weights0: 'a_Weights0',
    });

export const SCENE_ATTRIBUTE_LOCATIONS: Readonly<Record<SceneMeshSemantic, number>> =
    Object.freeze({
        position: 0,
        normal: 1,
        uv0: 2,
        color0: 3,
        tangent: 4,
        uv1: 5,
        joints0: 9,
        weights0: 10,
    });
