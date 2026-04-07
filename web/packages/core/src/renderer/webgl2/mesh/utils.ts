import { Vec3, Mat4 } from '@axrone/numeric';
import {
    VertexAttributeType,
    VertexDataType,
    PrimitiveTopology,
    BufferUsage,
    IndexType,
    IVertexAttributeDescriptor,
    IVertexLayout,
    IBoundingBox,
    IBoundingSphere,
    MeshError,
    MeshErrorCode,
} from './interfaces';

export class MeshWebGLConstants {
    public static readonly VERTEX_DATA_TYPE_MAP = new Map<VertexDataType, number>([
        [VertexDataType.BYTE, WebGL2RenderingContext.BYTE],
        [VertexDataType.UNSIGNED_BYTE, WebGL2RenderingContext.UNSIGNED_BYTE],
        [VertexDataType.SHORT, WebGL2RenderingContext.SHORT],
        [VertexDataType.UNSIGNED_SHORT, WebGL2RenderingContext.UNSIGNED_SHORT],
        [VertexDataType.INT, WebGL2RenderingContext.INT],
        [VertexDataType.UNSIGNED_INT, WebGL2RenderingContext.UNSIGNED_INT],
        [VertexDataType.FLOAT, WebGL2RenderingContext.FLOAT],
        [VertexDataType.HALF_FLOAT, WebGL2RenderingContext.HALF_FLOAT],
    ]);

    public static readonly PRIMITIVE_TOPOLOGY_MAP = new Map<PrimitiveTopology, number>([
        [PrimitiveTopology.POINTS, WebGL2RenderingContext.POINTS],
        [PrimitiveTopology.LINES, WebGL2RenderingContext.LINES],
        [PrimitiveTopology.LINE_STRIP, WebGL2RenderingContext.LINE_STRIP],
        [PrimitiveTopology.LINE_LOOP, WebGL2RenderingContext.LINE_LOOP],
        [PrimitiveTopology.TRIANGLES, WebGL2RenderingContext.TRIANGLES],
        [PrimitiveTopology.TRIANGLE_STRIP, WebGL2RenderingContext.TRIANGLE_STRIP],
        [PrimitiveTopology.TRIANGLE_FAN, WebGL2RenderingContext.TRIANGLE_FAN],
    ]);

    public static readonly BUFFER_USAGE_MAP = new Map<BufferUsage, number>([
        [BufferUsage.STATIC_DRAW, WebGL2RenderingContext.STATIC_DRAW],
        [BufferUsage.DYNAMIC_DRAW, WebGL2RenderingContext.DYNAMIC_DRAW],
        [BufferUsage.STREAM_DRAW, WebGL2RenderingContext.STREAM_DRAW],
        [BufferUsage.STATIC_READ, WebGL2RenderingContext.STATIC_READ],
        [BufferUsage.DYNAMIC_READ, WebGL2RenderingContext.DYNAMIC_READ],
        [BufferUsage.STREAM_READ, WebGL2RenderingContext.STREAM_READ],
        [BufferUsage.STATIC_COPY, WebGL2RenderingContext.STATIC_COPY],
        [BufferUsage.DYNAMIC_COPY, WebGL2RenderingContext.DYNAMIC_COPY],
        [BufferUsage.STREAM_COPY, WebGL2RenderingContext.STREAM_COPY],
    ]);

    public static readonly INDEX_TYPE_MAP = new Map<IndexType, number>([
        [IndexType.UNSIGNED_BYTE, WebGL2RenderingContext.UNSIGNED_BYTE],
        [IndexType.UNSIGNED_SHORT, WebGL2RenderingContext.UNSIGNED_SHORT],
        [IndexType.UNSIGNED_INT, WebGL2RenderingContext.UNSIGNED_INT],
    ]);

    public static getVertexDataTypeConstant(type: VertexDataType): number {
        const constant = this.VERTEX_DATA_TYPE_MAP.get(type);
        if (constant === undefined) {
            throw new MeshError(
                `Unsupported vertex data type: ${type}`,
                MeshErrorCode.INVALID_VERTEX_DATA
            );
        }
        return constant;
    }

