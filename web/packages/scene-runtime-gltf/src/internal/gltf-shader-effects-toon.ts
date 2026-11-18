import type {
    RenderShaderEffectDefinition,
    RenderShaderEffectRenderStateDefinition,
    RenderShaderPropertyDefinition,
    RenderShaderStageDefinition,
} from '@axrone/scene-runtime';
import { GLTF_SHADER_LIBRARIES } from './gltf-shader-libraries';
import {
    GLTF_LIGHTING_UNIFORMS,
    HIDDEN_INSPECTOR,
    MAX_GLTF_DIRECTIONAL_LIGHTS,
    MAX_GLTF_POINT_LIGHTS,
    createLightingProperties,
    createSharedAlphaProperties,
    createSharedObjectProperties,
    createSurfaceTextureProperties,
} from './gltf-shader-properties';

const GLTF_SHADER_TOON_ID = 'gltf/toon';
const GLTF_SHADER_TOON_OUTLINE_ID = 'gltf/toon-outline';

const OUTLINE_WIDTH_INSPECTOR = Object.freeze({
    label: 'Outline Width',
    group: 'Toon',
    control: 'slider',
    min: 0,
    max: 5,
    step: 0.1,
} as const);

const OUTLINE_COLOR_INSPECTOR = Object.freeze({
    label: 'Outline Color',
    group: 'Toon',
    control: 'color',
} as const);

const createOutlineWidthProperty = (): RenderShaderPropertyDefinition => ({
    name: '_OutlineWidth',
    type: 'float',
    stages: ['vertex', 'fragment'],
    scope: 'material',
    defaultValue: 0,
    inspector: OUTLINE_WIDTH_INSPECTOR,
});

const createOutlineColorProperty = (): RenderShaderPropertyDefinition => ({
    name: '_OutlineColor',
    type: 'vec3',
    stages: ['fragment'],
    scope: 'material',
    defaultValue: [0, 0, 0],
    inspector: OUTLINE_COLOR_INSPECTOR,
});

const createVertexOffsetProperty = (): RenderShaderPropertyDefinition => ({
    name: '_VertexOffset',
    type: 'vec3',
    stages: ['vertex'],
    scope: 'material',
    defaultValue: [0, 0, 0],
    inspector: HIDDEN_INSPECTOR,
});

const TOON_SKIN_BLOCK_LINES = [
    'if (u_Skinning && u_SkinJointCount > 0) {',
    '    mat4 skin = resolveSkinMatrix();',
    '    localPosition = skin * localPosition;',
    '    localNormal = mat3(skin) * localNormal;',
    '}',
];

const VERTEX_OFFSET_GUARD_LINES = [
    'if (any(greaterThan(abs(_VertexOffset), vec3(0.0)))) {',
    '    localPosition += vec4(_VertexOffset, 0.0);',
    '}',
];

const GLTF_TOON_MAIN_VERTEX_LINES = [
    'v_UV0 = a_UV0;',
    'v_UV1 = a_UV1;',
    'vec4 localPosition = vec4(a_Position, 1.0);',
    'vec3 localNormal = a_Normal;',
    ...TOON_SKIN_BLOCK_LINES,
    ...VERTEX_OFFSET_GUARD_LINES,
    'vec4 worldPosition = u_Model * localPosition;',
    'v_WorldPosition = worldPosition.xyz;',
    'v_WorldNormal = normalize(transpose(inverse(mat3(u_Model))) * localNormal);',
    'v_WorldTangent = vec4(normalize(transpose(inverse(mat3(u_Model))) * a_Tangent.xyz), a_Tangent.w);',
    'gl_Position = u_Projection * u_View * worldPosition;',
];

