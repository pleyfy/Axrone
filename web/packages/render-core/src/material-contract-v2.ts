import {
    isMaterialSlotValueTypeV2,
    serializeMaterialContractDocument,
    validateMaterialModelDefinition,
    type MaterialCapabilityStatus,
    type MaterialContractValidationResult,
    type MaterialDomainDefinition,
    type MaterialDomainId,
    type MaterialModelCapabilityMatrixEntry,
    type MaterialModelDefinition,
    type MaterialModelId,
    type MaterialOutputSlotDefinition,
    type MaterialPassPlanEntryDefinition,
    type MaterialRenderProfileId,
    type MaterialSlotValueType,
    type MaterialStageContractDefinition,
    type MaterialStageId,
} from './material-contract';

const CONTRACT_VERSION_V2 = 2 as const;

const CAP_SUPPORTED: MaterialCapabilityStatus = 'supported';
const CAP_PARTIAL: MaterialCapabilityStatus = 'partial';
const CAP_UNSUPPORTED: MaterialCapabilityStatus = 'unsupported';

const VERTEX_STAGE_LABEL = 'Vertex Stage';
const FRAGMENT_STAGE_LABEL = 'Surface Stage';

const makeSlot = (
    key: string,
    label: string,
    stage: MaterialStageId,
    section: string,
    valueType: MaterialSlotValueType,
    semantic: string,
    options: {
        readonly bindingKey?: string;
        readonly defaultValue?: string;
        readonly optional?: boolean;
        readonly advanced?: boolean;
        readonly capability?: MaterialCapabilityStatus;
        readonly description?: string;
    } = {}
): MaterialOutputSlotDefinition => ({
    key,
    label,
    stage,
    section,
    valueType,
    ...(options.bindingKey !== undefined ? { bindingKey: options.bindingKey } : {}),
    semantic,
    ...(options.defaultValue !== undefined ? { defaultValue: options.defaultValue } : {}),
    ...(options.optional !== undefined ? { optional: options.optional } : {}),
    ...(options.advanced !== undefined ? { advanced: options.advanced } : {}),
    capability: options.capability ?? CAP_SUPPORTED,
    ...(options.description !== undefined ? { description: options.description } : {}),
});

const vertexOffsetSlot = (capability: MaterialCapabilityStatus = CAP_PARTIAL) =>
    makeSlot('vertexOffset', 'Vertex Offset', 'vertex', 'vertex', 'vec3', 'vertex.offset', {
        bindingKey: '_VertexOffset',
        defaultValue: '[0, 0, 0]',
        optional: true,
        capability,
        description: 'Per-vertex object-space offset compiled into generated vertex shaders.',
    });

const depthOffsetSlot = (section = 'advanced', defaultValue = '0') =>
    makeSlot('depthOffset', 'Depth Offset', 'fragment', section, 'float', 'fragment.depthOffset', {
        bindingKey: '_DepthOffset',
        defaultValue,
        optional: true,
        advanced: section === 'advanced',
        capability: CAP_PARTIAL,
        description: 'Fragment depth bias applied in decal, water, and post-process paths.',
    });

const baseSurfaceSlots = (options: {
    readonly includeNormal?: boolean;
    readonly normalOptional?: boolean;
    readonly includeOcclusion?: boolean;
    readonly includeOpacityMask?: boolean;
    readonly defaultRoughness?: string;
    readonly defaultOpacity?: string;
    readonly defaultAlphaCutoff?: string;
} = {}): readonly MaterialOutputSlotDefinition[] => {
    const slots: MaterialOutputSlotDefinition[] = [
        makeSlot('baseColor', 'Base Color', 'fragment', 'surface', 'vec3', 'surface.baseColor', {
            bindingKey: '_BaseColorFactor',
            defaultValue: '[1, 1, 1]',
        }),
    ];
    if (options.includeNormal) {
        slots.push(
            makeSlot('normal', 'Normal', 'fragment', 'surface', 'vec3', 'surface.normal', {
                bindingKey: '_NormalTexture',
                defaultValue: '[0.5, 0.5, 1]',
                optional: options.normalOptional ?? true,
            })
        );
    }
    if (options.includeOcclusion) {
        slots.push(
            makeSlot(
                'ambientOcclusion',
                'Ambient Occlusion',
                'fragment',
                'surface',
                'float',
                'surface.ambientOcclusion',
                {
                    bindingKey: '_OcclusionFactor',
                    defaultValue: '1',
                    optional: true,
                    description: 'Scalar ambient occlusion factor plus _OcclusionTexture strength.',
                }
            )
        );
    }
    slots.push(
        makeSlot('opacity', 'Opacity', 'fragment', 'surface', 'float', 'surface.opacity', {
            bindingKey: '_OpacityFactor',
            defaultValue: options.defaultOpacity ?? '1',
            optional: true,
        })
    );
    if (options.includeOpacityMask !== false) {
        slots.push(
            makeSlot(
                'opacityMask',
                'Opacity Mask',
                'fragment',
                'surface',
                'float',
                'surface.opacityMask',
                {
                    bindingKey: '_AlphaCutoff',
                    defaultValue: options.defaultAlphaCutoff ?? '0.5',
                    optional: true,
                }
            )
        );
    }
    slots.push(
        makeSlot(
            'opacityMap',
            'Opacity Map',
            'fragment',
            'surface',
            'tex',
            'surface.opacityMap',
            {
                bindingKey: '_OpacityTexture',
                defaultValue: 'white',
                optional: true,
                description: 'Dedicated alpha/mask texture sampled via _OpacityTexture.',
            }
        ),
        makeSlot('emission', 'Emission', 'fragment', 'surface', 'vec3', 'surface.emission', {
            bindingKey: '_EmissiveFactor',
            defaultValue: '[0, 0, 0]',
            optional: true,
        }),
        makeSlot(
            'emissionIntensity',
            'Emission Intensity',
            'fragment',
            'surface',
            'float',
            'surface.emissionIntensity',
            {
                bindingKey: '_EmissiveIntensity',
                defaultValue: '1',
                optional: true,
                advanced: true,
            }
        )
    );
    if (options.defaultRoughness !== undefined) {
        slots.splice(
            1,
            0,
            makeSlot(
                'roughness',
                'Roughness',
                'fragment',
                'surface',
                'float',
                'surface.roughness',
                {
                    bindingKey: '_RoughnessFactor',
                    defaultValue: options.defaultRoughness,
                }
            )
        );
    }
    return slots;
};

