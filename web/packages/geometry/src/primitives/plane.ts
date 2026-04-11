import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, IPlaneConfig } from './types';

const DEFAULT_PLANE_CONFIG: Required<IPlaneConfig> = {
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403, // GLAttributeType.UNSIGNED_SHORT
} as const;

export const createPlane = (config: Partial<IPlaneConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_PLANE_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generatePlaneGeometry(builder, finalConfig);
};

export const createQuad = (
    config: Partial<IPlaneConfig> & { orientation?: 'xy' | 'xz' | 'yz' } = {}
): IGeometryBuffers => {
    const { orientation = 'xy', ...rest } = config;
    const finalConfig = { ...DEFAULT_PLANE_CONFIG, ...rest };
    const builder = GeometryBuilder.create(finalConfig);
    return generateQuadGeometry(builder, finalConfig, orientation);
};

export const createCircle = (
    config: Omit<Partial<IPlaneConfig>, 'width' | 'height' | 'widthSegments' | 'heightSegments'> & {
        radius?: number;
        segments?: number;
    } = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_PLANE_CONFIG,
        radius: 1,
        segments: 32,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateCircleGeometry(builder, finalConfig);
};

export const createRing = (
    config: Omit<Partial<IPlaneConfig>, 'width' | 'height' | 'widthSegments' | 'heightSegments'> & {
        innerRadius?: number;
        outerRadius?: number;
        segments?: number;
    } = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_PLANE_CONFIG,
        innerRadius: 0.5,
        outerRadius: 1,
        segments: 32,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateRingGeometry(builder, finalConfig);
};

export const createGrid = (
    config: Partial<IPlaneConfig> & { showLines?: boolean } = {}
): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_PLANE_CONFIG, showLines: false, ...config };

    if (finalConfig.showLines) {
        const builder = GeometryBuilder.create(finalConfig);
        return generateWireframeGrid(builder, finalConfig);
    }

    return createPlane(finalConfig);
};

const generatePlaneGeometry = (
    builder: GeometryBuilder,
    config: Required<IPlaneConfig>
): IGeometryBuffers => {
    const { width, height, widthSegments, heightSegments } = config;

    const widthHalf = width / 2;
    const heightHalf = height / 2;

    const gridX = widthSegments;
    const gridY = heightSegments;

    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;

    const segmentWidth = width / gridX;
    const segmentHeight = height / gridY;

    for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;

        for (let ix = 0; ix < gridX1; ix++) {
            const x = ix * segmentWidth - widthHalf;

            const position = Vec3.create(x, 0, -y);
            const normal = config.generateNormals ? Vec3.create(0, 1, 0) : undefined;
            const texCoord = config.generateTexCoords
                ? { u: ix / gridX, v: 1 - iy / gridY }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
            const a = ix + gridX1 * iy;
            const b = ix + gridX1 * (iy + 1);
            const c = ix + 1 + gridX1 * (iy + 1);
            const d = ix + 1 + gridX1 * iy;

            builder.addQuad(a, b, c, d);
        }
    }

    return builder.build();
};

const generateQuadGeometry = (
    builder: GeometryBuilder,
    config: Required<IPlaneConfig>,
    orientation: 'xy' | 'xz' | 'yz'
): IGeometryBuffers => {
    const { width, height } = config;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    let positions: Vec3[];
    let normal: Vec3;

    switch (orientation) {
        case 'xy':
            positions = [
                Vec3.create(-halfWidth, -halfHeight, 0),
                Vec3.create(halfWidth, -halfHeight, 0),
                Vec3.create(halfWidth, halfHeight, 0),
                Vec3.create(-halfWidth, halfHeight, 0),
            ];
            normal = Vec3.create(0, 0, 1);
            break;
        case 'xz':
            positions = [
                Vec3.create(-halfWidth, 0, -halfHeight),
                Vec3.create(halfWidth, 0, -halfHeight),
                Vec3.create(halfWidth, 0, halfHeight),
                Vec3.create(-halfWidth, 0, halfHeight),
            ];
            normal = Vec3.create(0, 1, 0);
            break;
        case 'yz':
            positions = [
                Vec3.create(0, -halfHeight, -halfWidth),
                Vec3.create(0, -halfHeight, halfWidth),
                Vec3.create(0, halfHeight, halfWidth),
                Vec3.create(0, halfHeight, -halfWidth),
            ];
            normal = Vec3.create(1, 0, 0);
            break;
    }

    const texCoords = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
    ];

    for (let i = 0; i < 4; i++) {
        builder.addVertex(
            positions[i],
            config.generateNormals ? normal : undefined,
            config.generateTexCoords ? texCoords[i] : undefined
        );
    }

    builder.addTriangle(0, 1, 2);
    builder.addTriangle(0, 2, 3);

    return builder.build();
};

