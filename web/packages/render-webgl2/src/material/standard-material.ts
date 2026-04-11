import {
    BaseMaterialComponent,
    MaterialType,
    MaterialProperty,
    MaterialKeyword,
    StandardMaterialConfig,
    Vec2,
    Vec3,
    Vec4,
    BlendMode,
    CullMode,
    ShadowCasting,
} from './base-material';

const STANDARD_PROPERTIES: MaterialProperty[] = [
    {
        name: '_MainTex',
        displayName: 'Albedo',
        type: 'texture',
        defaultValue: null,
        category: 'Main Maps',
        tooltip: 'Albedo (RGB) and Transparency (A)',
    },
    {
        name: '_Color',
        displayName: 'Color',
        type: 'color',
        defaultValue: { x: 1, y: 1, z: 1, w: 1 },
        category: 'Main Maps',
        tooltip: 'Main color tint',
    },

    {
        name: '_MetallicGlossMap',
        displayName: 'Metallic',
        type: 'texture',
        defaultValue: null,
        category: 'Main Maps',
        tooltip: 'Metallic (R) and Smoothness (A)',
    },
    {
        name: '_Metallic',
        displayName: 'Metallic',
        type: 'float',
        defaultValue: 0.0,
        range: { min: 0, max: 1 },
        category: 'Main Maps',
        tooltip: 'How metallic the surface is',
    },
    {
        name: '_Glossiness',
        displayName: 'Smoothness',
        type: 'float',
        defaultValue: 0.5,
        range: { min: 0, max: 1 },
        category: 'Main Maps',
        tooltip: 'How smooth the surface is',
    },
    {
        name: '_GlossMapScale',
        displayName: 'Smoothness Scale',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 1 },
        category: 'Main Maps',
        tooltip: 'Scale for smoothness from texture',
    },
    {
        name: '_SmoothnessTextureChannel',
        displayName: 'Source',
        type: 'int',
        defaultValue: 0,
        category: 'Main Maps',
        tooltip: 'Smoothness texture channel',
    },

    {
        name: '_BumpMap',
        displayName: 'Normal Map',
        type: 'texture',
        defaultValue: null,
        category: 'Secondary Maps',
        tooltip: 'Normal Map',
    },
    {
        name: '_BumpScale',
        displayName: 'Normal Map Scale',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 2 },
        category: 'Secondary Maps',
        tooltip: 'Strength of normal map effect',
    },

    {
        name: '_ParallaxMap',
        displayName: 'Height Map',
        type: 'texture',
        defaultValue: null,
        category: 'Secondary Maps',
        tooltip: 'Height Map (G)',
    },
    {
        name: '_Parallax',
        displayName: 'Height Scale',
        type: 'float',
        defaultValue: 0.02,
        range: { min: 0.005, max: 0.08 },
        category: 'Secondary Maps',
        tooltip: 'Height map parallax depth',
    },

    {
        name: '_OcclusionMap',
        displayName: 'Occlusion',
        type: 'texture',
        defaultValue: null,
        category: 'Secondary Maps',
        tooltip: 'Occlusion (G)',
    },
    {
        name: '_OcclusionStrength',
        displayName: 'Strength',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 1 },
        category: 'Secondary Maps',
        tooltip: 'Occlusion effect strength',
    },

    {
        name: '_EmissionMap',
        displayName: 'Emission',
        type: 'texture',
        defaultValue: null,
        category: 'Emission',
        tooltip: 'Emission (RGB)',
    },
    {
        name: '_EmissionColor',
        displayName: 'Color',
        type: 'color',
        defaultValue: { x: 0, y: 0, z: 0, w: 1 },
        category: 'Emission',
        tooltip: 'Emission color',
    },
    {
        name: '_EmissionIntensity',
        displayName: 'Intensity',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 10 },
        category: 'Emission',
        tooltip: 'Emission intensity multiplier',
    },

    {
        name: '_DetailMask',
        displayName: 'Detail Mask',
        type: 'texture',
        defaultValue: null,
        category: 'Detail Maps',
        tooltip: 'Detail Mask (A)',
    },
    {
        name: '_DetailAlbedoMap',
        displayName: 'Detail Albedo x2',
        type: 'texture',
        defaultValue: null,
        category: 'Detail Maps',
        tooltip: 'Detail Albedo x2',
    },
    {
        name: '_DetailNormalMap',
        displayName: 'Detail Normal Map',
        type: 'texture',
        defaultValue: null,
        category: 'Detail Maps',
        tooltip: 'Detail Normal Map',
    },
    {
        name: '_DetailNormalMapScale',
        displayName: 'Scale',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 2 },
        category: 'Detail Maps',
        tooltip: 'Detail normal map scale',
    },

    {
        name: '_MainTex_ST',
        displayName: 'Tiling',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Tiling & Offset',
        tooltip: 'Texture tiling (XY) and offset (ZW)',
    },
    {
        name: '_DetailAlbedoMap_ST',
        displayName: 'Detail Tiling',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Tiling & Offset',
        tooltip: 'Detail texture tiling and offset',
    },

    {
        name: '_UVSec',
        displayName: 'UV Set for secondary textures',
        type: 'int',
        defaultValue: 0,
        category: 'Advanced Options',
        tooltip: 'UV channel for detail maps',
    },
    {
        name: '_Mode',
        displayName: 'Rendering Mode',
        type: 'int',
        defaultValue: 0,
        category: 'Advanced Options',
        tooltip: 'Rendering mode',
    },
    {
        name: '_Cutoff',
        displayName: 'Alpha Cutoff',
        type: 'float',
        defaultValue: 0.5,
        range: { min: 0, max: 1 },
        category: 'Advanced Options',
        tooltip: 'Alpha cutoff threshold',
    },
];

