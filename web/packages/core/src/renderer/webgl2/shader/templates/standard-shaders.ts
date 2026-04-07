import {
    IShaderConfiguration,
    ShaderDataType,
    ShaderQualifier,
    ShaderStage,
    BlendMode,
    CullMode,
    DepthFunc,
} from '../interfaces';

export const StandardUnlitShader: IShaderConfiguration = {
    name: 'Standard/Unlit',
    version: '1.0.0',
    description: 'Basic unlit shader with color and texture support',
    author: 'Axrone Engine Team',
    tags: ['unlit', 'basic', 'mobile-friendly'],
    category: 'Standard',

    attributes: [
        {
            name: 'a_Position',
            type: ShaderDataType.VEC3,
            qualifier: ShaderQualifier.ATTRIBUTE,
            binding: 0,
            semantic: 'POSITION',
        },
        {
            name: 'a_TexCoord',
            type: ShaderDataType.VEC2,
            qualifier: ShaderQualifier.ATTRIBUTE,
            binding: 1,
            semantic: 'TEXCOORD',
            defaultValue: null,
        },
    ],

    uniforms: [
        {
            name: 'u_MVPMatrix',
            type: ShaderDataType.MAT4,
            qualifier: ShaderQualifier.UNIFORM,
            semantic: 'u_MVPMatrix',
            category: 'frame',
            defaultValue: null,
        },
        {
            name: 'u_Color',
            type: ShaderDataType.VEC4,
            qualifier: ShaderQualifier.UNIFORM,
            category: 'material',
            defaultValue: [1.0, 1.0, 1.0, 1.0],
            precision: 'highp',
        },
        {
            name: 'u_MainTexture',
            type: ShaderDataType.SAMPLER_2D,
            qualifier: ShaderQualifier.UNIFORM,
            category: 'material',
            defaultValue: null,
        },
    ],

    textures: [
        {
            name: 'u_MainTexture',
            type: 'texture2D',
            slot: 0,
            defaultTexture: 'white',
            wrapS: 'repeat',
            wrapT: 'repeat',
            filterMin: 'linear',
            filterMag: 'linear',
        },
    ],

    varyings: [
        {
            name: 'v_TexCoord',
            type: ShaderDataType.VEC2,
            qualifier: ShaderQualifier.VARYING,
            interpolation: 'smooth',
        },
    ],

    passes: [
        {
            name: 'ForwardBase',
            stage: [ShaderStage.VERTEX, ShaderStage.FRAGMENT],
            vertexShader: `
void main() {
    gl_Position = u_MVPMatrix * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}`,
            fragmentShader: `
void main() {
    vec4 color = u_Color;

    #ifdef MAIN_TEXTURE
        color *= texture(u_MainTexture, v_TexCoord);
    #endif

    gl_FragColor = color;
}`,
            renderState: {
                depthTest: true,
                depthWrite: true,
                depthFunc: DepthFunc.LEQUAL,
                cullMode: CullMode.BACK,
                blendMode: BlendMode.OPAQUE,
            },
            keywords: ['MAIN_TEXTURE'],
        },
    ],

    keywords: ['MAIN_TEXTURE'],

    optimization: {
        level: 'basic',
        preservePrecision: true,
        removeUnusedVariables: true,
        inlineConstants: true,
    },
};
