import { Vec2, Vec3, Vec4, Mat4 } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/utility';
import { IBindableTarget } from '../texture/interfaces';

export const enum VertexAttributeType {
    POSITION = 'POSITION',
    NORMAL = 'NORMAL',
    TANGENT = 'TANGENT',
    TEXCOORD_0 = 'TEXCOORD_0',
    TEXCOORD_1 = 'TEXCOORD_1',
    TEXCOORD_2 = 'TEXCOORD_2',
    TEXCOORD_3 = 'TEXCOORD_3',
    COLOR_0 = 'COLOR_0',
    COLOR_1 = 'COLOR_1',
    JOINTS_0 = 'JOINTS_0',
    WEIGHTS_0 = 'WEIGHTS_0',
    CUSTOM_0 = 'CUSTOM_0',
    CUSTOM_1 = 'CUSTOM_1',
    CUSTOM_2 = 'CUSTOM_2',
    CUSTOM_3 = 'CUSTOM_3'
}

export const enum VertexDataType {
    BYTE = 'BYTE',
    UNSIGNED_BYTE = 'UNSIGNED_BYTE',
    SHORT = 'SHORT',
    UNSIGNED_SHORT = 'UNSIGNED_SHORT',
    INT = 'INT',
    UNSIGNED_INT = 'UNSIGNED_INT',
    FLOAT = 'FLOAT',
    HALF_FLOAT = 'HALF_FLOAT'
}

export const enum PrimitiveTopology {
    POINTS = 'POINTS',
    LINES = 'LINES',
    LINE_STRIP = 'LINE_STRIP',
    LINE_LOOP = 'LINE_LOOP',
    TRIANGLES = 'TRIANGLES',
    TRIANGLE_STRIP = 'TRIANGLE_STRIP',
    TRIANGLE_FAN = 'TRIANGLE_FAN'
}

export const enum BufferUsage {
    STATIC_DRAW = 'STATIC_DRAW',
    DYNAMIC_DRAW = 'DYNAMIC_DRAW',
    STREAM_DRAW = 'STREAM_DRAW',
    STATIC_READ = 'STATIC_READ',
    DYNAMIC_READ = 'DYNAMIC_READ',
    STREAM_READ = 'STREAM_READ',
    STATIC_COPY = 'STATIC_COPY',
    DYNAMIC_COPY = 'DYNAMIC_COPY',
    STREAM_COPY = 'STREAM_COPY'
}

export const enum IndexType {
    UNSIGNED_BYTE = 'UNSIGNED_BYTE',
    UNSIGNED_SHORT = 'UNSIGNED_SHORT',
    UNSIGNED_INT = 'UNSIGNED_INT'
}

export const enum VertexBufferError {
    NONE = 0,
    INVALID_DATA_FORMAT = 1,
    BUFFER_CREATION_FAILED = 2,
    BUFFER_NOT_INITIALIZED = 3,
    UPDATE_FAILED = 4,
    INVALID_LAYOUT = 5,
    ATTRIBUTE_MISMATCH = 6
}

export const enum IndexBufferError {
    NONE = 0,
    INVALID_DATA_FORMAT = 1,
    BUFFER_CREATION_FAILED = 2,
    BUFFER_NOT_INITIALIZED = 3,
    UPDATE_FAILED = 4,
    INVALID_INDEX_TYPE = 5
}

export interface IVertexBufferConfig {
    readonly data?: ArrayBufferView | ByteBuffer;
    readonly usage?: BufferUsage;
    readonly layout: IVertexLayout;
}

export interface IIndexBufferConfig {
    readonly data?: ArrayBufferView | ByteBuffer;
    readonly usage?: BufferUsage;
    readonly indexType?: IndexType;
}

export interface IVertexAttributeDescriptor {
    readonly type: VertexAttributeType;
    readonly dataType: VertexDataType;
    readonly componentCount: number;
    readonly normalized: boolean;
    readonly offset: number;
    readonly stride: number;
    readonly divisor?: number; 
}

export interface IVertexLayout {
    readonly attributes: readonly IVertexAttributeDescriptor[];
    readonly stride: number;
    readonly vertexCount: number;
}