const pbrFeatureSlots = (advanced = true): readonly MaterialOutputSlotDefinition[] => [
    makeSlot('metallic', 'Metallic', 'fragment', 'surface', 'float', 'surface.metallic', {
        bindingKey: '_MetallicFactor',
        defaultValue: '0',
    }),
    makeSlot('roughness', 'Roughness', 'fragment', 'surface', 'float', 'surface.roughness', {
        bindingKey: '_RoughnessFactor',
        defaultValue: '0.5',
    }),
    makeSlot('clearcoat', 'Clearcoat', 'fragment', 'clearcoat', 'float', 'clearcoat.factor', {
        bindingKey: '_ClearcoatFactor',
        defaultValue: '0',
        optional: true,
        advanced,
    }),
    makeSlot(
        'clearcoatRoughness',
        'Clearcoat Roughness',
        'fragment',
        'clearcoat',
        'float',
        'clearcoat.roughness',
        {
            bindingKey: '_ClearcoatRoughnessFactor',
            defaultValue: '0',
            optional: true,
            advanced,
        }
    ),
    makeSlot(
        'clearcoatNormal',
        'Clearcoat Normal',
        'fragment',
        'clearcoat',
        'vec3',
        'clearcoat.normal',
        {
            bindingKey: '_ClearcoatNormalTexture',
            defaultValue: '[0.5, 0.5, 1]',
            optional: true,
            advanced,
        }
    ),
    makeSlot(
        'clearcoatNormalScale',
        'Clearcoat Normal Scale',
        'fragment',
        'clearcoat',
        'float',
        'clearcoat.normalScale',
        {
            bindingKey: '_ClearcoatNormalTexture_Scale',
            defaultValue: '1',
            optional: true,
            advanced,
        }
    ),
    makeSlot('sheen', 'Sheen', 'fragment', 'sheen', 'float', 'sheen.factor', {
        bindingKey: '_SheenFactor',
        defaultValue: '0',
        optional: true,
        advanced,
    }),
    makeSlot('sheenColor', 'Sheen Color', 'fragment', 'sheen', 'vec3', 'sheen.color', {
        bindingKey: '_SheenColorFactor',
        defaultValue: '[1, 1, 1]',
        optional: true,
        advanced,
    }),
    makeSlot('sheenRoughness', 'Sheen Roughness', 'fragment', 'sheen', 'float', 'sheen.roughness', {
        bindingKey: '_SheenRoughnessFactor',
        defaultValue: '0.5',
        optional: true,
        advanced,
    }),
    makeSlot('anisotropy', 'Anisotropy', 'fragment', 'anisotropy', 'float', 'anisotropy.factor', {
        bindingKey: '_AnisotropyFactor',
        defaultValue: '0',
        optional: true,
        advanced,
    }),
    makeSlot(
        'anisotropyRotation',
        'Anisotropy Rotation',
        'fragment',
        'anisotropy',
        'float',
        'anisotropy.rotation',
        {
            bindingKey: '_AnisotropyRotation',
            defaultValue: '0',
            optional: true,
            advanced,
        }
    ),
    makeSlot('subsurface', 'Subsurface', 'fragment', 'subsurface', 'float', 'subsurface.factor', {
        bindingKey: '_SubsurfaceFactor',
        defaultValue: '0',
        optional: true,
        advanced,
        capability: CAP_PARTIAL,
    }),
    makeSlot(
        'subsurfaceColor',
        'Subsurface Color',
        'fragment',
        'subsurface',
        'vec3',
        'subsurface.color',
        {
            bindingKey: '_SubsurfaceColorFactor',
            defaultValue: '[1, 0.8, 0.6]',
            optional: true,
            advanced,
            capability: CAP_PARTIAL,
        }
    ),
    makeSlot(
        'subsurfaceRadius',
        'Subsurface Radius',
        'fragment',
        'subsurface',
        'float',
        'subsurface.radius',
        {
            bindingKey: '_SubsurfaceThickness',
            defaultValue: '1',
            optional: true,
            advanced,
            capability: CAP_PARTIAL,
        }
    ),
    makeSlot(
        'iridescence',
        'Iridescence',
        'fragment',
        'iridescence',
        'float',
        'iridescence.factor',
        {
            bindingKey: '_IridescenceFactor',
            defaultValue: '0',
            optional: true,
            advanced,
        }
    ),
    makeSlot(
        'iridescenceIor',
        'Iridescence IOR',
        'fragment',
        'iridescence',
        'float',
        'iridescence.ior',
        {
            bindingKey: '_IridescenceIor',
            defaultValue: '1.3',
            optional: true,
            advanced,
        }
    ),
    makeSlot(
        'iridescenceThickness',
        'Iridescence Thickness',
        'fragment',
        'iridescence',
        'float',
        'iridescence.thickness',
        {
            bindingKey: '_IridescenceThickness',
            defaultValue: '400',
            optional: true,
            advanced,
        }
    ),
    makeSlot(
        'transmission',
        'Transmission',
        'fragment',
        'transmission',
        'float',
        'transmission.factor',
        {
            bindingKey: '_TransmissionFactor',
            defaultValue: '0',
            optional: true,
            advanced,
            capability: CAP_PARTIAL,
        }
    ),
    makeSlot('ior', 'IOR', 'fragment', 'transmission', 'float', 'transmission.ior', {
        bindingKey: '_IorFactor',
        defaultValue: '1.5',
        optional: true,
        advanced,
    }),
    makeSlot(
        'thickness',
        'Thickness',
        'fragment',
        'transmission',
        'float',
        'transmission.thickness',
        {
            bindingKey: '_ThicknessFactor',
            defaultValue: '0',
            optional: true,
            advanced,
        }
    ),
];

