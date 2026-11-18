export type MaterialModelV1Id = 'pbr' | 'unlit' | 'toon';
export type MaterialModelV2Id =
    | MaterialModelV1Id
    | 'hair'
    | 'cloth'
    | 'water'
    | 'foliage'
    | 'sprite'
    | 'particle'
    | 'composable'
    | 'decal'
    | 'post-process';
export type MaterialModelId = MaterialModelV2Id;
export type MaterialDomainId = 'surface' | 'decal' | 'post-process' | 'volume';
export type MaterialStageId = 'vertex' | 'fragment';
export type MaterialSlotValueType =
    | 'float'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'tex'
    | 'bool'
    | 'surfaceAttributes';
export type MaterialCapabilityStatus = 'supported' | 'partial' | 'unsupported';
export type MaterialRenderProfileId = 'webgl2-standard' | 'webgl2-minimal' | 'native';
export type MaterialCompilerFamily =
    | 'gltf/pbr'
    | 'gltf/unlit'
    | 'gltf/toon'
    | 'gltf/hair'
    | 'gltf/cloth'
    | 'gltf/water'
    | 'gltf/foliage'
    | 'sprite'
    | 'particle'
    | 'gltf/composable'
    | 'gltf/decal'
    | 'post-process';

export interface MaterialOutputSlotDefinition {
    readonly key: string;
    readonly label: string;
    readonly stage: MaterialStageId;
    readonly section: string;
    readonly valueType: MaterialSlotValueType;
    readonly bindingKey?: string;
    readonly semantic: string;
    readonly defaultValue?: string;
    readonly optional?: boolean;
    readonly advanced?: boolean;
    readonly capability: MaterialCapabilityStatus;
    readonly description?: string;
}

export interface MaterialStageContractDefinition {
    readonly stage: MaterialStageId;
    readonly label: string;
    readonly defaultCollapsed: boolean;
    readonly slots: readonly string[];
}

export interface MaterialPassPlanEntryDefinition {
    readonly id: string;
    readonly phase: string;
    readonly shaderId?: string;
    readonly cullMode?: 'none' | 'front' | 'back';
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly blend?: boolean;
    readonly required?: boolean;
    readonly enabledWhenUniformNonZero?: string;
}

export interface MaterialParameterContractEntry {
    readonly id: string;
    readonly label: string;
    readonly valueType: MaterialSlotValueType | 'texture2D';
    readonly group: string;
    readonly order?: number;
    readonly defaultValue?: number | boolean | string | readonly number[];
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly bindingKey?: string;
    readonly semantic?: string;
    readonly keywordId?: string;
    readonly exposed?: boolean;
    readonly tooltip?: string;
}

export interface MaterialModelCapabilityMatrixEntry {
    readonly profile: MaterialRenderProfileId;
    readonly status: MaterialCapabilityStatus;
    readonly notes?: string;
}

export interface MaterialDomainDefinition {
    readonly id: MaterialDomainId;
    readonly label: string;
    readonly description: string;
    readonly defaultModelId?: MaterialModelId;
    readonly supportsVertexOffset: boolean;
    readonly supportsDepthOffset: boolean;
    readonly capabilities: readonly MaterialModelCapabilityMatrixEntry[];
}

export interface MaterialModelDefinition {
    readonly contractVersion: 1 | 2;
    readonly id: MaterialModelId;
    readonly label: string;
    readonly description: string;
    readonly domain: MaterialDomainId;
    readonly compilerFamily: MaterialCompilerFamily;
    readonly defaultShaderId: string;
    readonly stages: readonly MaterialStageContractDefinition[];
    readonly outputSlots: readonly MaterialOutputSlotDefinition[];
    readonly passPlan: readonly MaterialPassPlanEntryDefinition[];
    readonly capabilities: readonly MaterialModelCapabilityMatrixEntry[];
    readonly defaultTemplateId?: string;
}

export interface MaterialTemplateDefinition {
    readonly contractVersion?: 1 | 2;
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly modelId: MaterialModelId;
    readonly category: string;
    readonly tags: readonly string[];
    readonly parameters: readonly MaterialParameterContractEntry[];
}

export interface MaterialContractValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

const CONTRACT_VERSION_V1 = 1;

const DOMAIN_SURFACE: MaterialDomainId = 'surface';
const STAGE_VERTEX: MaterialStageId = 'vertex';
const STAGE_FRAGMENT: MaterialStageId = 'fragment';

const SECTION_VERTEX = 'vertex';
const SECTION_SURFACE = 'surface';
const SECTION_CLEARCOAT = 'clearcoat';
const SECTION_SHEEN = 'sheen';
const SECTION_ANISOTROPY = 'anisotropy';
const SECTION_SUBSURFACE = 'subsurface';
const SECTION_IRIDESCENCE = 'iridescence';
const SECTION_TRANSMISSION = 'transmission';
const SECTION_TOON = 'toon';
const SECTION_OUTLINE = 'outline';

const VALUE_FLOAT: MaterialSlotValueType = 'float';
const VALUE_VEC3: MaterialSlotValueType = 'vec3';
const VALUE_VEC4: MaterialSlotValueType = 'vec4';
const VALUE_TEX: MaterialSlotValueType = 'tex';

const CAPABILITY_SUPPORTED: MaterialCapabilityStatus = 'supported';
const CAPABILITY_PARTIAL: MaterialCapabilityStatus = 'partial';

