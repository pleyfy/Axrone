import type { BoundingSphere } from '@axrone/geometry';
import type { SceneMeshDefinition } from './types';

const FLOAT_COMPONENT_TYPE = 0x1406;

const cloneCenter = (center: Readonly<BoundingSphere>['center']): readonly [number, number, number] =>
    Array.isArray(center) ? [center[0], center[1], center[2]] : [center.x, center.y, center.z];

export const cloneSceneMeshBounds = (
    bounds: Readonly<BoundingSphere> | undefined
): BoundingSphere | undefined => {
    if (!bounds) {
        return undefined;
    }

    return {
        kind: 'sphere',
        center: cloneCenter(bounds.center),
        radius: bounds.radius,
    };
};

export const resolveSceneMeshBounds = (
    definition: Readonly<SceneMeshDefinition>
): BoundingSphere | undefined => {
    if (definition.bounds?.kind === 'sphere') {
        return cloneSceneMeshBounds(definition.bounds);
    }

    const positionAttribute = definition.attributes.find(
        (attribute) =>
            attribute.semantic === 'position' &&
            attribute.componentCount >= 3 &&
            (attribute.type === undefined || attribute.type === FLOAT_COMPONENT_TYPE)
    );

    if (!positionAttribute) {
        return undefined;
    }

    const source = definition.vertices;
    const byteOffset = ArrayBuffer.isView(source) ? source.byteOffset : 0;
    const byteLength = ArrayBuffer.isView(source) ? source.byteLength : source.byteLength;
    const vertexStride = Math.max(positionAttribute.stride, positionAttribute.componentCount * 4);
    const vertexCount = definition.vertexCount ?? Math.floor(byteLength / vertexStride);

    if (vertexCount <= 0 || positionAttribute.offset + 12 > vertexStride) {
        return undefined;
    }

    const dataView = new DataView(
        ArrayBuffer.isView(source) ? source.buffer : source,
        byteOffset,
        byteLength
    );

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const positionOffset = vertexIndex * vertexStride + positionAttribute.offset;
        if (positionOffset + 12 > byteLength) {
            return undefined;
        }

        const x = dataView.getFloat32(positionOffset, true);
        const y = dataView.getFloat32(positionOffset + 4, true);
        const z = dataView.getFloat32(positionOffset + 8, true);

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const radius = Math.hypot(maxX - centerX, maxY - centerY, maxZ - centerZ);

    return {
        kind: 'sphere',
        center: [centerX, centerY, centerZ],
        radius,
    };
};