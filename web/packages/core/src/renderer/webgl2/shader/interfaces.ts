import { Mat4, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/utility';

export const enum ShaderDataType {
    FLOAT = 'float',
    VEC2 = 'vec2',
    VEC3 = 'vec3',
    VEC4 = 'vec4',
    MAT2 = 'mat2',
    MAT3 = 'mat3',
    MAT4 = 'mat4',
    INT = 'int',
    IVEC2 = 'ivec2',
    IVEC3 = 'ivec3',
    IVEC4 = 'ivec4',
    UINT = 'uint',
    UVEC2 = 'uvec2',
    UVEC3 = 'uvec3',
    UVEC4 = 'uvec4',
    BOOL = 'bool',
    BVEC2 = 'bvec2',
    BVEC3 = 'bvec3',
    BVEC4 = 'bvec4',
    SAMPLER_2D = 'sampler2D',
    SAMPLER_CUBE = 'samplerCube',
    SAMPLER_2D_ARRAY = 'sampler2DArray',
}

export const enum ShaderQualifier {
    ATTRIBUTE = 'attribute',
    UNIFORM = 'uniform',
    VARYING = 'varying',
    CONST = 'const',
    IN = 'in',
    OUT = 'out',
    INOUT = 'inout',
}

export const enum ShaderStage {
    VERTEX = 'vertex',
    FRAGMENT = 'fragment',
    GEOMETRY = 'geometry',
    TESSELLATION_CONTROL = 'tessellation_control',
    TESSELLATION_EVALUATION = 'tessellation_evaluation',
    COMPUTE = 'compute',
}

export const enum BlendMode {
    OPAQUE = 'opaque',
    ALPHA_BLEND = 'alpha_blend',
    ADDITIVE = 'additive',
    MULTIPLY = 'multiply',
    SCREEN = 'screen',
    OVERLAY = 'overlay',
}

export const enum CullMode {
    OFF = 'off',
    FRONT = 'front',
    BACK = 'back',
}

export const enum DepthFunc {
    NEVER = 'never',
    LESS = 'less',
    EQUAL = 'equal',
    LEQUAL = 'lequal',
    GREATER = 'greater',
    NOTEQUAL = 'notequal',
    GEQUAL = 'gequal',
    ALWAYS = 'always',
}

export interface IShaderVariable {
    readonly name: string;
    readonly type: ShaderDataType;
    readonly qualifier: ShaderQualifier;
    readonly location?: number;
    readonly defaultValue?: ShaderUniformValue;
    readonly semantic?: string;
    readonly precision?: 'lowp' | 'mediump' | 'highp';
    readonly arraySize?: number;
}

export interface IVertexAttribute extends IShaderVariable {
    readonly qualifier: ShaderQualifier.ATTRIBUTE | ShaderQualifier.IN;
    readonly binding: number;
    readonly stride?: number;
    readonly offset?: number;
    readonly normalized?: boolean;
    readonly divisor?: number;
}

export interface IUniformVariable extends IShaderVariable {
    readonly qualifier: ShaderQualifier.UNIFORM;
    readonly binding?: number;
    readonly bufferOffset?: number;
    readonly category?: 'material' | 'frame' | 'camera' | 'object' | 'lighting';
}

export interface IVaryingVariable extends IShaderVariable {
    readonly qualifier: ShaderQualifier.VARYING | ShaderQualifier.IN | ShaderQualifier.OUT;
    readonly interpolation?: 'smooth' | 'flat' | 'noperspective';
}

export type ShaderUniformValue =
    | number
    | boolean
    | Vec2
    | Vec3
    | Vec4
    | Mat4
    | Float32Array
    | Int32Array
    | Uint32Array
    | WebGLTexture
    | null;

export interface IUniformBlock {
    readonly name: string;
    readonly binding: number;
    readonly variables: readonly IUniformVariable[];
    readonly size: number;
    readonly buffer?: ByteBuffer;
}

export interface ITextureProperty {
    readonly name: string;
    readonly type: 'texture2D' | 'textureCube' | 'texture2DArray';
    readonly slot: number;
    readonly defaultTexture?: string;
    readonly wrapS?: 'repeat' | 'clamp' | 'mirror';
    readonly wrapT?: 'repeat' | 'clamp' | 'mirror';
    readonly filterMin?:
        | 'nearest'
        | 'linear'
        | 'nearest_mipmap_nearest'
        | 'linear_mipmap_nearest'
        | 'nearest_mipmap_linear'
        | 'linear_mipmap_linear';
    readonly filterMag?: 'nearest' | 'linear';
    readonly anisotropy?: number;
    readonly sRGB?: boolean;
}

export interface IRenderState {
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly depthFunc?: DepthFunc;
    readonly cullMode?: CullMode;
    readonly blendMode?: BlendMode;
    readonly blendSrc?: number;
    readonly blendDst?: number;
    readonly blendEquation?: number;
    readonly colorWrite?: [boolean, boolean, boolean, boolean];
    readonly stencilTest?: boolean;
    readonly stencilFunc?: number;
    readonly stencilRef?: number;
    readonly stencilMask?: number;
    readonly stencilFail?: number;
    readonly stencilZFail?: number;
    readonly stencilZPass?: number;
    readonly polygonOffset?: [number, number];
    readonly scissorTest?: boolean;
}

export interface IShaderPass {
    readonly name: string;
    readonly stage: ShaderStage[];
    readonly vertexShader: string;
    readonly fragmentShader?: string;
    readonly geometryShader?: string;
    readonly tessellationControlShader?: string;
    readonly tessellationEvaluationShader?: string;
    readonly computeShader?: string;
    readonly renderState: IRenderState;
    readonly defines?: Record<string, string | number | boolean>;
    readonly keywords?: string[];
}

export interface IShaderConfiguration {
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    readonly tags?: string[];
    readonly category?: string;
    readonly fallback?: string;
    readonly attributes: readonly IVertexAttribute[];
    readonly uniforms: readonly IUniformVariable[];
    readonly uniformBlocks?: readonly IUniformBlock[];
    readonly textures: readonly ITextureProperty[];
    readonly varyings?: readonly IVaryingVariable[];
    readonly passes: readonly IShaderPass[];
    readonly defines?: Record<string, string | number | boolean>;
    readonly keywords?: string[];
    readonly includes?: string[];
    readonly optimization?: {
        readonly level: 'none' | 'basic' | 'aggressive';
        readonly preservePrecision?: boolean;
        readonly removeUnusedVariables?: boolean;
        readonly inlineConstants?: boolean;
    };
}

export interface ICompiledShader {
    readonly id: string;
    readonly name: string;
    readonly configuration: IShaderConfiguration;
    readonly program: WebGLProgram;
    readonly uniformLocations: Map<string, WebGLUniformLocation>;
    readonly attributeLocations: Map<string, number>;
    readonly uniformBlocks: Map<string, IUniformBlock>;
    readonly textureSlots: Map<string, number>;
    readonly renderState: IRenderState;
    readonly bytecodeSize: number;
    readonly compilationTime: number;
}

export interface IShaderVariant {
    readonly keywords: readonly string[];
    readonly defines: Record<string, string | number | boolean>;
    readonly hash: string;
    readonly shader: ICompiledShader;
}

export interface IShaderInstance {
    readonly shader: ICompiledShader;
    readonly variant: IShaderVariant;
    readonly uniforms: Map<string, ShaderUniformValue>;
    readonly textures: Map<string, WebGLTexture>;
    readonly uniformBuffers: Map<string, ByteBuffer>;

    setUniform(name: string, value: ShaderUniformValue): void;
    setTexture(name: string, texture: WebGLTexture): void;
    setUniformBuffer(name: string, buffer: ByteBuffer): void;
    hasUniform(name: string): boolean;
    getUniform(name: string): ShaderUniformValue;
    bind(gl: WebGL2RenderingContext): void;
    unbind(gl: WebGL2RenderingContext): void;
}

export interface IMaterialInstance {
    readonly shader: IShaderInstance;
    readonly properties: Map<string, ShaderUniformValue>;

    setProperty(name: string, value: ShaderUniformValue): void;
    getProperty(name: string): ShaderUniformValue;
    hasProperty(name: string): boolean;
    enableKeyword(keyword: string): void;
    disableKeyword(keyword: string): void;
    hasKeyword(keyword: string): boolean;
    getEnabledKeywords(): string[];
    apply(): void;
    clone(): IMaterialInstance;
}

export interface IShaderCompilerOptions {
    readonly enableOptimization?: boolean;
    readonly preserveDebugInfo?: boolean;
    readonly validateInputs?: boolean;
    readonly generateReflection?: boolean;
    readonly targetVersion?: '300 es' | '310 es' | '320 es';
}

export interface IShaderCompiler {
    compile(
        configuration: IShaderConfiguration,
        options?: IShaderCompilerOptions
    ): Promise<ICompiledShader>;
    compileVariant(
        shader: ICompiledShader,
        keywords: string[],
        defines: Record<string, any>
    ): Promise<IShaderVariant>;
    validateConfiguration(configuration: IShaderConfiguration): ValidationResult;
}

export interface ValidationResult {
    readonly isValid: boolean;
    readonly errors: string[];
    readonly warnings: string[];
}

export interface IShaderManager {
    loadFromJSON(json: string): Promise<ICompiledShader>;
    loadFromFile(path: string): Promise<ICompiledShader>;
    loadFromConfiguration(configuration: IShaderConfiguration): Promise<ICompiledShader>;
    createMaterial(
        shaderName: string,
        properties?: Record<string, ShaderUniformValue>
    ): IMaterialInstance;
    getShader(name: string): ICompiledShader | null;
    getVariant(shader: ICompiledShader, keywords: string[]): Promise<IShaderVariant>;
    dispose(shader: ICompiledShader): void;
    disposeAll(): void;
}

export interface IShaderProfiler {
    readonly gpuTime: number;
    readonly cpuTime: number;
    readonly drawCalls: number;
    readonly uniformUpdates: number;
    readonly textureBinds: number;
    readonly shaderSwitches: number;

    beginFrame(): void;
    endFrame(): void;
    reset(): void;
}

export interface IShaderDebugger {
    captureFrame(): Promise<FrameCapture>;
    inspectShader(shader: ICompiledShader): ShaderInspection;
    validateUniforms(instance: IShaderInstance): ValidationResult;
}

export interface FrameCapture {
    readonly timestamp: number;
    readonly drawCalls: DrawCallInfo[];
    readonly shaderSwitches: ShaderSwitchInfo[];
    readonly uniformUpdates: UniformUpdateInfo[];
}

export interface DrawCallInfo {
    readonly shaderId: string;
    readonly primitiveCount: number;
    readonly vertexCount: number;
    readonly instanceCount: number;
    readonly gpuTime: number;
}

export interface ShaderSwitchInfo {
    readonly fromShader: string;
    readonly toShader: string;
    readonly timestamp: number;
    readonly cost: number;
}

export interface UniformUpdateInfo {
    readonly uniformName: string;
    readonly value: ShaderUniformValue;
    readonly timestamp: number;
    readonly frequency: number;
}

export interface ShaderInspection {
    readonly complexity: number;
    readonly instructionCount: number;
    readonly registerUsage: number;
    readonly textureReads: number;
    readonly branches: number;
    readonly loops: number;
    readonly hotspots: string[];
}
