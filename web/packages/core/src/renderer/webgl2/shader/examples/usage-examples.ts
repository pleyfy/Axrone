import { 
    ShaderManager, 
    WebGLShaderCompiler,
    MaterialInstance,
    IShaderConfiguration,
    ShaderDataType,
    ShaderQualifier,
    ShaderStage,
    BlendMode,
    CullMode,
    DepthFunc
} from '../index';

import { StandardUnlitShader } from '../templates/standard-shaders';

async function basicShaderUsage() {

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL2 not supported');
    }

    const shaderManager = new ShaderManager(gl);

    const shader = await shaderManager.loadFromConfiguration(StandardUnlitShader);

    const material = shaderManager.createMaterial('Standard/Unlit', {
        u_Color: [1.0, 0.5, 0.0, 1.0], 
    });

    material.enableKeyword('MAIN_TEXTURE');

    console.log('Material created successfully!');
    return { shader, material, shaderManager };
}

const CustomEffectShader: IShaderConfiguration = {
    name: "Custom/Effect",
    version: "1.0.0",
    description: "Custom effect shader with time-based animation",
    author: "Your Name",
    tags: ["custom", "effect", "animated"],
    category: "Effects",

    attributes: [
        {
            name: "a_Position",
            type: ShaderDataType.VEC3,
            qualifier: ShaderQualifier.ATTRIBUTE,
            binding: 0,
            semantic: "POSITION"
        },
        {
            name: "a_TexCoord",
            type: ShaderDataType.VEC2,
            qualifier: ShaderQualifier.ATTRIBUTE,
            binding: 1,
            semantic: "TEXCOORD"
        }
    ],

    uniforms: [
        {
            name: "u_MVPMatrix",
            type: ShaderDataType.MAT4,
            qualifier: ShaderQualifier.UNIFORM,
            category: "frame"
        },
        {
            name: "u_Time",
            type: ShaderDataType.FLOAT,
            qualifier: ShaderQualifier.UNIFORM,
            category: "frame",
            defaultValue: 0.0
        },
        {
            name: "u_Color",
            type: ShaderDataType.VEC4,
            qualifier: ShaderQualifier.UNIFORM,
            category: "material",
            defaultValue: [1.0, 1.0, 1.0, 1.0]
        },
        {
            name: "u_WaveAmplitude",
            type: ShaderDataType.FLOAT,
            qualifier: ShaderQualifier.UNIFORM,
            category: "material",
            defaultValue: 0.1
        },
        {
            name: "u_WaveFrequency",
            type: ShaderDataType.FLOAT,
            qualifier: ShaderQualifier.UNIFORM,
            category: "material",
            defaultValue: 2.0
        }
    ],

    textures: [
        {
            name: "u_MainTexture",
            type: "texture2D",
            slot: 0,
            defaultTexture: "white"
        }
    ],

    varyings: [
        {
            name: "v_TexCoord",
            type: ShaderDataType.VEC2,
            qualifier: ShaderQualifier.VARYING
        }
    ],

    passes: [
        {
            name: "WaveEffect",
            stage: [ShaderStage.VERTEX, ShaderStage.FRAGMENT],
            vertexShader: `
void main() {
    vec3 pos = a_Position;

    #ifdef WAVE_EFFECT

        float wave = sin(pos.x * u_WaveFrequency + u_Time) * u_WaveAmplitude;
        pos.y += wave;
    #endif

    gl_Position = u_MVPMatrix * vec4(pos, 1.0);
    v_TexCoord = a_TexCoord;
}`,
            fragmentShader: `
void main() {
    vec4 color = u_Color;

    #ifdef MAIN_TEXTURE
        color *= texture(u_MainTexture, v_TexCoord);
    #endif

    #ifdef ANIMATED_COLOR

        color.rgb *= (sin(u_Time) * 0.5 + 0.5);
    #endif

    gl_FragColor = color;
}`,
            renderState: {
                depthTest: true,
                depthWrite: true,
                depthFunc: DepthFunc.LEQUAL,
                cullMode: CullMode.BACK,
                blendMode: BlendMode.OPAQUE
            }
        }
    ],

    keywords: ["WAVE_EFFECT", "MAIN_TEXTURE", "ANIMATED_COLOR"],

    optimization: {
        level: "basic",
        preservePrecision: true,
        removeUnusedVariables: true,
        inlineConstants: true
    }
};

async function advancedShaderUsage() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL2 not supported');
    }

    const shaderManager = new ShaderManager(gl);

    const customShader = await shaderManager.loadFromConfiguration(CustomEffectShader);

    const material = shaderManager.createMaterial('Custom/Effect', {
        u_Color: [0.2, 0.8, 1.0, 1.0], 
        u_WaveAmplitude: 0.05,
        u_WaveFrequency: 4.0
    });

    material.enableKeyword('WAVE_EFFECT');
    material.enableKeyword('ANIMATED_COLOR');

    function animate(time: number) {

        material.setProperty('u_Time', time * 0.001);

        const amplitude = Math.sin(time * 0.002) * 0.1 + 0.05;
        material.setProperty('u_WaveAmplitude', amplitude);

        material.apply();

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    return { customShader, material, shaderManager };
}

