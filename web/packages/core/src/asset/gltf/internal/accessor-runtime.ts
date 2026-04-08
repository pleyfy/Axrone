import { GltfAccessorError } from '../errors';
import type { GltfAccessorJson, GltfBufferViewJson } from '../types';
import { GltfResourceRuntime } from './source-runtime';

export interface DecodedAccessor {
    readonly count: number;
    readonly componentCount: number;
    readonly values: Float32Array;
    readonly min?: readonly number[];
    readonly max?: readonly number[];
}

const componentTypeByteSize = (
    componentType: GltfAccessorJson['componentType']
): 1 | 2 | 4 => {
    switch (componentType) {
        case 5120:
        case 5121:
            return 1;
        case 5122:
        case 5123:
            return 2;
        case 5125:
        case 5126:
            return 4;
    }
};

const accessorComponentCount = (type: GltfAccessorJson['type']): number => {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
        case 'MAT2':
            return 4;
        case 'MAT3':
            return 9;
        case 'MAT4':
            return 16;
    }
};

const resolveBufferViewStride = (bufferView: GltfBufferViewJson): number | undefined =>
    bufferView.byteStride ?? bufferView.extensions?.EXT_meshopt_compression?.byteStride;

const readComponent = (
    view: DataView,
    offset: number,
    componentType: GltfAccessorJson['componentType']
): number => {
    switch (componentType) {
        case 5120:
            return view.getInt8(offset);
        case 5121:
            return view.getUint8(offset);
        case 5122:
            return view.getInt16(offset, true);
        case 5123:
            return view.getUint16(offset, true);
        case 5125:
            return view.getUint32(offset, true);
        case 5126:
            return view.getFloat32(offset, true);
    }
};

const normalizeComponent = (
    value: number,
    componentType: GltfAccessorJson['componentType']
): number => {
    switch (componentType) {
        case 5120:
            return Math.max(value / 127, -1);
        case 5121:
            return value / 255;
        case 5122:
            return Math.max(value / 32767, -1);
        case 5123:
            return value / 65535;
        case 5125:
            return value / 4294967295;
        default:
            return value;
    }
};

const decodeIndicesBuffer = (
    data: Uint8Array,
    componentType: 5121 | 5123 | 5125,
    count: number
): Uint32Array => {
    const result = new Uint32Array(count);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stride = componentTypeByteSize(componentType);

    for (let index = 0; index < count; index += 1) {
        result[index] = readComponent(view, index * stride, componentType);
    }

    return result;
};

export class GltfAccessorRuntime {
    private readonly _accessors = new Map<number, Promise<DecodedAccessor>>();
    private readonly _indices = new Map<number, Promise<Uint32Array>>();

    constructor(readonly runtime: GltfResourceRuntime) {}

    async decodeAccessor(index: number): Promise<DecodedAccessor> {
        const existing = this._accessors.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._decodeAccessor(index);
        this._accessors.set(index, promise);
        return promise;
    }

    async decodeIndices(index: number): Promise<Uint32Array> {
        const existing = this._indices.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._decodeIndices(index);
        this._indices.set(index, promise);
        return promise;
    }

    private async _decodeAccessor(index: number): Promise<DecodedAccessor> {
        const accessor = this.runtime.source.json.accessors?.[index];
        if (!accessor) {
            throw new GltfAccessorError(`Missing accessor ${index}`, index);
        }

        const componentCount = accessorComponentCount(accessor.type);
        const elementSize = componentCount * componentTypeByteSize(accessor.componentType);
        const values = new Float32Array(accessor.count * componentCount);

        if (accessor.bufferView !== undefined) {
            const bufferView = this.runtime.source.json.bufferViews?.[accessor.bufferView];
            if (!bufferView) {
                throw new GltfAccessorError(
                    `Accessor ${index} references a missing bufferView`,
                    index
                );
            }

            const bytes = await this.runtime.resolveBufferView(accessor.bufferView);
            const stride = resolveBufferViewStride(bufferView) ?? elementSize;
            if (stride < elementSize) {
                throw new GltfAccessorError(`Accessor ${index} has an invalid byteStride`, index);
            }

            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const accessorOffset = accessor.byteOffset ?? 0;

            for (let element = 0; element < accessor.count; element += 1) {
                const elementOffset = accessorOffset + element * stride;
                for (let component = 0; component < componentCount; component += 1) {
                    const raw = readComponent(
                        view,
                        elementOffset + component * componentTypeByteSize(accessor.componentType),
                        accessor.componentType
                    );
                    values[element * componentCount + component] = accessor.normalized
                        ? normalizeComponent(raw, accessor.componentType)
                        : raw;
                }
            }
        }

        if (accessor.sparse) {
            await this._applySparse(accessor, values, componentCount);
        }

        return Object.freeze({
            count: accessor.count,
            componentCount,
            values,
            min: accessor.min ? Object.freeze([...accessor.min]) : undefined,
            max: accessor.max ? Object.freeze([...accessor.max]) : undefined,
        });
    }