const UNIFORM_VERTEX_OFFSET = '_VertexOffset';
const UNIFORM_BASE_COLOR_FACTOR = '_BaseColorFactor';
const UNIFORM_METALLIC_FACTOR = '_MetallicFactor';
const UNIFORM_ROUGHNESS_FACTOR = '_RoughnessFactor';
const UNIFORM_NORMAL_TEXTURE = '_NormalTexture';
const UNIFORM_OPACITY_FACTOR = '_OpacityFactor';
const UNIFORM_ALPHA_CUTOFF = '_AlphaCutoff';
const UNIFORM_EMISSIVE_FACTOR = '_EmissiveFactor';
const UNIFORM_CLEARCOAT_FACTOR = '_ClearcoatFactor';
const UNIFORM_CLEARCOAT_ROUGHNESS = '_ClearcoatRoughnessFactor';
const UNIFORM_CLEARCOAT_NORMAL_SCALE = '_ClearcoatNormalTexture_Scale';
const UNIFORM_CLEARCOAT_NORMAL_TEXTURE = '_ClearcoatNormalTexture';
const UNIFORM_SHEEN_FACTOR = '_SheenFactor';
const UNIFORM_SHEEN_COLOR = '_SheenColorFactor';
const UNIFORM_SHEEN_ROUGHNESS = '_SheenRoughnessFactor';
const UNIFORM_ANISOTROPY = '_AnisotropyFactor';
const UNIFORM_ANISOTROPY_ROTATION = '_AnisotropyRotation';
const UNIFORM_SUBSURFACE = '_SubsurfaceFactor';
const UNIFORM_SUBSURFACE_COLOR = '_SubsurfaceColorFactor';
const UNIFORM_SUBSURFACE_RADIUS = '_SubsurfaceThickness';
const UNIFORM_IRIDESCENCE = '_IridescenceFactor';
const UNIFORM_IRIDESCENCE_IOR = '_IridescenceIor';
const UNIFORM_IRIDESCENCE_THICKNESS = '_IridescenceThickness';
const UNIFORM_TRANSMISSION = '_TransmissionFactor';
const UNIFORM_INDEX_OF_REFRACTION = '_IorFactor';
const UNIFORM_THICKNESS = '_ThicknessFactor';
const UNIFORM_SHADOW_COLOR = '_ShadowColor';
const UNIFORM_SHADOW_THRESHOLD = '_ShadowThreshold';
const UNIFORM_SHADOW_SMOOTHNESS = '_ShadowSmoothness';
const UNIFORM_HIGHLIGHT_THRESHOLD = '_HighlightThreshold';
const UNIFORM_HIGHLIGHT_COLOR = '_HighlightColor';
const UNIFORM_RIM_COLOR = '_RimColor';
const UNIFORM_RIM_THRESHOLD = '_RimThreshold';
const UNIFORM_RIM_SMOOTHNESS = '_RimSmoothness';
const UNIFORM_OUTLINE_WIDTH = '_OutlineWidth';
const UNIFORM_OUTLINE_COLOR = '_OutlineColor';

const DEFAULT_SHADOW_COLOR = '[0.2, 0.2, 0.3]';
const DEFAULT_HIGHLIGHT_COLOR = '[1, 1, 1]';
const DEFAULT_RIM_COLOR = '[0.8, 0.9, 1.0]';
const DEFAULT_OUTLINE_COLOR = '[0, 0, 0]';

const PHASE_DEFAULT = 'default';
const PASS_ID_MAIN = 'main';
const PHASE_FORWARD_ADD = 'forward-add';
const PHASE_SHADOW_CASTER = 'shadow-caster';
const PHASE_OUTLINE = 'outline';

const CULL_MODE_FRONT: NonNullable<MaterialPassPlanEntryDefinition['cullMode']> = 'front';

const SHADER_ID_PBR = 'gltf/pbr';
const SHADER_ID_UNLIT = 'gltf/unlit';
const SHADER_ID_TOON = 'gltf/toon';
const SHADER_ID_TOON_OUTLINE = 'gltf/toon-outline';

const SLOT_VERTEX_OFFSET = 'vertexOffset';
const SLOT_BASE_COLOR = 'baseColor';
const SLOT_METALLIC = 'metallic';
const SLOT_ROUGHNESS = 'roughness';
const SLOT_NORMAL = 'normal';
const SLOT_OPACITY = 'opacity';
const SLOT_OPACITY_MASK = 'opacityMask';
const SLOT_EMISSION = 'emission';
const SLOT_CLEARCOAT = 'clearcoat';
const SLOT_CLEARCOAT_ROUGHNESS = 'clearcoatRoughness';
const SLOT_CLEARCOAT_NORMAL = 'clearcoatNormal';
const SLOT_CLEARCOAT_NORMAL_SCALE = 'clearcoatNormalScale';
const SLOT_SHEEN = 'sheen';
const SLOT_SHEEN_COLOR = 'sheenColor';
const SLOT_SHEEN_ROUGHNESS = 'sheenRoughness';
const SLOT_ANISOTROPY = 'anisotropy';
const SLOT_ANISOTROPY_ROTATION = 'anisotropyRotation';
const SLOT_SUBSURFACE = 'subsurface';
const SLOT_SUBSURFACE_COLOR = 'subsurfaceColor';
const SLOT_SUBSURFACE_RADIUS = 'subsurfaceRadius';
const SLOT_IRIDESCENCE = 'iridescence';
const SLOT_IRIDESCENCE_IOR = 'iridescenceIor';
const SLOT_IRIDESCENCE_THICKNESS = 'iridescenceThickness';
const SLOT_TRANSMISSION = 'transmission';
const SLOT_IOR = 'ior';
const SLOT_THICKNESS = 'thickness';
const SLOT_SHADOW_COLOR = 'shadowColor';
const SLOT_SHADOW_THRESHOLD = 'shadowThreshold';
const SLOT_SHADOW_SMOOTHNESS = 'shadowSmoothness';
const SLOT_HIGHLIGHT_THRESHOLD = 'highlightThreshold';
const SLOT_HIGHLIGHT_COLOR = 'highlightColor';
const SLOT_RIM_COLOR = 'rimColor';
const SLOT_RIM_THRESHOLD = 'rimThreshold';
const SLOT_RIM_SMOOTHNESS = 'rimSmoothness';
const SLOT_OUTLINE_WIDTH = 'outlineWidth';
const SLOT_OUTLINE_COLOR = 'outlineColor';

const PBR_CORE_SLOT_KEYS = [
    SLOT_BASE_COLOR,
    SLOT_METALLIC,
    SLOT_ROUGHNESS,
    SLOT_NORMAL,
    SLOT_OPACITY,
    SLOT_OPACITY_MASK,
    SLOT_EMISSION,
] as const;

const PBR_ADVANCED_SLOT_KEYS = [
    SLOT_CLEARCOAT,
    SLOT_CLEARCOAT_ROUGHNESS,
    SLOT_CLEARCOAT_NORMAL,
    SLOT_CLEARCOAT_NORMAL_SCALE,
    SLOT_SHEEN,
    SLOT_SHEEN_COLOR,
    SLOT_SHEEN_ROUGHNESS,
    SLOT_ANISOTROPY,
    SLOT_ANISOTROPY_ROTATION,
    SLOT_SUBSURFACE,
    SLOT_SUBSURFACE_COLOR,
    SLOT_SUBSURFACE_RADIUS,
    SLOT_IRIDESCENCE,
    SLOT_IRIDESCENCE_IOR,
    SLOT_IRIDESCENCE_THICKNESS,
    SLOT_TRANSMISSION,
    SLOT_IOR,
    SLOT_THICKNESS,
] as const;

const UNLIT_FRAGMENT_SLOT_KEYS = [
    SLOT_BASE_COLOR,
    SLOT_OPACITY,
    SLOT_OPACITY_MASK,
    SLOT_EMISSION,
] as const;

const TOON_SURFACE_SLOT_KEYS = [
    SLOT_BASE_COLOR,
    SLOT_NORMAL,
    SLOT_OPACITY,
    SLOT_OPACITY_MASK,
    SLOT_EMISSION,
] as const;

