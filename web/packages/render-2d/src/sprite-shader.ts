import {
    compileRenderShaderEffect,
    type RenderShaderEffectDefinition,
} from '@axrone/render-core';

export const RENDER_2D_DEFAULT_SPRITE_SHADER_ID = 'Render2D/Sprite';

export const RENDER_2D_SPRITE_ATTRIBUTE_NAMES = Object.freeze({
    position: 'a_Position',
    uv0: 'a_UV0',
    color0: 'a_Color0',
} as const);

export const RENDER_2D_SPRITE_EFFECT = {
    format: 'axrone.shader/effect',
    version: 1,
    id: RENDER_2D_DEFAULT_SPRITE_SHADER_ID,
    attributes: [
        {
            name: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.position,
            type: 'vec3',
            location: 0,
        },
        {
            name: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.uv0,
            type: 'vec2',
            location: 2,
        },
        {
            name: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.color0,
            type: 'vec4',
            location: 3,
        },
    ],
    varyings: [
        { name: 'v_UV0', type: 'vec2' },
        { name: 'v_Color0', type: 'vec4' },
        { name: 'v_WorldPosition', type: 'vec3' },
    ],
    properties: [
        {
            name: 'u_ViewProjection',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'camera',
        },
        {
            name: 'u_MainTex',
            type: 'sampler2D',
            stages: ['fragment'],
            scope: 'material',
            inspector: {
                label: 'Main Texture',
                group: 'Surface',
                control: 'texture',
            },
        },
        {
            name: 'u_MaskShape',
            type: 'int',
            stages: ['fragment'],
            scope: 'internal',
            inspector: { hidden: true },
        },
        {
            name: 'u_MaskWorldToLocal',
            type: 'mat4',
            stages: ['fragment'],
            scope: 'internal',
            inspector: { hidden: true },
        },
        {
            name: 'u_MaskSize',
            type: 'vec2',
            stages: ['fragment'],
            scope: 'internal',
            inspector: { hidden: true },
        },
        {
            name: 'u_MaskAnchor',
            type: 'vec2',
            stages: ['fragment'],
            scope: 'internal',
            inspector: { hidden: true },
        },
        {
            name: 'u_MaskCornerRadius',
            type: 'float',
            stages: ['fragment'],
            scope: 'internal',
            inspector: { hidden: true },
        },
    ],
    libraries: [
        {
            id: 'sprite.mask',
            code: [
                'float evaluateMaskCircle(vec2 localPosition, vec2 maskSize, vec2 maskAnchor) {',
                '    vec2 maskMin = -maskAnchor * maskSize;',
                '    vec2 maskCenter = maskMin + maskSize * 0.5;',
                '    vec2 radius = max(maskSize * 0.5, vec2(0.000001));',
                '    vec2 normalized = (localPosition - maskCenter) / radius;',
                '    return step(length(normalized), 1.0);',
                '}',
                '',
                'float evaluateMaskRoundedRect(vec2 localPosition, vec2 maskSize, vec2 maskAnchor, float cornerRadius) {',
                '    vec2 maskMin = -maskAnchor * maskSize;',
                '    vec2 maskCenter = maskMin + maskSize * 0.5;',
                '    vec2 halfSize = maskSize * 0.5;',
                '    float radius = clamp(cornerRadius, 0.0, min(halfSize.x, halfSize.y));',
                '    vec2 local = abs(localPosition - maskCenter);',
                '    vec2 inner = max(halfSize - vec2(radius), vec2(0.0));',
                '    vec2 delta = local - inner;',
                '    vec2 maxDelta = max(delta, vec2(0.0));',
                '    float outsideDistance = length(maxDelta) + min(max(delta.x, delta.y), 0.0) - radius;',
                '    return step(outsideDistance, 0.0);',
                '}',
                '',
                'float evaluateMask(vec3 worldPosition) {',
                '    if (u_MaskShape == 0) {',
                '        return 1.0;',
                '    }',
                '',
                '    vec2 localPosition = (u_MaskWorldToLocal * vec4(worldPosition, 1.0)).xy;',
                '',
                '    if (u_MaskShape == 1) {',
                '        return evaluateMaskCircle(localPosition, u_MaskSize, u_MaskAnchor);',
                '    }',
                '',
                '    if (u_MaskShape == 2) {',
                '        return evaluateMaskRoundedRect(localPosition, u_MaskSize, u_MaskAnchor, u_MaskCornerRadius);',
                '    }',
                '',
                '    return 1.0;',
                '}',
            ],
        },
    ],
    vertex: {
        main: [
            'v_UV0 = a_UV0;',
            'v_Color0 = a_Color0;',
            'v_WorldPosition = a_Position;',
            'gl_Position = u_ViewProjection * vec4(a_Position, 1.0);',
        ],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        includes: ['sprite.mask'],
        main: [
            'float mask = evaluateMask(v_WorldPosition);',
            'if (mask <= 0.0) {',
            '    discard;',
            '}',
            '',
            'o_Color = texture(u_MainTex, v_UV0) * v_Color0;',
        ],
    },
    renderState: {
        depthTest: false,
        cull: false,
        blend: true,
    },
} as const satisfies RenderShaderEffectDefinition;

const COMPILED_RENDER_2D_SPRITE_EFFECT = compileRenderShaderEffect(RENDER_2D_SPRITE_EFFECT);

export const RENDER_2D_SPRITE_UNIFORM_NAMES = Object.freeze([
    ...COMPILED_RENDER_2D_SPRITE_EFFECT.uniformNames,
]);

export const RENDER_2D_SPRITE_VERTEX_STRIDE = 24;
export const RENDER_2D_SPRITE_FLOAT_STRIDE =
    RENDER_2D_SPRITE_VERTEX_STRIDE / Float32Array.BYTES_PER_ELEMENT;
export const RENDER_2D_SPRITE_VERTICES_PER_QUAD = 4;
export const RENDER_2D_SPRITE_INDICES_PER_QUAD = 6;

export const RENDER_2D_SPRITE_VERTEX_SOURCE = COMPILED_RENDER_2D_SPRITE_EFFECT.vertexSource;

export const RENDER_2D_SPRITE_FRAGMENT_SOURCE = COMPILED_RENDER_2D_SPRITE_EFFECT.fragmentSource;