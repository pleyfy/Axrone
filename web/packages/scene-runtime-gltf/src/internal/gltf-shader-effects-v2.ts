import type {
    RenderShaderEffectDefinition,
    RenderShaderEffectRenderStateDefinition,
    RenderShaderPropertyDefinition,
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

const STANDARD_ATTRIBUTES = [
    { name: 'a_Position', type: 'vec3', location: 0 },
    { name: 'a_Normal', type: 'vec3', location: 1 },
    { name: 'a_UV0', type: 'vec2', location: 2 },
    { name: 'a_Tangent', type: 'vec4', location: 4 },
    { name: 'a_UV1', type: 'vec2', location: 5 },
    { name: 'a_Joints0', type: 'uvec4', location: 9 },
    { name: 'a_Weights0', type: 'vec4', location: 10 },
] as const;

const STANDARD_VARYINGS = [
    { name: 'v_UV0', type: 'vec2' },
    { name: 'v_UV1', type: 'vec2' },
    { name: 'v_WorldPosition', type: 'vec3' },
    { name: 'v_WorldNormal', type: 'vec3' },
    { name: 'v_WorldTangent', type: 'vec4' },
] as const;

const floatProp = (
    name: string,
    defaultValue: number,
    stages: ('vertex' | 'fragment')[] = ['fragment']
): RenderShaderPropertyDefinition => ({
    name,
    type: 'float',
    stages,
    scope: 'material',
    defaultValue,
    inspector: HIDDEN_INSPECTOR,
});

const vec2Prop = (
    name: string,
    defaultValue: [number, number],
    stages: ('vertex' | 'fragment')[] = ['fragment']
): RenderShaderPropertyDefinition => ({
    name,
    type: 'vec2',
    stages,
    scope: 'material',
    defaultValue,
    inspector: HIDDEN_INSPECTOR,
});

const vec3Prop = (
    name: string,
    defaultValue: [number, number, number],
    stages: ('vertex' | 'fragment')[] = ['fragment']
): RenderShaderPropertyDefinition => ({
    name,
    type: 'vec3',
    stages,
    scope: 'material',
    defaultValue,
    inspector: HIDDEN_INSPECTOR,
});

const vec4Prop = (
    name: string,
    defaultValue: [number, number, number, number],
    stages: ('vertex' | 'fragment')[] = ['fragment']
): RenderShaderPropertyDefinition => ({
    name,
    type: 'vec4',
    stages,
    scope: 'material',
    defaultValue,
    inspector: HIDDEN_INSPECTOR,
});

const cameraAndSystemProperties = (): readonly RenderShaderPropertyDefinition[] => [
    { name: 'u_CameraPosition', type: 'vec3', stages: ['fragment'], scope: 'camera', inspector: HIDDEN_INSPECTOR },
    { name: 'u_ReceiveLighting', type: 'bool', stages: ['fragment'], scope: 'system', defaultValue: true, inspector: HIDDEN_INSPECTOR },
    { name: 'u_Time', type: 'float', stages: ['vertex', 'fragment'], scope: 'frame', defaultValue: 0, inspector: HIDDEN_INSPECTOR },
    { name: 'u_FogEnabled', type: 'int', stages: ['fragment'], scope: 'system', defaultValue: 0, inspector: HIDDEN_INSPECTOR },
    { name: 'u_FogColor', type: 'vec3', stages: ['fragment'], scope: 'system', defaultValue: [0.5, 0.5, 0.5], inspector: HIDDEN_INSPECTOR },
    { name: 'u_FogMode', type: 'int', stages: ['fragment'], scope: 'system', defaultValue: 0, inspector: HIDDEN_INSPECTOR },
    { name: 'u_FogDensity', type: 'float', stages: ['fragment'], scope: 'system', defaultValue: 0.015, inspector: HIDDEN_INSPECTOR },
    { name: 'u_FogStartEnd', type: 'vec2', stages: ['fragment'], scope: 'system', defaultValue: [0, 300], inspector: HIDDEN_INSPECTOR },
];

const commonSurfaceProperties = (): readonly RenderShaderPropertyDefinition[] => [
    ...createSharedObjectProperties(),
    ...cameraAndSystemProperties(),
    ...createLightingProperties(),
    vec4Prop('_BaseColorFactor', [1, 1, 1, 1]),
    ...createSurfaceTextureProperties('_BaseColorTexture', 'Base Color Map', 'Maps'),
    ...createSurfaceTextureProperties('_NormalTexture', 'Normal Map', 'Maps', {
        scale: { label: 'Normal Scale', min: 0, max: 2, step: 0.01, defaultValue: 1 },
    }),
    ...createSurfaceTextureProperties('_OpacityTexture', 'Opacity Map', 'Maps'),
    vec3Prop('_EmissiveFactor', [0, 0, 0]),
    ...createSurfaceTextureProperties('_EmissiveTexture', 'Emissive Map', 'Emission'),
    floatProp('_OcclusionFactor', 1),
    floatProp('_OpacityFactor', 1),
    floatProp('_EmissiveIntensity', 1),
    floatProp('_RoughnessFactor', 0.5),
    floatProp('_MetallicFactor', 0),
    floatProp('_DepthOffset', 0),
    vec3Prop('_VertexOffset', [0, 0, 0], ['vertex']),
    ...createSharedAlphaProperties(),
];

const standardVertexMain = (extraLines: readonly string[] = []): readonly string[] => [
    'v_UV0 = a_UV0;',
    'v_UV1 = a_UV1;',
    'vec4 localPosition = vec4(a_Position + _VertexOffset, 1.0);',
    'vec3 localNormal = a_Normal;',
    'if (u_Skinning && u_SkinJointCount > 0) {',
    '    mat4 skinMatrix = resolveSkinMatrix();',
    '    localPosition = skinMatrix * localPosition;',
    '    localNormal = mat3(skinMatrix) * localNormal;',
    '}',
    ...extraLines,
    'vec4 worldPosition = u_Model * localPosition;',
    'v_WorldPosition = worldPosition.xyz;',
    'v_WorldNormal = normalize(transpose(inverse(mat3(u_Model))) * localNormal);',
    'v_WorldTangent = vec4(normalize(transpose(inverse(mat3(u_Model))) * a_Tangent.xyz), a_Tangent.w);',
    'gl_Position = u_Projection * u_View * worldPosition;',
];

const sampleBaseColorBlock = (applyOpacityFactor = true): readonly string[] => [
    'vec4 baseColor = _BaseColorFactor;',
    ...(applyOpacityFactor ? ['baseColor.a *= clamp(_OpacityFactor, 0.0, 1.0);'] : []),
    'if (_BaseColorTexture_TexCoord >= 0) {',
    '    vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);',
    '    baseColor *= texture(_BaseColorTexture, uv);',
    '}',
    'if (_OpacityTexture_TexCoord >= 0) {',
    '    vec2 uv = transformUV(selectUV(_OpacityTexture_TexCoord), _OpacityTexture_ST, _OpacityTexture_Rotation);',
    '    baseColor.a *= texture(_OpacityTexture, uv).r;',
    '}',
    'int alphaMode = int(_AlphaMode + 0.5);',
    'if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {',
    '    discard;',
    '}',
];

const buildEffect = (
    id: string,
    extraProperties: readonly RenderShaderPropertyDefinition[],
    vertexMain: readonly string[],
    fragmentMain: readonly string[],
    renderState: RenderShaderEffectRenderStateDefinition,
    includes: readonly string[] = ['gltf.uv', 'gltf.pbr-lighting', 'gltf.color-space', 'gltf.fog']
): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id,
    attributes: [...STANDARD_ATTRIBUTES],
    varyings: [...STANDARD_VARYINGS],
    properties: [...commonSurfaceProperties(), ...extraProperties],
    libraries: GLTF_SHADER_LIBRARIES,
    vertex: {
        includes: ['gltf.skinning'],
        main: [...vertexMain],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        includes: [...includes],
        main: [...fragmentMain],
    },
    renderState,
});