const TOON_SHADING_SLOT_KEYS = [
    SLOT_SHADOW_COLOR,
    SLOT_SHADOW_THRESHOLD,
    SLOT_SHADOW_SMOOTHNESS,
    SLOT_HIGHLIGHT_THRESHOLD,
    SLOT_HIGHLIGHT_COLOR,
    SLOT_RIM_COLOR,
    SLOT_RIM_THRESHOLD,
    SLOT_RIM_SMOOTHNESS,
] as const;

const TOON_OUTLINE_SLOT_KEYS = [SLOT_OUTLINE_WIDTH, SLOT_OUTLINE_COLOR] as const;

const VERTEX_STAGE_LABEL = 'Vertex Stage';
const FRAGMENT_STAGE_LABEL = 'Fragment Stage';

const createVertexOffsetSlot = (): MaterialOutputSlotDefinition => ({
    key: SLOT_VERTEX_OFFSET,
    label: 'Vertex Offset',
    stage: STAGE_VERTEX,
    section: SECTION_VERTEX,
    valueType: VALUE_VEC3,
    bindingKey: UNIFORM_VERTEX_OFFSET,
    semantic: 'vertex.offset',
    capability: CAPABILITY_PARTIAL,
    description: 'Positional displacement applied before the model transform.',
});

const createBaseColorSlot = (): MaterialOutputSlotDefinition => ({
    key: SLOT_BASE_COLOR,
    label: 'Base Color',
    stage: STAGE_FRAGMENT,
    section: SECTION_SURFACE,
    valueType: VALUE_VEC4,
    bindingKey: UNIFORM_BASE_COLOR_FACTOR,
    semantic: 'surface.baseColor',
    capability: CAPABILITY_SUPPORTED,
});

const createNormalSlot = (optional?: boolean): MaterialOutputSlotDefinition => ({
    key: SLOT_NORMAL,
    label: 'Normal',
    stage: STAGE_FRAGMENT,
    section: SECTION_SURFACE,
    valueType: VALUE_TEX,
    bindingKey: UNIFORM_NORMAL_TEXTURE,
    semantic: 'surface.normal',
    optional,
    capability: CAPABILITY_SUPPORTED,
});

const createOpacitySlot = (): MaterialOutputSlotDefinition => ({
    key: SLOT_OPACITY,
    label: 'Opacity',
    stage: STAGE_FRAGMENT,
    section: SECTION_SURFACE,
    valueType: VALUE_FLOAT,
    bindingKey: UNIFORM_OPACITY_FACTOR,
    semantic: 'surface.opacity',
    capability: CAPABILITY_PARTIAL,
    description: 'Single-channel opacity factor; pending a dedicated runtime uniform.',
});

const createOpacityMaskSlot = (): MaterialOutputSlotDefinition => ({
    key: SLOT_OPACITY_MASK,
    label: 'Opacity Mask',
    stage: STAGE_FRAGMENT,
    section: SECTION_SURFACE,
    valueType: VALUE_FLOAT,
    bindingKey: UNIFORM_ALPHA_CUTOFF,
    semantic: 'surface.opacityMask',
    capability: CAPABILITY_SUPPORTED,
});

const createEmissionSlot = (): MaterialOutputSlotDefinition => ({
    key: SLOT_EMISSION,
    label: 'Emission',
    stage: STAGE_FRAGMENT,
    section: SECTION_SURFACE,
    valueType: VALUE_VEC3,
    bindingKey: UNIFORM_EMISSIVE_FACTOR,
    semantic: 'surface.emission',
    capability: CAPABILITY_SUPPORTED,
});

const createPbrSurfaceSlots = (): readonly MaterialOutputSlotDefinition[] => [
    createBaseColorSlot(),
    {
        key: SLOT_METALLIC,
        label: 'Metallic',
        stage: STAGE_FRAGMENT,
        section: SECTION_SURFACE,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_METALLIC_FACTOR,
        semantic: 'surface.metallic',
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_ROUGHNESS,
        label: 'Roughness',
        stage: STAGE_FRAGMENT,
        section: SECTION_SURFACE,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_ROUGHNESS_FACTOR,
        semantic: 'surface.roughness',
        capability: CAPABILITY_SUPPORTED,
    },
    createNormalSlot(),
    createOpacitySlot(),
    createOpacityMaskSlot(),
    createEmissionSlot(),
];

const createAdvancedSlot = (
    key: string,
    label: string,
    section: string,
    valueType: MaterialSlotValueType,
    bindingKey: string,
    capability: MaterialCapabilityStatus = CAPABILITY_SUPPORTED
): MaterialOutputSlotDefinition => ({
    key,
    label,
    stage: STAGE_FRAGMENT,
    section,
    valueType,
    bindingKey,
    semantic: `${section}.${key}`,
    advanced: true,
    capability,
});