const toonSpecificSlots = (): readonly MaterialOutputSlotDefinition[] => [
    makeSlot('shadowColor', 'Shadow Color', 'fragment', 'toon', 'vec3', 'toon.shadowColor', {
        bindingKey: '_ShadowColor',
        defaultValue: '[0.2, 0.2, 0.3]',
        optional: true,
    }),
    makeSlot(
        'shadowThreshold',
        'Shadow Threshold',
        'fragment',
        'toon',
        'float',
        'toon.shadowThreshold',
        { bindingKey: '_ShadowThreshold', defaultValue: '0.5', optional: true }
    ),
    makeSlot(
        'shadowSmoothness',
        'Shadow Smoothness',
        'fragment',
        'toon',
        'float',
        'toon.shadowSmoothness',
        { bindingKey: '_ShadowSmoothness', defaultValue: '0.05', optional: true }
    ),
    makeSlot(
        'highlightThreshold',
        'Highlight Threshold',
        'fragment',
        'toon',
        'float',
        'toon.highlightThreshold',
        { bindingKey: '_HighlightThreshold', defaultValue: '0.8', optional: true }
    ),
    makeSlot(
        'highlightColor',
        'Highlight Color',
        'fragment',
        'toon',
        'vec3',
        'toon.highlightColor',
        { bindingKey: '_HighlightColor', defaultValue: '[1, 1, 1]', optional: true }
    ),
    makeSlot('rimColor', 'Rim Color', 'fragment', 'toon', 'vec3', 'toon.rimColor', {
        bindingKey: '_RimColor',
        defaultValue: '[0.8, 0.9, 1]',
        optional: true,
    }),
    makeSlot('rimThreshold', 'Rim Threshold', 'fragment', 'toon', 'float', 'toon.rimThreshold', {
        bindingKey: '_RimThreshold',
        defaultValue: '0.6',
        optional: true,
    }),
    makeSlot('rimSmoothness', 'Rim Smoothness', 'fragment', 'toon', 'float', 'toon.rimSmoothness', {
        bindingKey: '_RimSmoothness',
        defaultValue: '0.1',
        optional: true,
    }),
    makeSlot('outlineWidth', 'Outline Width', 'fragment', 'outline', 'float', 'toon.outlineWidth', {
        bindingKey: '_OutlineWidth',
        defaultValue: '0',
        optional: true,
        capability: CAP_PARTIAL,
    }),
    makeSlot('outlineColor', 'Outline Color', 'fragment', 'outline', 'vec3', 'toon.outlineColor', {
        bindingKey: '_OutlineColor',
        defaultValue: '[0, 0, 0]',
        optional: true,
    }),
];

const makeCapabilities = (
    standard: MaterialCapabilityStatus,
    minimal: MaterialCapabilityStatus,
    notes: { readonly standard: string; readonly minimal: string; readonly native: string },
    native: MaterialCapabilityStatus = CAP_UNSUPPORTED
): readonly MaterialModelCapabilityMatrixEntry[] => [
    { profile: 'webgl2-standard', status: standard, notes: notes.standard },
    { profile: 'webgl2-minimal', status: minimal, notes: notes.minimal },
    { profile: 'native', status: native, notes: notes.native },
];

const NATIVE_PENDING_NOTE = 'C# native runtime parity for V2 models is scheduled for a follow-up wave.';

const standardSurfacePasses = (): readonly MaterialPassPlanEntryDefinition[] => [
    { id: 'main', phase: 'default', required: true },
    { id: 'forward-add', phase: 'forward-add' },
    { id: 'shadow-caster', phase: 'shadow-caster' },
];

const pbrSurfacePasses = (): readonly MaterialPassPlanEntryDefinition[] => [
    ...standardSurfacePasses(),
    {
        id: 'refraction-copy',
        phase: 'refraction',
        shaderId: 'post-process/contract',
        depthTest: false,
        depthWrite: false,
        enabledWhenUniformNonZero: '_TransmissionFactor',
    },
    {
        id: 'sss-blur',
        phase: 'subsurface',
        shaderId: 'post-process/contract',
        depthTest: false,
        depthWrite: false,
        blend: true,
        enabledWhenUniformNonZero: '_SubsurfaceFactor',
    },
];

const buildStagesFromSlots = (
    slots: readonly MaterialOutputSlotDefinition[],
    vertexDefaultCollapsed = true,
    fragmentLabel = FRAGMENT_STAGE_LABEL
): readonly MaterialStageContractDefinition[] => {
    const vertexKeys = slots.filter((slot) => slot.stage === 'vertex').map((slot) => slot.key);
    const fragmentKeys = slots.filter((slot) => slot.stage === 'fragment').map((slot) => slot.key);
    const stages: MaterialStageContractDefinition[] = [];
    if (vertexKeys.length > 0) {
        stages.push({
            stage: 'vertex',
            label: VERTEX_STAGE_LABEL,
            defaultCollapsed: vertexDefaultCollapsed,
            slots: vertexKeys,
        });
    }
    if (fragmentKeys.length > 0) {
        stages.push({
            stage: 'fragment',
            label: fragmentLabel,
            defaultCollapsed: false,
            slots: fragmentKeys,
        });
    }
    return stages;
};

export const MATERIAL_DOMAINS_V2: readonly MaterialDomainDefinition[] = Object.freeze([
    {
        id: 'surface',
        label: 'Surface',
        description: '3D and 2D geometry surfaces rendered into opaque, cutout, or blended scene passes.',
        defaultModelId: 'pbr',
        supportsVertexOffset: true,
        supportsDepthOffset: true,
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Full surface lighting, cutout, alpha blend, and multi-pass outline execution.',
            minimal: 'Reduced light budget and disabled advanced PBR lobes.',
            native: 'C# native runtime covers core PBR/Unlit only; V2 models follow in native wave.',
        }),
    },
    {
        id: 'decal',
        label: 'Decal',
        description: 'Overlay projection surfaces with depth-biased blending onto existing geometry.',
        defaultModelId: 'decal',
        supportsVertexOffset: true,
        supportsDepthOffset: true,
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_UNSUPPORTED, {
            standard: 'Decal blending, angle fade, and depth bias execute via gltf/decal.',
            minimal: 'Minimal profile disables projected decal passes.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        id: 'post-process',
        label: 'Post-Process',
        description: 'Screen-space full-frame compositing and color grading contract.',
        defaultModelId: 'post-process',
        supportsVertexOffset: false,
        supportsDepthOffset: true,
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Color grading, tint, vignette, and blend factor execute via post-process/contract.',
            minimal: 'Reduced screen-space passes without depth-based masking.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        id: 'volume',
        label: 'Volume',
        description:
            'Volumetric density raymarching with Beer-Lambert absorption and Henyey-Greenstein phase scattering.',
        defaultModelId: 'volume',
        supportsVertexOffset: false,
        supportsDepthOffset: false,
        capabilities: [
            {
                profile: 'webgl2-standard',
                status: CAP_SUPPORTED,
                notes: 'Volumetric raymarch pass executes Beer-Lambert density and anisotropic scattering via gltf/volume.',
            },
            {
                profile: 'webgl2-minimal',
                status: CAP_UNSUPPORTED,
                notes: 'Volumetric raymarching is unsupported on the minimal profile.',
            },
            {
                profile: 'native',
                status: CAP_UNSUPPORTED,
                notes: NATIVE_PENDING_NOTE,
            },
        ],
    },
]);

const pbrSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: true, includeOcclusion: true }),
    ...pbrFeatureSlots(true),
    depthOffsetSlot('advanced', '0'),
];

const unlitSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: false, includeOcclusion: false }),
    depthOffsetSlot('advanced', '0'),
];

const toonSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: true, includeOcclusion: true }),
    ...toonSpecificSlots(),
];

const hairSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: true, includeOcclusion: true }),
    makeSlot(
        'specularShift',
        'Primary Specular Shift',
        'fragment',
        'hair',
        'float',
        'hair.specularShift',
        { bindingKey: '_HairSpecularShift', defaultValue: '0.12', optional: true }
    ),
    makeSlot(
        'secondaryShift',
        'Secondary Specular Shift',
        'fragment',
        'hair',
        'float',
        'hair.secondaryShift',
        { bindingKey: '_HairSecondaryShift', defaultValue: '-0.08', optional: true }
    ),
    makeSlot(
        'primaryHighlight',
        'Primary Highlight',
        'fragment',
        'hair',
        'vec3',
        'hair.primaryHighlight',
        { bindingKey: '_HairPrimaryColor', defaultValue: '[1, 0.96, 0.9]', optional: true }
    ),
    makeSlot(
        'secondaryHighlight',
        'Secondary Highlight',
        'fragment',
        'hair',
        'vec3',
        'hair.secondaryHighlight',
        { bindingKey: '_HairSecondaryColor', defaultValue: '[0.85, 0.55, 0.35]', optional: true }
    ),
    makeSlot(
        'hairRoughness',
        'Hair Roughness',
        'fragment',
        'hair',
        'float',
        'hair.roughness',
        { bindingKey: '_HairRoughness', defaultValue: '0.32', optional: true }
    ),
    makeSlot('scatterTint', 'Scatter Tint', 'fragment', 'hair', 'vec3', 'hair.scatterTint', {
        bindingKey: '_HairScatterColor',
        defaultValue: '[0.45, 0.2, 0.1]',
        optional: true,
    }),
    makeSlot(
        'strandDirection',
        'Strand Direction',
        'fragment',
        'hair',
        'vec3',
        'hair.strandDirection',
        { bindingKey: '_HairStrandDirection', defaultValue: '[0, 1, 0]', optional: true }
    ),
];

const clothSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({
        includeNormal: true,
        includeOcclusion: true,
        defaultRoughness: '0.78',
    }),
    makeSlot('fuzzColor', 'Fuzz Color', 'fragment', 'cloth', 'vec3', 'cloth.fuzzColor', {
        bindingKey: '_ClothFuzzColor',
        defaultValue: '[0.9, 0.92, 0.96]',
        optional: true,
    }),
    makeSlot(
        'fuzzRoughness',
        'Fuzz Roughness',
        'fragment',
        'cloth',
        'float',
        'cloth.fuzzRoughness',
        { bindingKey: '_ClothFuzzRoughness', defaultValue: '0.45', optional: true }
    ),
    makeSlot('sheenScale', 'Sheen Scale', 'fragment', 'cloth', 'float', 'cloth.sheenScale', {
        bindingKey: '_ClothSheenScale',
        defaultValue: '0.85',
        optional: true,
    }),
    makeSlot('subsurface', 'Subsurface', 'fragment', 'cloth', 'float', 'subsurface.factor', {
        bindingKey: '_SubsurfaceFactor',
        defaultValue: '0.25',
        optional: true,
    }),
    makeSlot(
        'subsurfaceColor',
        'Subsurface Color',
        'fragment',
        'cloth',
        'vec3',
        'subsurface.color',
        { bindingKey: '_SubsurfaceColorFactor', defaultValue: '[0.8, 0.35, 0.25]', optional: true }
    ),
];

const waterSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    makeSlot('waveAmplitude', 'Wave Amplitude', 'vertex', 'vertex', 'float', 'water.waveAmplitude', {
        bindingKey: '_WaterWaveAmplitude',
        defaultValue: '0.12',
        optional: true,
    }),
    makeSlot('waveFrequency', 'Wave Frequency', 'vertex', 'vertex', 'float', 'water.waveFrequency', {
        bindingKey: '_WaterWaveFrequency',
        defaultValue: '1.8',
        optional: true,
    }),
    makeSlot('waveSpeed', 'Wave Speed', 'vertex', 'vertex', 'float', 'water.waveSpeed', {
        bindingKey: '_WaterWaveSpeed',
        defaultValue: '1.4',
        optional: true,
    }),
    ...baseSurfaceSlots({
        includeNormal: true,
        includeOcclusion: false,
        defaultRoughness: '0.06',
        defaultOpacity: '0.82',
    }),
    makeSlot('deepColor', 'Deep Color', 'fragment', 'water', 'vec3', 'water.deepColor', {
        bindingKey: '_WaterDeepColor',
        defaultValue: '[0.03, 0.16, 0.28]',
        optional: true,
    }),
    makeSlot('fresnelPower', 'Fresnel Power', 'fragment', 'water', 'float', 'water.fresnelPower', {
        bindingKey: '_WaterFresnelPower',
        defaultValue: '4',
        optional: true,
    }),
    makeSlot('rippleScale', 'Ripple Scale', 'fragment', 'water', 'float', 'water.rippleScale', {
        bindingKey: '_WaterRippleScale',
        defaultValue: '4',
        optional: true,
    }),
    makeSlot('rippleSpeed', 'Ripple Speed', 'fragment', 'water', 'float', 'water.rippleSpeed', {
        bindingKey: '_WaterRippleSpeed',
        defaultValue: '0.6',
        optional: true,
    }),
    makeSlot('foamColor', 'Foam Color', 'fragment', 'water', 'vec3', 'water.foamColor', {
        bindingKey: '_WaterFoamColor',
        defaultValue: '[0.95, 0.98, 1]',
        optional: true,
    }),
    makeSlot('foamThreshold', 'Foam Threshold', 'fragment', 'water', 'float', 'water.foamThreshold', {
        bindingKey: '_WaterFoamThreshold',
        defaultValue: '0.72',
        optional: true,
    }),
    depthOffsetSlot('water', '0'),
];

const foliageSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    makeSlot('windStrength', 'Wind Strength', 'vertex', 'vertex', 'float', 'foliage.windStrength', {
        bindingKey: '_WindStrength',
        defaultValue: '0.2',
        optional: true,
    }),
    makeSlot('windSpeed', 'Wind Speed', 'vertex', 'vertex', 'float', 'foliage.windSpeed', {
        bindingKey: '_WindSpeed',
        defaultValue: '1.6',
        optional: true,
    }),
    makeSlot(
        'windTurbulence',
        'Wind Turbulence',
        'vertex',
        'vertex',
        'float',
        'foliage.windTurbulence',
        { bindingKey: '_WindTurbulence', defaultValue: '1.2', optional: true }
    ),
    ...baseSurfaceSlots({
        includeNormal: true,
        includeOcclusion: true,
        defaultRoughness: '0.55',
        defaultAlphaCutoff: '0.45',
    }),
    makeSlot('translucency', 'Translucency', 'fragment', 'foliage', 'float', 'foliage.translucency', {
        bindingKey: '_FoliageTranslucency',
        defaultValue: '0.65',
        optional: true,
    }),
    makeSlot(
        'subsurfaceColor',
        'Subsurface Color',
        'fragment',
        'foliage',
        'vec3',
        'subsurface.color',
        { bindingKey: '_SubsurfaceColorFactor', defaultValue: '[0.55, 0.85, 0.25]', optional: true }
    ),
    makeSlot(
        'subsurfacePower',
        'Subsurface Power',
        'fragment',
        'foliage',
        'float',
        'foliage.subsurfacePower',
        { bindingKey: '_FoliageSubsurfacePower', defaultValue: '2.5', optional: true }
    ),
];

const spriteSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: false, includeOcclusion: false }),
    makeSlot('tintColor', 'Sprite Tint', 'fragment', 'sprite', 'vec3', 'sprite.tintColor', {
        bindingKey: '_SpriteTintColor',
        defaultValue: '[1, 1, 1]',
        optional: true,
    }),
    makeSlot(
        'flipbookFrame',
        'Flipbook Frame',
        'fragment',
        'sprite',
        'float',
        'sprite.flipbookFrame',
        { bindingKey: '_FlipbookFrame', defaultValue: '0', optional: true }
    ),
    makeSlot('flipbookGrid', 'Flipbook Grid', 'fragment', 'sprite', 'vec2', 'sprite.flipbookGrid', {
        bindingKey: '_FlipbookGrid',
        defaultValue: '[1, 1]',
        optional: true,
    }),
];

const particleSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: false, includeOcclusion: false }),
    makeSlot('softness', 'Soft Edge', 'fragment', 'particle', 'float', 'particle.softness', {
        bindingKey: '_ParticleSoftness',
        defaultValue: '0.5',
        optional: true,
    }),
    makeSlot(
        'flipbookProgress',
        'Flipbook Progress',
        'fragment',
        'particle',
        'float',
        'particle.flipbookProgress',
        { bindingKey: '_FlipbookProgress', defaultValue: '0', optional: true }
    ),
    makeSlot(
        'additiveMix',
        'Additive Mix',
        'fragment',
        'particle',
        'float',
        'particle.additiveMix',
        { bindingKey: '_ParticleAdditiveMix', defaultValue: '0.35', optional: true }
    ),
];

const composableSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    makeSlot(
        'surfaceAttributes',
        'Surface Attributes',
        'fragment',
        'composable',
        'surfaceAttributes',
        'composable.surfaceAttributes',
        {
            defaultValue: 'default',
            optional: true,
            description: 'Receives bundled surface attribute layers composed upstream.',
        }
    ),
    ...baseSurfaceSlots({ includeNormal: true, includeOcclusion: true }),
    ...pbrFeatureSlots(true),
    depthOffsetSlot('advanced', '0'),
];

const decalSlots = [
    vertexOffsetSlot(CAP_PARTIAL),
    ...baseSurfaceSlots({ includeNormal: true, includeOcclusion: true, includeOpacityMask: false }),
    makeSlot('metallic', 'Metallic', 'fragment', 'decal', 'float', 'surface.metallic', {
        bindingKey: '_MetallicFactor',
        defaultValue: '0',
        optional: true,
    }),
    makeSlot('roughness', 'Roughness', 'fragment', 'decal', 'float', 'surface.roughness', {
        bindingKey: '_RoughnessFactor',
        defaultValue: '0.6',
        optional: true,
    }),
    makeSlot('decalBlend', 'Decal Blend', 'fragment', 'decal', 'float', 'decal.blend', {
        bindingKey: '_DecalBlend',
        defaultValue: '1',
        optional: true,
    }),
    makeSlot('angleFade', 'Angle Fade', 'fragment', 'decal', 'float', 'decal.angleFade', {
        bindingKey: '_DecalAngleFade',
        defaultValue: '0.25',
        optional: true,
    }),
    depthOffsetSlot('decal', '-0.002'),
];

const postProcessSlots = [
    makeSlot(
        'vertexOffset',
        'Vertex Offset',
        'vertex',
        'vertex',
        'vec3',
        'vertex.offset',
        {
            bindingKey: '_VertexOffset',
            defaultValue: '[0, 0, 0]',
            optional: true,
            capability: CAP_UNSUPPORTED,
            description: 'Fullscreen post-process geometry ignores vertex offsets.',
        }
    ),
    ...baseSurfaceSlots({ includeNormal: false, includeOcclusion: false, includeOpacityMask: false }),
    makeSlot('postTintColor', 'Grade Tint', 'fragment', 'post-process', 'vec3', 'postProcess.tintColor', {
        bindingKey: '_PostTintColor',
        defaultValue: '[1, 1, 1]',
        optional: true,
    }),
    makeSlot(
        'vignetteIntensity',
        'Vignette Intensity',
        'fragment',
        'post-process',
        'float',
        'postProcess.vignette',
        { bindingKey: '_PostVignetteIntensity', defaultValue: '0.25', optional: true }
    ),
    makeSlot('saturation', 'Saturation', 'fragment', 'post-process', 'float', 'postProcess.saturation', {
        bindingKey: '_PostSaturation',
        defaultValue: '1',
        optional: true,
    }),
    makeSlot('contrast', 'Contrast', 'fragment', 'post-process', 'float', 'postProcess.contrast', {
        bindingKey: '_PostContrast',
        defaultValue: '1',
        optional: true,
    }),
    makeSlot(
        'blendFactor',
        'Blend Factor',
        'fragment',
        'post-process',
        'float',
        'postProcess.blendFactor',
        { bindingKey: '_PostBlendFactor', defaultValue: '1', optional: true }
    ),
    depthOffsetSlot('post-process', '0'),
];

