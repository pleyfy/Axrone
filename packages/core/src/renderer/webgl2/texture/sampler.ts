import { Vec4 } from '@axrone/numeric';
import {
    ITextureSampler,
    ITextureSamplerOptions,
    FilterMode,
    WrapMode,
    TextureError,
    TextureErrorCode
} from './interfaces';
import { 
    TextureWebGLConstants,
    TextureValidation 
} from './utils';

export class WebGLTextureSampler implements ITextureSampler {
    public readonly id: string;
    public readonly nativeHandle: WebGLSampler;
    public readonly options: ITextureSamplerOptions;

    private _isDisposed = false;
    private _currentUnit = -1;

    private readonly _gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext, options: ITextureSamplerOptions) {
        this._gl = gl;

        TextureValidation.validateSamplerOptions(options);

        this.id = this._generateSamplerId();
        this.options = { ...options }; 

        const handle = this._gl.createSampler();
        if (!handle) {
            throw new TextureError(
                'Failed to create WebGL sampler',
                TextureErrorCode.CONTEXT_LOST,
                this.id
            );
        }
        this.nativeHandle = handle;

        this._configureSampler();
    }

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    public bind(unit?: number): void {
        this._validateNotDisposed();

        if (unit === undefined) {
            throw new TextureError(
                'Texture unit is required for sampler binding',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        if (unit < 0) {
            throw new TextureError(
                'Texture unit must be non-negative',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        this._gl.bindSampler(unit, this.nativeHandle);
        this._currentUnit = unit;
    }

    public unbind(): void {
        if (this._currentUnit >= 0) {
            this._gl.bindSampler(this._currentUnit, null);
            this._currentUnit = -1;
        }
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._gl.deleteSampler(this.nativeHandle);
        this._isDisposed = true;
        this._currentUnit = -1;
    }

    private _validateNotDisposed(): void {
        if (this._isDisposed) {
            throw new TextureError(
                'Sampler has been disposed',
                TextureErrorCode.ALREADY_DISPOSED,
                this.id
            );
        }
    }

    private _generateSamplerId(): string {
        return `sampler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private _configureSampler(): void {
        const gl = this._gl;
        const sampler = this.nativeHandle;

        gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, 
            TextureWebGLConstants.getFilterConstant(this.options.minFilter));
        gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, 
            TextureWebGLConstants.getFilterConstant(this.options.magFilter));

        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, 
            TextureWebGLConstants.getWrapConstant(this.options.wrapS));
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, 
            TextureWebGLConstants.getWrapConstant(this.options.wrapT));

        if (this.options.wrapR !== undefined) {
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, 
                TextureWebGLConstants.getWrapConstant(this.options.wrapR));
        }

        if (this.options.borderColor) {
            const color = this.options.borderColor;

        }

        if (this.options.maxAnisotropy !== undefined && this.options.maxAnisotropy > 1) {
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext) {
                const maxAnisotropy = Math.min(
                    this.options.maxAnisotropy,
                    gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
                );
                gl.samplerParameterf(sampler, ext.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
            }
        }

        if (this.options.compareMode === 'COMPARE_REF_TO_TEXTURE') {
            gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);

            if (this.options.compareFunc) {
                const compareFuncs: Record<string, number> = {
                    'NEVER': gl.NEVER,
                    'LESS': gl.LESS,
                    'EQUAL': gl.EQUAL,
                    'LEQUAL': gl.LEQUAL,
                    'GREATER': gl.GREATER,
                    'NOTEQUAL': gl.NOTEQUAL,
                    'GEQUAL': gl.GEQUAL,
                    'ALWAYS': gl.ALWAYS
                };

                gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_FUNC, 
                    compareFuncs[this.options.compareFunc]);
            }
        } else {
            gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_MODE, gl.NONE);
        }

        if (this.options.minLod !== undefined) {
            gl.samplerParameterf(sampler, gl.TEXTURE_MIN_LOD, this.options.minLod);
        }

        if (this.options.maxLod !== undefined) {
            gl.samplerParameterf(sampler, gl.TEXTURE_MAX_LOD, this.options.maxLod);
        }

        if (this.options.lodBias !== undefined) {

        }
    }
}

export class SamplerFactory {
    private static readonly _commonSamplers = new Map<string, ITextureSamplerOptions>();

    static {

        this._commonSamplers.set('linear_repeat', {
            minFilter: FilterMode.LINEAR,
            magFilter: FilterMode.LINEAR,
            wrapS: WrapMode.REPEAT,
            wrapT: WrapMode.REPEAT
        });

        this._commonSamplers.set('linear_clamp', {
            minFilter: FilterMode.LINEAR,
            magFilter: FilterMode.LINEAR,
            wrapS: WrapMode.CLAMP_TO_EDGE,
            wrapT: WrapMode.CLAMP_TO_EDGE
        });

        this._commonSamplers.set('nearest_repeat', {
            minFilter: FilterMode.NEAREST,
            magFilter: FilterMode.NEAREST,
            wrapS: WrapMode.REPEAT,
            wrapT: WrapMode.REPEAT
        });

        this._commonSamplers.set('nearest_clamp', {
            minFilter: FilterMode.NEAREST,
            magFilter: FilterMode.NEAREST,
            wrapS: WrapMode.CLAMP_TO_EDGE,
            wrapT: WrapMode.CLAMP_TO_EDGE
        });

        this._commonSamplers.set('trilinear', {
            minFilter: FilterMode.LINEAR_MIPMAP_LINEAR,
            magFilter: FilterMode.LINEAR,
            wrapS: WrapMode.REPEAT,
            wrapT: WrapMode.REPEAT,
            maxAnisotropy: 16
        });

        this._commonSamplers.set('shadow', {
            minFilter: FilterMode.LINEAR,
            magFilter: FilterMode.LINEAR,
            wrapS: WrapMode.CLAMP_TO_EDGE,
            wrapT: WrapMode.CLAMP_TO_EDGE,
            compareMode: 'COMPARE_REF_TO_TEXTURE',
            compareFunc: 'LEQUAL'
        });
    }

    public static createCommonSampler(
        gl: WebGL2RenderingContext, 
        type: 'linear_repeat' | 'linear_clamp' | 'nearest_repeat' | 'nearest_clamp' | 'trilinear' | 'shadow'
    ): WebGLTextureSampler {
        const options = this._commonSamplers.get(type);
        if (!options) {
            throw new TextureError(
                `Unknown common sampler type: ${type}`,
                TextureErrorCode.INVALID_OPERATION
            );
        }

        return new WebGLTextureSampler(gl, options);
    }

    public static builder(): SamplerBuilder {
        return new SamplerBuilder();
    }
}

export class SamplerBuilder {
    private _options: {
        minFilter?: FilterMode;
        magFilter?: FilterMode;
        wrapS?: WrapMode;
        wrapT?: WrapMode;
        wrapR?: WrapMode;
        borderColor?: Vec4;
        maxAnisotropy?: number;
        compareMode?: 'NONE' | 'COMPARE_REF_TO_TEXTURE';
        compareFunc?: 'NEVER' | 'LESS' | 'EQUAL' | 'LEQUAL' | 'GREATER' | 'NOTEQUAL' | 'GEQUAL' | 'ALWAYS';
        minLod?: number;
        maxLod?: number;
        lodBias?: number;
    } = {};

    public minFilter(filter: FilterMode): SamplerBuilder {
        this._options.minFilter = filter;
        return this;
    }

    public magFilter(filter: FilterMode): SamplerBuilder {
        this._options.magFilter = filter;
        return this;
    }

    public wrapS(wrap: WrapMode): SamplerBuilder {
        this._options.wrapS = wrap;
        return this;
    }

    public wrapT(wrap: WrapMode): SamplerBuilder {
        this._options.wrapT = wrap;
        return this;
    }

    public wrapR(wrap: WrapMode): SamplerBuilder {
        this._options.wrapR = wrap;
        return this;
    }

    public wrapAll(wrap: WrapMode): SamplerBuilder {
        this._options.wrapS = wrap;
        this._options.wrapT = wrap;
        this._options.wrapR = wrap;
        return this;
    }

    public borderColor(color: Vec4): SamplerBuilder {
        this._options.borderColor = color;
        return this;
    }

    public anisotropy(level: number): SamplerBuilder {
        this._options.maxAnisotropy = level;
        return this;
    }

    public shadowComparison(func: 'NEVER' | 'LESS' | 'EQUAL' | 'LEQUAL' | 'GREATER' | 'NOTEQUAL' | 'GEQUAL' | 'ALWAYS'): SamplerBuilder {
        this._options.compareMode = 'COMPARE_REF_TO_TEXTURE';
        this._options.compareFunc = func;
        return this;
    }

    public lodRange(min: number, max: number): SamplerBuilder {
        this._options.minLod = min;
        this._options.maxLod = max;
        return this;
    }

    public lodBias(bias: number): SamplerBuilder {
        this._options.lodBias = bias;
        return this;
    }

    public build(gl: WebGL2RenderingContext): WebGLTextureSampler {

        if (!this._options.minFilter || !this._options.magFilter) {
            throw new TextureError(
                'Min and mag filters are required',
                TextureErrorCode.INVALID_OPERATION
            );
        }

        if (!this._options.wrapS || !this._options.wrapT) {
            throw new TextureError(
                'Wrap modes for S and T are required',
                TextureErrorCode.INVALID_OPERATION
            );
        }

        return new WebGLTextureSampler(gl, this._options as ITextureSamplerOptions);
    }
}
