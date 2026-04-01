import { ObjectPool } from '@axrone/utility';
import {
    IShaderManager,
    IShaderConfiguration,
    ICompiledShader,
    IShaderVariant,
    IMaterialInstance,
    ShaderUniformValue,
    IShaderCompiler,
} from './interfaces';

import { WebGLShaderCompiler } from './compiler';
import { ShaderInstance } from './instance';
import { MaterialInstance } from './material';
import { generateVariantKey, SHADER_CACHE_LIMITS } from './utils';

interface ShaderCacheEntry {
    readonly shader: ICompiledShader;
    readonly variants: Map<string, IShaderVariant>;
    lastAccessed: number;
    accessCount: number;
}

interface ShaderManagerStats {
    loadedShaders: number;
    totalVariants: number;
    cacheHits: number;
    cacheMisses: number;
    memoryUsage: number;
    compilationTime: number;
    hitRate: number;
}

export class ShaderManager implements IShaderManager {
    private readonly gl: WebGL2RenderingContext;
    private readonly compiler: IShaderCompiler;
    private readonly shaderCache = new Map<string, ShaderCacheEntry>();
    private readonly configurationCache = new Map<string, IShaderConfiguration>();
    private readonly includeCache = new Map<string, string>();
    private readonly materialPool: ObjectPool<MaterialInstance>;

    private stats: ShaderManagerStats = {
        loadedShaders: 0,
        totalVariants: 0,
        cacheHits: 0,
        cacheMisses: 0,
        memoryUsage: 0,
        compilationTime: 0,
        hitRate: 0,
    };

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.compiler = new WebGLShaderCompiler(gl);

