import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, ICylinderConfig } from './types';

const DEFAULT_CYLINDER_CONFIG: Required<ICylinderConfig> = {
    radiusTop: 1,
    radiusBottom: 1,
    height: 1,
    radialSegments: 32,
    heightSegments: 1,
    openEnded: false,
    thetaStart: 0,
    thetaLength: Math.PI * 2,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403, // GLAttributeType.UNSIGNED_SHORT
} as const;

export const createCylinder = (config: Partial<ICylinderConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_CYLINDER_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateCylinderGeometry(builder, finalConfig);
};

export const createCone = (
    config: Omit<Partial<ICylinderConfig>, 'radiusTop'> & { radius?: number } = {}
): IGeometryBuffers => {
    const { radius = 1, ...rest } = config;
    return createCylinder({
        ...rest,
        radiusTop: 0,
        radiusBottom: radius,
    });
};

export const createTruncatedCone = (
    config: Partial<ICylinderConfig> & { topRadius?: number; bottomRadius?: number } = {}
): IGeometryBuffers => {
    const { topRadius = 0.5, bottomRadius = 1, ...rest } = config;
    return createCylinder({
        ...rest,
        radiusTop: topRadius,
        radiusBottom: bottomRadius,
    });
};

export const createTube = (
    config: Partial<ICylinderConfig> & { innerRadius?: number; outerRadius?: number } = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_CYLINDER_CONFIG,
        innerRadius: 0.5,
        outerRadius: 1,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateTubeGeometry(builder, finalConfig);
};

const generateCylinderGeometry = (
    builder: GeometryBuilder,
    config: Required<ICylinderConfig>
): IGeometryBuffers => {
    const {
        radiusTop,
        radiusBottom,
        height,
        radialSegments,
        heightSegments,
        openEnded,
        thetaStart,
        thetaLength,
    } = config;

    const halfHeight = height * 0.5;
    const slope = (radiusBottom - radiusTop) / height;

    generateTorso();

    if (!openEnded) {
        if (radiusTop > 0) generateCap(true);
        if (radiusBottom > 0) generateCap(false);
    }

    function generateTorso(): void {
        const indexArray: number[][] = [];

        for (let y = 0; y <= heightSegments; y++) {
            const indexRow: number[] = [];
            const v = y / heightSegments;
            const radius = v * (radiusBottom - radiusTop) + radiusTop;

            for (let x = 0; x <= radialSegments; x++) {
                const u = x / radialSegments;
                const theta = u * thetaLength + thetaStart;

                const sinTheta = Math.sin(theta);
                const cosTheta = Math.cos(theta);

                const px = radius * sinTheta;
                const py = -v * height + halfHeight;
                const pz = radius * cosTheta;
                const position = Vec3.create(px, py, pz);

                const nx = sinTheta;
                const ny = slope;
                const nz = cosTheta;
                const normal = config.generateNormals
                    ? Vec3.normalize(Vec3.create(nx, ny, nz))
                    : undefined;

                const texCoord = config.generateTexCoords ? { u, v: 1 - v } : undefined;

                const index = builder.addVertex(position, normal, texCoord);
                indexRow.push(index);
            }

            indexArray.push(indexRow);
        }

        for (let x = 0; x < radialSegments; x++) {
            for (let y = 0; y < heightSegments; y++) {
                const a = indexArray[y][x];
                const b = indexArray[y + 1][x];
                const c = indexArray[y + 1][x + 1];
                const d = indexArray[y][x + 1];

                builder.addQuad(a, b, c, d);
            }
        }
    }

    function generateCap(top: boolean): void {
        const centerIndexStart = builder.vertexCount;
        const radius = top ? radiusTop : radiusBottom;
        const sign = top ? 1 : -1;

        const centerY = halfHeight * sign;
        const centerPosition = Vec3.create(0, centerY, 0);
        const centerNormal = config.generateNormals ? Vec3.create(0, sign, 0) : undefined;
        const centerTexCoord = config.generateTexCoords ? { u: 0.5, v: 0.5 } : undefined;

        builder.addVertex(centerPosition, centerNormal, centerTexCoord);

        for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;

            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const px = radius * sinTheta;
            const py = centerY;
            const pz = radius * cosTheta;
            const position = Vec3.create(px, py, pz);

            const normal = config.generateNormals ? Vec3.create(0, sign, 0) : undefined;

            const texCoord = config.generateTexCoords
                ? {
                      u: cosTheta * 0.5 + 0.5,
                      v: sinTheta * 0.5 * sign + 0.5,
                  }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }

        for (let x = 0; x < radialSegments; x++) {
            const c = centerIndexStart;
            const a = centerIndexStart + 1 + x;
            const b = centerIndexStart + 1 + x + 1;

            if (top) {
                builder.addTriangle(c, b, a);
            } else {
                builder.addTriangle(c, a, b);
            }
        }
    }

    return builder.build();
};

