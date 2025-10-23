import { 
    BaseMaterialComponent, 
    MaterialType, 
    MaterialProperty, 
    MaterialKeyword,
    PBRMaterialConfig,
    Vec2,
    Vec3,
    Vec4,
    BlendMode,
    CullMode,
    ShadowCasting
} from './base-material';

const PBR_PROPERTIES: MaterialProperty[] = [

    {
        name: '_BaseColorFactor',
        displayName: 'Base Color',
        type: 'color',
        defaultValue: { x: 1, y: 1, z: 1, w: 1 },
        category: 'PBR',
        tooltip: 'Base color of the material'
    },
    {
        name: '_BaseColorTexture',
        displayName: 'Base Color Texture',
        type: 'texture',
        defaultValue: null,
        category: 'PBR',
        tooltip: 'Base color texture (sRGB)'
    },

    {
        name: '_MetallicFactor',
        displayName: 'Metallic Factor',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 1 },
        category: 'PBR',
        tooltip: 'Metallic factor'
    },
    {
        name: '_RoughnessFactor',
        displayName: 'Roughness Factor',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 1 },
        category: 'PBR',
        tooltip: 'Roughness factor'
    },
    {
        name: '_MetallicRoughnessTexture',
        displayName: 'Metallic-Roughness Texture',
        type: 'texture',
        defaultValue: null,
        category: 'PBR',
        tooltip: 'Metallic (B) and Roughness (G) texture'
    },

    {
        name: '_NormalTexture',
        displayName: 'Normal Texture',
        type: 'texture',
        defaultValue: null,
        category: 'Normal',
        tooltip: 'Normal map texture'
    },
    {
        name: '_NormalScale',
        displayName: 'Normal Scale',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 2 },
        category: 'Normal',
        tooltip: 'Normal map scale factor'
    },

    {
        name: '_OcclusionTexture',
        displayName: 'Occlusion Texture',
        type: 'texture',
        defaultValue: null,
        category: 'Occlusion',
        tooltip: 'Ambient occlusion texture (R)'
    },
    {
        name: '_OcclusionStrength',
        displayName: 'Occlusion Strength',
        type: 'float',
        defaultValue: 1.0,
        range: { min: 0, max: 1 },
        category: 'Occlusion',
        tooltip: 'Occlusion effect strength'
    },

    {
        name: '_EmissiveTexture',
        displayName: 'Emissive Texture',
        type: 'texture',
        defaultValue: null,
        category: 'Emission',
        tooltip: 'Emissive texture (sRGB)'
    },
    {
        name: '_EmissiveFactor',
        displayName: 'Emissive Factor',
        type: 'color',
        defaultValue: { x: 0, y: 0, z: 0, w: 1 },
        category: 'Emission',
        tooltip: 'Emissive color factor'
    },

    {
        name: '_AlphaMode',
        displayName: 'Alpha Mode',
        type: 'int',
        defaultValue: 0, 
        category: 'Alpha',
        tooltip: 'Alpha rendering mode: 0=OPAQUE, 1=MASK, 2=BLEND'
    },
    {
        name: '_AlphaCutoff',
        displayName: 'Alpha Cutoff',
        type: 'float',
        defaultValue: 0.5,
        range: { min: 0, max: 1 },
        category: 'Alpha',
        tooltip: 'Alpha cutoff threshold for MASK mode'
    },

    {
        name: '_DoubleSided',
        displayName: 'Double Sided',
        type: 'bool',
        defaultValue: false,
        category: 'Rendering',
        tooltip: 'Enable double-sided rendering'
    },

    {
        name: '_BaseColorTexture_ST',
        displayName: 'Base Color Transform',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Texture Transforms',
        tooltip: 'Base color texture transform'
    },
    {
        name: '_MetallicRoughnessTexture_ST',
        displayName: 'Metallic-Roughness Transform',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Texture Transforms',
        tooltip: 'Metallic-roughness texture transform'
    },
    {
        name: '_NormalTexture_ST',
        displayName: 'Normal Transform',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Texture Transforms',
        tooltip: 'Normal texture transform'
    },
    {
        name: '_OcclusionTexture_ST',
        displayName: 'Occlusion Transform',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Texture Transforms',
        tooltip: 'Occlusion texture transform'
    },
    {
        name: '_EmissiveTexture_ST',
        displayName: 'Emissive Transform',
        type: 'vec4',
        defaultValue: { x: 1, y: 1, z: 0, w: 0 },
        category: 'Texture Transforms',
        tooltip: 'Emissive texture transform'
    }
];