        this.materialPool = new ObjectPool<MaterialInstance>({
            factory: () => new MaterialInstance(null as any),
            resetHandler: (material) => {},
        });
    }

    async loadFromJSON(json: string): Promise<ICompiledShader> {
        const startTime = performance.now();

        try {
            const configuration: IShaderConfiguration = JSON.parse(json);
            return await this.loadFromConfiguration(configuration);
        } catch (error) {
            throw new Error(`Failed to parse shader JSON: ${error}`);
        } finally {
            this.stats.compilationTime += performance.now() - startTime;
        }
    }

    async loadFromFile(path: string): Promise<ICompiledShader> {
        const startTime = performance.now();

        try {
            if (this.configurationCache.has(path)) {
                const configuration = this.configurationCache.get(path)!;
                return await this.loadFromConfiguration(configuration);
            }

            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load shader file: ${response.statusText}`);
            }

            const json = await response.text();
            const configuration: IShaderConfiguration = JSON.parse(json);

            this.configurationCache.set(path, configuration);

            return await this.loadFromConfiguration(configuration);
        } catch (error) {
            throw new Error(`Failed to load shader from file "${path}": ${error}`);
        } finally {
            this.stats.compilationTime += performance.now() - startTime;
        }
    }

    async loadFromConfiguration(configuration: IShaderConfiguration): Promise<ICompiledShader> {
        const cacheKey = configuration.name;
        const cachedEntry = this.shaderCache.get(cacheKey);

        if (cachedEntry) {
            cachedEntry.lastAccessed = Date.now();
            cachedEntry.accessCount++;
            this.stats.cacheHits++;
            this.updateStats();
            return cachedEntry.shader;
        }

        this.stats.cacheMisses++;

        const shader = await this.compiler.compile(configuration);

        const entry: ShaderCacheEntry = {
            shader,
            variants: new Map<string, IShaderVariant>(),
            lastAccessed: Date.now(),
            accessCount: 1,
        };

        this.shaderCache.set(cacheKey, entry);
        this.stats.loadedShaders++;
        this.updateStats();

        return shader;
    }

    createMaterial(
        shaderName: string,
        properties: Record<string, ShaderUniformValue> = {}
    ): IMaterialInstance {
        const shader = this.getShader(shaderName);
        if (!shader) {
            throw new Error(`Shader "${shaderName}" not found`);
        }

        const instance = new ShaderInstance(shader, {
            keywords: [],
            defines: {},
            hash: generateVariantKey(shaderName, [], {}),
            shader,
        });

        const material = new MaterialInstance(instance);

        for (const [name, value] of Object.entries(properties)) {
            material.setProperty(name, value);
        }

        return material;
    }

    getShader(name: string): ICompiledShader | null {
        const entry = this.shaderCache.get(name);
        if (entry) {
            entry.lastAccessed = Date.now();
            entry.accessCount++;
            this.stats.cacheHits++;
            this.updateStats();
            return entry.shader;
        }
        this.stats.cacheMisses++;
        this.updateStats();
        return null;
    }

    async getVariant(shader: ICompiledShader, keywords: string[]): Promise<IShaderVariant> {
        const entry = this.shaderCache.get(shader.name);
        if (!entry) {
            throw new Error(`Shader "${shader.name}" not found in cache`);
        }

        const variantKey = generateVariantKey(shader.name, keywords, {});
        const cachedVariant = entry.variants.get(variantKey);

        if (cachedVariant) {
            this.stats.cacheHits++;
            this.updateStats();
            return cachedVariant;
        }

        this.stats.cacheMisses++;

        const variant = await this.compiler.compileVariant(shader, keywords, {});
        entry.variants.set(variantKey, variant);
        this.stats.totalVariants++;
        this.updateStats();

        return variant;
    }

    dispose(shader: ICompiledShader): void {
        const entry = this.shaderCache.get(shader.name);
        if (entry) {
            this.disposeShaderEntry(entry);
            this.shaderCache.delete(shader.name);
            this.stats.loadedShaders--;
            this.updateStats();
        }
    }

    disposeAll(): void {
        for (const entry of this.shaderCache.values()) {
            this.disposeShaderEntry(entry);
        }

        this.shaderCache.clear();
        this.configurationCache.clear();
        this.includeCache.clear();

        this.stats = {
            loadedShaders: 0,
            totalVariants: 0,
            cacheHits: 0,
            cacheMisses: 0,
            memoryUsage: 0,
            compilationTime: 0,
            hitRate: 0,
        };
    }

    async preloadIncludes(includes: Record<string, string>): Promise<void> {
        const loadPromises = Object.entries(includes).map(async ([name, path]) => {
            try {
                const response = await fetch(path);
                if (response.ok) {
                    const content = await response.text();
                    this.includeCache.set(name, content);
                }
            } catch (error) {
                console.warn(`Failed to preload include "${name}": ${error}`);
            }
        });

        await Promise.all(loadPromises);
    }

    getInclude(name: string): string | null {
        return this.includeCache.get(name) || null;
    }

    optimizeCache(): void {
        // LRU caches handle eviction automatically, but we can trigger cleanup
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        const shadersToEvict: string[] = [];

        // Find old, rarely used shaders
        for (const [name, entry] of this.shaderCache.entries()) {
            const age = now - entry.lastAccessed;
            if (age > maxAge && entry.accessCount < 5) {
                shadersToEvict.push(name);
            }
        }

        // Remove old shaders
        for (const name of shadersToEvict) {
            this.shaderCache.delete(name);
        }

        // Force garbage collection if memory usage is too high
        if (this.stats.memoryUsage > SHADER_CACHE_LIMITS.MAX_CACHE_SIZE_BYTES) {
            // Remove half of the least recently used shaders
            const entries = Array.from(this.shaderCache.entries()).sort(
                ([, a], [, b]) => a.lastAccessed - b.lastAccessed
            );

            const toRemove = Math.floor(entries.length * 0.5);
            for (let i = 0; i < toRemove; i++) {
                const [key, entry] = entries[i];
                this.disposeShaderEntry(entry);
                this.shaderCache.delete(key);
            }
        }

        this.updateStats();
    }

    getStats(): Readonly<ShaderManagerStats> {
        return { ...this.stats };
    }

    getCacheInfo() {
        const shaders: Array<{
            name: string;
            variants: number;
            lastAccessed: number;
            accessCount: number;
            memorySize: number;
        }> = [];

        for (const [name, entry] of this.shaderCache.entries()) {
            let variantMemory = 0;
            for (const variant of entry.variants.values()) {
                variantMemory += variant.shader.bytecodeSize;
            }

            shaders.push({
                name,
                variants: entry.variants.size,
                lastAccessed: entry.lastAccessed,
                accessCount: entry.accessCount,
                memorySize: entry.shader.bytecodeSize + variantMemory,
            });
        }

        return {
            totalShaders: this.stats.loadedShaders,
            totalVariants: this.stats.totalVariants,
            totalMemory: this.stats.memoryUsage,
            hitRate: this.stats.hitRate,
            averageCompilationTime:
                this.stats.compilationTime / Math.max(1, this.stats.loadedShaders),
            cacheEfficiency: {
                shaderCacheSize: this.shaderCache.size,
                shaderCacheMaxSize: SHADER_CACHE_LIMITS.MAX_COMPILED_SHADERS,
                configCacheSize: this.configurationCache.size,
                configCacheMaxSize: SHADER_CACHE_LIMITS.MAX_CONFIGURATIONS,
            },
            shaders: shaders.sort((a, b) => b.accessCount - a.accessCount),
        };
    }

    private updateStats(): void {
        let totalSize = 0;
        let totalVariants = 0;

        for (const entry of this.shaderCache.values()) {
            totalSize += entry.shader.bytecodeSize;
            totalVariants += entry.variants.size;

            for (const variant of entry.variants.values()) {
                totalSize += variant.shader.bytecodeSize;
            }
        }

        this.stats = {
            ...this.stats,
            memoryUsage: totalSize,
            totalVariants,
            hitRate:
                this.stats.cacheHits / Math.max(1, this.stats.cacheHits + this.stats.cacheMisses),
        };
    }

    private disposeShaderEntry(entry: ShaderCacheEntry): void {
        this.gl.deleteProgram(entry.shader.program);

        for (const variant of entry.variants.values()) {
            this.disposeVariant(variant);
        }
        entry.variants.clear();
    }

    private disposeVariant(variant: IShaderVariant): void {
        this.gl.deleteProgram(variant.shader.program);
    }
}