export const createGltfHairShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            floatProp('_HairSpecularShift', 0.12),
            floatProp('_HairSecondaryShift', -0.08),
            vec3Prop('_HairPrimaryColor', [1, 0.96, 0.9]),
            vec3Prop('_HairSecondaryColor', [0.85, 0.55, 0.35]),
            floatProp('_HairRoughness', 0.32),
            vec3Prop('_HairScatterColor', [0.45, 0.2, 0.1]),
            vec3Prop('_HairStrandDirection', [0, 1, 0]),
        ],
        standardVertexMain(),
        [
            ...sampleBaseColorBlock(),
            'vec3 N = resolveNormal();',
            'vec3 T = normalize(length(v_WorldTangent.xyz) > 0.001 ? cross(N, v_WorldTangent.xyz) : _HairStrandDirection);',
            'vec3 V = normalize(u_CameraPosition - v_WorldPosition);',
            'float specExp = mix(256.0, 16.0, clamp(_HairRoughness, 0.04, 1.0));',
            'vec3 lighting = baseColor.rgb * 0.12;',
            'if (u_ReceiveLighting) {',
            `    for (int index = 0; index < ${MAX_GLTF_DIRECTIONAL_LIGHTS}; index += 1) {`,
            `        if (index >= ${GLTF_LIGHTING_UNIFORMS.directionalLightCount}) break;`,
            `        vec3 L = normalize(-${GLTF_LIGHTING_UNIFORMS.directionalLightDirection}[index]);`,
            `        vec3 Lc = ${GLTF_LIGHTING_UNIFORMS.directionalLightColor}[index] * ${GLTF_LIGHTING_UNIFORMS.directionalLightIntensity}[index];`,
            '        vec3 H = normalize(L + V);',
            '        vec3 T1 = normalize(T + N * _HairSpecularShift);',
            '        vec3 T2 = normalize(T + N * _HairSecondaryShift);',
            '        float TdotH1 = dot(T1, H);',
            '        float TdotH2 = dot(T2, H);',
            '        float spec1 = pow(sqrt(max(0.0, 1.0 - TdotH1 * TdotH1)), specExp);',
            '        float spec2 = pow(sqrt(max(0.0, 1.0 - TdotH2 * TdotH2)), specExp * 0.5);',
            '        float wrapDiff = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);',
            '        lighting += (baseColor.rgb * wrapDiff + _HairScatterColor * (1.0 - wrapDiff) * 0.35 + _HairPrimaryColor * spec1 * 0.65 + _HairSecondaryColor * spec2 * 0.4) * Lc;',
            '    }',
            '}',
            'lighting *= clamp(_OcclusionFactor, 0.0, 1.0);',
            'vec3 finalColor = lighting + _EmissiveFactor * _EmissiveIntensity;',
            '#ifdef FOG',
            'finalColor = applyFog(finalColor, v_WorldPosition, u_CameraPosition);',
            '#endif',
            'o_Color = vec4(linearToSrgb(finalColor), alphaMode == 2 ? baseColor.a : 1.0);',
        ],
        { depthTest: true, depthWrite: true, cull: false, blend: false }
    );