    private async _decodeIndices(index: number): Promise<Uint32Array> {
        const accessor = this.runtime.source.json.accessors?.[index];
        if (!accessor) {
            throw new GltfAccessorError(`Missing accessor ${index}`, index);
        }

        if (accessor.type !== 'SCALAR') {
            throw new GltfAccessorError(`Index accessor ${index} must use SCALAR type`, index);
        }

        if (
            accessor.componentType !== 5121 &&
            accessor.componentType !== 5123 &&
            accessor.componentType !== 5125
        ) {
            throw new GltfAccessorError(
                `Index accessor ${index} has an invalid component type`,
                index
            );
        }

        const values = new Uint32Array(accessor.count);
        if (accessor.bufferView !== undefined) {
            const bufferView = this.runtime.source.json.bufferViews?.[accessor.bufferView];
            if (!bufferView) {
                throw new GltfAccessorError(
                    `Accessor ${index} references a missing bufferView`,
                    index
                );
            }

            const bytes = await this.runtime.resolveBufferView(accessor.bufferView);
            const stride =
                resolveBufferViewStride(bufferView) ?? componentTypeByteSize(accessor.componentType);
            if (stride < componentTypeByteSize(accessor.componentType)) {
                throw new GltfAccessorError(`Index accessor ${index} has an invalid byteStride`, index);
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const accessorOffset = accessor.byteOffset ?? 0;

            for (let element = 0; element < accessor.count; element += 1) {
                values[element] = readComponent(
                    view,
                    accessorOffset + element * stride,
                    accessor.componentType
                );
            }
        }

        if (accessor.sparse) {
            const sparseIndicesBytes = await this.runtime.resolveBufferView(
                accessor.sparse.indices.bufferView
            );
            const sparseIndices = decodeIndicesBuffer(
                sparseIndicesBytes.subarray(accessor.sparse.indices.byteOffset ?? 0),
                accessor.sparse.indices.componentType,
                accessor.sparse.count
            );
            const sparseValuesBytes = await this.runtime.resolveBufferView(
                accessor.sparse.values.bufferView
            );
            const sparseView = new DataView(
                sparseValuesBytes.buffer,
                sparseValuesBytes.byteOffset + (accessor.sparse.values.byteOffset ?? 0),
                sparseValuesBytes.byteLength - (accessor.sparse.values.byteOffset ?? 0)
            );
            const stride = componentTypeByteSize(accessor.componentType);

            for (let element = 0; element < sparseIndices.length; element += 1) {
                const targetIndex = sparseIndices[element]!;
                values[targetIndex] = readComponent(
                    sparseView,
                    element * stride,
                    accessor.componentType
                );
            }
        }

        return values;
    }

    private async _applySparse(
        accessor: GltfAccessorJson,
        target: Float32Array,
        componentCount: number
    ): Promise<void> {
        if (!accessor.sparse) {
            return;
        }

        const indexBytes = await this.runtime.resolveBufferView(accessor.sparse.indices.bufferView);
        const sparseIndices = decodeIndicesBuffer(
            indexBytes.subarray(accessor.sparse.indices.byteOffset ?? 0),
            accessor.sparse.indices.componentType,
            accessor.sparse.count
        );
        const valueBytes = await this.runtime.resolveBufferView(accessor.sparse.values.bufferView);
        const elementSize = componentCount * componentTypeByteSize(accessor.componentType);
        const view = new DataView(
            valueBytes.buffer,
            valueBytes.byteOffset + (accessor.sparse.values.byteOffset ?? 0),
            valueBytes.byteLength - (accessor.sparse.values.byteOffset ?? 0)
        );

        for (let element = 0; element < sparseIndices.length; element += 1) {
            const targetIndex = sparseIndices[element]!;
            const elementOffset = element * elementSize;
            for (let component = 0; component < componentCount; component += 1) {
                const raw = readComponent(
                    view,
                    elementOffset + component * componentTypeByteSize(accessor.componentType),
                    accessor.componentType
                );
                target[targetIndex * componentCount + component] = accessor.normalized
                    ? normalizeComponent(raw, accessor.componentType)
                    : raw;
            }
        }
    }
}