const createPbrAdvancedSlots = (): readonly MaterialOutputSlotDefinition[] => [
    createAdvancedSlot(
        SLOT_CLEARCOAT,
        'Clearcoat',
        SECTION_CLEARCOAT,
        VALUE_FLOAT,
        UNIFORM_CLEARCOAT_FACTOR
    ),
    createAdvancedSlot(
        SLOT_CLEARCOAT_ROUGHNESS,
        'Clearcoat Roughness',
        SECTION_CLEARCOAT,
        VALUE_FLOAT,
        UNIFORM_CLEARCOAT_ROUGHNESS
    ),
    createAdvancedSlot(
        SLOT_CLEARCOAT_NORMAL,
        'Clearcoat Normal',
        SECTION_CLEARCOAT,
        VALUE_TEX,
        UNIFORM_CLEARCOAT_NORMAL_TEXTURE
    ),
    createAdvancedSlot(
        SLOT_CLEARCOAT_NORMAL_SCALE,
        'Clearcoat Normal Scale',
        SECTION_CLEARCOAT,
        VALUE_FLOAT,
        UNIFORM_CLEARCOAT_NORMAL_SCALE
    ),
    createAdvancedSlot(SLOT_SHEEN, 'Sheen', SECTION_SHEEN, VALUE_FLOAT, UNIFORM_SHEEN_FACTOR),
    createAdvancedSlot(
        SLOT_SHEEN_COLOR,
        'Sheen Color',
        SECTION_SHEEN,
        VALUE_VEC3,
        UNIFORM_SHEEN_COLOR
    ),
    createAdvancedSlot(
        SLOT_SHEEN_ROUGHNESS,
        'Sheen Roughness',
        SECTION_SHEEN,
        VALUE_FLOAT,
        UNIFORM_SHEEN_ROUGHNESS
    ),
    createAdvancedSlot(
        SLOT_ANISOTROPY,
        'Anisotropy',
        SECTION_ANISOTROPY,
        VALUE_FLOAT,
        UNIFORM_ANISOTROPY
    ),
    createAdvancedSlot(
        SLOT_ANISOTROPY_ROTATION,
        'Anisotropy Rotation',
        SECTION_ANISOTROPY,
        VALUE_FLOAT,
        UNIFORM_ANISOTROPY_ROTATION
    ),
    createAdvancedSlot(
        SLOT_SUBSURFACE,
        'Subsurface',
        SECTION_SUBSURFACE,
        VALUE_FLOAT,
        UNIFORM_SUBSURFACE
    ),
    createAdvancedSlot(
        SLOT_SUBSURFACE_COLOR,
        'Subsurface Color',
        SECTION_SUBSURFACE,
        VALUE_VEC3,
        UNIFORM_SUBSURFACE_COLOR
    ),
    createAdvancedSlot(
        SLOT_SUBSURFACE_RADIUS,
        'Subsurface Radius',
        SECTION_SUBSURFACE,
        VALUE_FLOAT,
        UNIFORM_SUBSURFACE_RADIUS
    ),
    createAdvancedSlot(
        SLOT_IRIDESCENCE,
        'Iridescence',
        SECTION_IRIDESCENCE,
        VALUE_FLOAT,
        UNIFORM_IRIDESCENCE
    ),
    createAdvancedSlot(
        SLOT_IRIDESCENCE_IOR,
        'Iridescence Index Of Refraction',
        SECTION_IRIDESCENCE,
        VALUE_FLOAT,
        UNIFORM_IRIDESCENCE_IOR
    ),
    createAdvancedSlot(
        SLOT_IRIDESCENCE_THICKNESS,
        'Iridescence Thickness',
        SECTION_IRIDESCENCE,
        VALUE_FLOAT,
        UNIFORM_IRIDESCENCE_THICKNESS
    ),
    createAdvancedSlot(
        SLOT_TRANSMISSION,
        'Transmission',
        SECTION_TRANSMISSION,
        VALUE_FLOAT,
        UNIFORM_TRANSMISSION
    ),
    createAdvancedSlot(
        SLOT_IOR,
        'Index Of Refraction',
        SECTION_TRANSMISSION,
        VALUE_FLOAT,
        UNIFORM_INDEX_OF_REFRACTION
    ),
    createAdvancedSlot(
        SLOT_THICKNESS,
        'Thickness',
        SECTION_TRANSMISSION,
        VALUE_FLOAT,
        UNIFORM_THICKNESS
    ),
];

const createToonShadingSlots = (): readonly MaterialOutputSlotDefinition[] => [
    {
        key: SLOT_SHADOW_COLOR,
        label: 'Shadow Color',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_VEC3,
        bindingKey: UNIFORM_SHADOW_COLOR,
        semantic: 'toon.shadowColor',
        defaultValue: DEFAULT_SHADOW_COLOR,
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_SHADOW_THRESHOLD,
        label: 'Shadow Threshold',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_SHADOW_THRESHOLD,
        semantic: 'toon.shadowThreshold',
        defaultValue: '0.5',
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_SHADOW_SMOOTHNESS,
        label: 'Shadow Smoothness',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_SHADOW_SMOOTHNESS,
        semantic: 'toon.shadowSmoothness',
        defaultValue: '0.05',
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_HIGHLIGHT_THRESHOLD,
        label: 'Highlight Threshold',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_HIGHLIGHT_THRESHOLD,
        semantic: 'toon.highlightThreshold',
        defaultValue: '0.8',
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_HIGHLIGHT_COLOR,
        label: 'Highlight Color',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_VEC3,
        bindingKey: UNIFORM_HIGHLIGHT_COLOR,
        semantic: 'toon.highlightColor',
        defaultValue: DEFAULT_HIGHLIGHT_COLOR,
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_RIM_COLOR,
        label: 'Rim Color',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_VEC3,
        bindingKey: UNIFORM_RIM_COLOR,
        semantic: 'toon.rimColor',
        defaultValue: DEFAULT_RIM_COLOR,
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_RIM_THRESHOLD,
        label: 'Rim Threshold',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_RIM_THRESHOLD,
        semantic: 'toon.rimThreshold',
        defaultValue: '0.6',
        capability: CAPABILITY_SUPPORTED,
    },
    {
        key: SLOT_RIM_SMOOTHNESS,
        label: 'Rim Smoothness',
        stage: STAGE_FRAGMENT,
        section: SECTION_TOON,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_RIM_SMOOTHNESS,
        semantic: 'toon.rimSmoothness',
        defaultValue: '0.1',
        capability: CAPABILITY_SUPPORTED,
    },
];

const createToonOutlineSlots = (): readonly MaterialOutputSlotDefinition[] => [
    {
        key: SLOT_OUTLINE_WIDTH,
        label: 'Outline Width',
        stage: STAGE_FRAGMENT,
        section: SECTION_OUTLINE,
        valueType: VALUE_FLOAT,
        bindingKey: UNIFORM_OUTLINE_WIDTH,
        semantic: 'toon.outlineWidth',
        defaultValue: '0',
        capability: CAPABILITY_PARTIAL,
        description: 'Gates the outline pass; lowered as inverted-hull vertex extrusion.',
    },
    {
        key: SLOT_OUTLINE_COLOR,
        label: 'Outline Color',
        stage: STAGE_FRAGMENT,
        section: SECTION_OUTLINE,
        valueType: VALUE_VEC3,
        bindingKey: UNIFORM_OUTLINE_COLOR,
        semantic: 'toon.outlineColor',
        defaultValue: DEFAULT_OUTLINE_COLOR,
        capability: CAPABILITY_SUPPORTED,
    },
];

const createStageContract = (
    stage: MaterialStageId,
    label: string,
    defaultCollapsed: boolean,
    slots: readonly string[]
): MaterialStageContractDefinition => ({
    stage,
    label,
    defaultCollapsed,
    slots,
});

const NATIVE_CAPABILITY_NOTES = 'Native render profile material catalog is not published yet.';

const createStandardCapabilities = (
    standardNotes: string,
    minimalNotes: string,
    nativeNotes: string
): readonly MaterialModelCapabilityMatrixEntry[] => [
    { profile: 'webgl2-standard', status: CAPABILITY_SUPPORTED, notes: standardNotes },
    { profile: 'webgl2-minimal', status: CAPABILITY_PARTIAL, notes: minimalNotes },
    { profile: 'native', status: CAPABILITY_PARTIAL, notes: nativeNotes },
];

const PBR_DESCRIPTION =
    'Physically based surface material model with advanced clearcoat, sheen, anisotropy, subsurface, iridescence and transmission sections.';