export const createGltfClothShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            vec3Prop('_ClothFuzzColor', [0.9, 0.92, 0.96]),
            floatProp('_ClothFuzzRoughness', 0.45),
            floatProp('_ClothSheenScale', 0.85),
            floatProp('_SubsurfaceFactor', 0.25),
            vec3Prop('_SubsurfaceColorFactor', [0.8, 0.35, 0.25]),
        ],
        standardVertexMain(),
        [
            ...sampleBaseColorBlock(),
            'vec3 N = resolveNormal();',
            'vec3 V = normalize(u_CameraPosition - v_WorldPosition);',
            'float NdotV = max(dot(N, V), 0.0);',
            'float sheenRim = pow(1.0 - NdotV, mix(5.0, 1.5, clamp(_ClothFuzzRoughness, 0.04, 1.0))) * clamp(_ClothSheenScale, 0.0, 2.0);',
            'vec3 lighting = baseColor.rgb * 0.14;',
            'if (u_ReceiveLighting) {',
            `    for (int index = 0; index < ${MAX_GLTF_DIRECTIONAL_LIGHTS}; index += 1) {`,
            `        if (index >= ${GLTF_LIGHTING_UNIFORMS.directionalLightCount}) break;`,
            `        vec3 L = normalize(-${GLTF_LIGHTING_UNIFORMS.directionalLightDirection}[index]);`,
            `        vec3 Lc = ${GLTF_LIGHTING_UNIFORMS.directionalLightColor}[index] * ${GLTF_LIGHTING_UNIFORMS.directionalLightIntensity}[index];`,
            '        float NdotL = max(dot(N, L), 0.0);',
            '        float wrap = clamp((dot(N, L) + 0.5) / 1.5, 0.0, 1.0);',
            '        vec3 fabricDiff = baseColor.rgb * NdotL + _SubsurfaceColorFactor * (wrap - NdotL) * clamp(_SubsurfaceFactor, 0.0, 1.0);',
            '        lighting += (fabricDiff + _ClothFuzzColor * sheenRim * (0.25 + 0.75 * NdotL)) * Lc;',
            '    }',
            '}',
            'lighting *= clamp(_OcclusionFactor, 0.0, 1.0);',
            'vec3 finalColor = lighting + _EmissiveFactor * _EmissiveIntensity;',
            '#ifdef FOG',
            'finalColor = applyFog(finalColor, v_WorldPosition, u_CameraPosition);',
            '#endif',
            'o_Color = vec4(linearToSrgb(finalColor), alphaMode == 2 ? baseColor.a : 1.0);',
        ],
        { depthTest: true, depthWrite: true, cull: false, blend: false }
    );

