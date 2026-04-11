import type { IGeometryBuffers } from '@axrone/geometry';
import type { SceneMeshDefinition, SceneMeshSemantic } from './types';

const mapGeometryAttribute = (name: string): SceneMeshSemantic | null => {
    switch (name) {
        case 'position':
            return 'position';
        case 'normal':
            return 'normal';
        case 'texCoord':
            return 'uv0';
        case 'texCoord1':
            return 'uv1';
        case 'tangent':
            return 'tangent';
        case 'color':
            return 'color0';
        default:
            return null;
    }
};

export class SceneGeometryMeshBuilder {
    createDefinition(id: string, geometryBuffers: IGeometryBuffers): SceneMeshDefinition {
        const attributes = geometryBuffers.layout.attributes
            .map((attribute) => {
                const semantic = mapGeometryAttribute(attribute.name);
                if (!semantic) {
                    return null;
                }

                return {
                    semantic,
                    componentCount: attribute.size,
                    offset: attribute.offset,
                    stride: geometryBuffers.layout.stride,
                    type: attribute.type,
                    normalized: attribute.normalized,
                };
            })
            .filter((attribute): attribute is NonNullable<typeof attribute> => attribute !== null);

        const vertexReader = geometryBuffers.vertices.duplicate().rewind();
        const vertexFloatCount = vertexReader.remaining / 4;
        const vertexBytes = new Float32Array(vertexFloatCount);
        for (let index = 0; index < vertexFloatCount; index += 1) {
            vertexBytes[index] = vertexReader.getFloat32();
        }

        const indexReader = geometryBuffers.indices.duplicate().rewind();
        const indexCount = geometryBuffers.layout.indexCount;
        const bytesPerIndex = indexCount > 0 ? indexReader.remaining / indexCount : 0;
        let indexArray: Uint8Array | Uint16Array | Uint32Array | undefined;

        if (indexCount > 0) {
            if (bytesPerIndex === 4) {
                const indices = new Uint32Array(indexCount);
                for (let index = 0; index < indexCount; index += 1) {
                    indices[index] = indexReader.getUint32();
                }
                indexArray = indices;
            } else if (bytesPerIndex === 2) {
                const indices = new Uint16Array(indexCount);
                for (let index = 0; index < indexCount; index += 1) {
                    indices[index] = indexReader.getUint16();
                }
                indexArray = indices;
            } else if (bytesPerIndex === 1) {
                const indices = new Uint8Array(indexCount);
                for (let index = 0; index < indexCount; index += 1) {
                    indices[index] = indexReader.getUint8();
                }
                indexArray = indices;
            }
        }

        return {
            id,
            vertices: vertexBytes,
            indices: indexArray,
            vertexCount: geometryBuffers.layout.vertexCount,
            topology: geometryBuffers.layout.primitiveType,
            attributes,
        };
    }
}
