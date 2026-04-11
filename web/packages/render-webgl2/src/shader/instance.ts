import {
    IShaderInstance,
    ICompiledShader,
    IShaderVariant,
    ShaderUniformValue,
    IUniformBlock,
    ShaderDataType,
} from './interfaces';

import { getWebGLType, getShaderDataTypeComponentCount } from './utils';
import { ByteBuffer } from '@axrone/utility';
import { Mat4, Vec2, Vec3, Vec4 } from '@axrone/numeric';

class UniformUploader {
    private readonly gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    uploadUniform(
        location: WebGLUniformLocation,
        type: ShaderDataType,
        value: ShaderUniformValue
    ): void {
        if (value === null || value === undefined) {
            return;
        }

        switch (type) {
            case ShaderDataType.FLOAT:
                this.gl.uniform1f(location, value as number);
                break;

            case ShaderDataType.VEC2:
                if (value instanceof Vec2) {
                    this.gl.uniform2f(location, value.x, value.y);
                } else if (value instanceof Float32Array) {
                    this.gl.uniform2fv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform2f(location, value[0], value[1]);
                }
                break;

            case ShaderDataType.VEC3:
                if (value instanceof Vec3) {
                    this.gl.uniform3f(location, value.x, value.y, value.z);
                } else if (value instanceof Float32Array) {
                    this.gl.uniform3fv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform3f(location, value[0], value[1], value[2]);
                }
                break;

            case ShaderDataType.VEC4:
                if (value instanceof Vec4) {
                    this.gl.uniform4f(location, value.x, value.y, value.z, value.w);
                } else if (value instanceof Float32Array) {
                    this.gl.uniform4fv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
                }
                break;

            case ShaderDataType.MAT4:
                if (value instanceof Mat4) {
                    this.gl.uniformMatrix4fv(location, false, value.data);
                } else if (value instanceof Float32Array) {
                    this.gl.uniformMatrix4fv(location, false, value);
                }
                break;

            case ShaderDataType.INT:
            case ShaderDataType.BOOL:
                this.gl.uniform1i(location, value as number);
                break;

            case ShaderDataType.IVEC2:
                if (value instanceof Int32Array) {
                    this.gl.uniform2iv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform2i(location, value[0], value[1]);
                }
                break;

            case ShaderDataType.IVEC3:
                if (value instanceof Int32Array) {
                    this.gl.uniform3iv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform3i(location, value[0], value[1], value[2]);
                }
                break;

            case ShaderDataType.IVEC4:
                if (value instanceof Int32Array) {
                    this.gl.uniform4iv(location, value);
                } else if (Array.isArray(value)) {
                    this.gl.uniform4i(location, value[0], value[1], value[2], value[3]);
                }
                break;

            case ShaderDataType.SAMPLER_2D:
            case ShaderDataType.SAMPLER_CUBE:
            case ShaderDataType.SAMPLER_2D_ARRAY:
                this.gl.uniform1i(location, value as number);
                break;

            default:
                console.warn(`Unsupported uniform type: ${type}`);
        }
    }
}

export class ShaderInstance implements IShaderInstance {
    public readonly shader: ICompiledShader;
    public readonly variant: IShaderVariant;
    public readonly uniforms = new Map<string, ShaderUniformValue>();
    public readonly textures = new Map<string, WebGLTexture>();
    public readonly uniformBuffers = new Map<string, ByteBuffer>();

    private readonly gl: WebGL2RenderingContext;
    private readonly uniformUploader: UniformUploader;
    private readonly boundTextureUnits = new Set<number>();
    private readonly dirtyUniforms = new Set<string>();
    private readonly dirtyBuffers = new Set<string>();

    private lastProgramBind = 0;
    private uniformUpdateCount = 0;

    constructor(shader: ICompiledShader, variant: IShaderVariant) {
        this.shader = shader;
        this.variant = variant;
        this.gl = this.getWebGLContext(shader.program);
        this.uniformUploader = new UniformUploader(this.gl);

        this.initializeDefaultValues();
    }

    setUniform(name: string, value: ShaderUniformValue): void {
        if (!this.shader.uniformLocations.has(name)) {
            console.warn(`Uniform "${name}" not found in shader "${this.shader.name}"`);
            return;
        }

        const currentValue = this.uniforms.get(name);
        if (currentValue !== undefined && this.isUniformValueEqual(currentValue, value)) {
            return;
        }

        this.uniforms.set(name, value);
        this.dirtyUniforms.add(name);
    }

    setTexture(name: string, texture: WebGLTexture): void {
        if (!this.shader.textureSlots.has(name)) {
            console.warn(`Texture "${name}" not found in shader "${this.shader.name}"`);
            return;
        }

        this.textures.set(name, texture);
    }

    setUniformBuffer(name: string, buffer: ByteBuffer): void {
        if (!this.shader.uniformBlocks.has(name)) {
            console.warn(`Uniform buffer "${name}" not found in shader "${this.shader.name}"`);
            return;
        }

        this.uniformBuffers.set(name, buffer);
        this.dirtyBuffers.add(name);
    }

    bind(gl: WebGL2RenderingContext): void {
        if (this.lastProgramBind !== this.variant.shader.program) {
            gl.useProgram(this.variant.shader.program);
            this.lastProgramBind = this.variant.shader.program as any;
        }

        this.updateUniforms();

        this.bindTextures();

        this.updateUniformBuffers();

        this.applyRenderState(gl);
    }

    unbind(gl: WebGL2RenderingContext): void {
        for (const unit of this.boundTextureUnits) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        this.boundTextureUnits.clear();
    }

    getUniform(name: string): ShaderUniformValue {
        return this.uniforms.get(name) || null;
    }

    hasUniform(name: string): boolean {
        return this.shader.uniformLocations.has(name);
    }

