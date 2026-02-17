import { Vec4 } from '@axrone/numeric';
import {
    ITexture,
    ITextureSampler,
    ITextureManager,
    ITextureManagerStats,
    ITextureCreateOptions,
    ITextureSamplerOptions,
    ITextureBuilder,
    TextureDimension,
    TextureFormat,
    TextureUsage,
    FilterMode,
    WrapMode,
    TextureDataSource,
    TextureError,
    TextureErrorCode
} from './interfaces';
import { WebGLTexture } from './texture';
import { WebGLTextureSampler, SamplerFactory } from './sampler';
import { TextureUtils, TextureValidation } from './utils';

export class WebGLTextureManager implements ITextureManager {
    private readonly _gl: WebGL2RenderingContext;
    private readonly _textureCache = new Map<string, ITexture>();
    private readonly _samplerCache = new Map<string, ITextureSampler>();
    private readonly _defaultTextures = new Map<string, ITexture>();
    private readonly _loadPromises = new Map<string, Promise<ITexture>>();

    private _stats = {
        totalTextures: 0,
        totalMemoryUsage: 0,
        cacheHits: 0,
        cacheMisses: 0,
        texturesByFormat: new Map<TextureFormat, number>(),
        texturesByDimension: new Map<TextureDimension, number>(),
        texturesByUsage: new Map<TextureUsage, number>()
    };

    private _maxMemoryUsage: number = 512 * 1024 * 1024; 
    private _enableCache: boolean = true;

    constructor(gl: WebGL2RenderingContext) {
        this._gl = gl;
        this._initializeDefaultTextures();
    }

    public createTexture(options: ITextureCreateOptions, data?: TextureDataSource): ITexture {
        TextureValidation.validateCreateOptions(options);

        const texture = new WebGLTexture(this._gl, options, data);
        this._registerTexture(texture);

        return texture;
    }

    public createTexture2D(width: number, height: number, format: TextureFormat, data?: TextureDataSource): ITexture {
        const options: ITextureCreateOptions = {
            width,
            height,
            format,
            dimension: TextureDimension.TEXTURE_2D,
            usage: TextureUsage.STATIC
        };

        return this.createTexture(options, data);
    }

    public createTexture3D(width: number, height: number, depth: number, format: TextureFormat, data?: TextureDataSource): ITexture {
        const options: ITextureCreateOptions = {
            width,
            height,
            depth,
            format,
            dimension: TextureDimension.TEXTURE_3D,
            usage: TextureUsage.STATIC
        };

        return this.createTexture(options, data);
    }

    public createTextureCube(size: number, format: TextureFormat, data?: TextureDataSource[]): ITexture {
        const options: ITextureCreateOptions = {
            width: size,
            height: size,
            format,
            dimension: TextureDimension.TEXTURE_CUBE,
            usage: TextureUsage.STATIC
        };

        const texture = new WebGLTexture(this._gl, options);

        if (data && data.length === 6) {
            for (let face = 0; face < 6; face++) {
                if (data[face]) {
                    texture.setData(data[face], { mipLevel: 0, arrayLayer: face });
                }
            }
        }

        this._registerTexture(texture);
        return texture;
    }

    public createTextureArray(width: number, height: number, layers: number, format: TextureFormat, data?: TextureDataSource[]): ITexture {
        const options: ITextureCreateOptions = {
            width,
            height,
            arrayLayers: layers,
            format,
            dimension: TextureDimension.TEXTURE_2D_ARRAY,
            usage: TextureUsage.STATIC
        };

        const texture = new WebGLTexture(this._gl, options);

        if (data) {
            for (let layer = 0; layer < Math.min(data.length, layers); layer++) {
                if (data[layer]) {
                    texture.setData(data[layer], { mipLevel: 0, arrayLayer: layer });
                }
            }
        }

        this._registerTexture(texture);
        return texture;
    }

    public createSampler(options: ITextureSamplerOptions): ITextureSampler {
        TextureValidation.validateSamplerOptions(options);
        return new WebGLTextureSampler(this._gl, options);
    }