const UNLIT_DESCRIPTION = 'Unlit surface material model that outputs base color without lighting.';
const TOON_DESCRIPTION =
    'Stylized toon material model with shadow, highlight and rim bands plus an inverted-hull outline pass.';

export const BUILTIN_MATERIAL_MODELS_V1: readonly MaterialModelDefinition[] = Object.freeze([
    {
        contractVersion: CONTRACT_VERSION_V1,
        id: 'pbr',
        label: 'PBR',
        description: PBR_DESCRIPTION,
        domain: DOMAIN_SURFACE,
        compilerFamily: SHADER_ID_PBR,
        defaultShaderId: SHADER_ID_PBR,
        stages: Object.freeze([
            createStageContract(STAGE_VERTEX, VERTEX_STAGE_LABEL, true, [SLOT_VERTEX_OFFSET]),
            createStageContract(
                STAGE_FRAGMENT,
                FRAGMENT_STAGE_LABEL,
                false,
                Object.freeze([...PBR_CORE_SLOT_KEYS, ...PBR_ADVANCED_SLOT_KEYS])
            ),
        ]),
        outputSlots: Object.freeze([
            createVertexOffsetSlot(),
            ...createPbrSurfaceSlots(),
            ...createPbrAdvancedSlots(),
        ]),
        passPlan: Object.freeze([
            { id: PASS_ID_MAIN, phase: PHASE_DEFAULT, required: true },
            { id: PHASE_FORWARD_ADD, phase: PHASE_FORWARD_ADD },
            { id: PHASE_SHADOW_CASTER, phase: PHASE_SHADOW_CASTER },
        ]),
        capabilities: createStandardCapabilities(
            'Vertex Offset awaits compiler lowering; every other declared section is lowered.',
            'Reduced light budget and disabled advanced sections lower as partial coverage.',
            NATIVE_CAPABILITY_NOTES
        ),
    },
    {
        contractVersion: CONTRACT_VERSION_V1,
        id: 'unlit',
        label: 'Unlit',
        description: UNLIT_DESCRIPTION,
        domain: DOMAIN_SURFACE,
        compilerFamily: SHADER_ID_UNLIT,
        defaultShaderId: SHADER_ID_UNLIT,
        stages: Object.freeze([
            createStageContract(STAGE_VERTEX, VERTEX_STAGE_LABEL, true, [SLOT_VERTEX_OFFSET]),
            createStageContract(
                STAGE_FRAGMENT,
                FRAGMENT_STAGE_LABEL,
                false,
                Object.freeze([...UNLIT_FRAGMENT_SLOT_KEYS])
            ),
        ]),
        outputSlots: Object.freeze([
            createVertexOffsetSlot(),
            createBaseColorSlot(),
            createOpacitySlot(),
            createOpacityMaskSlot(),
            createEmissionSlot(),
        ]),
        passPlan: Object.freeze([
            { id: PASS_ID_MAIN, phase: PHASE_DEFAULT, required: true },
        ]),
        capabilities: createStandardCapabilities(
            'Vertex Offset awaits compiler lowering; surface slots are lowered completely.',
            'Fog and alpha mode handling are reduced in the minimal WebGL2 render profile.',
            NATIVE_CAPABILITY_NOTES
        ),
    },
    {
        contractVersion: CONTRACT_VERSION_V1,
        id: 'toon',
        label: 'Toon',
        description: TOON_DESCRIPTION,
        domain: DOMAIN_SURFACE,
        compilerFamily: SHADER_ID_TOON,
        defaultShaderId: SHADER_ID_TOON,
        stages: Object.freeze([
            createStageContract(STAGE_VERTEX, VERTEX_STAGE_LABEL, true, [SLOT_VERTEX_OFFSET]),
            createStageContract(
                STAGE_FRAGMENT,
                FRAGMENT_STAGE_LABEL,
                false,
                Object.freeze([
                    ...TOON_SURFACE_SLOT_KEYS,
                    ...TOON_SHADING_SLOT_KEYS,
                    ...TOON_OUTLINE_SLOT_KEYS,
                ])
            ),
        ]),
        outputSlots: Object.freeze([
            createVertexOffsetSlot(),
            createBaseColorSlot(),
            createNormalSlot(true),
            createOpacitySlot(),
            createOpacityMaskSlot(),
            createEmissionSlot(),
            ...createToonShadingSlots(),
            ...createToonOutlineSlots(),
        ]),
        passPlan: Object.freeze<readonly MaterialPassPlanEntryDefinition[]>([
            { id: PASS_ID_MAIN, phase: PHASE_DEFAULT, required: true },
            { id: PHASE_FORWARD_ADD, phase: PHASE_FORWARD_ADD },
            { id: PHASE_SHADOW_CASTER, phase: PHASE_SHADOW_CASTER },
            {
                id: PHASE_OUTLINE,
                phase: PHASE_OUTLINE,
                shaderId: SHADER_ID_TOON_OUTLINE,
                cullMode: CULL_MODE_FRONT,
                depthTest: true,
                depthWrite: true,
                enabledWhenUniformNonZero: UNIFORM_OUTLINE_WIDTH,
            },
        ]),
        capabilities: createStandardCapabilities(
            'Runtime lowers surface, toon and the inverted-hull outline; Editor graph authoring parity is not verified here.',
            'Reduced light budget; advanced sections lower as partial coverage.',
            NATIVE_CAPABILITY_NOTES
        ),
    },
]);

// The build tooling for this package has no JSON loader plugin, so the shipped
// material-models.v1.json is mirrored from this registry instead of imported.
type CanonicalJsonValue =
    | string
    | number
    | boolean
    | null
    | readonly CanonicalJsonValue[]
    | readonly (readonly [string, CanonicalJsonValue])[];

const INDENT_UNIT = '    ';

const serializeCanonicalEntry = (
    entry: readonly [string, CanonicalJsonValue],
    depth: number
): string => `${JSON.stringify(entry[0])}: ${serializeCanonicalValue(entry[1], depth)}`;

const serializeCanonicalMembers = (
    entries: readonly (readonly [string, CanonicalJsonValue])[],
    depth: number
): string => {
    const memberIndent = INDENT_UNIT.repeat(depth + 1);
    const body = entries.map((entry) =>
        `${memberIndent}${serializeCanonicalEntry(entry, depth + 1)}`
    );

    return `{\n${body.join(',\n')}\n${INDENT_UNIT.repeat(depth)}}`;
};

const serializeCanonicalArray = (
    values: readonly CanonicalJsonValue[],
    depth: number
): string => {
    if (values.length === 0) {
        return '[]';
    }

    const itemIndent = INDENT_UNIT.repeat(depth + 1);
    const body = values.map((value) => `${itemIndent}${serializeCanonicalValue(value, depth + 1)}`);

    return `[\n${body.join(',\n')}\n${INDENT_UNIT.repeat(depth)}]`;
};

