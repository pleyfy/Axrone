import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, ISphereConfig } from './types';

const DEFAULT_SPHERE_CONFIG: Required<ISphereConfig> = {
    radius: 1,
    widthSegments: 32,
    heightSegments: 16,
    phiStart: 0,
    phiLength: Math.PI * 2,
    thetaStart: 0,
    thetaLength: Math.PI,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403, // GLAttributeType.UNSIGNED_SHORT
} as const;

export const createSphere = (config: Partial<ISphereConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_SPHERE_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateSphereGeometry(builder, finalConfig);
};

export const createUVSphere = (config: Partial<ISphereConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_SPHERE_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateUVSphereGeometry(builder, finalConfig);
};

export const createIcosphere = (
    config: Partial<
        Omit<ISphereConfig, 'widthSegments' | 'heightSegments'> & { subdivisions?: number }
    > = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_SPHERE_CONFIG,
        subdivisions: 2,
        ...config,
    };

    const builder = GeometryBuilder.create(finalConfig);
    return generateIcosphereGeometry(builder, finalConfig);
};

const generateSphereGeometry = (
    builder: GeometryBuilder,
    config: Required<ISphereConfig>
): IGeometryBuffers => {
    const { radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength } =
        config;

    const widthStep = 1 / widthSegments;
    const heightStep = 1 / heightSegments;

    const cosPhiLUT = new Float32Array(widthSegments + 1);
    const sinPhiLUT = new Float32Array(widthSegments + 1);
    const cosThetaLUT = new Float32Array(heightSegments + 1);
    const sinThetaLUT = new Float32Array(heightSegments + 1);

    for (let i = 0; i <= widthSegments; i++) {
        const phi = phiStart + i * widthStep * phiLength;
        cosPhiLUT[i] = Math.cos(phi);
        sinPhiLUT[i] = Math.sin(phi);
    }

    for (let i = 0; i <= heightSegments; i++) {
        const theta = thetaStart + i * heightStep * thetaLength;
        cosThetaLUT[i] = Math.cos(theta);
        sinThetaLUT[i] = Math.sin(theta);
    }

    for (let iy = 0; iy <= heightSegments; iy++) {
        const v = iy * heightStep;
        const cosTheta = cosThetaLUT[iy];
        const sinTheta = sinThetaLUT[iy];

        const uOffset = iy === 0 || iy === heightSegments ? 0.5 / widthSegments : 0;
        const uScale = iy === 0 || iy === heightSegments ? 0.5 : 1;

        for (let ix = 0; ix <= widthSegments; ix++) {
            const u = ix * widthStep;
            const cosPhi = cosPhiLUT[ix];
            const sinPhi = sinPhiLUT[ix];

            const x = -radius * sinTheta * cosPhi;
            const y = radius * cosTheta;
            const z = radius * sinTheta * sinPhi;

            const position = Vec3.create(x, y, z);

            const normal = config.generateNormals
                ? Vec3.create(x / radius, y / radius, z / radius)
                : undefined;

            const texCoord = config.generateTexCoords
                ? { u: u * uScale + uOffset, v: 1 - v }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let iy = 0; iy < heightSegments; iy++) {
        for (let ix = 0; ix < widthSegments; ix++) {
            const stride = widthSegments + 1;
            const a = (iy + 1) * stride + ix;
            const b = (iy + 1) * stride + ix + 1;
            const c = iy * stride + ix + 1;
            const d = iy * stride + ix;

            if (iy !== 0) builder.addTriangle(a, b, d);
            if (iy !== heightSegments - 1) builder.addTriangle(b, c, d);
        }
    }

    return builder.build();
};

const generateUVSphereGeometry = (
    builder: GeometryBuilder,
    config: Required<ISphereConfig>
): IGeometryBuffers => {
    const { radius, widthSegments, heightSegments } = config;

    builder.addVertex(
        Vec3.create(0, radius, 0),
        config.generateNormals ? Vec3.create(0, 1, 0) : undefined,
        config.generateTexCoords ? { u: 0.5, v: 0 } : undefined
    );

    for (let lat = 1; lat < heightSegments; lat++) {
        const theta = (lat * Math.PI) / heightSegments;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const y = radius * cosTheta;
        const ringRadius = radius * sinTheta;

        for (let lon = 0; lon < widthSegments; lon++) {
            const phi = (lon * 2 * Math.PI) / widthSegments;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = ringRadius * cosPhi;
            const z = ringRadius * sinPhi;

            const position = Vec3.create(x, y, z);
            const normal = config.generateNormals
                ? Vec3.create(x / radius, y / radius, z / radius)
                : undefined;
            const texCoord = config.generateTexCoords
                ? { u: lon / widthSegments, v: lat / heightSegments }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    builder.addVertex(
        Vec3.create(0, -radius, 0),
        config.generateNormals ? Vec3.create(0, -1, 0) : undefined,
        config.generateTexCoords ? { u: 0.5, v: 1 } : undefined
    );

    for (let i = 0; i < widthSegments; i++) {
        const next = (i + 1) % widthSegments;
        builder.addTriangle(0, i + 1, next + 1);
    }

    for (let lat = 0; lat < heightSegments - 2; lat++) {
        for (let lon = 0; lon < widthSegments; lon++) {
            const current = lat * widthSegments + lon + 1;
            const next = lat * widthSegments + ((lon + 1) % widthSegments) + 1;
            const below = (lat + 1) * widthSegments + lon + 1;
            const belowNext = (lat + 1) * widthSegments + ((lon + 1) % widthSegments) + 1;

            builder.addQuad(current, next, belowNext, below);
        }
    }

    const bottomVertex = builder.vertexCount - 1;
    const lastRingStart = (heightSegments - 2) * widthSegments + 1;

    for (let i = 0; i < widthSegments; i++) {
        const current = lastRingStart + i;
        const next = lastRingStart + ((i + 1) % widthSegments);
        builder.addTriangle(bottomVertex, next, current);
    }

    return builder.build();
};

const generateIcosphereGeometry = (
    builder: GeometryBuilder,
    config: Required<ISphereConfig & { subdivisions: number }>
): IGeometryBuffers => {
    const { radius, subdivisions } = config;

    const phi = (1 + Math.sqrt(5)) / 2;
    const invPhi = 1 / phi;

    const vertices = [
        Vec3.create(-invPhi, phi, 0),
        Vec3.create(invPhi, phi, 0),
        Vec3.create(-invPhi, -phi, 0),
        Vec3.create(invPhi, -phi, 0),
        Vec3.create(0, -invPhi, phi),
        Vec3.create(0, invPhi, phi),
        Vec3.create(0, -invPhi, -phi),
        Vec3.create(0, invPhi, -phi),
        Vec3.create(phi, 0, -invPhi),
        Vec3.create(phi, 0, invPhi),
        Vec3.create(-phi, 0, -invPhi),
        Vec3.create(-phi, 0, invPhi),
    ];

    for (const vertex of vertices) {
        Vec3.normalize(vertex, vertex);
        Vec3.multiplyScalar(vertex, radius, vertex);

        const normal = config.generateNormals ? Vec3.normalize(vertex.clone()) : undefined;

        const texCoord = config.generateTexCoords
            ? {
                  u: 0.5 + Math.atan2(vertex.z, vertex.x) / (2 * Math.PI),
                  v: 0.5 - Math.asin(vertex.y / radius) / Math.PI,
              }
            : undefined;

        builder.addVertex(vertex, normal, texCoord);
    }

    const faces = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
    ];

    for (const face of faces) {
        builder.addTriangle(face[0], face[1], face[2]);
    }

    if (subdivisions > 0) {
        const midpointCache = new Map<string, number>();

        for (let level = 0; level < subdivisions; level++) {
            const newFaces: number[][] = [];

            for (const face of faces) {
                const a = face[0],
                    b = face[1],
                    c = face[2];
                const ab = getMidpoint(a, b, midpointCache, builder, radius, config);
                const bc = getMidpoint(b, c, midpointCache, builder, radius, config);
                const ca = getMidpoint(c, a, midpointCache, builder, radius, config);

                newFaces.push([a, ab, ca]);
                newFaces.push([b, bc, ab]);
                newFaces.push([c, ca, bc]);
                newFaces.push([ab, bc, ca]);
            }

            faces.length = 0;
            faces.push(...newFaces);
        }

        builder.clear();

        for (const vertex of vertices) {
            Vec3.normalize(vertex, vertex);
            Vec3.multiplyScalar(vertex, radius, vertex);

            const normal = config.generateNormals ? Vec3.normalize(vertex.clone()) : undefined;

            const texCoord = config.generateTexCoords
                ? {
                      u: 0.5 + Math.atan2(vertex.z, vertex.x) / (2 * Math.PI),
                      v: 0.5 - Math.asin(vertex.y / radius) / Math.PI,
                  }
                : undefined;

            builder.addVertex(vertex, normal, texCoord);
        }

        for (const face of faces) {
            builder.addTriangle(face[0], face[1], face[2]);
        }
    }

    return builder.build();
};

const getMidpoint = (
    i1: number,
    i2: number,
    cache: Map<string, number>,
    builder: GeometryBuilder,
    radius: number,
    config: Required<ISphereConfig>
): number => {
    const key = i1 < i2 ? `${i1}-${i2}` : `${i2}-${i1}`;

    if (cache.has(key)) {
        return cache.get(key)!;
    }

    const midIndex = builder.vertexCount;

    const position = Vec3.ZERO.clone();
    const normal = config.generateNormals ? Vec3.ZERO.clone() : undefined;
    const texCoord = config.generateTexCoords ? { u: 0, v: 0 } : undefined;

    builder.addVertex(position, normal, texCoord);
    cache.set(key, midIndex);

    return midIndex;
};