const STANDARD_KEYWORDS: MaterialKeyword[] = [
    {
        name: '_NORMALMAP',
        displayName: 'Normal Map',
        description: 'Enable normal mapping',
        category: 'Textures',
    },
    {
        name: '_METALLICGLOSSMAP',
        displayName: 'Metallic Gloss Map',
        description: 'Use metallic gloss map',
        category: 'Textures',
    },
    {
        name: '_SPECGLOSSMAP',
        displayName: 'Specular Gloss Map',
        description: 'Use specular gloss map',
        category: 'Textures',
    },
    {
        name: '_PARALLAXMAP',
        displayName: 'Parallax Map',
        description: 'Enable parallax mapping',
        category: 'Textures',
    },
    {
        name: '_OCCLUSIONMAP',
        displayName: 'Occlusion Map',
        description: 'Enable occlusion mapping',
        category: 'Textures',
    },
    {
        name: '_EMISSION',
        displayName: 'Emission',
        description: 'Enable emission',
        category: 'Textures',
    },
    {
        name: '_DETAIL_MULX2',
        displayName: 'Detail Multiply',
        description: 'Enable detail multiply',
        category: 'Detail',
    },
    {
        name: '_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A',
        displayName: 'Smoothness Source Albedo',
        description: 'Smoothness from albedo alpha',
        category: 'Advanced',
        mutuallyExclusive: ['_SMOOTHNESS_TEXTURE_METALLIC_CHANNEL_A'],
    },
    {
        name: '_SMOOTHNESS_TEXTURE_METALLIC_CHANNEL_A',
        displayName: 'Smoothness Source Metallic',
        description: 'Smoothness from metallic alpha',
        category: 'Advanced',
        mutuallyExclusive: ['_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A'],
    },

    {
        name: '_ALPHATEST_ON',
        displayName: 'Alpha Test',
        description: 'Enable alpha testing',
        category: 'Rendering',
        mutuallyExclusive: ['_ALPHABLEND_ON', '_ALPHAPREMULTIPLY_ON'],
    },
    {
        name: '_ALPHABLEND_ON',
        displayName: 'Alpha Blend',
        description: 'Enable alpha blending',
        category: 'Rendering',
        mutuallyExclusive: ['_ALPHATEST_ON', '_ALPHAPREMULTIPLY_ON'],
    },
    {
        name: '_ALPHAPREMULTIPLY_ON',
        displayName: 'Alpha Premultiply',
        description: 'Enable premultiplied alpha',
        category: 'Rendering',
        mutuallyExclusive: ['_ALPHATEST_ON', '_ALPHABLEND_ON'],
    },
];

export class StandardMaterialComponent extends BaseMaterialComponent<StandardMaterialConfig> {
    constructor(config: StandardMaterialConfig = { materialType: MaterialType.STANDARD }) {
        super({
            shaderName: 'Standard',
            renderQueue: 2000,
            blendMode: BlendMode.OPAQUE,
            cullMode: CullMode.BACK,
            shadowCasting: ShadowCasting.ON,
            receiveShadows: true,
            ...config,
        });
    }

    get albedo(): Vec4 {
        return this.getProperty<Vec4>('_Color') || { x: 1, y: 1, z: 1, w: 1 };
    }

    set albedo(value: Vec4) {
        this.setProperty('_Color', value);
    }