const volumeSlots = [
    makeSlot('vertexOffset', 'Vertex Offset', 'vertex', 'vertex', 'vec3', 'vertex.offset', {
        bindingKey: '_VertexOffset',
        defaultValue: '[0, 0, 0]',
        optional: true,
        capability: CAP_UNSUPPORTED,
        description: 'Volumetric bounds ignore per-vertex displacement.',
    }),
    makeSlot('baseColor', 'Albedo Scatter', 'fragment', 'volume', 'vec3', 'volume.albedo', {
        bindingKey: '_BaseColorFactor',
        defaultValue: '[0.85, 0.9, 0.95]',
    }),
    makeSlot('volumeDensity', 'Volume Density', 'fragment', 'volume', 'float', 'volume.density', {
        bindingKey: '_VolumeDensity',
        defaultValue: '1.2',
        optional: true,
    }),
    makeSlot(
        'volumeAbsorption',
        'Absorption Rate',
        'fragment',
        'volume',
        'float',
        'volume.absorption',
        {
            bindingKey: '_VolumeAbsorption',
            defaultValue: '0.85',
            optional: true,
        }
    ),
    makeSlot(
        'volumeScatterColor',
        'Scatter Tint',
        'fragment',
        'volume',
        'vec3',
        'volume.scatterColor',
        {
            bindingKey: '_VolumeScatterColor',
            defaultValue: '[0.95, 0.98, 1]',
            optional: true,
        }
    ),
    makeSlot(
        'volumeAnisotropy',
        'Phase Anisotropy (g)',
        'fragment',
        'volume',
        'float',
        'volume.anisotropy',
        {
            bindingKey: '_VolumeAnisotropy',
            defaultValue: '0.45',
            optional: true,
        }
    ),
    makeSlot('emission', 'Emission', 'fragment', 'volume', 'vec3', 'surface.emission', {
        bindingKey: '_EmissiveFactor',
        defaultValue: '[0, 0, 0]',
        optional: true,
    }),
    makeSlot(
        'emissionIntensity',
        'Emission Intensity',
        'fragment',
        'volume',
        'float',
        'surface.emissionIntensity',
        {
            bindingKey: '_EmissiveIntensity',
            defaultValue: '1',
            optional: true,
            advanced: true,
        }
    ),
];

