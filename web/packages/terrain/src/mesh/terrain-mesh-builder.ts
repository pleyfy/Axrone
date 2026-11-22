import { EPSILON } from '@axrone/numeric';
import type { TerrainDescriptor, TerrainMeshData } from '../types';
import { validateTerrainDescriptor } from '../types';
import { TerrainError, TerrainErrorCode } from '../errors';
import type { TerrainHeightmap } from '../heightmap/terrain-heightmap';

/**
 * Builds an origin-centered grid mesh from a normalized heightmap. Vertex Y
 * values are scaled by `descriptor.maxHeight`; normals are derived with
 * central differences over the world-space grid. Triangles wind
 * counter-clockwise when viewed from +Y.
 */
export const buildTerrainMesh = (
    heightmap: TerrainHeightmap,
    descriptor: TerrainDescriptor
): TerrainMeshData => {
    validateTerrainDescriptor(descriptor);

    const resolution = descriptor.resolution;
    if (heightmap.resolution !== resolution) {
        throw new TerrainError(
            `Heightmap resolution ${heightmap.resolution} does not match descriptor resolution ${resolution}.`,
            TerrainErrorCode.HEIGHTMAP_SIZE_MISMATCH,
            { heightmapResolution: heightmap.resolution, descriptorResolution: resolution }
        );
    }

    const { width, length, maxHeight } = descriptor;
    const heights = heightmap.heights;
    const vertexCount = resolution * resolution;
    const cellCount = (resolution - 1) * (resolution - 1);
    const triangleCount = cellCount * 2;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: Uint16Array | Uint32Array = vertexCount <= 65536
        ? new Uint16Array(triangleCount * 3)
        : new Uint32Array(triangleCount * 3);

    const stepX = width / (resolution - 1);
    const stepZ = length / (resolution - 1);
    const lastIndex = resolution - 1;

    for (let gridZ = 0; gridZ < resolution; gridZ += 1) {
        const v = gridZ / lastIndex;
        const worldZ = (v - 0.5) * length;

        for (let gridX = 0; gridX < resolution; gridX += 1) {
            const u = gridX / lastIndex;
            const vertexIndex = gridZ * resolution + gridX;
            const positionOffset = vertexIndex * 3;

            positions[positionOffset] = (u - 0.5) * width;
            positions[positionOffset + 1] = heights[vertexIndex]! * maxHeight;
            positions[positionOffset + 2] = worldZ;

            uvs[vertexIndex * 2] = u;
            uvs[vertexIndex * 2 + 1] = v;

            // Central differences with edge clamping, in world units.
            const leftX = gridX > 0 ? gridX - 1 : 0;
            const rightX = gridX < lastIndex ? gridX + 1 : lastIndex;
            const nearZ = gridZ > 0 ? gridZ - 1 : 0;
            const farZ = gridZ < lastIndex ? gridZ + 1 : lastIndex;

            const slopeX =
                ((heights[gridZ * resolution + rightX]! - heights[gridZ * resolution + leftX]!) *
                    maxHeight) /
                ((rightX - leftX) * stepX);
            const slopeZ =
                ((heights[farZ * resolution + gridX]! - heights[nearZ * resolution + gridX]!) *
                    maxHeight) /
                ((farZ - nearZ) * stepZ);

            const inverseMagnitude =
                1 / Math.max(Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ), EPSILON);
            normals[positionOffset] = -slopeX * inverseMagnitude;
            normals[positionOffset + 1] = inverseMagnitude;
            normals[positionOffset + 2] = -slopeZ * inverseMagnitude;
        }
    }

    let indexOffset = 0;
    for (let cellZ = 0; cellZ < lastIndex; cellZ += 1) {
        for (let cellX = 0; cellX < lastIndex; cellX += 1) {
            const topLeft = cellZ * resolution + cellX;
            const topRight = topLeft + 1;
            const bottomLeft = topLeft + resolution;
            const bottomRight = bottomLeft + 1;

            indices[indexOffset] = topLeft;
            indices[indexOffset + 1] = bottomLeft;
            indices[indexOffset + 2] = topRight;
            indices[indexOffset + 3] = topRight;
            indices[indexOffset + 4] = bottomLeft;
            indices[indexOffset + 5] = bottomRight;
            indexOffset += 6;
        }
    }

    return Object.freeze({
        positions,
        normals,
        uvs,
        indices,
        vertexCount,
        triangleCount,
    });
};
