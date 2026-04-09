import { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformValue } from './types';

const copyNumberArray = (source: ArrayLike<number>, target: Float32Array): Float32Array => {
    for (let index = 0; index < source.length; index += 1) {
        target[index] = source[index] ?? 0;
    }

    return target;
};

const transposeMatrixInto = (
    source: ArrayLike<number>,
    target: Float32Array,
    sourceOffset: number = 0,
    targetOffset: number = 0
): void => {
    if (source.length < sourceOffset + 16) {
        throw new RangeError(
            `Matrix values array must have at least ${sourceOffset + 16} elements`
        );
    }

    target[targetOffset] = source[sourceOffset] ?? 0;
    target[targetOffset + 1] = source[sourceOffset + 4] ?? 0;
    target[targetOffset + 2] = source[sourceOffset + 8] ?? 0;
    target[targetOffset + 3] = source[sourceOffset + 12] ?? 0;
    target[targetOffset + 4] = source[sourceOffset + 1] ?? 0;
    target[targetOffset + 5] = source[sourceOffset + 5] ?? 0;
    target[targetOffset + 6] = source[sourceOffset + 9] ?? 0;
    target[targetOffset + 7] = source[sourceOffset + 13] ?? 0;
    target[targetOffset + 8] = source[sourceOffset + 2] ?? 0;
    target[targetOffset + 9] = source[sourceOffset + 6] ?? 0;
    target[targetOffset + 10] = source[sourceOffset + 10] ?? 0;
    target[targetOffset + 11] = source[sourceOffset + 14] ?? 0;
    target[targetOffset + 12] = source[sourceOffset + 3] ?? 0;
    target[targetOffset + 13] = source[sourceOffset + 7] ?? 0;
    target[targetOffset + 14] = source[sourceOffset + 11] ?? 0;
    target[targetOffset + 15] = source[sourceOffset + 15] ?? 0;
};

export class SceneUniformWriter {
    private readonly _singleMatrixScratch = new Float32Array(16);
    private readonly _floatArrayScratchCache = new Map<number, Float32Array>();

    constructor(private readonly _gl: WebGL2RenderingContext) {}

    write(
        shader: SceneShaderResource,
        name: string,
        value: SceneUniformValue | null | undefined
    ): void {
        if (value === null || value === undefined) {
            return;
        }

        const location = shader.uniformLocations.get(name);
        if (!location) {
            return;
        }

        const uniformType = shader.uniformTypes.get(name);

        if (value instanceof Mat4) {
            this._gl.uniformMatrix4fv(location, false, this._toMatrixData(value.data));
            return;
        }

        if (value instanceof Quat) {
            this._gl.uniform4f(location, value.x, value.y, value.z, value.w);
            return;
        }

        if (value instanceof Vec4) {
            this._gl.uniform4f(location, value.x, value.y, value.z, value.w);
            return;
        }

        if (value instanceof Vec3) {
            this._gl.uniform3f(location, value.x, value.y, value.z);
            return;
        }

        if (value instanceof Vec2) {
            this._gl.uniform2f(location, value.x, value.y);
            return;
        }

        if (value instanceof Float32Array) {
            this._writeFloat32ArrayUniform(location, uniformType, value);
            return;
        }

        if (value instanceof Int32Array) {
            this._writeInt32ArrayUniform(location, uniformType, value);
            return;
        }

        if (value instanceof Uint32Array) {
            this._writeUint32ArrayUniform(location, uniformType, value);
            return;
        }

        if (Array.isArray(value)) {
            this._writeArrayUniform(location, uniformType, value);
            return;
        }

        if (typeof value === 'boolean') {
            this._gl.uniform1i(location, value ? 1 : 0);
            return;
        }

        if (typeof value === 'number') {
            this._writeNumericUniform(location, uniformType, value);
        }
    }

    private _getFloatArrayScratch(length: number): Float32Array {
        let scratch = this._floatArrayScratchCache.get(length);
        if (scratch) {
            return scratch;
        }

        scratch = new Float32Array(length);
        this._floatArrayScratchCache.set(length, scratch);
        return scratch;
    }

    private _toMatrixData(value: ArrayLike<number>): Float32Array {
        transposeMatrixInto(value, this._singleMatrixScratch);
        return this._singleMatrixScratch;
    }

    private _toMatrixArrayData(value: ArrayLike<number>): Float32Array {
        if (value.length < 16 || value.length % 16 !== 0) {
            throw new RangeError(
                `Matrix array length must be a positive multiple of 16, received ${value.length}`
            );
        }

        if (value.length === 16) {
            return this._toMatrixData(value);
        }

        const scratch = this._getFloatArrayScratch(value.length);
        for (let offset = 0; offset + 15 < value.length; offset += 16) {
            transposeMatrixInto(value, scratch, offset, offset);
        }

        return scratch;
    }

    private _toFloatArrayData(value: readonly number[]): Float32Array {
        return copyNumberArray(value, this._getFloatArrayScratch(value.length));
    }