const GLTF_TOON_MAIN_FRAGMENT_LINES = [
    'vec4 baseColor = _BaseColorFactor;',
    'if (_BaseColorTexture_TexCoord >= 0) {',
    '    vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);',
    '    baseColor *= texture(_BaseColorTexture, uv);',
    '}',
    'int alphaMode = int(_AlphaMode + 0.5);',
    'if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {',
    '    discard;',
    '}',
    '',
    'vec3 normal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);',
    'vec3 viewDir = normalize(u_CameraPosition - v_WorldPosition);',
    '',
    'float NdotV = max(dot(normal, viewDir), 0.0);',
    'float rim = 1.0 - NdotV;',
    'float rimFactor = smoothstep(_RimThreshold - _RimSmoothness, _RimThreshold + _RimSmoothness, rim);',
    '',
    'vec3 lighting = vec3(0.0);',
    'if (u_ReceiveLighting) {',
    `    for (int index = 0; index < ${MAX_GLTF_DIRECTIONAL_LIGHTS}; index += 1) {`,
    `        if (index >= ${GLTF_LIGHTING_UNIFORMS.directionalLightCount}) break;`,
    `        vec3 lightDir = normalize(-${GLTF_LIGHTING_UNIFORMS.directionalLightDirection}[index]);`,
    `        vec3 lightColor = ${GLTF_LIGHTING_UNIFORMS.directionalLightColor}[index];`,
    `        float intensity = ${GLTF_LIGHTING_UNIFORMS.directionalLightIntensity}[index];`,
    '        float NdotL = max(dot(normal, lightDir), 0.0);',
    '        float toonShade = smoothstep(_ShadowThreshold - _ShadowSmoothness, _ShadowThreshold + _ShadowSmoothness, NdotL);',
    '        vec3 shadowedColor = mix(_ShadowColor * baseColor.rgb, baseColor.rgb, toonShade);',
    '        vec3 halfDir = normalize(viewDir + lightDir);',
    '        float NdotH = max(dot(normal, halfDir), 0.0);',
    '        float highlight = smoothstep(_HighlightThreshold - 0.05, _HighlightThreshold + 0.05, NdotH);',
    '        shadowedColor = mix(shadowedColor, _HighlightColor, highlight * toonShade);',
    '        shadowedColor = mix(shadowedColor, _RimColor, rimFactor * 0.5);',
    '        lighting += shadowedColor * lightColor * intensity;',
    '    }',
    `    for (int index = 0; index < ${MAX_GLTF_POINT_LIGHTS}; index += 1) {`,
    `        if (index >= ${GLTF_LIGHTING_UNIFORMS.pointLightCount}) break;`,
    `        vec3 toLight = ${GLTF_LIGHTING_UNIFORMS.pointLightPosition}[index] - v_WorldPosition;`,
    '        float dist = length(toLight);',
    '        vec3 lightDir = dist > 0.0 ? toLight / dist : vec3(0.0, 1.0, 0.0);',
    `        float atten = rangeAttenuation(dist, ${GLTF_LIGHTING_UNIFORMS.pointLightRange}[index], ${GLTF_LIGHTING_UNIFORMS.pointLightAttenuation}[index]);`,
    `        vec3 lightColor = ${GLTF_LIGHTING_UNIFORMS.pointLightColor}[index];`,
    `        float intensity = ${GLTF_LIGHTING_UNIFORMS.pointLightIntensity}[index] * atten;`,
    '        float NdotL = max(dot(normal, lightDir), 0.0);',
    '        float toonShade = smoothstep(_ShadowThreshold - _ShadowSmoothness, _ShadowThreshold + _ShadowSmoothness, NdotL);',
    '        lighting += mix(_ShadowColor * baseColor.rgb, baseColor.rgb, toonShade) * lightColor * intensity;',
    '    }',
    '} else {',
    '    lighting = baseColor.rgb;',
    '}',
    '',
    'vec3 emissive = _EmissiveFactor;',
    'if (_EmissiveTexture_TexCoord >= 0) {',
    '    vec2 uv = transformUV(selectUV(_EmissiveTexture_TexCoord), _EmissiveTexture_ST, _EmissiveTexture_Rotation);',
    '    emissive *= texture(_EmissiveTexture, uv).rgb;',
    '}',
    '',
    'float alpha = alphaMode == 2 ? baseColor.a : 1.0;',
    'o_Color = vec4(linearToSrgb(lighting + emissive), alpha);',
];

const GLTF_TOON_MAIN_VERTEX_STAGE: RenderShaderStageDefinition = {
    includes: ['gltf.skinning'],
    main: GLTF_TOON_MAIN_VERTEX_LINES,
};

const GLTF_TOON_MAIN_FRAGMENT_STAGE: RenderShaderStageDefinition = {
    precision: 'mediump',
    outputs: [{ name: 'o_Color', type: 'vec4' }],
    includes: ['gltf.uv', 'gltf.pbr-lighting', 'gltf.color-space'],
    main: GLTF_TOON_MAIN_FRAGMENT_LINES,
};