export const BUILTIN_MATERIAL_MODELS_V2: readonly MaterialModelDefinition[] = Object.freeze([
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'pbr',
        label: 'PBR',
        description:
            'Model-driven physically based surface with ambient occlusion, opacity map, and advanced specular lobes.',
        domain: 'surface',
        compilerFamily: 'gltf/pbr',
        defaultShaderId: 'gltf/pbr',
        defaultTemplateId: 'pbr-standard',
        stages: buildStagesFromSlots(pbrSlots),
        outputSlots: pbrSlots,
        passPlan: pbrSurfacePasses(),
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Surface, AO, opacity map, and advanced lobes compile end-to-end; Vertex Offset runs in generated shaders.',
            minimal: 'Reduced light budget; clearcoat, sheen, anisotropy, subsurface, iridescence, and transmission are dropped.',
            native: 'Native consumes core PBR only; advanced V2 slots await native wave.',
        }, CAP_PARTIAL),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'unlit',
        label: 'Unlit',
        description: 'Shading-free surface model driven by base color, opacity/mask, opacity map, and emission.',
        domain: 'surface',
        compilerFamily: 'gltf/unlit',
        defaultShaderId: 'gltf/unlit',
        defaultTemplateId: 'unlit-emissive-fx',
        stages: buildStagesFromSlots(unlitSlots),
        outputSlots: unlitSlots,
        passPlan: [
            { id: 'main', phase: 'default', required: true },
            { id: 'shadow-caster', phase: 'shadow-caster' },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_SUPPORTED, {
            standard: 'Surface, opacity map, and emission compile across generated and stock shaders.',
            minimal: 'Minimal profile matches standard unlit output.',
            native: 'Native renders unlit base surface without graph-authored Vertex Offset.',
        }, CAP_PARTIAL),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'toon',
        label: 'Toon',
        description: 'Cel-shaded model with shadow/highlight/rim bands, ambient occlusion, opacity map, and inverted-hull outline pass.',
        domain: 'surface',
        compilerFamily: 'gltf/toon',
        defaultShaderId: 'gltf/toon',
        defaultTemplateId: 'toon-character',
        stages: buildStagesFromSlots(toonSlots),
        outputSlots: toonSlots,
        passPlan: [
            ...standardSurfacePasses(),
            {
                id: 'outline',
                phase: 'outline',
                shaderId: 'gltf/toon-outline',
                cullMode: 'front',
                depthTest: true,
                depthWrite: true,
                enabledWhenUniformNonZero: '_OutlineWidth',
            },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_UNSUPPORTED, {
            standard: 'Toon shading bands, AO, opacity map, and inverted-hull outline pass execute end to end.',
            minimal: 'Minimal WebGL2 profile omits toon multi-pass shading.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'hair',
        label: 'Hair',
        description: 'Kajiya-Kay anisotropic dual-highlight hair strand shading with transmission scatter.',
        domain: 'surface',
        compilerFamily: 'gltf/hair',
        defaultShaderId: 'gltf/hair',
        defaultTemplateId: 'hair-anisotropic',
        stages: buildStagesFromSlots(hairSlots),
        outputSlots: hairSlots,
        passPlan: standardSurfacePasses(),
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Primary/secondary shifted strand specular and scatter tint execute via gltf/hair.',
            minimal: 'Minimal profile reduces hair shading to single-lobe approximation.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'cloth',
        label: 'Cloth',
        description: 'Microfiber Charlie-sheen and subsurface fabric BRDF for velvet, woven textiles, and silk.',
        domain: 'surface',
        compilerFamily: 'gltf/cloth',
        defaultShaderId: 'gltf/cloth',
        defaultTemplateId: 'cloth-velvet',
        stages: buildStagesFromSlots(clothSlots),
        outputSlots: clothSlots,
        passPlan: standardSurfacePasses(),
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Charlie fuzz sheen and fabric wrap subsurface execute via gltf/cloth.',
            minimal: 'Minimal profile simplifies microfiber sheen.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'water',
        label: 'Water',
        description: 'Wave-displaced animated water surface with Fresnel reflection tint, depth absorption, and edge foam.',
        domain: 'surface',
        compilerFamily: 'gltf/water',
        defaultShaderId: 'gltf/water',
        defaultTemplateId: 'water-stylized-ocean',
        stages: buildStagesFromSlots(waterSlots, false),
        outputSlots: waterSlots,
        passPlan: [{ id: 'main', phase: 'default', blend: true, depthWrite: false, required: true }],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Vertex wave displacement, scrolling ripples, Fresnel, and foam execute via gltf/water.',
            minimal: 'Minimal profile simplifies multi-wave ripples.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'foliage',
        label: 'Foliage',
        description: 'Double-sided wind-animated vegetation model with backlit wrap translucency and alpha cutout.',
        domain: 'surface',
        compilerFamily: 'gltf/foliage',
        defaultShaderId: 'gltf/foliage',
        defaultTemplateId: 'foliage-wind-canopy',
        stages: buildStagesFromSlots(foliageSlots, false),
        outputSlots: foliageSlots,
        passPlan: [
            { id: 'main', phase: 'default', cullMode: 'none', required: true },
            { id: 'shadow-caster', phase: 'shadow-caster' },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Double-sided lighting, wind sway vertex animation, and foliage translucency execute via gltf/foliage.',
            minimal: 'Minimal profile omits foliage subsurface scatter.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'sprite',
        label: 'Sprite',
        description: '2D sprite surface model with tint, atlas/flipbook UV framing, opacity map, and alpha blending.',
        domain: 'surface',
        compilerFamily: 'sprite',
        defaultShaderId: 'Render2D/Sprite',
        defaultTemplateId: 'sprite-lit-fx',
        stages: buildStagesFromSlots(spriteSlots),
        outputSlots: spriteSlots,
        passPlan: [
            { id: 'main', phase: 'default', cullMode: 'none', blend: true, depthWrite: false, required: true },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_SUPPORTED, {
            standard: 'Sprite tint, opacity map, and flipbook controls map cleanly onto the 2D sprite pipeline.',
            minimal: 'Full sprite parity on minimal profile.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'particle',
        label: 'Particle',
        description: 'Additive/alpha VFX particle surface with soft edge falloff, flipbook blending, and emissive boost.',
        domain: 'surface',
        compilerFamily: 'particle',
        defaultShaderId: 'gltf/particle',
        defaultTemplateId: 'particle-soft-additive',
        stages: buildStagesFromSlots(particleSlots),
        outputSlots: particleSlots,
        passPlan: [
            { id: 'main', phase: 'default', cullMode: 'none', blend: true, depthWrite: false, required: true },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_SUPPORTED, {
            standard: 'Softness, emissive boost, and additive mix execute via gltf/particle.',
            minimal: 'Core blended particle shading supported.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'composable',
        label: 'Composable',
        description: 'Modular Surface Attributes bundle and ordered Material Layering model built on top of PBR.',
        domain: 'surface',
        compilerFamily: 'gltf/composable',
        defaultShaderId: 'gltf/pbr',
        defaultTemplateId: 'composable-layered-metal',
        stages: buildStagesFromSlots(composableSlots, true, 'Composable Stage'),
        outputSlots: composableSlots,
        passPlan: pbrSurfacePasses(),
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Surface Attributes node bundles and ordered layer stacks lower directly to PBR bindings/shaders.',
            minimal: 'Advanced PBR sections trimmed in minimal profile.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'decal',
        label: 'Decal',
        description: 'Projected overlay decal domain with angle attenuation, roughness/normal override, and depth bias.',
        domain: 'decal',
        compilerFamily: 'gltf/decal',
        defaultShaderId: 'gltf/decal',
        defaultTemplateId: 'decal-weathering',
        stages: buildStagesFromSlots(decalSlots, true, 'Decal Stage'),
        outputSlots: decalSlots,
        passPlan: [
            {
                id: 'main',
                phase: 'decal',
                shaderId: 'gltf/decal',
                cullMode: 'back',
                depthTest: true,
                depthWrite: false,
                blend: true,
                required: true,
            },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_UNSUPPORTED, {
            standard: 'Decal blending, angle fade, and depth bias execute via gltf/decal.',
            minimal: 'Projected decals disabled on minimal profile.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'post-process',
        label: 'Post-Process',
        description: 'Fullscreen color grading, vignette, tint, and blend contract integrated with PostProcessStack.',
        domain: 'post-process',
        compilerFamily: 'post-process',
        defaultShaderId: 'post-process/contract',
        defaultTemplateId: 'post-process-vignette-grade',
        stages: buildStagesFromSlots(postProcessSlots, true, 'Post-Process Stage'),
        outputSlots: postProcessSlots,
        passPlan: [
            {
                id: 'main',
                phase: 'post-process',
                shaderId: 'post-process/contract',
                cullMode: 'none',
                depthTest: false,
                depthWrite: false,
                blend: true,
                required: true,
            },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_PARTIAL, {
            standard: 'Fullscreen tint, vignette, saturation, contrast, and blend execute via post-process/contract.',
            minimal: 'Simplified tint and opacity compositing on minimal profile.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
    {
        contractVersion: CONTRACT_VERSION_V2,
        id: 'volume',
        label: 'Volume',
        description:
            'Volumetric raymarched medium with Beer-Lambert extinction, 3D FBM density advection, and Henyey-Greenstein phase scattering.',
        domain: 'volume',
        compilerFamily: 'gltf/volume',
        defaultShaderId: 'gltf/volume',
        defaultTemplateId: 'volume-fog-cloud',
        stages: buildStagesFromSlots(volumeSlots, true, 'Volume Raymarch Stage'),
        outputSlots: volumeSlots,
        passPlan: [
            {
                id: 'volume-raymarch',
                phase: 'volume',
                shaderId: 'gltf/volume',
                cullMode: 'front',
                depthTest: true,
                depthWrite: false,
                blend: true,
                required: true,
            },
        ],
        capabilities: makeCapabilities(CAP_SUPPORTED, CAP_UNSUPPORTED, {
            standard: '16-step volumetric raymarch, Beer-Lambert optical absorption, and phase scattering execute via gltf/volume.',
            minimal: 'Volumetric raymarching is omitted on the minimal WebGL2 profile.',
            native: NATIVE_PENDING_NOTE,
        }),
    },
]);

export const MATERIAL_MODEL_REGISTRY_V2: ReadonlyMap<MaterialModelId, MaterialModelDefinition> =
    new Map<MaterialModelId, MaterialModelDefinition>(
        BUILTIN_MATERIAL_MODELS_V2.map((definition) => [definition.id, definition])
    );

const MATERIAL_DOMAINS_BY_ID: ReadonlyMap<MaterialDomainId, MaterialDomainDefinition> = new Map<
    MaterialDomainId,
    MaterialDomainDefinition
>(MATERIAL_DOMAINS_V2.map((domain) => [domain.id, domain]));

const MINIMAL_STRIPPED_PBR_SECTIONS = new Set([
    'clearcoat',
    'sheen',
    'anisotropy',
    'subsurface',
    'iridescence',
    'transmission',
]);

export const listMaterialModelDefinitionsV2 = (): readonly MaterialModelDefinition[] =>
    BUILTIN_MATERIAL_MODELS_V2;

export const getMaterialModelDefinitionV2 = (
    id: string
): MaterialModelDefinition | undefined => MATERIAL_MODEL_REGISTRY_V2.get(id as MaterialModelId);

export const listMaterialDomainsV2 = (): readonly MaterialDomainDefinition[] => MATERIAL_DOMAINS_V2;

export const getMaterialDomainDefinitionV2 = (
    id: string
): MaterialDomainDefinition | undefined => MATERIAL_DOMAINS_BY_ID.get(id as MaterialDomainId);

export const resolveModelOutputSlotV2 = (
    modelId: string,
    slotKey: string
): MaterialOutputSlotDefinition | undefined =>
    getMaterialModelDefinitionV2(modelId)?.outputSlots.find((slot) => slot.key === slotKey);

export const resolveModelStageSlotsV2 = (
    modelId: string,
    stage: MaterialStageId
): readonly string[] =>
    getMaterialModelDefinitionV2(modelId)?.stages.find((entry) => entry.stage === stage)?.slots ??
    [];

export const resolveMaterialModelCapability = (
    modelId: string,
    profile: MaterialRenderProfileId
): MaterialModelCapabilityMatrixEntry | undefined =>
    getMaterialModelDefinitionV2(modelId)?.capabilities.find(
        (entry) => entry.profile === profile
    );

export const resolveOutputSlotCapability = (
    modelId: string,
    slotKey: string,
    profile: MaterialRenderProfileId
): MaterialCapabilityStatus => {
    const model = getMaterialModelDefinitionV2(modelId);
    const slot = model?.outputSlots.find((entry) => entry.key === slotKey);
    if (!model || !slot) {
        return CAP_UNSUPPORTED;
    }

    const modelCapability =
        model.capabilities.find((entry) => entry.profile === profile)?.status ?? CAP_UNSUPPORTED;
    if (modelCapability === CAP_UNSUPPORTED || slot.capability === CAP_UNSUPPORTED) {
        return CAP_UNSUPPORTED;
    }

    if (profile === 'native') {
        return slot.stage === 'fragment' &&
            (model.id === 'pbr' || model.id === 'unlit') &&
            slot.section === 'surface' &&
            slot.key !== 'opacityMap'
            ? CAP_PARTIAL
            : CAP_UNSUPPORTED;
    }

    if (profile === 'webgl2-minimal') {
        if (model.id === 'pbr' && MINIMAL_STRIPPED_PBR_SECTIONS.has(slot.section)) {
            return CAP_UNSUPPORTED;
        }
        if (modelCapability === CAP_PARTIAL && slot.section !== 'surface') {
            return CAP_PARTIAL;
        }
    }

    return slot.capability;
};

export const resolveModelIdFromLegacyShaderId = (shaderId: string): MaterialModelId => {
    const normalized = shaderId.trim();
    if (normalized === 'Render2D/Sprite' || normalized.startsWith('sprite/')) {
        return 'sprite';
    }
    if (normalized === 'gltf/particle' || normalized === 'scene/particle-point') {
        return 'particle';
    }
    if (normalized === 'gltf/unlit' || normalized.startsWith('gltf/unlit/')) {
        return 'unlit';
    }
    if (normalized === 'gltf/toon' || normalized.startsWith('gltf/toon/')) {
        return 'toon';
    }
    if (normalized === 'gltf/hair' || normalized.startsWith('gltf/hair/')) {
        return 'hair';
    }
    if (normalized === 'gltf/cloth' || normalized.startsWith('gltf/cloth/')) {
        return 'cloth';
    }
    if (normalized === 'gltf/water' || normalized.startsWith('gltf/water/')) {
        return 'water';
    }
    if (normalized === 'gltf/foliage' || normalized.startsWith('gltf/foliage/')) {
        return 'foliage';
    }
    if (normalized === 'gltf/decal' || normalized.startsWith('gltf/decal/')) {
        return 'decal';
    }
    if (normalized === 'post-process/contract' || normalized.startsWith('post-process/')) {
        return 'post-process';
    }
    if (normalized === 'gltf/volume' || normalized.startsWith('gltf/volume/')) {
        return 'volume';
    }
    return 'pbr';
};

export const resolveShaderIdFromModelId = (
    modelId: MaterialModelId,
    currentShaderId?: string
): string => {
    if (modelId === 'unlit' && currentShaderId === 'Render2D/Sprite') {
        return currentShaderId;
    }
    return getMaterialModelDefinitionV2(modelId)?.defaultShaderId ?? 'gltf/pbr';
};

export { isMaterialSlotValueTypeV2 };

export const serializeMaterialModelsV2 = (): string =>
    serializeMaterialContractDocument(CONTRACT_VERSION_V2, BUILTIN_MATERIAL_MODELS_V2, MATERIAL_DOMAINS_V2);

export const validateBuiltinMaterialModelsV2 = (): MaterialContractValidationResult => {
    const errors: string[] = [];

    for (const definition of BUILTIN_MATERIAL_MODELS_V2) {
        errors.push(...validateMaterialModelDefinition(definition, { allowV2: true }).errors);
    }

    return { valid: errors.length === 0, errors };
};