const serializeCanonicalValue = (value: CanonicalJsonValue, depth: number): string => {
    if (Array.isArray(value)) {
        const isMemberList = value.every(
            (item) => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string'
        );

        if (isMemberList) {
            return serializeCanonicalMembers(
                value as readonly (readonly [string, CanonicalJsonValue])[],
                depth
            );
        }

        return serializeCanonicalArray(value, depth);
    }

    return JSON.stringify(value);
};

const optionalEntry = (
    key: string,
    value: string | number | boolean | undefined
): readonly (readonly [string, CanonicalJsonValue])[] =>
    value === undefined ? [] : [[key, value]];

const serializeOutputSlot = (slot: MaterialOutputSlotDefinition): CanonicalJsonValue => [
    ['key', slot.key],
    ['label', slot.label],
    ['stage', slot.stage],
    ['section', slot.section],
    ['valueType', slot.valueType],
    ...optionalEntry('bindingKey', slot.bindingKey),
    ['semantic', slot.semantic],
    ...optionalEntry('defaultValue', slot.defaultValue),
    ...optionalEntry('optional', slot.optional),
    ...optionalEntry('advanced', slot.advanced),
    ['capability', slot.capability],
    ...optionalEntry('description', slot.description),
];

const serializeStageContract = (stage: MaterialStageContractDefinition): CanonicalJsonValue => [
    ['stage', stage.stage],
    ['label', stage.label],
    ['defaultCollapsed', stage.defaultCollapsed],
    ['slots', [...stage.slots]],
];

const serializePassPlanEntry = (entry: MaterialPassPlanEntryDefinition): CanonicalJsonValue => [
    ['id', entry.id],
    ['phase', entry.phase],
    ...optionalEntry('shaderId', entry.shaderId),
    ...optionalEntry('cullMode', entry.cullMode),
    ...optionalEntry('depthTest', entry.depthTest),
    ...optionalEntry('depthWrite', entry.depthWrite),
    ...optionalEntry('blend', entry.blend),
    ...optionalEntry('required', entry.required),
    ...optionalEntry('enabledWhenUniformNonZero', entry.enabledWhenUniformNonZero),
];

const serializeCapabilityEntry = (
    entry: MaterialModelCapabilityMatrixEntry
): CanonicalJsonValue => [
    ['profile', entry.profile],
    ['status', entry.status],
    ...optionalEntry('notes', entry.notes),
];

const serializeModelDefinition = (model: MaterialModelDefinition): CanonicalJsonValue => [
    ['contractVersion', model.contractVersion],
    ['id', model.id],
    ['label', model.label],
    ['description', model.description],
    ['domain', model.domain],
    ['compilerFamily', model.compilerFamily],
    ['defaultShaderId', model.defaultShaderId],
    ['stages', model.stages.map(serializeStageContract)],
    ['outputSlots', model.outputSlots.map(serializeOutputSlot)],
    ['passPlan', model.passPlan.map(serializePassPlanEntry)],
    ['capabilities', model.capabilities.map(serializeCapabilityEntry)],
    ...optionalEntry('defaultTemplateId', model.defaultTemplateId),
];

export const serializeMaterialModelsV1 = (): string =>
    `${serializeCanonicalValue(
        [
            ['contractVersion', CONTRACT_VERSION_V1],
            ['models', BUILTIN_MATERIAL_MODELS_V1.map(serializeModelDefinition)],
        ],
        0
    )}\n`;

export const serializeMaterialContractDocument = (
    contractVersion: 1 | 2,
    models: readonly MaterialModelDefinition[],
    domains?: readonly MaterialDomainDefinition[]
): string => {
    const entries: (readonly [string, CanonicalJsonValue])[] = [
        ['contractVersion', contractVersion],
        ...(domains
            ? ([
                  [
                      'domains',
                      domains.map(
                          (domain): CanonicalJsonValue => [
                              ['id', domain.id],
                              ['label', domain.label],
                              ['description', domain.description],
                              ...optionalEntry('defaultModelId', domain.defaultModelId),
                              ['supportsVertexOffset', domain.supportsVertexOffset],
                              ['supportsDepthOffset', domain.supportsDepthOffset],
                              ['capabilities', domain.capabilities.map(serializeCapabilityEntry)],
                          ]
                      ),
                  ],
              ] as const)
            : []),
        ['models', models.map(serializeModelDefinition)],
    ];
    return `${serializeCanonicalValue(entries, 0)}\n`;
};

const MATERIAL_MODEL_DEFINITIONS_BY_ID: ReadonlyMap<MaterialModelId, MaterialModelDefinition> =
    new Map<MaterialModelId, MaterialModelDefinition>(
        BUILTIN_MATERIAL_MODELS_V1.map((definition) => [definition.id, definition])
    );

const V1_MODEL_ID_VALUES: readonly MaterialModelV1Id[] = ['pbr', 'unlit', 'toon'];
const V2_MODEL_ID_VALUES: readonly MaterialModelV2Id[] = [
    'pbr',
    'unlit',
    'toon',
    'hair',
    'cloth',
    'water',
    'foliage',
    'sprite',
    'particle',
    'composable',
    'decal',
    'post-process',
];
const V1_DOMAIN_ID_VALUES: readonly MaterialDomainId[] = ['surface'];
const V2_DOMAIN_ID_VALUES: readonly MaterialDomainId[] = [
    'surface',
    'decal',
    'post-process',
    'volume',
];
const STAGE_ID_VALUES: readonly MaterialStageId[] = ['vertex', 'fragment'];
const SLOT_VALUE_TYPE_VALUES: readonly MaterialSlotValueType[] = [
    'float',
    'vec2',
    'vec3',
    'vec4',
    'tex',
    'bool',
];
const V2_SLOT_VALUE_TYPE_VALUES: readonly MaterialSlotValueType[] = [
    ...SLOT_VALUE_TYPE_VALUES,
    'surfaceAttributes',
];
const CAPABILITY_STATUS_VALUES: readonly MaterialCapabilityStatus[] = [
    'supported',
    'partial',
    'unsupported',
];
const V1_COMPILER_FAMILY_VALUES: readonly MaterialCompilerFamily[] = [
    'gltf/pbr',
    'gltf/unlit',
    'gltf/toon',
];
const V2_COMPILER_FAMILY_VALUES: readonly MaterialCompilerFamily[] = [
    ...V1_COMPILER_FAMILY_VALUES,
    'gltf/hair',
    'gltf/cloth',
    'gltf/water',
    'gltf/foliage',
    'sprite',
    'particle',
    'gltf/composable',
    'gltf/decal',
    'post-process',
];
const CULL_MODE_VALUES: readonly NonNullable<MaterialPassPlanEntryDefinition['cullMode']>[] = [
    'none',
    'front',
    'back',
];
const CAPABILITY_PROFILE_VALUES: readonly MaterialModelCapabilityMatrixEntry['profile'][] = [
    'webgl2-standard',
    'webgl2-minimal',
    'native',
];

