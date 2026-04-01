import {
    IMaterialInstance,
    IShaderInstance,
    ShaderUniformValue,
    IShaderConfiguration,
} from './interfaces';

import { generateVariantKey } from './utils';

interface MaterialProperty {
    value: ShaderUniformValue;
    lastModified: number;
    isDirty: boolean;
}

interface MaterialKeyword {
    enabled: boolean;
    lastModified: number;
}

export class MaterialInstance implements IMaterialInstance {
    public readonly shader: IShaderInstance;
    public readonly properties = new Map<string, ShaderUniformValue>();
    private readonly _materialProperties = new Map<string, MaterialProperty>();
    private readonly _keywords = new Map<string, MaterialKeyword>();

    private variantDirty = false;
    private lastVariantUpdate = 0;
    private readonly propertyAliases = new Map<string, string>();

    constructor(shader: IShaderInstance) {
        this.shader = shader;
        this.initializeProperties();
        this.setupPropertyAliases();
    }

    setProperty(name: string, value: ShaderUniformValue): void {
        const actualName = this.propertyAliases.get(name) || name;

        if (!this.shader.hasUniform(actualName)) {
            console.warn(`Property "${name}" (${actualName}) not found in material`);
            return;
        }

        const currentProperty = this._materialProperties.get(actualName);
        if (currentProperty && this.isValueEqual(currentProperty.value, value)) {
            return;
        }

        const now = performance.now();
        this._materialProperties.set(actualName, {
            value,
            lastModified: now,
            isDirty: true,
        });

        this.properties.set(actualName, value);

        this.shader.setUniform(actualName, value);
    }

    getProperty(name: string): ShaderUniformValue {
        const actualName = this.propertyAliases.get(name) || name;
        return this.properties.get(actualName) || null;
    }

    hasProperty(name: string): boolean {
        const actualName = this.propertyAliases.get(name) || name;
        return this.properties.has(actualName);
    }

    enableKeyword(keyword: string): void {
        const currentKeyword = this._keywords.get(keyword);
        if (currentKeyword?.enabled) {
            return;
        }

        this._keywords.set(keyword, {
            enabled: true,
            lastModified: performance.now(),
        });

        this.variantDirty = true;
    }

    disableKeyword(keyword: string): void {
        const currentKeyword = this._keywords.get(keyword);
        if (!currentKeyword?.enabled) {
            return;
        }

        this._keywords.set(keyword, {
            enabled: false,
            lastModified: performance.now(),
        });

        this.variantDirty = true;
    }

    hasKeyword(keyword: string): boolean {
        const keywordState = this._keywords.get(keyword);
        return keywordState?.enabled || false;
    }

    toggleKeyword(keyword: string): void {
        if (this.hasKeyword(keyword)) {
            this.disableKeyword(keyword);
        } else {
            this.enableKeyword(keyword);
        }
    }

    getEnabledKeywords(): string[] {
        const enabled: string[] = [];
        for (const [keyword, state] of this._keywords) {
            if (state.enabled) {
                enabled.push(keyword);
            }
        }
        return enabled;
    }

    clone(): IMaterialInstance {
        const cloned = new MaterialInstance(this.shader);

        for (const [name, property] of this._materialProperties) {
            cloned._materialProperties.set(name, {
                value: this.deepCloneValue(property.value),
                lastModified: property.lastModified,
                isDirty: property.isDirty,
            });
            cloned.properties.set(name, property.value);
        }

        for (const [keyword, state] of this._keywords) {
            cloned._keywords.set(keyword, { ...state });
        }

        return cloned;
    }

    setProperties(properties: Record<string, ShaderUniformValue>): void {
        for (const [name, value] of Object.entries(properties)) {
            this.setProperty(name, value);
        }
    }

    getPropertyNames(): string[] {
        return Array.from(this.properties.keys());
    }

    getDirtyProperties(): string[] {
        const dirty: string[] = [];
        for (const [name, property] of this._materialProperties) {
            if (property.isDirty) {
                dirty.push(name);
            }
        }
        return dirty;
    }

    markClean(): void {
        for (const property of this._materialProperties.values()) {
            property.isDirty = false;
        }
        this.variantDirty = false;
    }

    needsVariantUpdate(): boolean {
        return this.variantDirty;
    }