    public static getPrimitiveTopologyConstant(topology: PrimitiveTopology): number {
        const constant = this.PRIMITIVE_TOPOLOGY_MAP.get(topology);
        if (constant === undefined) {
            throw new MeshError(
                `Unsupported primitive topology: ${topology}`,
                MeshErrorCode.INVALID_OPERATION
            );
        }
        return constant;
    }

    public static getBufferUsageConstant(usage: BufferUsage): number {
        const constant = this.BUFFER_USAGE_MAP.get(usage);
        if (constant === undefined) {
            throw new MeshError(
                `Unsupported buffer usage: ${usage}`,
                MeshErrorCode.INVALID_OPERATION
            );
        }
        return constant;
    }

    public static getIndexTypeConstant(type: IndexType): number {
        const constant = this.INDEX_TYPE_MAP.get(type);
        if (constant === undefined) {
            throw new MeshError(
                `Unsupported index type: ${type}`,
                MeshErrorCode.INVALID_INDEX_DATA
            );
        }
        return constant;
    }
}

export class VertexAttributeInfo {
    private static readonly ATTRIBUTE_LOCATIONS = new Map<VertexAttributeType, number>([
        [VertexAttributeType.POSITION, 0],
        [VertexAttributeType.NORMAL, 1],
        [VertexAttributeType.TANGENT, 2],
        [VertexAttributeType.TEXCOORD_0, 3],
        [VertexAttributeType.TEXCOORD_1, 4],
        [VertexAttributeType.TEXCOORD_2, 5],
        [VertexAttributeType.TEXCOORD_3, 6],
        [VertexAttributeType.COLOR_0, 7],
        [VertexAttributeType.COLOR_1, 8],
        [VertexAttributeType.JOINTS_0, 9],
        [VertexAttributeType.WEIGHTS_0, 10],
        [VertexAttributeType.CUSTOM_0, 11],
        [VertexAttributeType.CUSTOM_1, 12],
        [VertexAttributeType.CUSTOM_2, 13],
        [VertexAttributeType.CUSTOM_3, 14],
    ]);

    private static readonly DATA_TYPE_SIZES = new Map<VertexDataType, number>([
        [VertexDataType.BYTE, 1],
        [VertexDataType.UNSIGNED_BYTE, 1],
        [VertexDataType.SHORT, 2],
        [VertexDataType.UNSIGNED_SHORT, 2],
        [VertexDataType.INT, 4],
        [VertexDataType.UNSIGNED_INT, 4],
        [VertexDataType.FLOAT, 4],
        [VertexDataType.HALF_FLOAT, 2],
    ]);

    public static getAttributeLocation(type: VertexAttributeType): number {
        const location = this.ATTRIBUTE_LOCATIONS.get(type);
        if (location === undefined) {
            throw new MeshError(
                `Unknown attribute type: ${type}`,
                MeshErrorCode.ATTRIBUTE_NOT_FOUND
            );
        }
        return location;
    }

    public static getDataTypeSize(type: VertexDataType): number {
        const size = this.DATA_TYPE_SIZES.get(type);
        if (size === undefined) {
            throw new MeshError(`Unknown data type: ${type}`, MeshErrorCode.INVALID_VERTEX_DATA);
        }
        return size;
    }

    public static getAttributeByteSize(descriptor: IVertexAttributeDescriptor): number {
        return this.getDataTypeSize(descriptor.dataType) * descriptor.componentCount;
    }

    public static getDefaultComponentCount(type: VertexAttributeType): number {
        switch (type) {
            case VertexAttributeType.POSITION:
            case VertexAttributeType.NORMAL:
            case VertexAttributeType.TANGENT:
                return 3;
            case VertexAttributeType.TEXCOORD_0:
            case VertexAttributeType.TEXCOORD_1:
            case VertexAttributeType.TEXCOORD_2:
            case VertexAttributeType.TEXCOORD_3:
                return 2;
            case VertexAttributeType.COLOR_0:
            case VertexAttributeType.COLOR_1:
            case VertexAttributeType.JOINTS_0:
            case VertexAttributeType.WEIGHTS_0:
                return 4;
            default:
                return 1;
        }
    }