const PBR_KEYWORDS: MaterialKeyword[] = [

    {
        name: '_BASECOLORTEXTURE',
        displayName: 'Base Color Texture',
        description: 'Enable base color texture',
        category: 'Textures'
    },
    {
        name: '_METALLICROUGHNESSTEXTURE',
        displayName: 'Metallic-Roughness Texture',
        description: 'Enable metallic-roughness texture',
        category: 'Textures'
    },
    {
        name: '_NORMALTEXTURE',
        displayName: 'Normal Texture',
        description: 'Enable normal mapping',
        category: 'Textures'
    },
    {
        name: '_OCCLUSIONTEXTURE',
        displayName: 'Occlusion Texture',
        description: 'Enable occlusion mapping',
        category: 'Textures'
    },
    {
        name: '_EMISSIVETEXTURE',
        displayName: 'Emissive Texture',
        description: 'Enable emissive texture',
        category: 'Textures'
    },

    {
        name: '_ALPHAMODE_OPAQUE',
        displayName: 'Alpha Mode Opaque',
        description: 'Opaque alpha mode',
        category: 'Alpha',
        mutuallyExclusive: ['_ALPHAMODE_MASK', '_ALPHAMODE_BLEND']
    },
    {
        name: '_ALPHAMODE_MASK',
        displayName: 'Alpha Mode Mask',
        description: 'Alpha mask mode',
        category: 'Alpha',
        mutuallyExclusive: ['_ALPHAMODE_OPAQUE', '_ALPHAMODE_BLEND']
    },
    {
        name: '_ALPHAMODE_BLEND',
        displayName: 'Alpha Mode Blend',
        description: 'Alpha blend mode',
        category: 'Alpha',
        mutuallyExclusive: ['_ALPHAMODE_OPAQUE', '_ALPHAMODE_MASK']
    },

    {
        name: '_DOUBLESIDED',
        displayName: 'Double Sided',
        description: 'Enable double-sided rendering',
        category: 'Rendering'
    }
];

export class PBRMaterialComponent extends BaseMaterialComponent<PBRMaterialConfig> {
    constructor(config: PBRMaterialConfig = { materialType: MaterialType.PBR }) {
        super({
            shaderName: 'PBR',
            renderQueue: 2000,
            blendMode: BlendMode.OPAQUE,
            cullMode: CullMode.BACK,
            shadowCasting: ShadowCasting.ON,
            receiveShadows: true,
            ...config
        });
    }

    get baseColor(): Vec4 {
        return this.getProperty<Vec4>('_BaseColorFactor') || { x: 1, y: 1, z: 1, w: 1 };
    }

    set baseColor(value: Vec4) {
        this.setProperty('_BaseColorFactor', value);
    }

    get baseColorTexture(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_BaseColorTexture');
    }

    set baseColorTexture(value: WebGLTexture | null) {
        this.setTexture('_BaseColorTexture', value);
        if (value) {
            this.enableKeyword('_BASECOLORTEXTURE');
        } else {
            this.disableKeyword('_BASECOLORTEXTURE');
        }
    }

    get metallicFactor(): number {
        return this.getProperty<number>('_MetallicFactor') || 1;
    }

    set metallicFactor(value: number) {
        this.setProperty('_MetallicFactor', Math.max(0, Math.min(1, value)));
    }

    get roughnessFactor(): number {
        return this.getProperty<number>('_RoughnessFactor') || 1;
    }

    set roughnessFactor(value: number) {
        this.setProperty('_RoughnessFactor', Math.max(0, Math.min(1, value)));
    }

    get metallicRoughnessTexture(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_MetallicRoughnessTexture');
    }

    set metallicRoughnessTexture(value: WebGLTexture | null) {
        this.setTexture('_MetallicRoughnessTexture', value);
        if (value) {
            this.enableKeyword('_METALLICROUGHNESSTEXTURE');
        } else {
            this.disableKeyword('_METALLICROUGHNESSTEXTURE');
        }
    }

    get normalTexture(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_NormalTexture');
    }

    set normalTexture(value: WebGLTexture | null) {
        this.setTexture('_NormalTexture', value);
        if (value) {
            this.enableKeyword('_NORMALTEXTURE');
        } else {
            this.disableKeyword('_NORMALTEXTURE');
        }
    }

    get normalScale(): number {
        return this.getProperty<number>('_NormalScale') || 1;
    }

