import { IBuffer, IBufferFactory, createBufferFactory } from '../buffer';
import { IGeometryBuffers } from '@axrone/geometry';
import {
    createSphere,
    createBox,
    createPlane,
    createQuad,
    createCylinder,
    createCone,
    createCapsule,
    createTorus,
} from '@axrone/geometry';

export interface IMeshData {
    readonly id: string;
    readonly vertexBuffer: IBuffer;
    readonly indexBuffer: IBuffer | null;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly topology: 'triangles' | 'lines' | 'points';
}

export class MeshManager {
    private readonly gl: WebGL2RenderingContext;
    private readonly bufferFactory: IBufferFactory;
    private readonly meshCache = new Map<string, IMeshData>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.bufferFactory = createBufferFactory(gl);
    }

    public createMeshFromGeometry(id: string, geometryBuffers: IGeometryBuffers): IMeshData {
        if (this.meshCache.has(id)) {
            return this.meshCache.get(id)!;
        }

        const vertexData = geometryBuffers.vertices.toUint8Array();
        const vertexBuffer = this.bufferFactory.createArrayBufferFromData(
            vertexData as unknown as BufferSource,
            this.gl.STATIC_DRAW
        );

        let indexBuffer: IBuffer | null = null;
        if (geometryBuffers.layout.indexCount > 0) {
            const indexData = geometryBuffers.indices.toUint8Array();
            indexBuffer = this.bufferFactory.createElementArrayBufferFromData(
                indexData as unknown as BufferSource,
                this.gl.STATIC_DRAW
            );
        }

        const mesh: IMeshData = {
            id,
            vertexBuffer,
            indexBuffer,
            vertexCount: geometryBuffers.layout.vertexCount,
            indexCount: geometryBuffers.layout.indexCount,
            topology: geometryBuffers.layout.primitiveType as any,
        };

        this.meshCache.set(id, mesh);
        return mesh;
    }

    public createSphereMesh(id: string, radius: number = 1, segments: number = 32): IMeshData {
        const geometryBuffers = createSphere({
            radius,
            widthSegments: segments,
            heightSegments: segments,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): IMeshData {
        const geometryBuffers = createBox({
            width,
            height,
            depth,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createPlaneMesh(id: string, width: number = 1, height: number = 1): IMeshData {
        const geometryBuffers = createPlane({
            width,
            height,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createQuadMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        orientation: 'xy' | 'xz' | 'yz' = 'xy'
    ): IMeshData {
        const geometryBuffers = createQuad({
            width,
            height,
            orientation,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public getMesh(id: string): IMeshData | null {
        return this.meshCache.get(id) || null;
    }

    public createCylinderMesh(
        id: string,
        radiusTop: number = 0.5,
        radiusBottom: number = 0.5,
        height: number = 1,
        radialSegments: number = 24,
        heightSegments: number = 1
    ): IMeshData {
        const geometryBuffers = createCylinder({
            radiusTop,
            radiusBottom,
            height,
            radialSegments,
            heightSegments,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createConeMesh(
        id: string,
        radius: number = 0.5,
        height: number = 1,
        radialSegments: number = 24,
        heightSegments: number = 1
    ): IMeshData {
        const geometryBuffers = createCone({
            radius,
            height,
            radialSegments,
            heightSegments,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createCapsuleMesh(
        id: string,
        radius: number = 0.5,
        length: number = 1,
        capSegments: number = 12,
        radialSegments: number = 24
    ): IMeshData {
        const geometryBuffers = createCapsule({
            radius,
            length,
            capSegments,
            radialSegments,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public createTorusMesh(
        id: string,
        radius: number = 0.56,
        tube: number = 0.18,
        radialSegments: number = 20,
        tubularSegments: number = 32
    ): IMeshData {
        const geometryBuffers = createTorus({
            radius,
            tube,
            radialSegments,
            tubularSegments,
            generateNormals: true,
            generateTexCoords: true,
            generateTangents: false,
        });
        return this.createMeshFromGeometry(id, geometryBuffers);
    }

    public renderMesh(mesh: IMeshData): void {
        mesh.vertexBuffer.bind();

        if (mesh.indexBuffer) {
            mesh.indexBuffer.bind();

            const mode = this.getGLTopology(mesh.topology);
            const indexType = this.gl.UNSIGNED_SHORT;
            this.gl.drawElements(mode, mesh.indexCount, indexType, 0);

            mesh.indexBuffer.unbind();
        } else {
            const mode = this.getGLTopology(mesh.topology);
            this.gl.drawArrays(mode, 0, mesh.vertexCount);
        }

        mesh.vertexBuffer.unbind();
    }

    private getGLTopology(topology: string): number {
        switch (topology) {
            case 'triangles':
                return this.gl.TRIANGLES;
            case 'lines':
                return this.gl.LINES;
            case 'points':
                return this.gl.POINTS;
            default:
                return this.gl.TRIANGLES;
        }
    }

    public getStats() {
        return {
            totalMeshes: this.meshCache.size,
            cachedMeshes: Array.from(this.meshCache.keys()),
        };
    }

    public dispose(): void {
        for (const mesh of this.meshCache.values()) {
            mesh.vertexBuffer.dispose();
            mesh.indexBuffer?.dispose();
        }
        this.meshCache.clear();
    }
}
