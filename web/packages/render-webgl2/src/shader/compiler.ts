import {
    IShaderConfiguration,
    ICompiledShader,
    IShaderVariant,
    IShaderCompiler,
    IShaderCompilerOptions,
    ValidationResult,
    ShaderDataType,
    ShaderStage,
    IVertexAttribute,
    IUniformVariable,
    IUniformBlock,
    ITextureProperty,
} from './interfaces';

import {
    generateVersionDirective,
    generatePrecisionDirective,
    generateDefines,
    generateIncludes,
    hashShaderSource,
    generateVariantKey,
    isValidShaderVariableName,
    isValidStageCombo,
    validateUniformNaming,
    calculateUniformBufferLayout,
    getShaderDataTypeSize,
    VERTEX_SEMANTICS,
    UNIFORM_SEMANTICS,
    SHADER_KEYWORDS,
} from './utils';

import { ByteBuffer } from '@axrone/utility';

class ShaderSourceGenerator {
    private readonly includeCache = new Map<string, string>();

    generateShaderSource(
        config: IShaderConfiguration,
        stage: ShaderStage,
        keywords: string[] = [],
        defines: Record<string, any> = {}
    ): string {
        const source: string[] = [];

        source.push(generateVersionDirective('300 es'));

        if (stage === ShaderStage.FRAGMENT) {
            source.push(generatePrecisionDirective('highp'));
        }

        const allDefines = { ...config.defines, ...defines };
        source.push(generateDefines(allDefines));

        keywords.forEach((keyword) => {
            source.push(`#define ${keyword}\n`);
        });

        if (config.includes) {
            source.push(generateIncludes(config.includes));
        }

        source.push(this.generateVariableDeclarations(config, stage));

        const stageSource = this.getStageSource(config, stage);
        if (stageSource) {
            source.push('\n// Stage-specific code\n');
            source.push(stageSource);
        }

        return source.join('');
    }

    private generateVariableDeclarations(config: IShaderConfiguration, stage: ShaderStage): string {
        const declarations: string[] = [];

        if (stage === ShaderStage.VERTEX) {
            config.attributes.forEach((attr) => {
                const precision = attr.precision ? `${attr.precision} ` : '';
                declarations.push(
                    `layout(location = ${attr.binding}) in ${precision}${attr.type} ${attr.name};\n`
                );
            });
        }

        config.uniforms.forEach((uniform) => {
            const precision = uniform.precision ? `${uniform.precision} ` : '';
            const arraySpec = uniform.arraySize ? `[${uniform.arraySize}]` : '';
            declarations.push(`uniform ${precision}${uniform.type} ${uniform.name}${arraySpec};\n`);
        });

        if (config.uniformBlocks) {
            config.uniformBlocks.forEach((block) => {
                declarations.push(this.generateUniformBlock(block));
            });
        }

        config.textures.forEach((texture) => {
            declarations.push(`uniform ${texture.type} ${texture.name};\n`);
        });

        if (config.varyings) {
            config.varyings.forEach((varying) => {
                const precision = varying.precision ? `${varying.precision} ` : '';
                const interpolation = varying.interpolation ? `${varying.interpolation} ` : '';

                if (stage === ShaderStage.VERTEX) {
                    declarations.push(
                        `${interpolation}out ${precision}${varying.type} ${varying.name};\n`
                    );
                } else if (stage === ShaderStage.FRAGMENT) {
                    declarations.push(
                        `${interpolation}in ${precision}${varying.type} ${varying.name};\n`
                    );
                }
            });
        }

        return declarations.join('');
    }

    private generateUniformBlock(block: IUniformBlock): string {
        const layout = `layout(std140, binding = ${block.binding})`;
        const variables = block.variables
            .map((variable) => {
                const precision = variable.precision ? `${variable.precision} ` : '';
                const arraySpec = variable.arraySize ? `[${variable.arraySize}]` : '';
                return `    ${precision}${variable.type} ${variable.name}${arraySpec};`;
            })
            .join('\n');

        return `${layout} uniform ${block.name} {\n${variables}\n};\n`;
    }

    private getStageSource(config: IShaderConfiguration, stage: ShaderStage): string {
        const pass = config.passes[0];

        switch (stage) {
            case ShaderStage.VERTEX:
                return pass.vertexShader;
            case ShaderStage.FRAGMENT:
                return pass.fragmentShader || '';
            case ShaderStage.GEOMETRY:
                return pass.geometryShader || '';
            case ShaderStage.TESSELLATION_CONTROL:
                return pass.tessellationControlShader || '';
            case ShaderStage.TESSELLATION_EVALUATION:
                return pass.tessellationEvaluationShader || '';
            case ShaderStage.COMPUTE:
                return pass.computeShader || '';
            default:
                return '';
        }
    }
}