const generateCircleGeometry = (
    builder: GeometryBuilder,
    config: Required<IPlaneConfig & { radius: number; segments: number }>
): IGeometryBuffers => {
    const { radius, segments } = config;

    builder.addVertex(
        Vec3.ZERO,
        config.generateNormals ? Vec3.create(0, 1, 0) : undefined,
        config.generateTexCoords ? { u: 0.5, v: 0.5 } : undefined
    );

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const x = radius * Math.cos(theta);
        const z = radius * Math.sin(theta);

        const position = Vec3.create(x, 0, z);
        const normal = config.generateNormals ? Vec3.create(0, 1, 0) : undefined;
        const texCoord = config.generateTexCoords
            ? {
                  u: Math.cos(theta) * 0.5 + 0.5,
                  v: Math.sin(theta) * 0.5 + 0.5,
              }
            : undefined;

        builder.addVertex(position, normal, texCoord);
    }

    for (let i = 0; i < segments; i++) {
        builder.addTriangle(0, i + 1, i + 2);
    }

    return builder.build();
};

const generateRingGeometry = (
    builder: GeometryBuilder,
    config: Required<IPlaneConfig & { innerRadius: number; outerRadius: number; segments: number }>
): IGeometryBuffers => {
    const { innerRadius, outerRadius, segments } = config;

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        const innerX = innerRadius * cosTheta;
        const innerZ = innerRadius * sinTheta;
        const innerPosition = Vec3.create(innerX, 0, innerZ);
        const innerTexCoord = config.generateTexCoords
            ? {
                  u: cosTheta * 0.25 + 0.5,
                  v: sinTheta * 0.25 + 0.5,
              }
            : undefined;
        builder.addVertex(
            innerPosition,
            config.generateNormals ? Vec3.create(0, 1, 0) : undefined,
            innerTexCoord
        );

        const outerX = outerRadius * cosTheta;
        const outerZ = outerRadius * sinTheta;
        const outerPosition = Vec3.create(outerX, 0, outerZ);
        const outerTexCoord = config.generateTexCoords
            ? {
                  u: cosTheta * 0.5 + 0.5,
                  v: sinTheta * 0.5 + 0.5,
              }
            : undefined;
        builder.addVertex(
            outerPosition,
            config.generateNormals ? Vec3.create(0, 1, 0) : undefined,
            outerTexCoord
        );
    }

    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2 + 1;
        const d = (i + 1) * 2;

        builder.addQuad(a, b, c, d);
    }

    return builder.build();
};

const generateWireframeGrid = (
    builder: GeometryBuilder,
    config: Required<IPlaneConfig & { showLines: boolean }>
): IGeometryBuffers => {
    const { width, height, widthSegments, heightSegments } = config;

    const widthHalf = width / 2;
    const heightHalf = height / 2;
    const segmentWidth = width / widthSegments;
    const segmentHeight = height / heightSegments;

    for (let i = 0; i <= heightSegments; i++) {
        const y = i * segmentHeight - heightHalf;

        const startPos = Vec3.create(-widthHalf, 0, -y);
        const endPos = Vec3.create(widthHalf, 0, -y);
        const normal = config.generateNormals ? Vec3.create(0, 1, 0) : undefined;

        const startIndex = builder.addVertex(
            startPos,
            normal,
            config.generateTexCoords ? { u: 0, v: i / heightSegments } : undefined
        );
        const endIndex = builder.addVertex(
            endPos,
            normal,
            config.generateTexCoords ? { u: 1, v: i / heightSegments } : undefined
        );

        builder.addTriangle(startIndex, endIndex, startIndex);
    }

    for (let i = 0; i <= widthSegments; i++) {
        const x = i * segmentWidth - widthHalf;

        const startPos = Vec3.create(x, 0, heightHalf);
        const endPos = Vec3.create(x, 0, -heightHalf);
        const normal = config.generateNormals ? Vec3.create(0, 1, 0) : undefined;

        const startIndex = builder.addVertex(
            startPos,
            normal,
            config.generateTexCoords ? { u: i / widthSegments, v: 0 } : undefined
        );
        const endIndex = builder.addVertex(
            endPos,
            normal,
            config.generateTexCoords ? { u: i / widthSegments, v: 1 } : undefined
        );

        builder.addTriangle(startIndex, endIndex, startIndex);
    }

    return builder.build();
};