export const createGltfWaterShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            floatProp('_WaterWaveAmplitude', 0.12, ['vertex', 'fragment']),
            floatProp('_WaterWaveFrequency', 1.8, ['vertex', 'fragment']),
            floatProp('_WaterWaveSpeed', 1.4, ['vertex', 'fragment']),
            vec3Prop('_WaterDeepColor', [0.03, 0.16, 0.28]),
            floatProp('_WaterFresnelPower', 4),
            floatProp('_WaterRippleScale', 4),
            floatProp('_WaterRippleSpeed', 0.6),
            vec3Prop('_WaterFoamColor', [0.95, 0.98, 1]),
            floatProp('_WaterFoamThreshold', 0.72),
        ],
        standardVertexMain([
            'float wavePhase = localPosition.x * _WaterWaveFrequency + localPosition.z * (_WaterWaveFrequency * 0.8) + u_Time * _WaterWaveSpeed;',
            'float waveLift = sin(wavePhase) * _WaterWaveAmplitude + cos(wavePhase * 0.73) * (_WaterWaveAmplitude * 0.5);',
            'localPosition.y += waveLift;',
        ]),
        [
            ...sampleBaseColorBlock(),
            'vec3 N = normalize(v_WorldNormal + vec3(sin(v_UV0.x * _WaterRippleScale + u_Time * _WaterRippleSpeed) * 0.08, 0.0, cos(v_UV0.y * _WaterRippleScale - u_Time * _WaterRippleSpeed) * 0.08));',
            'vec3 V = normalize(u_CameraPosition - v_WorldPosition);',
            'float fresnel = pow(1.0 - max(dot(N, V), 0.0), max(_WaterFresnelPower, 0.5));',
            'vec3 waterColor = mix(_WaterDeepColor, baseColor.rgb, clamp(1.0 - fresnel * 0.65, 0.0, 1.0));',
            'float ripplePeak = abs(sin(v_UV0.x * _WaterRippleScale + u_Time * _WaterRippleSpeed) * cos(v_UV0.y * _WaterRippleScale));',
            'float foamMask = smoothstep(_WaterFoamThreshold, 1.0, ripplePeak + fresnel * 0.25);',
            'vec3 finalColor = mix(waterColor, _WaterFoamColor, clamp(foamMask, 0.0, 1.0)) + _EmissiveFactor * _EmissiveIntensity;',
            '#ifdef FOG',
            'finalColor = applyFog(finalColor, v_WorldPosition, u_CameraPosition);',
            '#endif',
            'o_Color = vec4(linearToSrgb(finalColor), clamp(baseColor.a + foamMask * 0.2, 0.0, 1.0));',
        ],
        { depthTest: true, depthWrite: false, cull: false, blend: true }
    );