    public static getDefaultDataType(type: VertexAttributeType): VertexDataType {
        switch (type) {
            case VertexAttributeType.JOINTS_0:
                return VertexDataType.UNSIGNED_SHORT;
            case VertexAttributeType.COLOR_0:
            case VertexAttributeType.COLOR_1:
                return VertexDataType.UNSIGNED_BYTE;
            default:
                return VertexDataType.FLOAT;
        }
    }

    public static shouldNormalize(type: VertexAttributeType, dataType: VertexDataType): boolean {
        if (type === VertexAttributeType.COLOR_0 || type === VertexAttributeType.COLOR_1) {
            return dataType === VertexDataType.UNSIGNED_BYTE;
        }
        if (type === VertexAttributeType.WEIGHTS_0) {
            return (
                dataType === VertexDataType.UNSIGNED_BYTE ||
                dataType === VertexDataType.UNSIGNED_SHORT
            );
        }
        return false;
    }
}

export class MeshUtils {
    public static calculateLayoutStride(attributes: readonly IVertexAttributeDescriptor[]): number {
        let maxEnd = 0;
        for (const attr of attributes) {
            const end = attr.offset + VertexAttributeInfo.getAttributeByteSize(attr);
            maxEnd = Math.max(maxEnd, end);
        }
        return maxEnd;
    }

    public static validateVertexLayout(layout: IVertexLayout): void {
        if (layout.attributes.length === 0) {
            throw new MeshError(
                'Vertex layout must have at least one attribute',
                MeshErrorCode.INVALID_LAYOUT
            );
        }

        for (let i = 0; i < layout.attributes.length; i++) {
            const attr1 = layout.attributes[i];
            const attr1End = attr1.offset + VertexAttributeInfo.getAttributeByteSize(attr1);

            for (let j = i + 1; j < layout.attributes.length; j++) {
                const attr2 = layout.attributes[j];
                const attr2End = attr2.offset + VertexAttributeInfo.getAttributeByteSize(attr2);

                if (!(attr1End <= attr2.offset || attr2End <= attr1.offset)) {
                    throw new MeshError(
                        `Overlapping vertex attributes: ${attr1.type} and ${attr2.type}`,
                        MeshErrorCode.INVALID_LAYOUT
                    );
                }
            }
        }

        const calculatedStride = this.calculateLayoutStride(layout.attributes);
        if (layout.stride < calculatedStride) {
            throw new MeshError(
                `Invalid stride: ${layout.stride}, minimum required: ${calculatedStride}`,
                MeshErrorCode.INVALID_LAYOUT
            );
        }
    }

    public static createPositionLayout(): IVertexLayout {
        return {
            attributes: [
                {
                    type: VertexAttributeType.POSITION,
                    dataType: VertexDataType.FLOAT,
                    componentCount: 3,
                    normalized: false,
                    offset: 0,
                    stride: 12,
                },
            ],
            stride: 12,
            vertexCount: 0,
        };
    }

    public static createStandardLayout(): IVertexLayout {
        return {
            attributes: [
                {
                    type: VertexAttributeType.POSITION,
                    dataType: VertexDataType.FLOAT,
                    componentCount: 3,
                    normalized: false,
                    offset: 0,
                    stride: 32,
                },
                {
                    type: VertexAttributeType.NORMAL,
                    dataType: VertexDataType.FLOAT,
                    componentCount: 3,
                    normalized: false,
                    offset: 12,
                    stride: 32,
                },
                {
                    type: VertexAttributeType.TEXCOORD_0,
                    dataType: VertexDataType.FLOAT,
                    componentCount: 2,
                    normalized: false,
                    offset: 24,
                    stride: 32,
                },
            ],
            stride: 32,
            vertexCount: 0,
        };
    }

