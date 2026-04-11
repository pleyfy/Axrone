import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, IBoxConfig } from './types';

const DEFAULT_BOX_CONFIG: Required<IBoxConfig> = {
    width: 1,
    height: 1,
    depth: 1,
    widthSegments: 1,
    heightSegments: 1,
    depthSegments: 1,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403,
} as const;

export const createBox = (config: Partial<IBoxConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_BOX_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateBoxGeometry(builder, finalConfig);
};

export const createCube = (
    config: Omit<Partial<IBoxConfig>, 'width' | 'height' | 'depth'> = {}
): IGeometryBuffers => {
    return createBox({ ...config, width: 1, height: 1, depth: 1 });
};

export const createRoundedBox = (
    config: Partial<IBoxConfig & { radius?: number; smoothness?: number }> = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_BOX_CONFIG,
        radius: 0.1,
        smoothness: 8,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateRoundedBoxGeometry(builder, finalConfig);
};

const generateBoxGeometry = (
    builder: GeometryBuilder,
    config: Required<IBoxConfig>
): IGeometryBuffers => {
    const { width, height, depth, widthSegments, heightSegments, depthSegments } = config;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const halfDepth = depth * 0.5;

    let groupStart = 0;

    groupStart = buildPlane(
        'z',
        'y',
        'x',
        -1,
        -1,
        depth,
        height,
        halfWidth,
        depthSegments,
        heightSegments,
        groupStart
    );

    groupStart = buildPlane(
        'z',
        'y',
        'x',
        1,
        -1,
        depth,
        height,
        -halfWidth,
        depthSegments,
        heightSegments,
        groupStart
    );

    groupStart = buildPlane(
        'x',
        'z',
        'y',
        1,
        1,
        width,
        depth,
        halfHeight,
        widthSegments,
        depthSegments,
        groupStart
    );

    groupStart = buildPlane(
        'x',
        'z',
        'y',
        1,
        -1,
        width,
        depth,
        -halfHeight,
        widthSegments,
        depthSegments,
        groupStart
    );

    groupStart = buildPlane(
        'x',
        'y',
        'z',
        1,
        -1,
        width,
        height,
        halfDepth,
        widthSegments,
        heightSegments,
        groupStart
    );

    buildPlane(
        'x',
        'y',
        'z',
        -1,
        -1,
        width,
        height,
        -halfDepth,
        widthSegments,
        heightSegments,
        groupStart
    );

    function buildPlane(
        u: 'x' | 'y' | 'z',
        v: 'x' | 'y' | 'z',
        w: 'x' | 'y' | 'z',
        udir: number,
        vdir: number,
        width: number,
        height: number,
        depth: number,
        gridX: number,
        gridY: number,
        vertexOffset: number
    ): number {
        const segmentWidth = width / gridX;
        const segmentHeight = height / gridY;
        const widthHalf = width * 0.5;
        const heightHalf = height * 0.5;

        const gridX1 = gridX + 1;
        const gridY1 = gridY + 1;

        let vertexCounter = 0;
        const position = Vec3.ZERO.clone();
        const normal = Vec3.ZERO.clone();

        for (let iy = 0; iy < gridY1; iy++) {
            const y = iy * segmentHeight - heightHalf;

            for (let ix = 0; ix < gridX1; ix++) {
                const x = ix * segmentWidth - widthHalf;

                position[u] = x * udir;
                position[v] = y * vdir;
                position[w] = depth;

                normal[u] = 0;
                normal[v] = 0;
                normal[w] = depth > 0 ? 1 : -1;

                const texCoord = config.generateTexCoords
                    ? {
                          u: ix / gridX,
                          v: 1 - iy / gridY,
                      }
                    : undefined;

                builder.addVertex(
                    position.clone(),
                    config.generateNormals ? normal.clone() : undefined,
                    texCoord
                );
                vertexCounter++;
            }
        }

        for (let iy = 0; iy < gridY; iy++) {
            for (let ix = 0; ix < gridX; ix++) {
                const a = vertexOffset + ix + gridX1 * iy;
                const b = vertexOffset + ix + gridX1 * (iy + 1);
                const c = vertexOffset + (ix + 1) + gridX1 * (iy + 1);
                const d = vertexOffset + (ix + 1) + gridX1 * iy;

                builder.addQuad(a, b, c, d);
            }
        }

        return vertexOffset + vertexCounter;
    }

    return builder.build();
};