    public getDefaultSampler(filterMode: FilterMode, wrapMode: WrapMode): ITextureSampler {
        const cacheKey = `${filterMode}_${wrapMode}`;

        if (!this._samplerCache.has(cacheKey)) {
            const options: ITextureSamplerOptions = {
                minFilter: filterMode,
                magFilter: filterMode === FilterMode.LINEAR_MIPMAP_LINEAR ? FilterMode.LINEAR : filterMode,
                wrapS: wrapMode,
                wrapT: wrapMode
            };

            const sampler = new WebGLTextureSampler(this._gl, options);
            this._samplerCache.set(cacheKey, sampler);
        }

        return this._samplerCache.get(cacheKey)!;
    }

    public async loadFromFile(path: string, options?: Partial<ITextureCreateOptions>): Promise<ITexture> {

        if (this._loadPromises.has(path)) {
            return this._loadPromises.get(path)!;
        }

        const loadPromise = this._loadTextureFromPath(path, options);
        this._loadPromises.set(path, loadPromise);

        try {
            const texture = await loadPromise;
            return texture;
        } finally {
            this._loadPromises.delete(path);
        }
    }

    public async loadFromURL(url: string, options?: Partial<ITextureCreateOptions>): Promise<ITexture> {
        return this.loadFromFile(url, options);
    }

    public async loadCubeFromFiles(paths: [string, string, string, string, string, string]): Promise<ITexture> {
        const loadPromises = paths.map(path => this._loadImageFromPath(path));
        const images = await Promise.all(loadPromises);

        const firstImage = images[0];
        const size = Math.max(firstImage.width, firstImage.height);

        return this.createTextureCube(size, TextureFormat.RGBA8, images);
    }

    public getTexture(id: string): ITexture | null {
        const texture = this._textureCache.get(id);
        if (texture) {
            this._stats.cacheHits++;
            return texture;
        }

        this._stats.cacheMisses++;
        return null;
    }

    public cacheTexture(id: string, texture: ITexture): void {
        if (this._enableCache) {
            this._textureCache.set(id, texture);
        }
    }

    public removeCachedTexture(id: string): boolean {
        return this._textureCache.delete(id);
    }

    public clearCache(): void {

        for (const texture of this._textureCache.values()) {
            if (!texture.isDisposed) {
                texture.dispose();
            }
        }

        for (const sampler of this._samplerCache.values()) {
            if (!sampler.isDisposed) {
                sampler.dispose();
            }
        }

        this._textureCache.clear();
        this._samplerCache.clear();
        this._loadPromises.clear();

        this._stats.totalTextures = 0;
        this._stats.totalMemoryUsage = 0;
        this._stats.texturesByFormat.clear();
        this._stats.texturesByDimension.clear();
        this._stats.texturesByUsage.clear();
    }

    public getWhiteTexture(): ITexture {
        return this._getOrCreateDefaultTexture('white', () => {
            const data = new Uint8Array([255, 255, 255, 255]);
            return this.createTexture2D(1, 1, TextureFormat.RGBA8, data);
        });
    }

    public getBlackTexture(): ITexture {
        return this._getOrCreateDefaultTexture('black', () => {
            const data = new Uint8Array([0, 0, 0, 255]);
            return this.createTexture2D(1, 1, TextureFormat.RGBA8, data);
        });
    }

    public getNormalTexture(): ITexture {
        return this._getOrCreateDefaultTexture('normal', () => {
            const data = new Uint8Array([128, 128, 255, 255]); 
            return this.createTexture2D(1, 1, TextureFormat.RGBA8, data);
        });
    }