    public static calculateVertexMemoryUsage(layout: IVertexLayout, vertexCount: number): number {
        return layout.stride * vertexCount;
    }

    public static calculateIndexMemoryUsage(indexType: IndexType, indexCount: number): number {
        const bytesPerIndex =
            indexType === IndexType.UNSIGNED_BYTE
                ? 1
                : indexType === IndexType.UNSIGNED_SHORT
                  ? 2
                  : 4;
        return bytesPerIndex * indexCount;
    }

    public static generateMeshId(): string {
        return `mesh_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    public static validateIndexType(indexType: IndexType, vertexCount: number): void {
        const maxIndex =
            indexType === IndexType.UNSIGNED_BYTE
                ? 255
                : indexType === IndexType.UNSIGNED_SHORT
                  ? 65535
                  : 4294967295;

        if (vertexCount > maxIndex) {
            throw new MeshError(
                `Vertex count ${vertexCount} exceeds maximum for index type ${indexType} (${maxIndex})`,
                MeshErrorCode.INVALID_INDEX_DATA
            );
        }
    }

    public static getOptimalIndexType(vertexCount: number): IndexType {
        if (vertexCount <= 255) {
            return IndexType.UNSIGNED_BYTE;
        } else if (vertexCount <= 65535) {
            return IndexType.UNSIGNED_SHORT;
        } else {
            return IndexType.UNSIGNED_INT;
        }
    }
}

export class BoundingVolumeUtils {
    public static computeBoundingBox(positions: Float32Array): IBoundingBox {
        if (positions.length === 0) {
            const zero = new Vec3(0, 0, 0);
            return {
                min: zero as Vec3,
                max: zero as Vec3,
                center: zero as Vec3,
                size: zero as Vec3,
                radius: 0,
            };
        }

        let minX = positions[0];
        let minY = positions[1];
        let minZ = positions[2];
        let maxX = positions[0];
        let maxY = positions[1];
        let maxZ = positions[2];

        for (let i = 3; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        const min = new Vec3(minX, minY, minZ);
        const max = new Vec3(maxX, maxY, maxZ);
        const center = Vec3.lerp(min, max, 0.5);
        const size = Vec3.subtract(max, min);
        const radius = Vec3.distance(center, max);

        return {
            min: min as Vec3,
            max: max as Vec3,
            center: center as Vec3,
            size: size as Vec3,
            radius,
        };
    }

    public static computeBoundingSphere(positions: Float32Array): IBoundingSphere {
        const boundingBox = this.computeBoundingBox(positions);
        return {
            center: boundingBox.center,
            radius: boundingBox.radius,
        };
    }

    public static transformBoundingBox(boundingBox: IBoundingBox, transform: Mat4): IBoundingBox {
        const corners = [
            new Vec3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
            new Vec3(boundingBox.max.x, boundingBox.min.y, boundingBox.min.z),
            new Vec3(boundingBox.min.x, boundingBox.max.y, boundingBox.min.z),
            new Vec3(boundingBox.max.x, boundingBox.max.y, boundingBox.min.z),
            new Vec3(boundingBox.min.x, boundingBox.min.y, boundingBox.max.z),
            new Vec3(boundingBox.max.x, boundingBox.min.y, boundingBox.max.z),
            new Vec3(boundingBox.min.x, boundingBox.max.y, boundingBox.max.z),
            new Vec3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
        ];

        const transformedCorners = corners.map((corner) => Mat4.transformVec3(corner, transform));

        let minX = transformedCorners[0].x;
        let minY = transformedCorners[0].y;
        let minZ = transformedCorners[0].z;
        let maxX = transformedCorners[0].x;
        let maxY = transformedCorners[0].y;
        let maxZ = transformedCorners[0].z;

        for (const corner of transformedCorners) {
            minX = Math.min(minX, corner.x);
            minY = Math.min(minY, corner.y);
            minZ = Math.min(minZ, corner.z);
            maxX = Math.max(maxX, corner.x);
            maxY = Math.max(maxY, corner.y);
            maxZ = Math.max(maxZ, corner.z);
        }

        const min = new Vec3(minX, minY, minZ);
        const max = new Vec3(maxX, maxY, maxZ);
        const center = Vec3.lerp(min, max, 0.5);
        const size = Vec3.subtract(max, min);
        const radius = Vec3.distance(center, max);

        return {
            min: new Vec3(min.x, min.y, min.z),
            max: new Vec3(max.x, max.y, max.z),
            center: new Vec3(center.x, center.y, center.z),
            size: new Vec3(size.x, size.y, size.z),
            radius,
        };
    }

    public static transformBoundingSphere(
        sphere: IBoundingSphere,
        transform: Mat4
    ): IBoundingSphere {
        const transformedCenter = Mat4.transformVec3(sphere.center, transform);

        const m = transform.data;
        const scaleX = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
        const scaleY = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
        const scaleZ = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
        const maxScale = Math.max(scaleX, scaleY, scaleZ);

        return {
            center: transformedCenter as Vec3,
            radius: sphere.radius * maxScale,
        };
    }

    public static mergeBoundingBoxes(boxes: IBoundingBox[]): IBoundingBox {
        if (boxes.length === 0) {
            const zero = new Vec3(0, 0, 0);
            return {
                min: zero,
                max: zero,
                center: zero,
                size: zero,
                radius: 0,
            };
        }

        let minX = boxes[0].min.x;
        let minY = boxes[0].min.y;
        let minZ = boxes[0].min.z;
        let maxX = boxes[0].max.x;
        let maxY = boxes[0].max.y;
        let maxZ = boxes[0].max.z;

        for (const box of boxes) {
            minX = Math.min(minX, box.min.x);
            minY = Math.min(minY, box.min.y);
            minZ = Math.min(minZ, box.min.z);
            maxX = Math.max(maxX, box.max.x);
            maxY = Math.max(maxY, box.max.y);
            maxZ = Math.max(maxZ, box.max.z);
        }

        const min = new Vec3(minX, minY, minZ);
        const max = new Vec3(maxX, maxY, maxZ);
        const center = Vec3.lerp(min, max, 0.5);
        const size = Vec3.subtract(max, min);
        const radius = Vec3.distance(center, max);

        return {
            min: new Vec3(min.x, min.y, min.z),
            max: new Vec3(max.x, max.y, max.z),
            center: new Vec3(center.x, center.y, center.z),
            size: new Vec3(size.x, size.y, size.z),
            radius,
        };
    }
}

export class MeshGenerationUtils {
    public static generateSmoothNormals(
        positions: Float32Array,
        indices: Uint16Array | Uint32Array
    ): Float32Array {
        const vertexCount = positions.length / 3;
        const normals = new Float32Array(positions.length);

        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i] * 3;
            const i1 = indices[i + 1] * 3;
            const i2 = indices[i + 2] * 3;

            const v0 = new Vec3(positions[i0], positions[i0 + 1], positions[i0 + 2]);
            const v1 = new Vec3(positions[i1], positions[i1 + 1], positions[i1 + 2]);
            const v2 = new Vec3(positions[i2], positions[i2 + 1], positions[i2 + 2]);

            const edge1 = Vec3.subtract(v1, v0);
            const edge2 = Vec3.subtract(v2, v0);
            const faceNormal = Vec3.normalize(Vec3.cross(edge1, edge2));

            normals[i0] += faceNormal.x;
            normals[i0 + 1] += faceNormal.y;
            normals[i0 + 2] += faceNormal.z;

            normals[i1] += faceNormal.x;
            normals[i1 + 1] += faceNormal.y;
            normals[i1 + 2] += faceNormal.z;

            normals[i2] += faceNormal.x;
            normals[i2 + 1] += faceNormal.y;
            normals[i2 + 2] += faceNormal.z;
        }

        for (let i = 0; i < normals.length; i += 3) {
            const normal = Vec3.normalize(new Vec3(normals[i], normals[i + 1], normals[i + 2]));
            normals[i] = normal.x;
            normals[i + 1] = normal.y;
            normals[i + 2] = normal.z;
        }

        return normals;
    }

    public static generateTangents(
        positions: Float32Array,
        normals: Float32Array,
        texCoords: Float32Array,
        indices: Uint16Array | Uint32Array
    ): Float32Array {
        const vertexCount = positions.length / 3;
        const tangents = new Float32Array(vertexCount * 4);

        const tan1 = new Float32Array(vertexCount * 3);
        const tan2 = new Float32Array(vertexCount * 3);

        for (let i = 0; i < indices.length; i += 3) {
            const i1 = indices[i];
            const i2 = indices[i + 1];
            const i3 = indices[i + 2];

            const v1 = new Vec3(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
            const v2 = new Vec3(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
            const v3 = new Vec3(positions[i3 * 3], positions[i3 * 3 + 1], positions[i3 * 3 + 2]);

            const w1 = texCoords[i1 * 2];
            const w2 = texCoords[i2 * 2];
            const w3 = texCoords[i3 * 2];
            const h1 = texCoords[i1 * 2 + 1];
            const h2 = texCoords[i2 * 2 + 1];
            const h3 = texCoords[i3 * 2 + 1];

            const x1 = v2.x - v1.x;
            const x2 = v3.x - v1.x;
            const y1 = v2.y - v1.y;
            const y2 = v3.y - v1.y;
            const z1 = v2.z - v1.z;
            const z2 = v3.z - v1.z;

            const s1 = w2 - w1;
            const s2 = w3 - w1;
            const t1 = h2 - h1;
            const t2 = h3 - h1;

            const r = 1.0 / (s1 * t2 - s2 * t1);
            const sdir = new Vec3(
                (t2 * x1 - t1 * x2) * r,
                (t2 * y1 - t1 * y2) * r,
                (t2 * z1 - t1 * z2) * r
            );
            const tdir = new Vec3(
                (s1 * x2 - s2 * x1) * r,
                (s1 * y2 - s2 * y1) * r,
                (s1 * z2 - s2 * z1) * r
            );

            tan1[i1 * 3] += sdir.x;
            tan1[i1 * 3 + 1] += sdir.y;
            tan1[i1 * 3 + 2] += sdir.z;
            tan1[i2 * 3] += sdir.x;
            tan1[i2 * 3 + 1] += sdir.y;
            tan1[i2 * 3 + 2] += sdir.z;
            tan1[i3 * 3] += sdir.x;
            tan1[i3 * 3 + 1] += sdir.y;
            tan1[i3 * 3 + 2] += sdir.z;

            tan2[i1 * 3] += tdir.x;
            tan2[i1 * 3 + 1] += tdir.y;
            tan2[i1 * 3 + 2] += tdir.z;
            tan2[i2 * 3] += tdir.x;
            tan2[i2 * 3 + 1] += tdir.y;
            tan2[i2 * 3 + 2] += tdir.z;
            tan2[i3 * 3] += tdir.x;
            tan2[i3 * 3 + 1] += tdir.y;
            tan2[i3 * 3 + 2] += tdir.z;
        }

        for (let i = 0; i < vertexCount; i++) {
            const n = new Vec3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
            const t = new Vec3(tan1[i * 3], tan1[i * 3 + 1], tan1[i * 3 + 2]);

            const dotProduct = Vec3.dot(n, t);
            const scaled = Vec3.multiplyScalar(n, dotProduct);
            const tangent = Vec3.normalize(Vec3.subtract(t, scaled));

            const handedness =
                Vec3.dot(
                    Vec3.cross(n, t),
                    new Vec3(tan2[i * 3], tan2[i * 3 + 1], tan2[i * 3 + 2])
                ) < 0.0
                    ? -1.0
                    : 1.0;

            tangents[i * 4] = tangent.x;
            tangents[i * 4 + 1] = tangent.y;
            tangents[i * 4 + 2] = tangent.z;
            tangents[i * 4 + 3] = handedness;
        }

        return tangents;
    }
}