    private _writeNumericUniform(
        location: WebGLUniformLocation,
        uniformType: number | undefined,
        value: number
    ): void {
        switch (uniformType) {
            case this._gl.BOOL:
            case this._gl.INT:
            case this._gl.SAMPLER_2D:
            case this._gl.SAMPLER_CUBE:
            case this._gl.SAMPLER_2D_SHADOW:
            case this._gl.SAMPLER_2D_ARRAY:
            case this._gl.SAMPLER_2D_ARRAY_SHADOW:
            case this._gl.SAMPLER_CUBE_SHADOW:
            case this._gl.INT_SAMPLER_2D:
            case this._gl.INT_SAMPLER_3D:
            case this._gl.INT_SAMPLER_CUBE:
            case this._gl.INT_SAMPLER_2D_ARRAY:
            case this._gl.UNSIGNED_INT_SAMPLER_2D:
            case this._gl.UNSIGNED_INT_SAMPLER_3D:
            case this._gl.UNSIGNED_INT_SAMPLER_CUBE:
            case this._gl.UNSIGNED_INT_SAMPLER_2D_ARRAY:
                this._gl.uniform1i(location, Math.trunc(value));
                return;
            case this._gl.UNSIGNED_INT:
                this._gl.uniform1ui(location, Math.max(0, Math.trunc(value)));
                return;
            case this._gl.FLOAT:
            default:
                this._gl.uniform1f(location, value);
                return;
        }
    }

    private _writeFloat32ArrayUniform(
        location: WebGLUniformLocation,
        uniformType: number | undefined,
        value: Float32Array
    ): void {
        switch (uniformType) {
            case this._gl.FLOAT:
                this._gl.uniform1fv(location, value);
                return;
            case this._gl.FLOAT_MAT4:
                this._gl.uniformMatrix4fv(location, false, this._toMatrixArrayData(value));
                return;
            case this._gl.FLOAT_VEC4:
                this._gl.uniform4fv(location, value);
                return;
            case this._gl.FLOAT_VEC3:
                this._gl.uniform3fv(location, value);
                return;
            case this._gl.FLOAT_VEC2:
                this._gl.uniform2fv(location, value);
                return;
        }

        switch (value.length) {
            case 16:
                this._gl.uniformMatrix4fv(location, false, this._toMatrixData(value));
                return;
            case 4:
                this._gl.uniform4fv(location, value);
                return;
            case 3:
                this._gl.uniform3fv(location, value);
                return;
            case 2:
                this._gl.uniform2fv(location, value);
                return;
            default:
                this._gl.uniform1fv(location, value);
                return;
        }
    }

    private _writeInt32ArrayUniform(
        location: WebGLUniformLocation,
        uniformType: number | undefined,
        value: Int32Array
    ): void {
        switch (uniformType) {
            case this._gl.INT:
            case this._gl.BOOL:
            case this._gl.SAMPLER_2D:
            case this._gl.SAMPLER_CUBE:
            case this._gl.SAMPLER_2D_SHADOW:
            case this._gl.SAMPLER_2D_ARRAY:
            case this._gl.SAMPLER_2D_ARRAY_SHADOW:
            case this._gl.SAMPLER_CUBE_SHADOW:
            case this._gl.INT_SAMPLER_2D:
            case this._gl.INT_SAMPLER_3D:
            case this._gl.INT_SAMPLER_CUBE:
            case this._gl.INT_SAMPLER_2D_ARRAY:
                this._gl.uniform1iv(location, value);
                return;
            case this._gl.INT_VEC4:
            case this._gl.BOOL_VEC4:
                this._gl.uniform4iv(location, value);
                return;
            case this._gl.INT_VEC3:
            case this._gl.BOOL_VEC3:
                this._gl.uniform3iv(location, value);
                return;
            case this._gl.INT_VEC2:
            case this._gl.BOOL_VEC2:
                this._gl.uniform2iv(location, value);
                return;
        }

        switch (value.length) {
            case 4:
                this._gl.uniform4iv(location, value);
                return;
            case 3:
                this._gl.uniform3iv(location, value);
                return;
            case 2:
                this._gl.uniform2iv(location, value);
                return;
            default:
                this._gl.uniform1iv(location, value);
                return;
        }
    }

    private _writeUint32ArrayUniform(
        location: WebGLUniformLocation,
        uniformType: number | undefined,
        value: Uint32Array
    ): void {
        switch (uniformType) {
            case this._gl.UNSIGNED_INT:
                this._gl.uniform1uiv(location, value);
                return;
            case this._gl.UNSIGNED_INT_VEC4:
                this._gl.uniform4uiv(location, value);
                return;
            case this._gl.UNSIGNED_INT_VEC3:
                this._gl.uniform3uiv(location, value);
                return;
            case this._gl.UNSIGNED_INT_VEC2:
                this._gl.uniform2uiv(location, value);
                return;
        }

        switch (value.length) {
            case 4:
                this._gl.uniform4uiv(location, value);
                return;
            case 3:
                this._gl.uniform3uiv(location, value);
                return;
            case 2:
                this._gl.uniform2uiv(location, value);
                return;
            default:
                this._gl.uniform1uiv(location, value);
                return;
        }
    }

    private _writeArrayUniform(
        location: WebGLUniformLocation,
        uniformType: number | undefined,
        value: readonly number[]
    ): void {
        if (uniformType === this._gl.FLOAT_MAT4 && value.length % 16 === 0) {
            this._gl.uniformMatrix4fv(location, false, this._toMatrixArrayData(value));
            return;
        }

        switch (value.length) {
            case 16:
                this._gl.uniformMatrix4fv(location, false, this._toMatrixData(value));
                return;
            case 4:
                this._gl.uniform4f(location, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
                return;
            case 3:
                this._gl.uniform3f(location, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
                return;
            case 2:
                this._gl.uniform2f(location, value[0] ?? 0, value[1] ?? 0);
                return;
            case 1:
                this._gl.uniform1f(location, value[0] ?? 0);
                return;
            default:
                this._gl.uniform1fv(location, this._toFloatArrayData(value));
                return;
        }
    }
}
