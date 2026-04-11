import { Component, type ComponentConfig } from '@axrone/ecs-runtime';

export interface Vec2 {
    x: number;
    y: number;
}
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}
export interface Mat3 {
    elements: Float32Array;
}
export interface Mat4 {
    elements: Float32Array;
}

export const enum MaterialType {
    STANDARD = 'Standard',
    UNLIT = 'Unlit',
    PBR = 'PBR',
    PARTICLE = 'Particle',
    TOON = 'Toon',
    GLASS = 'Glass',
    METAL = 'Metal',
    SKIN = 'Skin',
    VEGETATION = 'Vegetation',
    WATER = 'Water',
    CUSTOM = 'Custom',
}

export const enum BlendMode {
    OPAQUE = 'Opaque',
    ALPHA_BLEND = 'AlphaBlend',
    ALPHA_TEST = 'AlphaTest',
    ADDITIVE = 'Additive',
    MULTIPLY = 'Multiply',
    SCREEN = 'Screen',
    OVERLAY = 'Overlay',
    SOFT_ADDITIVE = 'SoftAdditive',
    PREMULTIPLIED = 'Premultiplied',
}

export const enum CullMode {
    NONE = 'None',
    FRONT = 'Front',
    BACK = 'Back',
}

export const enum DepthTest {
    DISABLED = 'Disabled',
    NEVER = 'Never',
    LESS = 'Less',
    EQUAL = 'Equal',
    LEQUAL = 'LEqual',
    GREATER = 'Greater',
    NOTEQUAL = 'NotEqual',
    GEQUAL = 'GEqual',
    ALWAYS = 'Always',
}

export const enum ShadowCasting {
    OFF = 'Off',
    ON = 'On',
    TWO_SIDED = 'TwoSided',
    SHADOWS_ONLY = 'ShadowsOnly',
}

export const enum LightMode {
    FORWARD_BASE = 'ForwardBase',
    FORWARD_ADD = 'ForwardAdd',
    DEFERRED = 'Deferred',
    SHADOW_CASTER = 'ShadowCaster',
    DEPTH_ONLY = 'DepthOnly',
    META = 'Meta',
}

export type MaterialPropertyValue =
    | number
    | boolean
    | Vec2
    | Vec3
    | Vec4
    | Mat3
    | Mat4
    | WebGLTexture
    | string
    | Float32Array
    | Int32Array
    | Uint32Array
    | null;

export interface MaterialProperty {
    readonly name: string;
    readonly displayName: string;
    readonly type:
        | 'float'
        | 'int'
        | 'bool'
        | 'vec2'
        | 'vec3'
        | 'vec4'
        | 'color'
        | 'texture'
        | 'matrix';
    readonly defaultValue: MaterialPropertyValue;
    readonly range?: { min: number; max: number };
    readonly category?: string;
    readonly tooltip?: string;
    readonly hidden?: boolean;
    readonly system?: boolean;
}

export interface MaterialKeyword {
    readonly name: string;
    readonly displayName: string;
    readonly description?: string;
    readonly category?: string;
    readonly mutuallyExclusive?: string[];
    readonly dependencies?: string[];
}

export interface MaterialConfig extends ComponentConfig {
    readonly materialType: MaterialType;
    readonly shaderName?: string;
    readonly renderQueue?: number;
    readonly blendMode?: BlendMode;
    readonly cullMode?: CullMode;
    readonly depthTest?: DepthTest;
    readonly depthWrite?: boolean;
    readonly shadowCasting?: ShadowCasting;
    readonly receiveShadows?: boolean;
    readonly lightMode?: LightMode;
    readonly properties?: Record<string, MaterialPropertyValue>;
    readonly keywords?: string[];
    readonly renderTags?: Record<string, string>;
}

export interface StandardMaterialConfig extends MaterialConfig {
    materialType: MaterialType.STANDARD;
    albedo?: Vec4;
    albedoMap?: WebGLTexture;
    metallic?: number;
    metallicMap?: WebGLTexture;
    roughness?: number;
    roughnessMap?: WebGLTexture;
    normalMap?: WebGLTexture;
    normalScale?: number;
    heightMap?: WebGLTexture;
    heightScale?: number;
    occlusionMap?: WebGLTexture;
    occlusionStrength?: number;
    emission?: Vec3;
    emissionMap?: WebGLTexture;
    emissionIntensity?: number;
}

