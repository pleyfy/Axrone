import { Vec3 } from '@axrone/numeric';
import { GeometryBuilder } from './geometry-builder';
import { IGeometryBuffers, ITorusConfig } from './types';

const DEFAULT_TORUS_CONFIG: Required<ITorusConfig> = {
    radius: 1,
    tube: 0.4,
    radialSegments: 12,
    tubularSegments: 48,
    arc: Math.PI * 2,
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: 0x1403, // GLAttributeType.UNSIGNED_SHORT
} as const;

export const createTorus = (config: Partial<ITorusConfig> = {}): IGeometryBuffers => {
    const finalConfig = { ...DEFAULT_TORUS_CONFIG, ...config };
    const builder = GeometryBuilder.create(finalConfig);
    return generateTorusGeometry(builder, finalConfig);
};

export const createTorusKnot = (
    config: Partial<ITorusConfig> & {
        p?: number;
        q?: number;
        heightScale?: number;
    } = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_TORUS_CONFIG,
        p: 2,
        q: 3,
        heightScale: 1,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateTorusKnotGeometry(builder, finalConfig);
};

export const createSpring = (
    config: Partial<ITorusConfig> & {
        coils?: number;
        pitch?: number;
        startRadius?: number;
        endRadius?: number;
    } = {}
): IGeometryBuffers => {
    const finalConfig = {
        ...DEFAULT_TORUS_CONFIG,
        coils: 5,
        pitch: 1,
        startRadius: 1,
        endRadius: 1,
        ...config,
    };
    const builder = GeometryBuilder.create(finalConfig);
    return generateSpringGeometry(builder, finalConfig);
};

const generateTorusGeometry = (
    builder: GeometryBuilder,
    config: Required<ITorusConfig>
): IGeometryBuffers => {
    const { radius, tube, radialSegments, tubularSegments, arc } = config;

    for (let j = 0; j <= radialSegments; j++) {
        for (let i = 0; i <= tubularSegments; i++) {
            const u = (i / tubularSegments) * arc;
            const v = (j / radialSegments) * Math.PI * 2;

            const x = (radius + tube * Math.cos(v)) * Math.cos(u);
            const y = tube * Math.sin(v);
            const z = (radius + tube * Math.cos(v)) * Math.sin(u);
            const position = Vec3.create(x, y, z);

            const centerX = radius * Math.cos(u);
            const centerY = 0;
            const centerZ = radius * Math.sin(u);
            const center = Vec3.create(centerX, centerY, centerZ);
            const normal = config.generateNormals
                ? Vec3.normalize(Vec3.subtract(position, center))
                : undefined;

            const texCoord = config.generateTexCoords
                ? {
                      u: i / tubularSegments,
                      v: j / radialSegments,
                  }
                : undefined;

            builder.addVertex(position, normal, texCoord);
        }
    }

    for (let j = 1; j <= radialSegments; j++) {
        for (let i = 1; i <= tubularSegments; i++) {
            const a = (tubularSegments + 1) * j + i - 1;
            const b = (tubularSegments + 1) * (j - 1) + i - 1;
            const c = (tubularSegments + 1) * (j - 1) + i;
            const d = (tubularSegments + 1) * j + i;

            builder.addQuad(a, b, c, d);
        }
    }

    return builder.build();
};