export const createGltfFoliageShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            floatProp('_WindStrength', 0.2, ['vertex', 'fragment']),
            floatProp('_WindSpeed', 1.6, ['vertex', 'fragment']),
            floatProp('_WindTurbulence', 1.2, ['vertex', 'fragment']),
            floatProp('_FoliageTranslucency', 0.65),
            vec3Prop('_SubsurfaceColorFactor', [0.55, 0.85, 0.25]),
            floatProp('_FoliageSubsurfacePower', 2.5),
        ],
        standardVertexMain([
            'float swayPhase = localPosition.y * _WindTurbulence + localPosition.x * 0.6 + u_Time * _WindSpeed;',
            'float heightWeight = clamp(localPosition.y, 0.0, 2.0);',
            'localPosition.x += sin(swayPhase) * _WindStrength * heightWeight;',
            'localPosition.z += cos(swayPhase * 0.8) * _WindStrength * 0.5 * heightWeight;',
        ]),
        [
            ...sampleBaseColorBlock(),
            'vec3 N = resolveNormal();',
            'if (!gl_FrontFacing) N = -N;',
            'vec3 V = normalize(u_CameraPosition - v_WorldPosition);',
            'vec3 lighting = baseColor.rgb * 0.14;',
            'if (u_ReceiveLighting) {',
            `    for (int index = 0; index < ${MAX_GLTF_DIRECTIONAL_LIGHTS}; index += 1) {`,
            `        if (index >= ${GLTF_LIGHTING_UNIFORMS.directionalLightCount}) break;`,
            `        vec3 L = normalize(-${GLTF_LIGHTING_UNIFORMS.directionalLightDirection}[index]);`,
            `        vec3 Lc = ${GLTF_LIGHTING_UNIFORMS.directionalLightColor}[index] * ${GLTF_LIGHTING_UNIFORMS.directionalLightIntensity}[index];`,
            '        float NdotL = max(dot(N, L), 0.0);',
            '        float backLight = pow(max(dot(V, -L), 0.0), max(_FoliageSubsurfacePower, 0.5)) * clamp(_FoliageTranslucency, 0.0, 1.0);',
            '        lighting += (baseColor.rgb * NdotL + _SubsurfaceColorFactor * backLight) * Lc;',
            '    }',
            '}',
            'lighting *= clamp(_OcclusionFactor, 0.0, 1.0);',
            'vec3 finalColor = lighting + _EmissiveFactor * _EmissiveIntensity;',
            '#ifdef FOG',
            'finalColor = applyFog(finalColor, v_WorldPosition, u_CameraPosition);',
            '#endif',
            'o_Color = vec4(linearToSrgb(finalColor), alphaMode == 2 ? baseColor.a : 1.0);',
        ],
        { depthTest: true, depthWrite: true, cull: false, blend: false }
    );