export interface IVertexBuffer extends IBindableTarget {
    readonly id: string;
    readonly nativeHandle: WebGLBuffer;
    readonly usage: BufferUsage;
    readonly size: number;
    readonly vertexCount: number;
    readonly layout: IVertexLayout;
    readonly isDisposed: boolean;

    update(data: ArrayBuffer | ArrayBufferView, offset?: number): this;
    resize(newSize: number): this;

    dispose(): void;
}

export interface IIndexBuffer extends IBindableTarget {
    readonly id: string;
    readonly nativeHandle: WebGLBuffer;
    readonly usage: BufferUsage;
    readonly size: number;
    readonly indexCount: number;
    readonly indexType: IndexType;
    readonly isDisposed: boolean;

    update(data: ArrayBuffer | ArrayBufferView, offset?: number): this;
    resize(newSize: number): this;

    dispose(): void;
}

export interface IVertexArrayObject extends IBindableTarget {
    readonly id: string;
    readonly nativeHandle: WebGLVertexArrayObject;
    readonly vertexBuffers: readonly IVertexBuffer[];
    readonly indexBuffer: IIndexBuffer | null;
    readonly isDisposed: boolean;

    addVertexBuffer(buffer: IVertexBuffer): void;
    setIndexBuffer(buffer: IIndexBuffer): void;
    removeVertexBuffer(buffer: IVertexBuffer): boolean;
    clearVertexBuffers(): void;

    dispose(): void;
}

export interface IBoundingBox {
    readonly min: Vec3;
    readonly max: Vec3;
    readonly center: Vec3;
    readonly size: Vec3;
    readonly radius: number;
}

export interface IBoundingSphere {
    readonly center: Vec3;
    readonly radius: number;
}

export interface IGeometry {
    readonly id: string;
    readonly primitiveTopology: PrimitiveTopology;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly boundingBox: IBoundingBox;
    readonly boundingSphere: IBoundingSphere;
    readonly vertexArrayObject: IVertexArrayObject;
    readonly vertexBuffers: readonly IVertexBuffer[];
    readonly indexBuffer: IIndexBuffer | null;
    readonly isDisposed: boolean;

    hasAttribute(type: VertexAttributeType): boolean;
    getAttribute(type: VertexAttributeType): IVertexBuffer | null;
    getAttributeData(type: VertexAttributeType): Float32Array | null;

    computeBounds(): void;
    generateNormals(): void;
    generateTangents(): void;

    dispose(): void;
}

export interface IMesh {
    readonly id: string;
    readonly name: string;
    readonly geometry: IGeometry;
    readonly materialIndex: number;
    readonly transform: Mat4;
    readonly boundingBox: IBoundingBox;
    readonly boundingSphere: IBoundingSphere;
    readonly visible: boolean;
    readonly castShadows: boolean;
    readonly receiveShadows: boolean;
    readonly isDisposed: boolean;

    setTransform(transform: Mat4): void;
    translate(offset: Vec3): void;
    rotate(rotation: Vec3): void;
    scale(scale: Vec3): void;

    render(): void;
    renderInstanced(count: number): void;

    updateBounds(): void;

    dispose(): void;
}

export interface IVertexBufferCreateOptions {
    readonly data: ArrayBufferView | ByteBuffer;
    readonly layout: IVertexLayout;
    readonly usage: BufferUsage;
    readonly label?: string;
}

export interface IIndexBufferCreateOptions {
    readonly data: ArrayBufferView | ByteBuffer;
    readonly indexType: IndexType;
    readonly usage: BufferUsage;
    readonly label?: string;
}

export interface IGeometryCreateOptions {
    readonly primitiveTopology: PrimitiveTopology;
    readonly vertexBuffers: IVertexBuffer[];
    readonly indexBuffer?: IIndexBuffer;
    readonly computeBounds?: boolean;
    readonly label?: string;
}

export interface IMeshCreateOptions {
    readonly name: string;
    readonly geometry: IGeometry;
    readonly materialIndex?: number;
    readonly transform?: Mat4;
    readonly visible?: boolean;
    readonly castShadows?: boolean;
    readonly receiveShadows?: boolean;
}