export const isMaterialSlotValueType = (value: unknown): value is MaterialSlotValueType =>
    typeof value === 'string' && SLOT_VALUE_TYPE_VALUES.includes(value as MaterialSlotValueType);

export const isMaterialSlotValueTypeV2 = (value: unknown): value is MaterialSlotValueType =>
    typeof value === 'string' && V2_SLOT_VALUE_TYPE_VALUES.includes(value as MaterialSlotValueType);

export const getMaterialModelDefinition = (
    id: MaterialModelId
): MaterialModelDefinition | undefined => MATERIAL_MODEL_DEFINITIONS_BY_ID.get(id);

export const listMaterialModelDefinitions = (): readonly MaterialModelDefinition[] =>
    BUILTIN_MATERIAL_MODELS_V1;

export const resolveModelOutputSlot = (
    modelId: MaterialModelId,
    slotKey: string
): MaterialOutputSlotDefinition | undefined =>
    MATERIAL_MODEL_DEFINITIONS_BY_ID.get(modelId)?.outputSlots.find(
        (slot) => slot.key === slotKey
    );

const vectorComponentPattern = /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;

const parseDefaultValueForValueType = (
    valueType: MaterialSlotValueType,
    rawValue: string
): boolean => {
    if (valueType === 'tex' || valueType === 'surfaceAttributes') {
        return rawValue.trim().length > 0;
    }

    if (valueType === 'bool') {
        return rawValue === 'true' || rawValue === 'false';
    }

    if (valueType === 'float') {
        return Number.isFinite(Number(rawValue));
    }

    const components = rawValue.match(
        /^\[\s*([^,\]]*)\s*(?:,\s*([^,\]]*)\s*(?:,\s*([^,\]]*)\s*(?:,\s*([^,\]]*)\s*)?)?)?\]$/
    );
    if (!components) {
        return false;
    }

    const expectedCount = valueType === 'vec2' ? 2 : valueType === 'vec4' ? 4 : 3;
    let parsedCount = 0;
    for (let index = 1; index <= 4; index += 1) {
        const component = components[index];
        if (component === undefined) {
            continue;
        }
        if (!vectorComponentPattern.test(component)) {
            return false;
        }
        parsedCount += 1;
    }

    return parsedCount === expectedCount;
};

const collectDuplicateKeys = (keys: readonly string[]): readonly string[] => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const key of keys) {
        if (seen.has(key)) {
            duplicates.add(key);
            continue;
        }
        seen.add(key);
    }

    return [...duplicates].sort();
};

const joinErrorPath = (prefix: string, segment: string): string => `${prefix}[${segment}]`;

const collectDuplicateStageIds = (
    stages: readonly MaterialStageContractDefinition[]
): readonly string[] => collectDuplicateKeys(stages.map((stage) => stage.stage));

const validateOutputSlots = (
    definition: MaterialModelDefinition,
    errors: string[],
    allowV2: boolean
): ReadonlyMap<string, MaterialOutputSlotDefinition> => {
    const slotsByKey = new Map<string, MaterialOutputSlotDefinition>();
    const allowedValueTypes = allowV2 ? V2_SLOT_VALUE_TYPE_VALUES : SLOT_VALUE_TYPE_VALUES;
    const checkSlotType = allowV2 ? isMaterialSlotValueTypeV2 : isMaterialSlotValueType;

    for (const duplicate of collectDuplicateKeys(definition.outputSlots.map((slot) => slot.key))) {
        errors.push(`outputSlots contains duplicate slot key '${duplicate}'.`);
    }

    definition.outputSlots.forEach((slot, slotIndex) => {
        const path = joinErrorPath('outputSlots', String(slotIndex));
        const label = slot.key.length > 0 ? slot.key : `index ${slotIndex}`;

        if (slot.key.length === 0) {
            errors.push(`${path} ('${label}') has an empty key.`);
        }
        if (slot.label.length === 0) {
            errors.push(`outputSlot '${label}' has an empty label.`);
        }
        if (slot.section.length === 0) {
            errors.push(`outputSlot '${label}' has an empty section.`);
        }
        if (!STAGE_ID_VALUES.includes(slot.stage)) {
            errors.push(`outputSlot '${label}' has invalid stage '${slot.stage}'.`);
        }
        if (!allowedValueTypes.includes(slot.valueType)) {
            errors.push(`outputSlot '${label}' has invalid valueType '${slot.valueType}'.`);
        }
        if (!CAPABILITY_STATUS_VALUES.includes(slot.capability)) {
            errors.push(`outputSlot '${label}' has invalid capability '${slot.capability}'.`);
        }
        if (slot.semantic.length === 0) {
            errors.push(`outputSlot '${label}' has an empty semantic.`);
        }
        if (slot.bindingKey !== undefined) {
            if (slot.bindingKey.length === 0) {
                errors.push(`outputSlot '${label}' has an empty bindingKey.`);
            } else if (!slot.bindingKey.startsWith('_')) {
                errors.push(
                    `outputSlot '${label}' bindingKey '${slot.bindingKey}' must start with '_'.`
                );
            }
        }
        if (slot.defaultValue !== undefined && !checkSlotType(slot.valueType)) {
            errors.push(`outputSlot '${label}' has an unsupported valueType declaration.`);
        } else if (
            slot.defaultValue !== undefined &&
            !parseDefaultValueForValueType(slot.valueType, slot.defaultValue)
        ) {
            errors.push(
                `outputSlot '${label}' defaultValue '${slot.defaultValue}' does not parse as valueType '${slot.valueType}'.`
            );
        }

        if (slot.key.length > 0 && !slotsByKey.has(slot.key)) {
            slotsByKey.set(slot.key, slot);
        }
    });

    return slotsByKey;
};