export const createGltfParticleShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            floatProp('_ParticleSoftness', 0.5),
            floatProp('_FlipbookProgress', 0),
            floatProp('_ParticleAdditiveMix', 0.35),
        ],
        standardVertexMain(),
        [
            ...sampleBaseColorBlock(),
            'float edgeDist = length(v_UV0 - vec2(0.5)) * 2.0;',
            'float softFalloff = 1.0 - smoothstep(clamp(1.0 - _ParticleSoftness, 0.0, 0.99), 1.0, edgeDist);',
            'vec3 particleRgb = baseColor.rgb * (1.0 + _ParticleAdditiveMix) + _EmissiveFactor * _EmissiveIntensity;',
            'o_Color = vec4(linearToSrgb(particleRgb), clamp(baseColor.a * softFalloff, 0.0, 1.0));',
        ],
        { depthTest: true, depthWrite: false, cull: false, blend: true }
    );

export const createGltfDecalShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [floatProp('_DecalBlend', 1), floatProp('_DecalAngleFade', 0.25)],
        standardVertexMain(),
        [
            ...sampleBaseColorBlock(),
            'vec3 N = resolveNormal();',
            'vec3 V = normalize(u_CameraPosition - v_WorldPosition);',
            'float angleAtten = smoothstep(0.0, max(_DecalAngleFade, 0.01), max(dot(N, V), 0.0));',
            'vec3 lighting = baseColor.rgb * (0.25 + 0.75 * clamp(_OcclusionFactor, 0.0, 1.0));',
            'float decalAlpha = clamp(baseColor.a * _DecalBlend * angleAtten, 0.0, 1.0);',
            'o_Color = vec4(linearToSrgb(lighting + _EmissiveFactor * _EmissiveIntensity), decalAlpha);',
        ],
        { depthTest: true, depthWrite: false, cull: true, blend: true }
    );

export const createPostProcessContractShaderEffect = (
    id: string
): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            vec3Prop('_PostTintColor', [1, 1, 1]),
            floatProp('_PostVignetteIntensity', 0.25),
            floatProp('_PostSaturation', 1),
            floatProp('_PostContrast', 1),
            floatProp('_PostBlendFactor', 1),
        ],
        standardVertexMain(),
        [
            ...sampleBaseColorBlock(),
            'vec3 color = baseColor.rgb * _PostTintColor;',
            'float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));',
            'color = mix(vec3(luma), color, max(_PostSaturation, 0.0));',
            'color = (color - 0.5) * max(_PostContrast, 0.0) + 0.5;',
            'float vignetteDist = length(v_UV0 - vec2(0.5)) * 1.4142;',
            'color *= clamp(1.0 - pow(vignetteDist, 2.0) * _PostVignetteIntensity, 0.0, 1.0);',
            'vec3 graded = max(color + _EmissiveFactor * _EmissiveIntensity, vec3(0.0));',
            'o_Color = vec4(linearToSrgb(graded), clamp(baseColor.a * _PostBlendFactor, 0.0, 1.0));',
        ],
        { depthTest: false, depthWrite: false, cull: false, blend: true }
    );