const generateTorusKnotGeometry = (
    builder: GeometryBuilder,
    config: Required<ITorusConfig & { p: number; q: number; heightScale: number }>
): IGeometryBuffers => {
    const { radius, tube, radialSegments, tubularSegments, p, q, heightScale } = config;

    for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * p * Math.PI * 2;

        const p1 = calculatePositionOnCurve(u, q, p, radius, heightScale);
        const p2 = calculatePositionOnCurve(u + 0.01, q, p, radius, heightScale);

        const tangent = Vec3.normalize(Vec3.subtract(p2, p1));
        const normal = Vec3.normalize(p1);
        const binormal = Vec3.normalize(Vec3.cross(tangent, normal));

        for (let j = 0; j <= radialSegments; j++) {
            const v = (j / radialSegments) * Math.PI * 2;
            const cx = -tube * Math.cos(v);
            const cy = tube * Math.sin(v);

            const pos = Vec3.create(
                p1.x + cx * normal.x + cy * binormal.x,
                p1.y + cx * normal.y + cy * binormal.y,
                p1.z + cx * normal.z + cy * binormal.z
            );

            const norm = config.generateNormals
                ? Vec3.create(
                      cx * normal.x + cy * binormal.x,
                      cx * normal.y + cy * binormal.y,
                      cx * normal.z + cy * binormal.z
                  )
                : undefined;

            const texCoord = config.generateTexCoords
                ? {
                      u: i / tubularSegments,
                      v: j / radialSegments,
                  }
                : undefined;

            builder.addVertex(pos, norm ? Vec3.normalize(norm) : undefined, texCoord);
        }
    }

    for (let j = 1; j <= radialSegments; j++) {
        for (let i = 1; i <= tubularSegments; i++) {
            const a = (radialSegments + 1) * (i - 1) + (j - 1);
            const b = (radialSegments + 1) * i + (j - 1);
            const c = (radialSegments + 1) * i + j;
            const d = (radialSegments + 1) * (i - 1) + j;

            builder.addQuad(a, b, c, d);
        }
    }

    return builder.build();
};

const calculatePositionOnCurve = (
    u: number,
    q: number,
    p: number,
    radius: number,
    heightScale: number
): Vec3 => {
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const quOverP = (q / p) * u;
    const cs = Math.cos(quOverP);

    const x = radius * (2 + cs) * 0.5 * cu;
    const y = radius * (2 + cs) * su * 0.5;
    const z = heightScale * radius * Math.sin(quOverP) * 0.5;

    return Vec3.create(x, y, z);
};

const generateSpringGeometry = (
    builder: GeometryBuilder,
    config: Required<
        ITorusConfig & { coils: number; pitch: number; startRadius: number; endRadius: number }
    >
): IGeometryBuffers => {
    const { tube, radialSegments, tubularSegments, coils, pitch, startRadius, endRadius } = config;

    const totalLength = coils * Math.PI * 2;
    const heightPerCoil = pitch;
    const totalHeight = coils * heightPerCoil;

    for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        const u = t * totalLength;

        const currentRadius = startRadius + t * (endRadius - startRadius);

        const x = currentRadius * Math.cos(u);
        const y = (t - 0.5) * totalHeight;
        const z = currentRadius * Math.sin(u);
        const centerPos = Vec3.create(x, y, z);

        const dx = -currentRadius * Math.sin(u);
        const dy = totalHeight / tubularSegments;
        const dz = currentRadius * Math.cos(u);
        const tangent = Vec3.normalize(Vec3.create(dx, dy, dz));

        const radialDir = Vec3.normalize(Vec3.create(x, 0, z));
        const binormal = Vec3.normalize(Vec3.cross(tangent, radialDir));
        const normal = Vec3.cross(binormal, tangent);

        for (let j = 0; j <= radialSegments; j++) {
            const v = (j / radialSegments) * Math.PI * 2;
            const tubeX = tube * Math.cos(v);
            const tubeY = tube * Math.sin(v);

            const pos = Vec3.create(
                centerPos.x + tubeX * normal.x + tubeY * binormal.x,
                centerPos.y + tubeX * normal.y + tubeY * binormal.y,
                centerPos.z + tubeX * normal.z + tubeY * binormal.z
            );

            const norm = config.generateNormals
                ? Vec3.create(
                      tubeX * normal.x + tubeY * binormal.x,
                      tubeX * normal.y + tubeY * binormal.y,
                      tubeX * normal.z + tubeY * binormal.z
                  )
                : undefined;

            const texCoord = config.generateTexCoords
                ? {
                      u: i / tubularSegments,
                      v: j / radialSegments,
                  }
                : undefined;

            builder.addVertex(pos, norm ? Vec3.normalize(norm) : undefined, texCoord);
        }
    }

    for (let i = 0; i < tubularSegments; i++) {
        for (let j = 0; j < radialSegments; j++) {
            const a = i * (radialSegments + 1) + j;
            const b = (i + 1) * (radialSegments + 1) + j;
            const c = (i + 1) * (radialSegments + 1) + j + 1;
            const d = i * (radialSegments + 1) + j + 1;

            builder.addQuad(a, b, c, d);
        }
    }

    return builder.build();
};