    getVariantHash(): string {
        const enabledKeywords = this.getEnabledKeywords();
        return generateVariantKey(this.shader.shader.name, enabledKeywords, {});
    }

    getStats() {
        let dirtyCount = 0;
        let totalProperties = 0;
        let lastModified = 0;

        for (const property of this._materialProperties.values()) {
            totalProperties++;
            if (property.isDirty) dirtyCount++;
            lastModified = Math.max(lastModified, property.lastModified);
        }

        return {
            totalProperties,
            dirtyProperties: dirtyCount,
            enabledKeywords: this.getEnabledKeywords().length,
            totalKeywords: this._keywords.size,
            lastModified,
            variantDirty: this.variantDirty,
        };
    }

    validate(): { valid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        const config = this.shader.shader.configuration;
        for (const uniform of config.uniforms) {
            if (!this.properties.has(uniform.name) && uniform.defaultValue === undefined) {
                warnings.push(`Property "${uniform.name}" has no value and no default`);
            }
        }

        for (const propertyName of this.properties.keys()) {
            if (!this.shader.hasUniform(propertyName)) {
                warnings.push(`Property "${propertyName}" is not used by the shader`);
            }
        }

        const validKeywords = new Set(config.keywords || []);
        for (const keyword of this._keywords.keys()) {
            if (!validKeywords.has(keyword)) {
                warnings.push(`Keyword "${keyword}" is not defined in shader`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    reset(): void {
        this.properties.clear();
        this._materialProperties.clear();
        this._keywords.clear();
        this.initializeProperties();
        this.variantDirty = true;
    }

    apply(): void {
        for (const [name, property] of this._materialProperties) {
            if (property.isDirty) {
                this.shader.setUniform(name, property.value);
                property.isDirty = false;
            }
        }

        this.variantDirty = false;
        this.lastVariantUpdate = performance.now();
    }

    private initializeProperties(): void {
        const config = this.shader.shader.configuration;

        for (const uniform of config.uniforms) {
            if (uniform.defaultValue !== undefined) {
                this._materialProperties.set(uniform.name, {
                    value: uniform.defaultValue,
                    lastModified: 0,
                    isDirty: false,
                });
                this.properties.set(uniform.name, uniform.defaultValue);
            }
        }

        if (config.keywords) {
            for (const keyword of config.keywords) {
                this._keywords.set(keyword, {
                    enabled: false,
                    lastModified: 0,
                });
            }
        }
    }

    private setupPropertyAliases(): void {
        this.propertyAliases.set('mainTexture', 'u_MainTexture');
        this.propertyAliases.set('color', 'u_Color');
        this.propertyAliases.set('tint', 'u_Color');
        this.propertyAliases.set('albedo', 'u_AlbedoColor');
        this.propertyAliases.set('emission', 'u_EmissionColor');
        this.propertyAliases.set('metallic', 'u_Metallic');
        this.propertyAliases.set('roughness', 'u_Roughness');
        this.propertyAliases.set('normalScale', 'u_NormalScale');
        this.propertyAliases.set('emissionIntensity', 'u_EmissionIntensity');
    }

    private isValueEqual(a: ShaderUniformValue, b: ShaderUniformValue): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a !== typeof b) return false;

        if (a instanceof Float32Array && b instanceof Float32Array) {
            return this.areArraysEqual(a, b);
        }
        if (a instanceof Int32Array && b instanceof Int32Array) {
            return this.areArraysEqual(a, b);
        }

        if (typeof a === 'object' && 'equals' in a && typeof a.equals === 'function') {
            return a.equals(b);
        }

        return false;
    }

    private areArraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (Math.abs(a[i] - b[i]) > 1e-6) return false;
        }
        return true;
    }

    private deepCloneValue(value: ShaderUniformValue): ShaderUniformValue {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (value instanceof Float32Array) {
            return new Float32Array(value);
        }
        if (value instanceof Int32Array) {
            return new Int32Array(value);
        }
        if (value instanceof Uint32Array) {
            return new Uint32Array(value);
        }

        if ('clone' in value && typeof value.clone === 'function') {
            return value.clone();
        }

        if (value instanceof WebGLTexture) {
            return value;
        }

        return value;
    }
}