export const createGltfVolumeShaderEffect = (id: string): RenderShaderEffectDefinition =>
    buildEffect(
        id,
        [
            floatProp('_VolumeDensity', 1.2),
            floatProp('_VolumeAbsorption', 0.85),
            vec3Prop('_VolumeScatterColor', [0.95, 0.98, 1.0]),
            floatProp('_VolumeAnisotropy', 0.45),
        ],
        standardVertexMain(),
        [
            'vec3 rayOrigin = u_CameraPosition;',
            'vec3 rayDir = normalize(v_WorldPosition - u_CameraPosition);',
            'float marchLength = max(length(v_WorldPosition - u_CameraPosition), 0.1);',
            'float stepSize = clamp(marchLength / 16.0, 0.02, 0.35);',
            'float transmittance = 1.0;',
            'vec3 inScatter = vec3(0.0);',
            `vec3 lightDir = ${GLTF_LIGHTING_UNIFORMS.directionalLightCount} > 0 ? normalize(-${GLTF_LIGHTING_UNIFORMS.directionalLightDirection}[0]) : vec3(0.0, 1.0, 0.0);`,
            `vec3 lightCol = ${GLTF_LIGHTING_UNIFORMS.directionalLightCount} > 0 ? (${GLTF_LIGHTING_UNIFORMS.directionalLightColor}[0] * ${GLTF_LIGHTING_UNIFORMS.directionalLightIntensity}[0]) : vec3(1.0);`,
            'float cosTheta = dot(rayDir, lightDir);',
            'float g = clamp(_VolumeAnisotropy, -0.85, 0.85);',
            'float hgPhase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.01), 1.5));',
            'for (int stepIdx = 0; stepIdx < 16; stepIdx += 1) {',
            '    vec3 p = v_WorldPosition - rayDir * (float(stepIdx) * stepSize);',
            '    vec3 pAnimated = p * 1.4 + vec3(u_Time * 0.12, u_Time * 0.05, 0.0);',
            '    float field = 0.5 + 0.5 * (sin(pAnimated.x) * cos(pAnimated.y) * sin(pAnimated.z));',
            '    float density = max(0.0, field * _VolumeDensity);',
            '    float sigmaT = max(_VolumeAbsorption, 0.01) * density;',
            '    float stepExtinction = exp(-sigmaT * stepSize);',
            '    vec3 scatterSample = _BaseColorFactor.rgb * _VolumeScatterColor * (0.25 + lightCol * hgPhase * 2.5);',
            '    inScatter += transmittance * scatterSample * (1.0 - stepExtinction);',
            '    transmittance *= stepExtinction;',
            '    if (transmittance < 0.02) break;',
            '}',
            'vec3 volColor = inScatter + _EmissiveFactor * _EmissiveIntensity * (1.0 - transmittance);',
            '#ifdef FOG',
            'volColor = applyFog(volColor, v_WorldPosition, u_CameraPosition);',
            '#endif',
            'o_Color = vec4(linearToSrgb(volColor), clamp(1.0 - transmittance, 0.0, 1.0));',
        ],
        { depthTest: true, depthWrite: false, cull: true, blend: true }
    );

export const GLTF_HAIR_SHADER_EFFECT = createGltfHairShaderEffect('gltf/hair');
export const GLTF_CLOTH_SHADER_EFFECT = createGltfClothShaderEffect('gltf/cloth');
export const GLTF_WATER_SHADER_EFFECT = createGltfWaterShaderEffect('gltf/water');
export const GLTF_FOLIAGE_SHADER_EFFECT = createGltfFoliageShaderEffect('gltf/foliage');
export const GLTF_PARTICLE_SHADER_EFFECT = createGltfParticleShaderEffect('gltf/particle');
export const GLTF_DECAL_SHADER_EFFECT = createGltfDecalShaderEffect('gltf/decal');
export const POST_PROCESS_CONTRACT_SHADER_EFFECT =
    createPostProcessContractShaderEffect('post-process/contract');
export const GLTF_VOLUME_SHADER_EFFECT = createGltfVolumeShaderEffect('gltf/volume');

export const V2_BUILTIN_SHADER_EFFECTS: readonly RenderShaderEffectDefinition[] = Object.freeze([
    GLTF_HAIR_SHADER_EFFECT,
    GLTF_CLOTH_SHADER_EFFECT,
    GLTF_WATER_SHADER_EFFECT,
    GLTF_FOLIAGE_SHADER_EFFECT,
    GLTF_PARTICLE_SHADER_EFFECT,
    GLTF_DECAL_SHADER_EFFECT,
    POST_PROCESS_CONTRACT_SHADER_EFFECT,
    GLTF_VOLUME_SHADER_EFFECT,
]);