export class WebGLShaderCompiler implements IShaderCompiler {
    private readonly gl: WebGL2RenderingContext;
    private readonly sourceGenerator: ShaderSourceGenerator;
    private readonly compilationCache = new Map<string, ICompiledShader>();
    private readonly variantCache = new Map<string, IShaderVariant>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.sourceGenerator = new ShaderSourceGenerator();
    }

    async compile(
        configuration: IShaderConfiguration,
        options: IShaderCompilerOptions = {}
    ): Promise<ICompiledShader> {
        const startTime = performance.now();

        const validation = this.validateConfiguration(configuration);
        if (!validation.isValid) {
            throw new Error(`Shader validation failed: ${validation.errors.join(', ')}`);
        }

        const cacheKey = this.generateConfigurationKey(configuration);

        if (this.compilationCache.has(cacheKey)) {
            return this.compilationCache.get(cacheKey)!;
        }

        const program = await this.compileShaderProgram(configuration, [], {});

        const reflection = this.extractReflectionData(program, configuration);

        const compiledShader: ICompiledShader = {
            id: cacheKey,
            name: configuration.name,
            configuration,
            program,
            uniformLocations: reflection.uniformLocations,
            attributeLocations: reflection.attributeLocations,
            uniformBlocks: reflection.uniformBlocks,
            textureSlots: reflection.textureSlots,
            renderState: configuration.passes[0].renderState,
            bytecodeSize: this.calculateBytecodeSize(program),
            compilationTime: performance.now() - startTime,
        };

        this.compilationCache.set(cacheKey, compiledShader);

        return compiledShader;
    }

    async compileVariant(
        shader: ICompiledShader,
        keywords: string[],
        defines: Record<string, any>
    ): Promise<IShaderVariant> {
        const variantKey = generateVariantKey(shader.name, keywords, defines);

        if (this.variantCache.has(variantKey)) {
            return this.variantCache.get(variantKey)!;
        }

        const program = await this.compileShaderProgram(shader.configuration, keywords, defines);

        const reflection = this.extractReflectionData(program, shader.configuration);

        const variantShader: ICompiledShader = {
            ...shader,
            id: variantKey,
            program,
            uniformLocations: reflection.uniformLocations,
            attributeLocations: reflection.attributeLocations,
            uniformBlocks: reflection.uniformBlocks,
            textureSlots: reflection.textureSlots,
        };

        const variant: IShaderVariant = {
            keywords: Object.freeze([...keywords]),
            defines: Object.freeze({ ...defines }),
            hash: variantKey,
            shader: variantShader,
        };

        this.variantCache.set(variantKey, variant);

        return variant;
    }

    validateConfiguration(configuration: IShaderConfiguration): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!configuration.name || typeof configuration.name !== 'string') {
            errors.push('Shader name is required and must be a string');
        }

        if (!configuration.passes || configuration.passes.length === 0) {
            errors.push('Shader must have at least one pass');
        }

        configuration.passes.forEach((pass, index) => {
            if (!isValidStageCombo(pass.stage)) {
                errors.push(`Pass ${index}: Invalid shader stage combination`);
            }

            if (!pass.vertexShader && pass.stage.includes(ShaderStage.VERTEX)) {
                errors.push(`Pass ${index}: Vertex shader source is required`);
            }

            if (!pass.fragmentShader && pass.stage.includes(ShaderStage.FRAGMENT)) {
                errors.push(`Pass ${index}: Fragment shader source is required`);
            }
        });

        const attributeBindings = new Set<number>();
        configuration.attributes.forEach((attr, index) => {
            if (!isValidShaderVariableName(attr.name)) {
                errors.push(`Attribute ${index}: Invalid variable name "${attr.name}"`);
            }

            if (attributeBindings.has(attr.binding)) {
                errors.push(`Attribute ${index}: Binding ${attr.binding} is already used`);
            }
            attributeBindings.add(attr.binding);
        });

        const uniformNames = new Set<string>();
        configuration.uniforms.forEach((uniform, index) => {
            const validation = validateUniformNaming(uniform.name);
            if (!validation.valid) {
                errors.push(`Uniform ${index}: ${validation.warnings.join(', ')}`);
            }
            warnings.push(...validation.warnings);

            if (uniformNames.has(uniform.name)) {
                errors.push(`Uniform ${index}: Name "${uniform.name}" is already used`);
            }
            uniformNames.add(uniform.name);
        });

        const textureSlots = new Set<number>();
        configuration.textures.forEach((texture, index) => {
            if (!isValidShaderVariableName(texture.name)) {
                errors.push(`Texture ${index}: Invalid variable name "${texture.name}"`);
            }

            if (textureSlots.has(texture.slot)) {
                errors.push(`Texture ${index}: Slot ${texture.slot} is already used`);
            }
            textureSlots.add(texture.slot);
        });

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    private async compileShaderProgram(
        configuration: IShaderConfiguration,
        keywords: string[],
        defines: Record<string, any>
    ): Promise<WebGLProgram> {
        const pass = configuration.passes[0];
        const program = this.gl.createProgram();

        if (!program) {
            throw new Error('Failed to create WebGL program');
        }

        try {
            if (pass.stage.includes(ShaderStage.VERTEX)) {
                const vertexSource = this.sourceGenerator.generateShaderSource(
                    configuration,
                    ShaderStage.VERTEX,
                    keywords,
                    defines
                );
                const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexSource);
                this.gl.attachShader(program, vertexShader);
            }

            if (pass.stage.includes(ShaderStage.FRAGMENT)) {
                const fragmentSource = this.sourceGenerator.generateShaderSource(
                    configuration,
                    ShaderStage.FRAGMENT,
                    keywords,
                    defines
                );
                const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSource);
                this.gl.attachShader(program, fragmentShader);
            }

            this.gl.linkProgram(program);

            if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
                const info = this.gl.getProgramInfoLog(program);
                throw new Error(`Shader program linking failed: ${info}`);
            }

            return program;
        } catch (error) {
            this.gl.deleteProgram(program);
            throw error;
        }
    }

    private compileShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) {
            throw new Error('Failed to create WebGL shader');
        }

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(`Shader compilation failed: ${info}`);
        }

        return shader;
    }

    private extractReflectionData(program: WebGLProgram, configuration: IShaderConfiguration) {
        const uniformLocations = new Map<string, WebGLUniformLocation>();
        const attributeLocations = new Map<string, number>();
        const uniformBlocks = new Map<string, IUniformBlock>();
        const textureSlots = new Map<string, number>();

        configuration.uniforms.forEach((uniform) => {
            const location = this.gl.getUniformLocation(program, uniform.name);
            if (location) {
                uniformLocations.set(uniform.name, location);
            }
        });

        configuration.attributes.forEach((attribute) => {
            const location = this.gl.getAttribLocation(program, attribute.name);
            if (location !== -1) {
                attributeLocations.set(attribute.name, location);
            }
        });

        if (configuration.uniformBlocks) {
            configuration.uniformBlocks.forEach((block) => {
                const index = this.gl.getUniformBlockIndex(program, block.name);
                if (index !== this.gl.INVALID_INDEX) {
                    const layout = calculateUniformBufferLayout(
                        block.variables.map((v) => ({
                            name: v.name,
                            type: v.type,
                            arraySize: v.arraySize,
                        }))
                    );

                    const buffer = ByteBuffer.alloc(layout.totalSize);

                    uniformBlocks.set(block.name, {
                        ...block,
                        size: layout.totalSize,
                        buffer,
                    });
                }
            });
        }

        configuration.textures.forEach((texture) => {
            textureSlots.set(texture.name, texture.slot);
        });

        return {
            uniformLocations,
            attributeLocations,
            uniformBlocks,
            textureSlots,
        };
    }

    private calculateBytecodeSize(program: WebGLProgram): number {
        const attachedShaders = this.gl.getAttachedShaders(program) || [];
        return attachedShaders.reduce((size: number, shader: WebGLShader) => {
            const source = this.gl.getShaderSource(shader) || '';
            return size + source.length;
        }, 0);
    }

    private generateConfigurationKey(configuration: IShaderConfiguration): string {
        const configString = JSON.stringify({
            name: configuration.name,
            version: configuration.version,
            passes: configuration.passes.map((pass) => ({
                stage: pass.stage,
                vertexShader: hashShaderSource(pass.vertexShader),
                fragmentShader: pass.fragmentShader ? hashShaderSource(pass.fragmentShader) : null,
                renderState: pass.renderState,
            })),
            attributes: configuration.attributes,
            uniforms: configuration.uniforms,
            textures: configuration.textures,
        });

        return hashShaderSource(configString);
    }

    clearCache(): void {
        for (const shader of this.compilationCache.values()) {
            this.gl.deleteProgram(shader.program);
        }

        for (const variant of this.variantCache.values()) {
            this.gl.deleteProgram(variant.shader.program);
        }

        this.compilationCache.clear();
        this.variantCache.clear();
    }

    getCacheStats() {
        return {
            compiledShaders: this.compilationCache.size,
            variants: this.variantCache.size,
            memoryUsage: this.calculateCacheMemoryUsage(),
        };
    }

    private calculateCacheMemoryUsage(): number {
        let totalSize = 0;

        for (const shader of this.compilationCache.values()) {
            totalSize += shader.bytecodeSize;
        }

        for (const variant of this.variantCache.values()) {
            totalSize += variant.shader.bytecodeSize;
        }

        return totalSize;
    }
}
