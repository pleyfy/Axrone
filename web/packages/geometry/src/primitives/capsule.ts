import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, ICapsuleConfig } from './types';

const DEFAULT_CAPSULE_CONFIG: Required<ICapsuleConfig> = {
    radius: 0.5,
    length: 1,
    capSegments: 8,
    radialSegments: 16,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403, // GLAttributeType.UNSIGNED_SHORT
} as const;

export const createCapsule = (config: Partial<ICapsuleConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_CAPSULE_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateCapsuleGeometry(builder, finalConfig);
};

export const createPill = (config: Partial<ICapsuleConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_CAPSULE_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generatePillGeometry(builder, finalConfig);
};

const generateCapsuleGeometry = (
    builder: GeometryBuilder,
    config: Required<ICapsuleConfig>
): IGeometryBuffers => {
    const { radius, length, capSegments, radialSegments } = config;
    const halfLength = length * 0.5;

    generateCylinderBody(builder, radius, length, radialSegments, config);
    generateHemisphere(
        builder,
        Vec3.create(0, halfLength, 0),
        radius,
        capSegments,
        radialSegments,
        true,
        config
    );
    generateHemisphere(
        builder,
        Vec3.create(0, -halfLength, 0),
        radius,
        capSegments,
        radialSegments,
        false,
        config
    );

    return builder.build();
};

const generateCylinderBody = (
    builder: GeometryBuilder,
    radius: number,
    length: number,
    radialSegments: number,
    config: Required<ICapsuleConfig>
): void => {
    const halfLength = length * 0.5;
    const startVertex = builder.vertexCount;

    for (let i = 0; i <= 1; i++) {
        const y = i === 0 ? -halfLength : halfLength;
        const v = i;

        for (let j = 0; j <= radialSegments; j++) {
            const theta = (j / radialSegments) * Math.PI * 2;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const x = radius * cosTheta;
            const z = radius * sinTheta;

            const position = Vec3.create(x, y, z);
            const normal = config.generateNormals ? Vec3.create(cosTheta, 0, sinTheta) : undefined;
            const texCoord = config.generateTexCoords ? { u: j / radialSegments, v } : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let j = 0; j < radialSegments; j++) {
        const a = startVertex + j;
        const b = startVertex + j + 1;
        const c = startVertex + j + radialSegments + 1;
        const d = startVertex + j + radialSegments + 2;

        builder.addQuad(a, b, d, c);
    }
};

const generateHemisphere = (
    builder: GeometryBuilder,
    center: Vec3,
    radius: number,
    capSegments: number,
    radialSegments: number,
    isTop: boolean,
    config: Required<ICapsuleConfig>
): void => {
    const startVertex = builder.vertexCount;

    const centerNormal = config.generateNormals ? Vec3.create(0, isTop ? 1 : -1, 0) : undefined;
    const centerTexCoord = config.generateTexCoords ? { u: 0.5, v: isTop ? 0 : 1 } : undefined;

    builder.addVertex(center, centerNormal, centerTexCoord);

    for (let i = 1; i <= capSegments; i++) {
        const phi = (i / capSegments) * Math.PI * 0.5;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const y = center.y + radius * cosPhi * (isTop ? 1 : -1);
        const ringRadius = radius * sinPhi;

        for (let j = 0; j <= radialSegments; j++) {
            const theta = (j / radialSegments) * Math.PI * 2;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const x = center.x + ringRadius * cosTheta;
            const z = center.z + ringRadius * sinTheta;

            const position = Vec3.create(x, y, z);
            const normal = config.generateNormals
                ? Vec3.normalize(Vec3.subtract(position, center))
                : undefined;
            const texCoord = config.generateTexCoords
                ? {
                      u: j / radialSegments,
                      v: isTop ? i / capSegments : 1 - i / capSegments,
                  }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let j = 0; j < radialSegments; j++) {
        const center = startVertex;
        const a = startVertex + 1 + j;
        const b = startVertex + 1 + j + 1;

        if (isTop) {
            builder.addTriangle(center, a, b);
        } else {
            builder.addTriangle(center, b, a);
        }
    }

    for (let i = 0; i < capSegments - 1; i++) {
        for (let j = 0; j < radialSegments; j++) {
            const a = startVertex + 1 + i * (radialSegments + 1) + j;
            const b = startVertex + 1 + i * (radialSegments + 1) + j + 1;
            const c = startVertex + 1 + (i + 1) * (radialSegments + 1) + j + 1;
            const d = startVertex + 1 + (i + 1) * (radialSegments + 1) + j;

            if (isTop) {
                builder.addQuad(a, b, c, d);
            } else {
                builder.addQuad(a, d, c, b);
            }
        }
    }
};

const generatePillGeometry = (
    builder: GeometryBuilder,
    config: Required<ICapsuleConfig>
): IGeometryBuffers => {
    const { radius, length, capSegments, radialSegments } = config;
    const totalHeight = length + 2 * radius;
    const cylinderHeight = length;

    const rings = capSegments + 2;

    for (let ring = 0; ring <= rings; ring++) {
        let y: number;
        let ringRadius: number;
        let v: number;

        if (ring <= capSegments / 2) {
            const phi = (ring / (capSegments / 2)) * Math.PI * 0.5;
            y = totalHeight / 2 - radius + radius * Math.cos(phi);
            ringRadius = radius * Math.sin(phi);
            v = ring / rings;
        } else if (ring <= rings - capSegments / 2) {
            const t = (ring - capSegments / 2) / (rings - capSegments);
            y = cylinderHeight / 2 - t * cylinderHeight;
            ringRadius = radius;
            v = ring / rings;
        } else {
            const phi = ((ring - (rings - capSegments / 2)) / (capSegments / 2)) * Math.PI * 0.5;
            y = -(totalHeight / 2) + radius - radius * Math.cos(phi);
            ringRadius = radius * Math.sin(phi);
            v = ring / rings;
        }

        for (let segment = 0; segment <= radialSegments; segment++) {
            const theta = (segment / radialSegments) * Math.PI * 2;
            const x = ringRadius * Math.cos(theta);
            const z = ringRadius * Math.sin(theta);

            const position = Vec3.create(x, y, z);

            let normal: Vec3 | undefined;
            if (config.generateNormals) {
                if (ring <= capSegments / 2 || ring > rings - capSegments / 2) {
                    const center = Vec3.create(
                        0,
                        ring <= capSegments / 2 ? cylinderHeight / 2 : -cylinderHeight / 2,
                        0
                    );
                    normal = Vec3.normalize(Vec3.subtract(position, center), new Vec3());
                } else {
                    normal = Vec3.normalize(Vec3.create(x, 0, z), new Vec3());
                }
            }

            const texCoord = config.generateTexCoords
                ? { u: segment / radialSegments, v }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let ring = 0; ring < rings; ring++) {
        for (let segment = 0; segment < radialSegments; segment++) {
            const a = ring * (radialSegments + 1) + segment;
            const b = ring * (radialSegments + 1) + segment + 1;
            const c = (ring + 1) * (radialSegments + 1) + segment + 1;
            const d = (ring + 1) * (radialSegments + 1) + segment;

            builder.addQuad(a, b, c, d);
        }
    }

    return builder.build();
};