    getUniformNames(): string[] {
        return Array.from(this.shader.uniformLocations.keys());
    }

    getRenderState() {
        return this.shader.renderState;
    }

    getStats() {
        return {
            uniformUpdateCount: this.uniformUpdateCount,
            dirtyUniforms: this.dirtyUniforms.size,
            dirtyBuffers: this.dirtyBuffers.size,
            boundTextures: this.textures.size,
        };
    }

    private initializeDefaultValues(): void {
        for (const uniform of this.shader.configuration.uniforms) {
            if (uniform.defaultValue !== undefined) {
                this.uniforms.set(uniform.name, uniform.defaultValue);
            }
        }

        for (const [name, block] of this.shader.uniformBlocks) {
            if (block.buffer) {
                this.uniformBuffers.set(name, block.buffer);
            }
        }
    }

    private updateUniforms(): void {
        if (this.dirtyUniforms.size === 0) {
            return;
        }

        for (const uniformName of this.dirtyUniforms) {
            const location = this.shader.uniformLocations.get(uniformName);
            const value = this.uniforms.get(uniformName);

            if (location && value !== undefined) {
                const uniformConfig = this.shader.configuration.uniforms.find(
                    (u) => u.name === uniformName
                );
                if (uniformConfig) {
                    this.uniformUploader.uploadUniform(location, uniformConfig.type, value);
                    this.uniformUpdateCount++;
                }
            }
        }

        this.dirtyUniforms.clear();
    }

    private bindTextures(): void {
        for (const [textureName, texture] of this.textures) {
            const slot = this.shader.textureSlots.get(textureName);
            const location = this.shader.uniformLocations.get(textureName);

            if (slot !== undefined && location) {
                this.gl.activeTexture(this.gl.TEXTURE0 + slot);
                this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
                this.gl.uniform1i(location, slot);
                this.boundTextureUnits.add(slot);
            }
        }
    }

    private updateUniformBuffers(): void {
        if (this.dirtyBuffers.size === 0) {
            return;
        }

        for (const bufferName of this.dirtyBuffers) {
            const block = this.shader.uniformBlocks.get(bufferName);
            const buffer = this.uniformBuffers.get(bufferName);

            if (block && buffer) {
                let glBuffer = this.gl.createBuffer();
                if (glBuffer) {
                    this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, glBuffer);

                    const bufferData = buffer as any;
                    this.gl.bufferData(
                        this.gl.UNIFORM_BUFFER,
                        bufferData.buffer || bufferData,
                        this.gl.DYNAMIC_DRAW
                    );
                    this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, block.binding, glBuffer);
                }
            }
        }

        this.dirtyBuffers.clear();
    }

    private applyRenderState(gl: WebGL2RenderingContext): void {
        const state = this.shader.renderState;

        if (state.depthTest !== undefined) {
            if (state.depthTest) {
                gl.enable(gl.DEPTH_TEST);
                if (state.depthFunc) {
                    gl.depthFunc(this.getDepthFunc(gl, state.depthFunc));
                }
            } else {
                gl.disable(gl.DEPTH_TEST);
            }
        }

        if (state.depthWrite !== undefined) {
            gl.depthMask(state.depthWrite);
        }

        if (state.cullMode !== undefined) {
            if (state.cullMode === 'off') {
                gl.disable(gl.CULL_FACE);
            } else {
                gl.enable(gl.CULL_FACE);
                gl.cullFace(state.cullMode === 'front' ? gl.FRONT : gl.BACK);
            }
        }

        if (state.blendMode !== undefined) {
            if (state.blendMode === 'opaque') {
                gl.disable(gl.BLEND);
            } else {
                gl.enable(gl.BLEND);
                this.setBlendMode(gl, state.blendMode);
            }
        }

        if (state.colorWrite) {
            gl.colorMask(
                state.colorWrite[0],
                state.colorWrite[1],
                state.colorWrite[2],
                state.colorWrite[3]
            );
        }
    }

    private getDepthFunc(gl: WebGL2RenderingContext, func: string): number {
        switch (func) {
            case 'never':
                return gl.NEVER;
            case 'less':
                return gl.LESS;
            case 'equal':
                return gl.EQUAL;
            case 'lequal':
                return gl.LEQUAL;
            case 'greater':
                return gl.GREATER;
            case 'notequal':
                return gl.NOTEQUAL;
            case 'gequal':
                return gl.GEQUAL;
            case 'always':
                return gl.ALWAYS;
            default:
                return gl.LESS;
        }
    }

    private setBlendMode(gl: WebGL2RenderingContext, mode: string): void {
        switch (mode) {
            case 'alpha_blend':
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                break;
            case 'additive':
                gl.blendFunc(gl.ONE, gl.ONE);
                break;
            case 'multiply':
                gl.blendFunc(gl.DST_COLOR, gl.ZERO);
                break;
            case 'screen':
                gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
                break;
            default:
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
    }

    private isUniformValueEqual(a: ShaderUniformValue, b: ShaderUniformValue): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a !== typeof b) return false;

        if (a instanceof Float32Array && b instanceof Float32Array) {
            return this.areArraysEqual(a, b);
        }
        if (a instanceof Int32Array && b instanceof Int32Array) {
            return this.areArraysEqual(a, b);
        }
        if (a instanceof Vec2 && b instanceof Vec2) {
            return a.equals(b);
        }
        if (a instanceof Vec3 && b instanceof Vec3) {
            return a.equals(b);
        }
        if (a instanceof Vec4 && b instanceof Vec4) {
            return a.equals(b);
        }
        if (a instanceof Mat4 && b instanceof Mat4) {
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

    private getWebGLContext(program: WebGLProgram): WebGL2RenderingContext {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        return gl;
    }
}