    public getCheckerboardTexture(): ITexture {
        return this._getOrCreateDefaultTexture('checkerboard', () => {
            const size = 8;
            const data = new Uint8Array(size * size * 4);

            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const index = (y * size + x) * 4;
                    const isBlack = (x + y) % 2 === 0;
                    const color = isBlack ? 0 : 255;

                    data[index] = color;     
                    data[index + 1] = color; 
                    data[index + 2] = color; 
                    data[index + 3] = 255;   
                }
            }

            return this.createTexture2D(size, size, TextureFormat.RGBA8, data);
        });
    }

    public getStats(): ITextureManagerStats {
        return {
            totalTextures: this._stats.totalTextures,
            totalMemoryUsage: this._stats.totalMemoryUsage,
            texturesByFormat: new Map(this._stats.texturesByFormat),
            texturesByDimension: new Map(this._stats.texturesByDimension),
            texturesByUsage: new Map(this._stats.texturesByUsage),
            cacheHitRate: this._stats.cacheHits / (this._stats.cacheHits + this._stats.cacheMisses),
            averageTextureSize: this._stats.totalTextures > 0 ? this._stats.totalMemoryUsage / this._stats.totalTextures : 0,
            largestTexture: this._findLargestTexture()
        };
    }

    public optimizeMemory(): void {
        if (this._stats.totalMemoryUsage <= this._maxMemoryUsage) {
            return;
        }

        const texturesToDispose: ITexture[] = [];
        let memoryToFree = this._stats.totalMemoryUsage - this._maxMemoryUsage;

        for (const texture of this._textureCache.values()) {
            if (memoryToFree <= 0) break;

            if (!this._isDefaultTexture(texture)) {
                texturesToDispose.push(texture);
                memoryToFree -= texture.totalMemoryUsage;
            }
        }

        for (const texture of texturesToDispose) {
            this._unregisterTexture(texture);
            texture.dispose();
        }
    }

    public dispose(): void {
        this.clearCache();

        for (const texture of this._defaultTextures.values()) {
            if (!texture.isDisposed) {
                texture.dispose();
            }
        }
        this._defaultTextures.clear();
    }

    public builder(): ITextureBuilder {
        return new TextureBuilder(this);
    }

    private _initializeDefaultTextures(): void {

    }

    private _registerTexture(texture: ITexture): void {
        this._stats.totalTextures++;
        this._stats.totalMemoryUsage += texture.totalMemoryUsage;

        const formatCount = this._stats.texturesByFormat.get(texture.format) || 0;
        this._stats.texturesByFormat.set(texture.format, formatCount + 1);

        const dimensionCount = this._stats.texturesByDimension.get(texture.dimension) || 0;
        this._stats.texturesByDimension.set(texture.dimension, dimensionCount + 1);

        const usageCount = this._stats.texturesByUsage.get(texture.usage) || 0;
        this._stats.texturesByUsage.set(texture.usage, usageCount + 1);
    }

    private _unregisterTexture(texture: ITexture): void {
        this._stats.totalTextures--;
        this._stats.totalMemoryUsage -= texture.totalMemoryUsage;

        const formatCount = this._stats.texturesByFormat.get(texture.format) || 0;
        if (formatCount > 1) {
            this._stats.texturesByFormat.set(texture.format, formatCount - 1);
        } else {
            this._stats.texturesByFormat.delete(texture.format);
        }

        const dimensionCount = this._stats.texturesByDimension.get(texture.dimension) || 0;
        if (dimensionCount > 1) {
            this._stats.texturesByDimension.set(texture.dimension, dimensionCount - 1);
        } else {
            this._stats.texturesByDimension.delete(texture.dimension);
        }

        const usageCount = this._stats.texturesByUsage.get(texture.usage) || 0;
        if (usageCount > 1) {
            this._stats.texturesByUsage.set(texture.usage, usageCount - 1);
        } else {
            this._stats.texturesByUsage.delete(texture.usage);
        }

        for (const [key, cachedTexture] of this._textureCache.entries()) {
            if (cachedTexture === texture) {
                this._textureCache.delete(key);
                break;
            }
        }
    }

    private _getOrCreateDefaultTexture(type: string, factory: () => ITexture): ITexture {
        if (!this._defaultTextures.has(type)) {
            this._defaultTextures.set(type, factory());
        }
        return this._defaultTextures.get(type)!;
    }

    private _isDefaultTexture(texture: ITexture): boolean {
        return Array.from(this._defaultTextures.values()).includes(texture);
    }

    private _findLargestTexture(): ITexture | null {
        let largest: ITexture | null = null;
        let maxMemory = 0;

        for (const texture of this._textureCache.values()) {
            if (texture.totalMemoryUsage > maxMemory) {
                maxMemory = texture.totalMemoryUsage;
                largest = texture;
            }
        }

        return largest;
    }

    private async _loadTextureFromPath(path: string, options?: Partial<ITextureCreateOptions>): Promise<ITexture> {
        try {
            const image = await this._loadImageFromPath(path);

            const createOptions: ITextureCreateOptions = {
                width: image.width,
                height: image.height,
                format: TextureFormat.RGBA8,
                dimension: TextureDimension.TEXTURE_2D,
                usage: TextureUsage.STATIC,
                mipLevels: 1,
                ...options
            };

            const texture = this.createTexture(createOptions, image);

            if (createOptions.mipLevels! > 1) {
                texture.generateMipmaps();
            }

            return texture;
        } catch (error) {
            throw new TextureError(
                `Failed to load texture from path: ${path}`,
                TextureErrorCode.LOAD_FAILED,
                undefined,
                error as Error
            );
        }
    }

    private async _loadImageFromPath(path: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Failed to load image: ${path}`));

            if (path.startsWith('http')) {
                image.crossOrigin = 'anonymous';
            }

            image.src = path;
        });
    }
}

class TextureBuilder implements ITextureBuilder {
    private _options: {
        width?: number;
        height?: number;
        depth?: number;
        format?: TextureFormat;
        dimension?: TextureDimension;
        mipLevels?: number;
        arrayLayers?: number;
        samples?: number;
        usage?: TextureUsage;
        colorSpace?: any;
        label?: string;
    } = {};
    private _samplerOptions: {
        minFilter?: FilterMode;
        magFilter?: FilterMode;
        wrapS?: WrapMode;
        wrapT?: WrapMode;
        wrapR?: WrapMode;
        borderColor?: Vec4;
        maxAnisotropy?: number;
    } = {};
    private _data: TextureDataSource = null;

    constructor(private _manager: WebGLTextureManager) {}

    public dimension(dim: TextureDimension): ITextureBuilder {
        this._options.dimension = dim;
        return this;
    }

    public size(width: number, height: number, depth?: number): ITextureBuilder {
        this._options.width = width;
        this._options.height = height;
        if (depth !== undefined) {
            this._options.depth = depth;
        }
        return this;
    }

    public format(fmt: TextureFormat): ITextureBuilder {
        this._options.format = fmt;
        return this;
    }

    public mipLevels(levels: number): ITextureBuilder {
        this._options.mipLevels = levels;
        return this;
    }

    public arrayLayers(layers: number): ITextureBuilder {
        this._options.arrayLayers = layers;
        return this;
    }

    public samples(count: number): ITextureBuilder {
        this._options.samples = count;
        return this;
    }

    public usage(use: TextureUsage): ITextureBuilder {
        this._options.usage = use;
        return this;
    }

    public colorSpace(space: any): ITextureBuilder {
        this._options.colorSpace = space;
        return this;
    }

    public label(name: string): ITextureBuilder {
        this._options.label = name;
        return this;
    }

    public data(source: TextureDataSource): ITextureBuilder {
        this._data = source;
        return this;
    }

    public filtering(min: FilterMode, mag: FilterMode): ITextureBuilder {
        this._samplerOptions.minFilter = min;
        this._samplerOptions.magFilter = mag;
        return this;
    }

    public wrapping(s: WrapMode, t: WrapMode, r?: WrapMode): ITextureBuilder {
        this._samplerOptions.wrapS = s;
        this._samplerOptions.wrapT = t;
        if (r !== undefined) {
            this._samplerOptions.wrapR = r;
        }
        return this;
    }

    public anisotropy(level: number): ITextureBuilder {
        this._samplerOptions.maxAnisotropy = level;
        return this;
    }

    public borderColor(color: Vec4): ITextureBuilder {
        this._samplerOptions.borderColor = color;
        return this;
    }

    public build(): ITexture {

        if (!this._options.width || !this._options.height) {
            throw new TextureError(
                'Width and height are required',
                TextureErrorCode.INVALID_DIMENSIONS
            );
        }

        if (!this._options.format) {
            throw new TextureError(
                'Texture format is required',
                TextureErrorCode.UNSUPPORTED_FORMAT
            );
        }

        if (!this._options.dimension) {
            this._options.dimension = TextureDimension.TEXTURE_2D;
        }

        if (!this._options.usage) {
            this._options.usage = TextureUsage.STATIC;
        }

        return this._manager.createTexture(this._options as ITextureCreateOptions, this._data);
    }
}