const GLTF_TOON_MAIN_RENDER_STATE: RenderShaderEffectRenderStateDefinition = {
    depthTest: true,
    cull: true,
    blend: false,
};

export const GLTF_TOON_OUTLINE_VERTEX_STAGE: RenderShaderStageDefinition = {
    includes: ['gltf.skinning'],
    main: [
        'v_UV0 = a_UV0;',
        'v_UV1 = a_UV1;',
        'vec4 localPosition = vec4(a_Position, 1.0);',
        'vec3 localNormal = a_Normal;',
        ...TOON_SKIN_BLOCK_LINES,
        ...VERTEX_OFFSET_GUARD_LINES,
        'if (_OutlineWidth > 0.0) {',
        '    vec3 extrudeDirection = length(localNormal) > 0.0001 ? normalize(localNormal) : vec3(0.0);',
        '    localPosition += vec4(extrudeDirection * (_OutlineWidth * 0.01), 0.0);',
        '}',
        'vec4 worldPosition = u_Model * localPosition;',
        'v_WorldPosition = worldPosition.xyz;',
        'v_WorldNormal = normalize(transpose(inverse(mat3(u_Model))) * localNormal);',
        'gl_Position = u_Projection * u_View * worldPosition;',
    ],
};

export const GLTF_TOON_OUTLINE_FRAGMENT_STAGE: RenderShaderStageDefinition = {
    precision: 'mediump',
    outputs: [{ name: 'o_Color', type: 'vec4' }],
    includes: ['gltf.uv', 'gltf.color-space'],
    main: [
        'if (_OutlineWidth <= 0.0) {',
        '    discard;',
        '}',
        'vec4 baseColor = _BaseColorFactor;',
        'if (_BaseColorTexture_TexCoord >= 0) {',
        '    vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);',
        '    baseColor *= texture(_BaseColorTexture, uv);',
        '}',
        'int alphaMode = int(_AlphaMode + 0.5);',
        'if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {',
        '    discard;',
        '}',
        'float alpha = alphaMode == 2 ? baseColor.a : 1.0;',
        'o_Color = vec4(linearToSrgb(_OutlineColor), alpha);',
    ],
};

export const GLTF_TOON_OUTLINE_RENDER_STATE: RenderShaderEffectRenderStateDefinition = {
    depthTest: true,
    depthWrite: true,
    cull: true,
    cullMode: 'front',
    blend: false,
};