const shaderConfigJSON = `{
    "name": "UI/Text",
    "version": "1.0.0",
    "description": "Text rendering shader with SDF support",
    "author": "Axrone Engine Team",
    "tags": ["ui", "text", "sdf"],
    "category": "UI",

    "attributes": [
        {
            "name": "a_Position",
            "type": "vec3",
            "qualifier": "attribute",
            "binding": 0,
            "semantic": "POSITION"
        },
        {
            "name": "a_TexCoord",
            "type": "vec2",
            "qualifier": "attribute",
            "binding": 1,
            "semantic": "TEXCOORD"
        },
        {
            "name": "a_Color",
            "type": "vec4",
            "qualifier": "attribute",
            "binding": 2,
            "semantic": "COLOR"
        }
    ],

    "uniforms": [
        {
            "name": "u_MVPMatrix",
            "type": "mat4",
            "qualifier": "uniform",
            "category": "frame"
        },
        {
            "name": "u_TextColor",
            "type": "vec4",
            "qualifier": "uniform",
            "category": "material",
            "defaultValue": [1.0, 1.0, 1.0, 1.0]
        },
        {
            "name": "u_Smoothing",
            "type": "float",
            "qualifier": "uniform",
            "category": "material",
            "defaultValue": 0.1
        }
    ],

    "textures": [
        {
            "name": "u_FontTexture",
            "type": "texture2D",
            "slot": 0,
            "filterMin": "linear",
            "filterMag": "linear"
        }
    ],

    "varyings": [
        {
            "name": "v_TexCoord",
            "type": "vec2",
            "qualifier": "varying"
        },
        {
            "name": "v_Color",
            "type": "vec4",
            "qualifier": "varying"
        }
    ],

    "passes": [
        {
            "name": "TextRendering",
            "stage": ["vertex", "fragment"],
            "vertexShader": "void main() { gl_Position = u_MVPMatrix * vec4(a_Position, 1.0); v_TexCoord = a_TexCoord; v_Color = a_Color; }",
            "fragmentShader": "void main() { float sdf = texture(u_FontTexture, v_TexCoord).r; float alpha = smoothstep(0.5 - u_Smoothing, 0.5 + u_Smoothing, sdf); gl_FragColor = vec4(u_TextColor.rgb * v_Color.rgb, alpha * u_TextColor.a * v_Color.a); }",
            "renderState": {
                "depthTest": false,
                "depthWrite": false,
                "blendMode": "alpha_blend"
            }
        }
    ],

    "keywords": ["SDF_TEXT", "OUTLINE", "SHADOW"],

    "optimization": {
        "level": "basic",
        "preservePrecision": true,
        "removeUnusedVariables": true,
        "inlineConstants": false
    }
}`;

async function loadShaderFromJSON() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL2 not supported');
    }

    const shaderManager = new ShaderManager(gl);

    const textShader = await shaderManager.loadFromJSON(shaderConfigJSON);

    const textMaterial = shaderManager.createMaterial('UI/Text', {
        u_TextColor: [1.0, 1.0, 1.0, 1.0],
        u_Smoothing: 0.05
    });

    textMaterial.enableKeyword('SDF_TEXT');

    console.log('Text shader loaded successfully!');
    return { textShader, textMaterial, shaderManager };
}

function monitorShaderPerformance(shaderManager: ShaderManager) {

    const cacheInfo = shaderManager.getCacheInfo();

    console.log('Shader Cache Statistics:');
    console.log(`- Total Shaders: ${cacheInfo.totalShaders}`);
    console.log(`- Total Variants: ${cacheInfo.totalVariants}`);
    console.log(`- Cache Hit Rate: ${(cacheInfo.hitRate * 100).toFixed(2)}%`);
    console.log(`- Memory Usage: ${(cacheInfo.totalMemory / 1024).toFixed(2)} KB`);
    console.log(`- Average Compilation Time: ${cacheInfo.averageCompilationTime.toFixed(2)} ms`);

    console.log('\nMost Accessed Shaders:');
    cacheInfo.shaders.slice(0, 5).forEach((shader, index) => {
        console.log(`${index + 1}. ${shader.name} (${shader.accessCount} accesses, ${shader.variants} variants)`);
    });
}

export {
    basicShaderUsage,
    advancedShaderUsage,
    loadShaderFromJSON,
    monitorShaderPerformance,
    CustomEffectShader
};