const generateTubeGeometry = (
    builder: GeometryBuilder,
    config: Required<ICylinderConfig & { innerRadius: number; outerRadius: number }>
): IGeometryBuffers => {
    const {
        innerRadius,
        outerRadius,
        height,
        radialSegments,
        heightSegments,
        thetaStart,
        thetaLength,
    } = config;

    const halfHeight = height * 0.5;

    generateCylinderSurface(outerRadius, false);

    generateCylinderSurface(innerRadius, true);

    generateRing(true);
    generateRing(false);

    function generateCylinderSurface(radius: number, inner: boolean): void {
        const startVertex = builder.vertexCount;

        for (let y = 0; y <= heightSegments; y++) {
            const v = y / heightSegments;
            const py = -v * height + halfHeight;

            for (let x = 0; x <= radialSegments; x++) {
                const u = x / radialSegments;
                const theta = u * thetaLength + thetaStart;

                const sinTheta = Math.sin(theta);
                const cosTheta = Math.cos(theta);

                const px = radius * sinTheta;
                const pz = radius * cosTheta;
                const position = Vec3.create(px, py, pz);

                const normalSign = inner ? -1 : 1;
                const normal = config.generateNormals
                    ? Vec3.create(sinTheta * normalSign, 0, cosTheta * normalSign)
                    : undefined;

                const texCoord = config.generateTexCoords
                    ? { u: inner ? 1 - u : u, v: 1 - v }
                    : undefined;

                builder.addVertex(position, normal, texCoord);
            }
        }

        for (let x = 0; x < radialSegments; x++) {
            for (let y = 0; y < heightSegments; y++) {
                const a = startVertex + y * (radialSegments + 1) + x;
                const b = startVertex + (y + 1) * (radialSegments + 1) + x;
                const c = startVertex + (y + 1) * (radialSegments + 1) + x + 1;
                const d = startVertex + y * (radialSegments + 1) + x + 1;

                if (inner) {
                    builder.addQuad(a, d, c, b);
                } else {
                    builder.addQuad(a, b, c, d);
                }
            }
        }
    }

    function generateRing(top: boolean): void {
        const startVertex = builder.vertexCount;
        const y = top ? halfHeight : -halfHeight;
        const normalY = top ? 1 : -1;

        for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;

            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            const outerPos = Vec3.create(outerRadius * sinTheta, y, outerRadius * cosTheta);
            const outerTexCoord = config.generateTexCoords
                ? {
                      u: cosTheta * 0.5 + 0.5,
                      v: sinTheta * 0.5 + 0.5,
                  }
                : undefined;
            builder.addVertex(
                outerPos,
                config.generateNormals ? Vec3.create(0, normalY, 0) : undefined,
                outerTexCoord
            );

            const innerPos = Vec3.create(innerRadius * sinTheta, y, innerRadius * cosTheta);
            const innerTexCoord = config.generateTexCoords
                ? {
                      u: cosTheta * 0.25 + 0.5,
                      v: sinTheta * 0.25 + 0.5,
                  }
                : undefined;
            builder.addVertex(
                innerPos,
                config.generateNormals ? Vec3.create(0, normalY, 0) : undefined,
                innerTexCoord
            );
        }

        for (let x = 0; x < radialSegments; x++) {
            const a = startVertex + x * 2;
            const b = startVertex + x * 2 + 1;
            const c = startVertex + (x + 1) * 2 + 1;
            const d = startVertex + (x + 1) * 2;

            if (top) {
                builder.addQuad(a, d, c, b);
            } else {
                builder.addQuad(a, b, c, d);
            }
        }
    }

    return builder.build();
};