    set normalScale(value: number) {
        this.setProperty('_NormalScale', Math.max(0, Math.min(2, value)));
    }

    get occlusionTexture(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_OcclusionTexture');
    }

    set occlusionTexture(value: WebGLTexture | null) {
        this.setTexture('_OcclusionTexture', value);
        if (value) {
            this.enableKeyword('_OCCLUSIONTEXTURE');
        } else {
            this.disableKeyword('_OCCLUSIONTEXTURE');
        }
    }

    get occlusionStrength(): number {
        return this.getProperty<number>('_OcclusionStrength') || 1;
    }

    set occlusionStrength(value: number) {
        this.setProperty('_OcclusionStrength', Math.max(0, Math.min(1, value)));
    }

    get emissiveTexture(): WebGLTexture | null {
        return this.getProperty<WebGLTexture>('_EmissiveTexture');
    }

    set emissiveTexture(value: WebGLTexture | null) {
        this.setTexture('_EmissiveTexture', value);
        if (value) {
            this.enableKeyword('_EMISSIVETEXTURE');
        } else {
            this.disableKeyword('_EMISSIVETEXTURE');
        }
    }

    get emissiveFactor(): Vec3 {
        const color = this.getProperty<Vec4>('_EmissiveFactor');
        if (!color) return { x: 0, y: 0, z: 0 };
        return { x: color.x, y: color.y, z: color.z };
    }

    set emissiveFactor(value: Vec3) {
        this.setProperty('_EmissiveFactor', { x: value.x, y: value.y, z: value.z, w: 1 });
    }

    get alphaMode(): 'OPAQUE' | 'MASK' | 'BLEND' {
        const mode = this.getProperty<number>('_AlphaMode') || 0;
        switch (mode) {
            case 1: return 'MASK';
            case 2: return 'BLEND';
            default: return 'OPAQUE';
        }
    }

    set alphaMode(value: 'OPAQUE' | 'MASK' | 'BLEND') {
        let mode = 0;

        this.disableKeyword('_ALPHAMODE_OPAQUE');
        this.disableKeyword('_ALPHAMODE_MASK');
        this.disableKeyword('_ALPHAMODE_BLEND');

        switch (value) {
            case 'MASK':
                mode = 1;
                this.blendMode = BlendMode.ALPHA_TEST;
                this.enableKeyword('_ALPHAMODE_MASK');
                this.renderQueue = 2450;
                break;
            case 'BLEND':
                mode = 2;
                this.blendMode = BlendMode.ALPHA_BLEND;
                this.enableKeyword('_ALPHAMODE_BLEND');
                this.renderQueue = 3000;
                break;
            default: 
                mode = 0;
                this.blendMode = BlendMode.OPAQUE;
                this.enableKeyword('_ALPHAMODE_OPAQUE');
                this.renderQueue = 2000;
                break;
        }
        this.setProperty('_AlphaMode', mode);
    }

    get alphaCutoff(): number {
        return this.getProperty<number>('_AlphaCutoff') || 0.5;
    }

    set alphaCutoff(value: number) {
        this.setProperty('_AlphaCutoff', Math.max(0, Math.min(1, value)));
    }

    get doubleSided(): boolean {
        return this.getProperty<boolean>('_DoubleSided') || false;
    }

    set doubleSided(value: boolean) {
        this.setProperty('_DoubleSided', value);
        if (value) {
            this.cullMode = CullMode.NONE;
            this.enableKeyword('_DOUBLESIDED');
        } else {
            this.cullMode = CullMode.BACK;
            this.disableKeyword('_DOUBLESIDED');
        }
    }

    public setTextureTransform(textureName: string, scale: Vec2, offset: Vec2): void {
        const propName = `${textureName}_ST`;
        this.setProperty(propName, { x: scale.x, y: scale.y, z: offset.x, w: offset.y });
    }

    public getTextureScale(textureName: string): Vec2 {
        const st = this.getProperty<Vec4>(`${textureName}_ST`);
        return st ? { x: st.x, y: st.y } : { x: 1, y: 1 };
    }

    public getTextureOffset(textureName: string): Vec2 {
        const st = this.getProperty<Vec4>(`${textureName}_ST`);
        return st ? { x: st.z, y: st.w } : { x: 0, y: 0 };
    }

    protected _setupDefaultProperties(): void {
        for (const prop of PBR_PROPERTIES) {
            if (!this.hasProperty(prop.name)) {
                this.setProperty(prop.name, prop.defaultValue);
            }
        }
    }