    get albedoMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_MainTex');
    }

    set albedoMap(value: WebGLTexture | null) {
        this.setTexture('_MainTex', value);
    }

    get metallic(): number {
        return this.getProperty<number>('_Metallic') || 0;
    }

    set metallic(value: number) {
        this.setProperty('_Metallic', Math.max(0, Math.min(1, value)));
    }

    get metallicMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_MetallicGlossMap');
    }

    set metallicMap(value: WebGLTexture | null) {
        this.setTexture('_MetallicGlossMap', value);
        if (value) {
            this.enableKeyword('_METALLICGLOSSMAP');
        } else {
            this.disableKeyword('_METALLICGLOSSMAP');
        }
    }

    get smoothness(): number {
        return this.getProperty<number>('_Glossiness') || 0.5;
    }

    set smoothness(value: number) {
        this.setProperty('_Glossiness', Math.max(0, Math.min(1, value)));
    }

    get normalMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_BumpMap');
    }

    set normalMap(value: WebGLTexture | null) {
        this.setTexture('_BumpMap', value);
        if (value) {
            this.enableKeyword('_NORMALMAP');
        } else {
            this.disableKeyword('_NORMALMAP');
        }
    }

    get normalScale(): number {
        return this.getProperty<number>('_BumpScale') || 1;
    }

    set normalScale(value: number) {
        this.setProperty('_BumpScale', Math.max(0, Math.min(2, value)));
    }

    get heightMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_ParallaxMap');
    }

    set heightMap(value: WebGLTexture | null) {
        this.setTexture('_ParallaxMap', value);
        if (value) {
            this.enableKeyword('_PARALLAXMAP');
        } else {
            this.disableKeyword('_PARALLAXMAP');
        }
    }

    get heightScale(): number {
        return this.getProperty<number>('_Parallax') || 0.02;
    }

    set heightScale(value: number) {
        this.setProperty('_Parallax', Math.max(0.005, Math.min(0.08, value)));
    }

    get occlusionMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_OcclusionMap');
    }

    set occlusionMap(value: WebGLTexture | null) {
        this.setTexture('_OcclusionMap', value);
        if (value) {
            this.enableKeyword('_OCCLUSIONMAP');
        } else {
            this.disableKeyword('_OCCLUSIONMAP');
        }
    }

    get occlusionStrength(): number {
        return this.getProperty<number>('_OcclusionStrength') || 1;
    }

    set occlusionStrength(value: number) {
        this.setProperty('_OcclusionStrength', Math.max(0, Math.min(1, value)));
    }

    get emission(): Vec3 {
        const color = this.getProperty<Vec4>('_EmissionColor');
        if (!color) return { x: 0, y: 0, z: 0 };
        return { x: color.x, y: color.y, z: color.z };
    }

    set emission(value: Vec3) {
        const intensity = this.getProperty<number>('_EmissionIntensity') || 1;
        this.setProperty('_EmissionColor', {
            x: value.x * intensity,
            y: value.y * intensity,
            z: value.z * intensity,
            w: 1,
        });

        const hasEmission = value.x > 0 || value.y > 0 || value.z > 0;
        if (hasEmission) {
            this.enableKeyword('_EMISSION');
        } else {
            this.disableKeyword('_EMISSION');
        }
    }

    get emissionMap(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_EmissionMap');
    }

    set emissionMap(value: WebGLTexture | null) {
        this.setTexture('_EmissionMap', value);
        if (value) {
            this.enableKeyword('_EMISSION');
        }
    }

    get emissionIntensity(): number {
        return this.getProperty<number>('_EmissionIntensity') || 1;
    }

    set emissionIntensity(value: number) {
        this.setProperty('_EmissionIntensity', Math.max(0, value));
    }

    get renderingMode(): 'Opaque' | 'Cutout' | 'Fade' | 'Transparent' {
        const mode = this.getProperty<number>('_Mode') || 0;
        switch (mode) {
            case 1:
                return 'Cutout';
            case 2:
                return 'Fade';
            case 3:
                return 'Transparent';
            default:
                return 'Opaque';
        }
    }

    set renderingMode(value: 'Opaque' | 'Cutout' | 'Fade' | 'Transparent') {
        let mode = 0;
        switch (value) {
            case 'Cutout':
                mode = 1;
                this.blendMode = BlendMode.ALPHA_TEST;
                this.enableKeyword('_ALPHATEST_ON');
                this.disableKeyword('_ALPHABLEND_ON');
                this.disableKeyword('_ALPHAPREMULTIPLY_ON');
                this.renderQueue = 2450;
                break;
            case 'Fade':
                mode = 2;
                this.blendMode = BlendMode.ALPHA_BLEND;
                this.disableKeyword('_ALPHATEST_ON');
                this.enableKeyword('_ALPHABLEND_ON');
                this.disableKeyword('_ALPHAPREMULTIPLY_ON');
                this.renderQueue = 3000;
                break;
            case 'Transparent':
                mode = 3;
                this.blendMode = BlendMode.PREMULTIPLIED;
                this.disableKeyword('_ALPHATEST_ON');
                this.disableKeyword('_ALPHABLEND_ON');
                this.enableKeyword('_ALPHAPREMULTIPLY_ON');
                this.renderQueue = 3000;
                break;
            default:
                mode = 0;
                this.blendMode = BlendMode.OPAQUE;
                this.disableKeyword('_ALPHATEST_ON');
                this.disableKeyword('_ALPHABLEND_ON');
                this.disableKeyword('_ALPHAPREMULTIPLY_ON');
                this.renderQueue = 2000;
                break;
        }
        this.setProperty('_Mode', mode);
    }

    get alphaCutoff(): number {
        return this.getProperty<number>('_Cutoff') || 0.5;
    }

    set alphaCutoff(value: number) {
        this.setProperty('_Cutoff', Math.max(0, Math.min(1, value)));
    }

    get mainTextureScale(): Vec2 {
        const st = this.getProperty<Vec4>('_MainTex_ST');
        return st ? { x: st.x, y: st.y } : { x: 1, y: 1 };
    }

    set mainTextureScale(value: Vec2) {
        const st = this.getProperty<Vec4>('_MainTex_ST') || { x: 1, y: 1, z: 0, w: 0 };
        this.setProperty('_MainTex_ST', { x: value.x, y: value.y, z: st.z, w: st.w });
    }

    get mainTextureOffset(): Vec2 {
        const st = this.getProperty<Vec4>('_MainTex_ST');
        return st ? { x: st.z, y: st.w } : { x: 0, y: 0 };
    }

    set mainTextureOffset(value: Vec2) {
        const st = this.getProperty<Vec4>('_MainTex_ST') || { x: 1, y: 1, z: 0, w: 0 };
        this.setProperty('_MainTex_ST', { x: st.x, y: st.y, z: value.x, w: value.y });
    }

    protected _setupDefaultProperties(): void {
        for (const prop of STANDARD_PROPERTIES) {
            if (!this.hasProperty(prop.name)) {
                this.setProperty(prop.name, prop.defaultValue);
            }
        }
    }

    protected _setupDefaultKeywords(): void {
        if (this.albedoMap) this.enableKeyword('_MAINTEX');
        if (this.normalMap) this.enableKeyword('_NORMALMAP');
        if (this.metallicMap) this.enableKeyword('_METALLICGLOSSMAP');
        if (this.occlusionMap) this.enableKeyword('_OCCLUSIONMAP');
        if (this.heightMap) this.enableKeyword('_PARALLAXMAP');
        if (this.emissionMap) this.enableKeyword('_EMISSION');
    }

    protected _getAvailableProperties(): MaterialProperty[] {
        return STANDARD_PROPERTIES;
    }

    protected _getAvailableKeywords(): MaterialKeyword[] {
        return STANDARD_KEYWORDS;
    }

    protected _onPropertyChanged(name: string, value: any): void {
        super._onPropertyChanged(name, value);

        switch (name) {
            case '_EmissionColor':
                const color = value as Vec4;
                if (color && (color.x > 0 || color.y > 0 || color.z > 0)) {
                    this.enableKeyword('_EMISSION');
                } else {
                    this.disableKeyword('_EMISSION');
                }
                break;
        }
    }

    public enableGlobalIllumination(): void {
        this.setRenderTag('GlobalIllumination', 'RealtimeEmissive');
    }

    public disableGlobalIllumination(): void {
        this.setRenderTag('GlobalIllumination', 'EmissiveIsBlack');
    }

    public setSmoothnessSource(source: 'metallic' | 'albedo'): void {
        if (source === 'metallic') {
            this.enableKeyword('_SMOOTHNESS_TEXTURE_METALLIC_CHANNEL_A');
            this.disableKeyword('_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A');
            this.setProperty('_SmoothnessTextureChannel', 0);
        } else {
            this.disableKeyword('_SMOOTHNESS_TEXTURE_METALLIC_CHANNEL_A');
            this.enableKeyword('_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A');
            this.setProperty('_SmoothnessTextureChannel', 1);
        }
    }
}