export interface PBRMaterialConfig extends MaterialConfig {
    materialType: MaterialType.PBR;
    baseColor?: Vec4;
    baseColorTexture?: WebGLTexture;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: WebGLTexture;
    normalTexture?: WebGLTexture;
    normalScale?: number;
    occlusionTexture?: WebGLTexture;
    occlusionStrength?: number;
    emissiveTexture?: WebGLTexture;
    emissiveFactor?: Vec3;
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number;
    doubleSided?: boolean;
}

export interface UnlitMaterialConfig extends MaterialConfig {
    materialType: MaterialType.UNLIT;
    color?: Vec4;
    mainTexture?: WebGLTexture;
    cutoff?: number;
}

export abstract class BaseMaterialComponent<
    T extends MaterialConfig = MaterialConfig,
> extends Component<T> {
    protected _properties = new Map<string, MaterialPropertyValue>();
    protected _keywords = new Set<string>();
    protected _renderQueue: number = 2000;
    protected _isDirty: boolean = true;
    protected _lastModified: number = 0;

    protected _blendMode: BlendMode = BlendMode.OPAQUE;
    protected _cullMode: CullMode = CullMode.BACK;
    protected _depthTest: DepthTest = DepthTest.LESS;
    protected _depthWrite: boolean = true;
    protected _shadowCasting: ShadowCasting = ShadowCasting.ON;
    protected _receiveShadows: boolean = true;

    protected _shaderName: string = '';
    protected _materialType: MaterialType;
    protected _renderTags = new Map<string, string>();

    constructor(config: T) {
        super(config);
        this._materialType = config.materialType;
        this._initializeFromConfig(config);
    }

    public setProperty(name: string, value: MaterialPropertyValue): void {
        if (this._properties.get(name) !== value) {
            this._properties.set(name, value);
            this._markDirty();
            this._onPropertyChanged(name, value);
        }
    }

    public getProperty<TValue extends MaterialPropertyValue>(name: string): TValue | null {
        return (this._properties.get(name) as TValue) || null;
    }

    public hasProperty(name: string): boolean {
        return this._properties.has(name);
    }

    public getPropertyNames(): string[] {
        return Array.from(this._properties.keys());
    }

    public enableKeyword(keyword: string): void {
        if (!this._keywords.has(keyword)) {
            this._keywords.add(keyword);
            this._markDirty();
            this._onKeywordChanged(keyword, true);
        }
    }

    public disableKeyword(keyword: string): void {
        if (this._keywords.has(keyword)) {
            this._keywords.delete(keyword);
            this._markDirty();
            this._onKeywordChanged(keyword, false);
        }
    }

    public hasKeyword(keyword: string): boolean {
        return this._keywords.has(keyword);
    }

    public getKeywords(): string[] {
        return Array.from(this._keywords);
    }

    public get blendMode(): BlendMode {
        return this._blendMode;
    }
    public set blendMode(value: BlendMode) {
        if (this._blendMode !== value) {
            this._blendMode = value;
            this._markDirty();
            this._updateRenderQueue();
        }
    }

    public get cullMode(): CullMode {
        return this._cullMode;
    }
    public set cullMode(value: CullMode) {
        if (this._cullMode !== value) {
            this._cullMode = value;
            this._markDirty();
        }
    }

    public get depthTest(): DepthTest {
        return this._depthTest;
    }
    public set depthTest(value: DepthTest) {
        if (this._depthTest !== value) {
            this._depthTest = value;
            this._markDirty();
        }
    }

    public get depthWrite(): boolean {
        return this._depthWrite;
    }
    public set depthWrite(value: boolean) {
        if (this._depthWrite !== value) {
            this._depthWrite = value;
            this._markDirty();
        }
    }

    public get renderQueue(): number {
        return this._renderQueue;
    }
    public set renderQueue(value: number) {
        if (this._renderQueue !== value) {
            this._renderQueue = Math.max(0, Math.min(5000, value));
            this._markDirty();
        }
    }

    public get shadowCasting(): ShadowCasting {
        return this._shadowCasting;
    }
    public set shadowCasting(value: ShadowCasting) {
        if (this._shadowCasting !== value) {
            this._shadowCasting = value;
            this._markDirty();
        }
    }

    public get receiveShadows(): boolean {
        return this._receiveShadows;
    }
    public set receiveShadows(value: boolean) {
        if (this._receiveShadows !== value) {
            this._receiveShadows = value;
            this._markDirty();
        }
    }

    public get materialType(): MaterialType {
        return this._materialType;
    }
    public get shaderName(): string {
        return this._shaderName;
    }
    public get isDirty(): boolean {
        return this._isDirty;
    }
    public get lastModified(): number {
        return this._lastModified;
    }

    public setRenderTag(key: string, value: string): void {
        this._renderTags.set(key, value);
        this._markDirty();
    }

    public getRenderTag(key: string): string | null {
        return this._renderTags.get(key) || null;
    }

    public hasRenderTag(key: string): boolean {
        return this._renderTags.has(key);
    }

    protected onInitialize(): void {
        this._setupDefaultProperties();
        this._setupDefaultKeywords();
        this._setupDefaultRenderTags();
    }

    public onDestroy(): void {
        this._properties.clear();
        this._keywords.clear();
        this._renderTags.clear();
    }

    protected abstract _setupDefaultProperties(): void;
    protected abstract _setupDefaultKeywords(): void;
    protected abstract _getAvailableProperties(): MaterialProperty[];
    protected abstract _getAvailableKeywords(): MaterialKeyword[];

    protected _initializeFromConfig(config: T): void {
        if (config.shaderName) this._shaderName = config.shaderName;
        if (config.renderQueue !== undefined) this._renderQueue = config.renderQueue;
        if (config.blendMode) this._blendMode = config.blendMode;
        if (config.cullMode) this._cullMode = config.cullMode;
        if (config.depthTest) this._depthTest = config.depthTest;
        if (config.depthWrite !== undefined) this._depthWrite = config.depthWrite;
        if (config.shadowCasting) this._shadowCasting = config.shadowCasting;
        if (config.receiveShadows !== undefined) this._receiveShadows = config.receiveShadows;

        if (config.properties) {
            for (const [name, value] of Object.entries(config.properties)) {
                this._properties.set(name, value);
            }
        }

        if (config.keywords) {
            for (const keyword of config.keywords) {
                this._keywords.add(keyword);
            }
        }

        if (config.renderTags) {
            for (const [key, value] of Object.entries(config.renderTags)) {
                this._renderTags.set(key, value);
            }
        }
    }

    protected _setupDefaultRenderTags(): void {
        this._renderTags.set(
            'RenderType',
            this._blendMode === BlendMode.OPAQUE ? 'Opaque' : 'Transparent'
        );
        this._renderTags.set('Queue', this._getRenderQueueName());
        this._renderTags.set('IgnoreProjector', 'True');
        this._renderTags.set(
            'ForceNoShadowCasting',
            this._shadowCasting === ShadowCasting.OFF ? 'True' : 'False'
        );
    }

    protected _updateRenderQueue(): void {
        switch (this._blendMode) {
            case BlendMode.OPAQUE:
                if (this._renderQueue >= 2500) this._renderQueue = 2000;
                break;
            case BlendMode.ALPHA_TEST:
                if (this._renderQueue < 2450 || this._renderQueue >= 2550) this._renderQueue = 2450;
                break;
            case BlendMode.ALPHA_BLEND:
            case BlendMode.ADDITIVE:
            case BlendMode.MULTIPLY:
            case BlendMode.SCREEN:
            case BlendMode.OVERLAY:
            case BlendMode.SOFT_ADDITIVE:
            case BlendMode.PREMULTIPLIED:
                if (this._renderQueue < 3000) this._renderQueue = 3000;
                break;
        }
    }

    protected _getRenderQueueName(): string {
        if (this._renderQueue < 1000) return 'Background';
        if (this._renderQueue < 2000) return 'Geometry';
        if (this._renderQueue < 2500) return 'AlphaTest';
        if (this._renderQueue < 3000) return 'GeometryLast';
        if (this._renderQueue < 4000) return 'Transparent';
        return 'Overlay';
    }

    protected _markDirty(): void {
        this._isDirty = true;
        this._lastModified = performance.now();
    }

    protected _onPropertyChanged(name: string, value: MaterialPropertyValue): void {}

    protected _onKeywordChanged(keyword: string, enabled: boolean): void {}

    public setColor(propertyName: string, color: Vec3 | Vec4): void {
        this.setProperty(propertyName, color);
    }

    public getColor(propertyName: string): Vec4 | null {
        const value = this.getProperty<Vec4>(propertyName);
        if (!value) return null;

        if (
            typeof value === 'object' &&
            'x' in value &&
            'y' in value &&
            'z' in value &&
            'w' in value
        ) {
            return value as Vec4;
        }

        if (typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
            const vec3 = value as Vec3;
            return { x: vec3.x, y: vec3.y, z: vec3.z, w: 1.0 };
        }

        return null;
    }

    public setTexture(propertyName: string, texture: WebGLTexture | null): void {
        this.setProperty(propertyName, texture);

        const keywordName = `${propertyName.toUpperCase()}_ON`;
        if (texture) {
            this.enableKeyword(keywordName);
        } else {
            this.disableKeyword(keywordName);
        }
    }

    public getTexture(propertyName: string): WebGLTexture | null {
        return this.getProperty<WebGLTexture>(propertyName);
    }

    public setFloat(propertyName: string, value: number): void {
        this.setProperty(propertyName, value);
    }

    public getFloat(propertyName: string): number {
        return this.getProperty<number>(propertyName) || 0;
    }

    public setVector(propertyName: string, vector: Vec2 | Vec3 | Vec4): void {
        this.setProperty(propertyName, vector);
    }

    public getVector(propertyName: string): Vec2 | Vec3 | Vec4 | null {
        return this.getProperty<Vec2 | Vec3 | Vec4>(propertyName);
    }

    public setMatrix(propertyName: string, matrix: Mat3 | Mat4): void {
        this.setProperty(propertyName, matrix);
    }

    public getMatrix(propertyName: string): Mat3 | Mat4 | null {
        return this.getProperty<Mat3 | Mat4>(propertyName);
    }

    public serialize(): Record<string, any> {
        return {
            materialType: this._materialType,
            shaderName: this._shaderName,
            renderQueue: this._renderQueue,
            blendMode: this._blendMode,
            cullMode: this._cullMode,
            depthTest: this._depthTest,
            depthWrite: this._depthWrite,
            shadowCasting: this._shadowCasting,
            receiveShadows: this._receiveShadows,
            properties: Object.fromEntries(this._properties),
            keywords: Array.from(this._keywords),
            renderTags: Object.fromEntries(this._renderTags),
        };
    }

    public deserialize(data: Record<string, any>): void {
        if (data.materialType) this._materialType = data.materialType;
        if (data.shaderName) this._shaderName = data.shaderName;
        if (data.renderQueue !== undefined) this._renderQueue = data.renderQueue;
        if (data.blendMode) this._blendMode = data.blendMode;
        if (data.cullMode) this._cullMode = data.cullMode;
        if (data.depthTest) this._depthTest = data.depthTest;
        if (data.depthWrite !== undefined) this._depthWrite = data.depthWrite;
        if (data.shadowCasting) this._shadowCasting = data.shadowCasting;
        if (data.receiveShadows !== undefined) this._receiveShadows = data.receiveShadows;

        if (data.properties) {
            this._properties.clear();
            for (const [name, value] of Object.entries(data.properties)) {
                this._properties.set(name, value as MaterialPropertyValue);
            }
        }

        if (data.keywords) {
            this._keywords.clear();
            for (const keyword of data.keywords) {
                this._keywords.add(keyword);
            }
        }

        if (data.renderTags) {
            this._renderTags.clear();
            for (const [key, value] of Object.entries(data.renderTags)) {
                this._renderTags.set(key, value as string);
            }
        }

        this._markDirty();
    }

    public clone(): this {
        const serialized = this.serialize();
        const cloned = new (this.constructor as any)(serialized);
        cloned.deserialize(serialized);
        return cloned;
    }
}