export interface IMeshManager {

    createVertexBuffer(options: IVertexBufferCreateOptions): IVertexBuffer;
    createIndexBuffer(options: IIndexBufferCreateOptions): IIndexBuffer;
    createVertexArrayObject(): IVertexArrayObject;

    createGeometry(options: IGeometryCreateOptions): IGeometry;
    createQuadGeometry(): IGeometry;
    createCubeGeometry(size?: number): IGeometry;
    createSphereGeometry(radius?: number, segments?: number): IGeometry;
    createPlaneGeometry(width?: number, height?: number): IGeometry;

    createMesh(options: IMeshCreateOptions): IMesh;

    getMesh(id: string): IMesh | null;
    cacheMesh(id: string, mesh: IMesh): void;
    removeCachedMesh(id: string): boolean;
    clearCache(): void;

    getStats(): IMeshManagerStats;
    optimizeMemory(): void;
    dispose(): void;
}

export interface IMeshManagerStats {
    readonly totalMeshes: number;
    readonly totalGeometries: number;
    readonly totalVertexBuffers: number;
    readonly totalIndexBuffers: number;
    readonly totalVertices: number;
    readonly totalIndices: number;
    readonly memoryUsage: number;
    readonly cacheHitRate: number;
}

export interface IPrimitiveGenerator {
    generateQuad(): {
        vertices: Float32Array;
        indices: Uint16Array;
        layout: IVertexLayout;
    };

    generateCube(size: number): {
        vertices: Float32Array;
        indices: Uint16Array;
        layout: IVertexLayout;
    };

    generateSphere(radius: number, segments: number): {
        vertices: Float32Array;
        indices: Uint16Array;
        layout: IVertexLayout;
    };

    generatePlane(width: number, height: number, subdivisions?: number): {
        vertices: Float32Array;
        indices: Uint16Array;
        layout: IVertexLayout;
    };
}

export class MeshError extends Error {
    constructor(
        message: string,
        public readonly code: MeshErrorCode,
        public readonly meshId?: string,
        public readonly cause?: Error
    ) {
        super(`[Mesh] ${code}: ${message}`);
        this.name = 'MeshError';
    }
}

export const enum MeshErrorCode {
    INVALID_VERTEX_DATA = 'INVALID_VERTEX_DATA',
    INVALID_INDEX_DATA = 'INVALID_INDEX_DATA',
    BUFFER_CREATION_FAILED = 'BUFFER_CREATION_FAILED',
    VAO_CREATION_FAILED = 'VAO_CREATION_FAILED',
    ATTRIBUTE_NOT_FOUND = 'ATTRIBUTE_NOT_FOUND',
    INVALID_LAYOUT = 'INVALID_LAYOUT',
    ALREADY_DISPOSED = 'ALREADY_DISPOSED',
    DISPOSED_RESOURCE_ACCESS = 'DISPOSED_RESOURCE_ACCESS',
    CONTEXT_LOST = 'CONTEXT_LOST',
    OUT_OF_MEMORY = 'OUT_OF_MEMORY',
    INVALID_OPERATION = 'INVALID_OPERATION'
}

export interface IMeshBuilder {
    vertices(data: ArrayBufferView | number[]): IMeshBuilder;
    indices(data: ArrayBufferView | number[]): IMeshBuilder;
    attribute(type: VertexAttributeType, dataType: VertexDataType, componentCount: number, normalized?: boolean): IMeshBuilder;
    topology(topology: PrimitiveTopology): IMeshBuilder;
    usage(usage: BufferUsage): IMeshBuilder;
    label(name: string): IMeshBuilder;

    transform(matrix: Mat4): IMeshBuilder;
    translate(offset: Vec3): IMeshBuilder;
    rotate(rotation: Vec3): IMeshBuilder;
    scale(scale: Vec3): IMeshBuilder;

    computeBounds(enabled: boolean): IMeshBuilder;
    generateNormals(enabled: boolean): IMeshBuilder;
    generateTangents(enabled: boolean): IMeshBuilder;

    build(): IMesh;
}