    protected _setupDefaultKeywords(): void {

        this.enableKeyword('_ALPHAMODE_OPAQUE');

        if (this.baseColorTexture) this.enableKeyword('_BASECOLORTEXTURE');
        if (this.metallicRoughnessTexture) this.enableKeyword('_METALLICROUGHNESSTEXTURE');
        if (this.normalTexture) this.enableKeyword('_NORMALTEXTURE');
        if (this.occlusionTexture) this.enableKeyword('_OCCLUSIONTEXTURE');
        if (this.emissiveTexture) this.enableKeyword('_EMISSIVETEXTURE');
        if (this.doubleSided) this.enableKeyword('_DOUBLESIDED');
    }

    protected _getAvailableProperties(): MaterialProperty[] {
        return PBR_PROPERTIES;
    }

    protected _getAvailableKeywords(): MaterialKeyword[] {
        return PBR_KEYWORDS;
    }

    protected _onPropertyChanged(name: string, value: any): void {
        super._onPropertyChanged(name, value);

        switch (name) {
            case '_EmissiveFactor':
                const color = value as Vec4;
                if (color && (color.x > 0 || color.y > 0 || color.z > 0)) {

                }
                break;
            case '_DoubleSided':
                if (value) {
                    this.cullMode = CullMode.NONE;
                    this.enableKeyword('_DOUBLESIDED');
                } else {
                    this.cullMode = CullMode.BACK;
                    this.disableKeyword('_DOUBLESIDED');
                }
                break;
        }
    }

    public copyFromGLTF(gltfMaterial: any): void {
        if (!gltfMaterial) return;

        if (gltfMaterial.pbrMetallicRoughness) {
            const pbr = gltfMaterial.pbrMetallicRoughness;

            if (pbr.baseColorFactor) {
                this.baseColor = {
                    x: pbr.baseColorFactor[0] || 1,
                    y: pbr.baseColorFactor[1] || 1,
                    z: pbr.baseColorFactor[2] || 1,
                    w: pbr.baseColorFactor[3] || 1
                };
            }

            if (pbr.metallicFactor !== undefined) {
                this.metallicFactor = pbr.metallicFactor;
            }

            if (pbr.roughnessFactor !== undefined) {
                this.roughnessFactor = pbr.roughnessFactor;
            }
        }

        if (gltfMaterial.normalTexture) {
            if (gltfMaterial.normalTexture.scale !== undefined) {
                this.normalScale = gltfMaterial.normalTexture.scale;
            }
        }

        if (gltfMaterial.occlusionTexture) {
            if (gltfMaterial.occlusionTexture.strength !== undefined) {
                this.occlusionStrength = gltfMaterial.occlusionTexture.strength;
            }
        }

        if (gltfMaterial.emissiveFactor) {
            this.emissiveFactor = {
                x: gltfMaterial.emissiveFactor[0] || 0,
                y: gltfMaterial.emissiveFactor[1] || 0,
                z: gltfMaterial.emissiveFactor[2] || 0
            };
        }

        if (gltfMaterial.alphaMode) {
            this.alphaMode = gltfMaterial.alphaMode as 'OPAQUE' | 'MASK' | 'BLEND';
        }

        if (gltfMaterial.alphaCutoff !== undefined) {
            this.alphaCutoff = gltfMaterial.alphaCutoff;
        }

        if (gltfMaterial.doubleSided !== undefined) {
            this.doubleSided = gltfMaterial.doubleSided;
        }
    }

    public exportToGLTF(): any {
        return {
            name: this.constructor.name,
            pbrMetallicRoughness: {
                baseColorFactor: [this.baseColor.x, this.baseColor.y, this.baseColor.z, this.baseColor.w],
                metallicFactor: this.metallicFactor,
                roughnessFactor: this.roughnessFactor
            },
            normalTexture: this.normalTexture ? {
                scale: this.normalScale
            } : undefined,
            occlusionTexture: this.occlusionTexture ? {
                strength: this.occlusionStrength
            } : undefined,
            emissiveTexture: this.emissiveTexture ? {} : undefined,
            emissiveFactor: [this.emissiveFactor.x, this.emissiveFactor.y, this.emissiveFactor.z],
            alphaMode: this.alphaMode,
            alphaCutoff: this.alphaMode === 'MASK' ? this.alphaCutoff : undefined,
            doubleSided: this.doubleSided || undefined
        };
    }
}