const generateRoundedBoxGeometry = (
    builder: GeometryBuilder,
    config: Required<IBoxConfig & { radius: number; smoothness: number }>
): IGeometryBuffers => {
    const { width, height, depth, radius, smoothness } = config;

    const halfWidth = width * 0.5 - radius;
    const halfHeight = height * 0.5 - radius;
    const halfDepth = depth * 0.5 - radius;

    const corners: Vec3[] = [
        Vec3.create(-halfWidth, -halfHeight, -halfDepth),
        Vec3.create(halfWidth, -halfHeight, -halfDepth),
        Vec3.create(halfWidth, halfHeight, -halfDepth),
        Vec3.create(-halfWidth, halfHeight, -halfDepth),
        Vec3.create(-halfWidth, -halfHeight, halfDepth),
        Vec3.create(halfWidth, -halfHeight, halfDepth),
        Vec3.create(halfWidth, halfHeight, halfDepth),
        Vec3.create(-halfWidth, halfHeight, halfDepth),
    ];

    for (let i = 0; i < corners.length; i++) {
        generateCornerSphere(corners[i], radius, smoothness);
    }

    generateEdgeCylinders(corners, radius, smoothness);

    generateFacePlanes(corners, radius);

    function generateCornerSphere(center: Vec3, radius: number, segments: number): void {
        const startVertex = builder.vertexCount;

        const xSign = Math.sign(center.x || 1);
        const ySign = Math.sign(center.y || 1);
        const zSign = Math.sign(center.z || 1);

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 0.5;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            for (let j = 0; j <= segments; j++) {
                const phi = (j / segments) * Math.PI * 0.5;
                const cosPhi = Math.cos(phi);
                const sinPhi = Math.sin(phi);

                const x = center.x + radius * sinTheta * cosPhi * xSign;
                const y = center.y + radius * cosTheta * ySign;
                const z = center.z + radius * sinTheta * sinPhi * zSign;

                const position = Vec3.create(x, y, z);
                const normal = config.generateNormals
                    ? Vec3.normalize(Vec3.subtract(position, center))
                    : undefined;
                const texCoord = config.generateTexCoords
                    ? { u: j / segments, v: i / segments }
                    : undefined;

                builder.addVertex(position, normal, texCoord);
            }
        }

        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < segments; j++) {
                const a = startVertex + i * (segments + 1) + j;
                const b = startVertex + (i + 1) * (segments + 1) + j;
                const c = startVertex + (i + 1) * (segments + 1) + j + 1;
                const d = startVertex + i * (segments + 1) + j + 1;

                builder.addQuad(a, b, c, d);
            }
        }
    }

    function generateEdgeCylinders(corners: Vec3[], radius: number, segments: number): void {
        const edges = [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7],
        ];

        for (const [startIdx, endIdx] of edges) {
            const start = corners[startIdx];
            const end = corners[endIdx];
            const diff = Vec3.subtract(end, start, new Vec3());
            const direction = Vec3.normalize(diff, new Vec3());
            const length = Vec3.len(diff);

            generateEdgeCylinder(start, direction, length, radius, segments);
        }
    }

    function generateEdgeCylinder(
        start: Vec3,
        direction: Vec3,
        length: number,
        radius: number,
        segments: number
    ): void {
        const startVertex = builder.vertexCount;

        for (let i = 0; i <= 1; i++) {
            const t = i;
            const center = Vec3.add(start, Vec3.multiplyScalar(direction, t * length));

            for (let j = 0; j <= segments; j++) {
                const angle = (j / segments) * Math.PI * 2;
                const x = center.x + radius * Math.cos(angle);
                const z = center.z + radius * Math.sin(angle);

                const position = Vec3.create(x, center.y, z);
                const normal = config.generateNormals
                    ? Vec3.normalize(Vec3.subtract(position, center))
                    : undefined;
                const texCoord = config.generateTexCoords ? { u: j / segments, v: t } : undefined;

                builder.addVertex(position, normal, texCoord);
            }
        }

        for (let j = 0; j < segments; j++) {
            const a = startVertex + j;
            const b = startVertex + j + 1;
            const c = startVertex + j + segments + 2;
            const d = startVertex + j + segments + 1;

            builder.addQuad(a, b, c, d);
        }
    }

    function generateFacePlanes(corners: Vec3[], radius: number): void {
        const faces = [
            {
                corners: [corners[4], corners[5], corners[6], corners[7]],
                normal: Vec3.create(0, 0, 1),
                offset: halfDepth + radius,
            },

            {
                corners: [corners[1], corners[0], corners[3], corners[2]],
                normal: Vec3.create(0, 0, -1),
                offset: -halfDepth - radius,
            },

            {
                corners: [corners[1], corners[5], corners[6], corners[2]],
                normal: Vec3.create(1, 0, 0),
                offset: halfWidth + radius,
            },

            {
                corners: [corners[0], corners[4], corners[7], corners[3]],
                normal: Vec3.create(-1, 0, 0),
                offset: -halfWidth - radius,
            },

            {
                corners: [corners[3], corners[2], corners[6], corners[7]],
                normal: Vec3.create(0, 1, 0),
                offset: halfHeight + radius,
            },

            {
                corners: [corners[0], corners[1], corners[5], corners[4]],
                normal: Vec3.create(0, -1, 0),
                offset: -halfHeight - radius,
            },
        ];

        for (const face of faces) {
            const startVertex = builder.vertexCount;

            for (let i = 0; i < 4; i++) {
                const corner = face.corners[i];
                const position = Vec3.add(corner, Vec3.multiplyScalar(face.normal, radius));

                const normal = config.generateNormals ? face.normal.clone() : undefined;
                const texCoord = config.generateTexCoords
                    ? {
                          u: i % 2,
                          v: Math.floor(i / 2),
                      }
                    : undefined;

                builder.addVertex(position, normal, texCoord);
            }

            builder.addQuad(startVertex, startVertex + 1, startVertex + 2, startVertex + 3);
        }
    }

    return builder.build();
};