export const createGltfToonShaderEffect = (id: string): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id,
    attributes: [
        { name: 'a_Position', type: 'vec3', location: 0 },
        { name: 'a_Normal', type: 'vec3', location: 1 },
        { name: 'a_UV0', type: 'vec2', location: 2 },
        { name: 'a_Tangent', type: 'vec4', location: 4 },
        { name: 'a_UV1', type: 'vec2', location: 5 },
        { name: 'a_Joints0', type: 'uvec4', location: 9 },
        { name: 'a_Weights0', type: 'vec4', location: 10 },
    ],
    varyings: [
        { name: 'v_UV0', type: 'vec2' },
        { name: 'v_UV1', type: 'vec2' },
        { name: 'v_WorldPosition', type: 'vec3' },
        { name: 'v_WorldNormal', type: 'vec3' },
        { name: 'v_WorldTangent', type: 'vec4' },
    ],
    properties: [
        ...createSharedObjectProperties(),
        {
            name: 'u_ReceiveLighting',
            type: 'bool',
            stages: ['fragment'],
            scope: 'system',
            inspector: HIDDEN_INSPECTOR,
        },
        ...createLightingProperties(),
        {
            name: 'u_CameraPosition',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'camera',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: '_BaseColorFactor',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 1, 1],
            inspector: { label: 'Base Color', group: 'Surface', control: 'color' },
        },
        ...createSurfaceTextureProperties('_BaseColorTexture', 'Base Color Map', 'Maps'),
        {
            name: '_ShadowColor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [0.2, 0.2, 0.3],
            inspector: { label: 'Shadow Color', group: 'Toon', control: 'color' },
        },
        {
            name: '_ShadowThreshold',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0.5,
            inspector: { label: 'Shadow Threshold', group: 'Toon', control: 'slider', min: 0, max: 1, step: 0.01 },
        },
        {
            name: '_ShadowSmoothness',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0.05,
            inspector: { label: 'Shadow Smoothness', group: 'Toon', control: 'slider', min: 0, max: 0.5, step: 0.01 },
        },
        {
            name: '_HighlightThreshold',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0.8,
            inspector: { label: 'Highlight Threshold', group: 'Toon', control: 'slider', min: 0, max: 1, step: 0.01 },
        },
        {
            name: '_HighlightColor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 1],
            inspector: { label: 'Highlight Color', group: 'Toon', control: 'color' },
        },
        {
            name: '_RimColor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [0.8, 0.9, 1.0],
            inspector: { label: 'Rim Color', group: 'Toon', control: 'color' },
        },
        {
            name: '_RimThreshold',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0.6,
            inspector: { label: 'Rim Threshold', group: 'Toon', control: 'slider', min: 0, max: 1, step: 0.01 },
        },
        {
            name: '_RimSmoothness',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0.1,
            inspector: { label: 'Rim Smoothness', group: 'Toon', control: 'slider', min: 0, max: 0.5, step: 0.01 },
        },
        {
            name: '_OutlineWidth',
            type: 'float',
            stages: ['vertex', 'fragment'],
            scope: 'material',
            defaultValue: 0,
            inspector: OUTLINE_WIDTH_INSPECTOR,
        },
        {
            name: '_OutlineColor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [0, 0, 0],
            inspector: OUTLINE_COLOR_INSPECTOR,
        },
        {
            name: '_VertexOffset',
            type: 'vec3',
            stages: ['vertex'],
            scope: 'material',
            defaultValue: [0, 0, 0],
            inspector: HIDDEN_INSPECTOR,
        },
        ...createSharedAlphaProperties(),
    ],
    libraries: GLTF_SHADER_LIBRARIES,
    vertex: GLTF_TOON_MAIN_VERTEX_STAGE,
    fragment: GLTF_TOON_MAIN_FRAGMENT_STAGE,
    renderState: GLTF_TOON_MAIN_RENDER_STATE,
    techniques: [
        {
            id: 'default',
            passes: [
                {
                    id: 'main',
                    vertex: GLTF_TOON_MAIN_VERTEX_STAGE,
                    fragment: GLTF_TOON_MAIN_FRAGMENT_STAGE,
                    renderState: GLTF_TOON_MAIN_RENDER_STATE,
                },
                {
                    id: 'outline',
                    vertex: GLTF_TOON_OUTLINE_VERTEX_STAGE,
                    fragment: GLTF_TOON_OUTLINE_FRAGMENT_STAGE,
                    renderState: GLTF_TOON_OUTLINE_RENDER_STATE,
                },
            ],
        },
    ],
});

export const createGltfToonOutlineShaderEffect = (id: string): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id,
    attributes: [
        { name: 'a_Position', type: 'vec3', location: 0 },
        { name: 'a_Normal', type: 'vec3', location: 1 },
        { name: 'a_UV0', type: 'vec2', location: 2 },
        { name: 'a_UV1', type: 'vec2', location: 5 },
        { name: 'a_Joints0', type: 'uvec4', location: 9 },
        { name: 'a_Weights0', type: 'vec4', location: 10 },
    ],
    varyings: [
        { name: 'v_UV0', type: 'vec2' },
        { name: 'v_UV1', type: 'vec2' },
        { name: 'v_WorldPosition', type: 'vec3' },
        { name: 'v_WorldNormal', type: 'vec3' },
    ],
    properties: [
        ...createSharedObjectProperties(),
        {
            name: '_BaseColorFactor',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 1, 1],
            inspector: { label: 'Base Color', group: 'Surface', control: 'color' },
        },
        ...createSurfaceTextureProperties('_BaseColorTexture', 'Base Color Map', 'Maps'),
        createOutlineWidthProperty(),
        createOutlineColorProperty(),
        createVertexOffsetProperty(),
        ...createSharedAlphaProperties(),
    ],
    libraries: GLTF_SHADER_LIBRARIES,
    vertex: GLTF_TOON_OUTLINE_VERTEX_STAGE,
    fragment: GLTF_TOON_OUTLINE_FRAGMENT_STAGE,
    renderState: GLTF_TOON_OUTLINE_RENDER_STATE,
});

export const GLTF_TOON_SHADER_EFFECT = createGltfToonShaderEffect(GLTF_SHADER_TOON_ID);
export const GLTF_TOON_OUTLINE_SHADER_EFFECT = createGltfToonOutlineShaderEffect(
    GLTF_SHADER_TOON_OUTLINE_ID
);