const validateStageContracts = (
    definition: MaterialModelDefinition,
    slotsByKey: ReadonlyMap<string, MaterialOutputSlotDefinition>,
    errors: string[]
): void => {
    const referencedKeys = new Set<string>();

    for (const duplicate of collectDuplicateStageIds(definition.stages)) {
        errors.push(`stages declares stage '${duplicate}' more than once.`);
    }

    definition.stages.forEach((stage, stageIndex) => {
        const path = joinErrorPath('stages', String(stageIndex));

        if (!STAGE_ID_VALUES.includes(stage.stage)) {
            errors.push(`${path} has invalid stage '${stage.stage}'.`);
        }
        if (stage.label.length === 0) {
            errors.push(`${path} has an empty label.`);
        }

        for (const duplicate of collectDuplicateKeys(stage.slots)) {
            errors.push(`stage '${stage.stage}' lists slot key '${duplicate}' more than once.`);
        }

        stage.slots.forEach((slotKey, slotIndex) => {
            const slotPath = `${path}.slots[${slotIndex}]`;
            const slot = slotsByKey.get(slotKey);

            if (!slot) {
                errors.push(
                    `${slotPath} references undeclared outputSlot '${slotKey}' on model '${definition.id}'.`
                );
                return;
            }
            if (slot.stage !== stage.stage) {
                errors.push(
                    `stage '${stage.stage}' lists outputSlot '${slotKey}' declared for stage '${slot.stage}'.`
                );
            }
            if (referencedKeys.has(slotKey)) {
                errors.push(`outputSlot '${slotKey}' is referenced by more than one stage.`);
            }
            referencedKeys.add(slotKey);
        });
    });

    for (const slotKey of slotsByKey.keys()) {
        if (!referencedKeys.has(slotKey)) {
            errors.push(`outputSlot '${slotKey}' is not referenced by any stage contract.`);
        }
    }
};

const validatePassPlan = (definition: MaterialModelDefinition, errors: string[]): void => {
    const passIds: string[] = [];

    definition.passPlan.forEach((entry, entryIndex) => {
        const path = joinErrorPath('passPlan', String(entryIndex));

        if (entry.id.length === 0) {
            errors.push(`${path} has an empty id.`);
        } else if (passIds.includes(entry.id)) {
            errors.push(`passPlan contains duplicate pass id '${entry.id}'.`);
        } else {
            passIds.push(entry.id);
        }

        if (entry.phase.length === 0) {
            errors.push(`passPlan entry '${entry.id}' has an empty phase.`);
        }
        if (entry.shaderId !== undefined && entry.shaderId.length === 0) {
            errors.push(`passPlan entry '${entry.id}' has an empty shaderId.`);
        }
        if (entry.cullMode !== undefined && !CULL_MODE_VALUES.includes(entry.cullMode)) {
            errors.push(
                `passPlan entry '${entry.id}' has invalid cullMode '${entry.cullMode}'.`
            );
        }
        if (
            entry.enabledWhenUniformNonZero !== undefined &&
            !entry.enabledWhenUniformNonZero.startsWith('_')
        ) {
            errors.push(
                `passPlan entry '${entry.id}' enabledWhenUniformNonZero '${entry.enabledWhenUniformNonZero}' must start with '_'.`
            );
        }
    });
};

const validateCapabilities = (definition: MaterialModelDefinition, errors: string[]): void => {
    const profiles: string[] = [];

    definition.capabilities.forEach((entry, entryIndex) => {
        const path = joinErrorPath('capabilities', String(entryIndex));

        if (!CAPABILITY_PROFILE_VALUES.includes(entry.profile)) {
            errors.push(`${path} has invalid profile '${entry.profile}'.`);
        } else if (profiles.includes(entry.profile)) {
            errors.push(`capabilities contains duplicate profile '${entry.profile}'.`);
        } else {
            profiles.push(entry.profile);
        }

        if (!CAPABILITY_STATUS_VALUES.includes(entry.status)) {
            errors.push(`capability '${entry.profile}' has invalid status '${entry.status}'.`);
        }
    });
};

export interface MaterialModelValidationOptions {
    readonly allowV2?: boolean;
}

export const validateMaterialModelDefinition = (
    definition: MaterialModelDefinition,
    options: MaterialModelValidationOptions = {}
): MaterialContractValidationResult => {
    const errors: string[] = [];
    const allowV2 = options.allowV2 === true;
    const allowedModels = allowV2 ? V2_MODEL_ID_VALUES : V1_MODEL_ID_VALUES;
    const allowedDomains = allowV2 ? V2_DOMAIN_ID_VALUES : V1_DOMAIN_ID_VALUES;
    const allowedFamilies = allowV2 ? V2_COMPILER_FAMILY_VALUES : V1_COMPILER_FAMILY_VALUES;

    if (
        allowV2
            ? definition.contractVersion !== 1 && definition.contractVersion !== 2
            : definition.contractVersion !== CONTRACT_VERSION_V1
    ) {
        errors.push(
            `material model '${definition.id}' has contractVersion ${String(
                definition.contractVersion
            )}; expected ${allowV2 ? '1 or 2' : CONTRACT_VERSION_V1}.`
        );
    }
    if (definition.id.length === 0) {
        errors.push('material model has an empty id.');
    } else if (!allowedModels.includes(definition.id)) {
        errors.push(
            `material model id '${definition.id}' is not a ${allowV2 ? 'V2' : 'V1'} model id.`
        );
    }
    if (definition.label.length === 0) {
        errors.push(`material model '${definition.id}' has an empty label.`);
    }
    if (definition.description.length === 0) {
        errors.push(`material model '${definition.id}' has an empty description.`);
    }
    if (!allowedDomains.includes(definition.domain)) {
        errors.push(`material model '${definition.id}' has invalid domain '${definition.domain}'.`);
    }
    if (!allowedFamilies.includes(definition.compilerFamily)) {
        errors.push(
            `material model '${definition.id}' has invalid compilerFamily '${definition.compilerFamily}'.`
        );
    }
    if (definition.defaultShaderId.length === 0) {
        errors.push(`material model '${definition.id}' has an empty defaultShaderId.`);
    }
    if (definition.stages.length === 0) {
        errors.push(`material model '${definition.id}' declares no stage contracts.`);
    }
    if (definition.outputSlots.length === 0) {
        errors.push(`material model '${definition.id}' declares no output slots.`);
    }
    if (definition.passPlan.length === 0) {
        errors.push(`material model '${definition.id}' declares no pass plan entries.`);
    }
    if (definition.capabilities.length === 0) {
        errors.push(`material model '${definition.id}' declares no capability matrix entries.`);
    }

    const slotsByKey = validateOutputSlots(definition, errors, allowV2);
    validateStageContracts(definition, slotsByKey, errors);
    validatePassPlan(definition, errors);
    validateCapabilities(definition, errors);

    return { valid: errors.length === 0, errors };
};

export const validateBuiltinMaterialModelsV1 = (): MaterialContractValidationResult => {
    const errors: string[] = [];

    for (const definition of BUILTIN_MATERIAL_MODELS_V1) {
        errors.push(...validateMaterialModelDefinition(definition).errors);
    }

    return { valid: errors.length === 0, errors };
};

export const MATERIAL_MODEL_REGISTRY_V1: ReadonlyMap<MaterialModelId, MaterialModelDefinition> =
    MATERIAL_MODEL_DEFINITIONS_BY_ID;
