import {
    createSceneShaderDefinitionFromEffect,
    type RenderShaderEffectDefinition,
    type SceneShaderDefinition,
} from '@axrone/scene-runtime';

const UNLIT_COLOR_SHADER_EFFECT = {
    format: 'axrone.shader/effect',
    version: 1,
    id: 'Scene/UnlitColor',
    attributes: [{ name: 'a_Position', type: 'vec3', location: 0 }],
    properties: [
        {
            name: 'u_Model',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'object',
        },
        {
            name: 'u_View',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'camera',
        },
        {
            name: 'u_Projection',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'camera',
        },
        {
            name: 'u_Color',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            inspector: {
                label: 'Color',
                group: 'Surface',
                control: 'color',
            },
        },
    ],
    vertex: {
        main: ['gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);'],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        main: ['o_Color = u_Color;'],
    },
    renderState: {
        depthTest: true,
        cull: true,
        blend: false,
    },
} as const satisfies RenderShaderEffectDefinition;

export const createUnlitColorShaderDefinition = (
    id: string = 'Scene/UnlitColor'
): SceneShaderDefinition =>
    createSceneShaderDefinitionFromEffect(
        {
            ...UNLIT_COLOR_SHADER_EFFECT,
            id,
        },
        {
            attributes: {
                position: 'a_Position',
            },
        }
    );
