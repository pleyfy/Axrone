import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';
import type { IRaycastHit3D, LayerMask } from '../types/raycast-types';
import type { RaycastSystem3D } from './raycast-system';

export interface IShapecastQuery3D {
    readonly origin: Readonly<IVec3Like>;
    readonly direction: Readonly<IVec3Like>;
    readonly maxDistance: number;
    readonly layerMask: LayerMask;
}

export interface ISphereCastQuery3D extends IShapecastQuery3D {
    readonly radius: number;
}

export interface IBoxCastQuery3D extends IShapecastQuery3D {
    readonly extents: Readonly<IVec3Like>;
    readonly rotation?: Readonly<IVec3Like>;
}

export interface ICapsuleCastQuery3D extends IShapecastQuery3D {
    readonly radius: number;
    readonly height: number;
}

export class ShapeCaster3D {
    private readonly _raycastSystem: RaycastSystem3D;
    private readonly _tempVec3: Vec3 = Vec3.ZERO.clone();

    constructor(raycastSystem: RaycastSystem3D) {
        this._raycastSystem = raycastSystem;
    }

    public sphereCast(query: ISphereCastQuery3D): IRaycastHit3D | null {
        const samples = this._computeSphereSamples(query.radius);
        let closestHit: IRaycastHit3D | null = null;
        let closestDistance = Number.MAX_VALUE;

        const centerHit = this._raycastSystem.raycast(
            query.origin,
            query.direction,
            query.maxDistance,
            query.layerMask
        );

        if (centerHit && centerHit.distance < closestDistance) {
            closestHit = centerHit;
            closestDistance = centerHit.distance;
        }

        const up = Vec3.create(0, 1, 0);
        const right = Vec3.cross(query.direction, up);
        Vec3.normalize(right, right);
        const actualUp = Vec3.cross(right, query.direction);
        Vec3.normalize(actualUp, actualUp);

        for (let i = 0; i < samples; i++) {
            const angle = (Math.PI * 2 * i) / samples;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const offset = Vec3.create(
                right.x * cos * query.radius + actualUp.x * sin * query.radius,
                right.y * cos * query.radius + actualUp.y * sin * query.radius,
                right.z * cos * query.radius + actualUp.z * sin * query.radius
            );

            const rayOrigin = Vec3.add(query.origin, offset);
            const hit = this._raycastSystem.raycast(
                rayOrigin,
                query.direction,
                query.maxDistance,
                query.layerMask
            );

            if (hit && hit.distance < closestDistance) {
                closestHit = hit;
                closestDistance = hit.distance;
            }
        }

        return closestHit;
    }

    public boxCast(query: IBoxCastQuery3D): IRaycastHit3D | null {
        let closestHit: IRaycastHit3D | null = null;
        let closestDistance = Number.MAX_VALUE;

        const offsets = [
            [-1, -1, -1],
            [1, -1, -1],
            [-1, 1, -1],
            [1, 1, -1],
            [-1, -1, 1],
            [1, -1, 1],
            [-1, 1, 1],
            [1, 1, 1],
            [0, 0, 0],
        ];

        for (const [x, y, z] of offsets) {
            const offset = Vec3.create(
                x * query.extents.x,
                y * query.extents.y,
                z * query.extents.z
            );

            const rayOrigin = Vec3.add(query.origin, offset);
            const hit = this._raycastSystem.raycast(
                rayOrigin,
                query.direction,
                query.maxDistance,
                query.layerMask
            );

            if (hit && hit.distance < closestDistance) {
                closestHit = hit;
                closestDistance = hit.distance;
            }
        }

        return closestHit;
    }

    public capsuleCast(query: ICapsuleCastQuery3D): IRaycastHit3D | null {
        const halfHeight = query.height * 0.5;
        let closestHit: IRaycastHit3D | null = null;
        let closestDistance = Number.MAX_VALUE;

        const up = Vec3.create(0, 1, 0);
        const sphereOffsets = [0, halfHeight, -halfHeight];

        for (const offset of sphereOffsets) {
            const sphereOrigin = Vec3.create(
                query.origin.x,
                query.origin.y + offset,
                query.origin.z
            );

            const sphereQuery: ISphereCastQuery3D = {
                origin: sphereOrigin,
                direction: query.direction,
                maxDistance: query.maxDistance,
                layerMask: query.layerMask,
                radius: query.radius,
            };

            const hit = this.sphereCast(sphereQuery);
            if (hit && hit.distance < closestDistance) {
                closestHit = hit;
                closestDistance = hit.distance;
            }
        }

        return closestHit;
    }

    private _computeSphereSamples(radius: number): number {
        if (radius < 0.5) return 4;
        if (radius < 1.0) return 8;
        if (radius < 2.0) return 12;
        return 16;
    }
}

export class MultiRaycaster3D {
    private readonly _raycastSystem: RaycastSystem3D;

    constructor(raycastSystem: RaycastSystem3D) {
        this._raycastSystem = raycastSystem;
    }

    public fanCast(
        origin: Readonly<IVec3Like>,
        centerDirection: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        spreadAngle: number,
        rayCount: number
    ): IRaycastHit3D[] {
        const hits: IRaycastHit3D[] = [];

        if (rayCount === 1) {
            const hit = this._raycastSystem.raycast(
                origin,
                centerDirection,
                maxDistance,
                layerMask
            );
            if (hit) hits.push(hit);
            return hits;
        }

        const up = Vec3.create(0, 1, 0);
        const right = Vec3.cross(centerDirection, up);
        Vec3.normalize(right, right);
        const actualUp = Vec3.cross(right, centerDirection);
        Vec3.normalize(actualUp, actualUp);

        for (let i = 0; i < rayCount; i++) {
            const angle = (i / (rayCount - 1) - 0.5) * spreadAngle;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const rotatedDir = Vec3.create(
                centerDirection.x * cos + right.x * sin,
                centerDirection.y * cos + right.y * sin,
                centerDirection.z * cos + right.z * sin
            );
            Vec3.normalize(rotatedDir, rotatedDir);

            const hit = this._raycastSystem.raycast(origin, rotatedDir, maxDistance, layerMask);
            if (hit) hits.push(hit);
        }

        return hits;
    }

    public coneCast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        coneAngle: number,
        samples: number = 16
    ): IRaycastHit3D[] {
        const hits: IRaycastHit3D[] = [];

        const centerHit = this._raycastSystem.raycast(origin, direction, maxDistance, layerMask);
        if (centerHit) hits.push(centerHit);

        const up = Vec3.create(0, 1, 0);
        const right = Vec3.cross(direction, up);
        Vec3.normalize(right, right);
        const actualUp = Vec3.cross(right, direction);
        Vec3.normalize(actualUp, actualUp);

        const ringCount = Math.ceil(Math.sqrt(samples));
        const raysPerRing = Math.ceil(samples / ringCount);

        for (let ring = 1; ring <= ringCount; ring++) {
            const ringAngle = (ring / ringCount) * coneAngle;
            const ringRadius = Math.tan(ringAngle);

            for (let i = 0; i < raysPerRing; i++) {
                const azimuth = (Math.PI * 2 * i) / raysPerRing;
                const cos = Math.cos(azimuth);
                const sin = Math.sin(azimuth);

                const offset = Vec3.create(
                    right.x * cos * ringRadius + actualUp.x * sin * ringRadius,
                    right.y * cos * ringRadius + actualUp.y * sin * ringRadius,
                    right.z * cos * ringRadius + actualUp.z * sin * ringRadius
                );

                const rayDir = Vec3.add(direction, offset);
                Vec3.normalize(rayDir, rayDir);

                const hit = this._raycastSystem.raycast(origin, rayDir, maxDistance, layerMask);
                if (hit) hits.push(hit);
            }
        }

        return hits;
    }

    public radialCast(
        origin: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        samples: number = 32
    ): IRaycastHit3D[] {
        const hits: IRaycastHit3D[] = [];

        const thetaSamples = Math.ceil(Math.sqrt(samples));
        const phiSamples = Math.ceil(samples / thetaSamples);

        for (let i = 0; i < thetaSamples; i++) {
            const theta = (Math.PI * i) / (thetaSamples - 1);

            for (let j = 0; j < phiSamples; j++) {
                const phi = (Math.PI * 2 * j) / phiSamples;

                const direction = Vec3.create(
                    Math.sin(theta) * Math.cos(phi),
                    Math.cos(theta),
                    Math.sin(theta) * Math.sin(phi)
                );

                const hit = this._raycastSystem.raycast(origin, direction, maxDistance, layerMask);
                if (hit) hits.push(hit);
            }
        }

        return hits;
    }

    public gridCast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        width: number,
        height: number,
        columns: number,
        rows: number
    ): IRaycastHit3D[][] {
        const grid: IRaycastHit3D[][] = Array.from({ length: rows }, () => []);

        const up = Vec3.create(0, 1, 0);
        const right = Vec3.cross(direction, up);
        Vec3.normalize(right, right);
        const actualUp = Vec3.cross(right, direction);
        Vec3.normalize(actualUp, actualUp);

        const stepX = width / (columns - 1);
        const stepY = height / (rows - 1);
        const startX = -width * 0.5;
        const startY = -height * 0.5;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const offsetX = startX + col * stepX;
                const offsetY = startY + row * stepY;

                const rayOrigin = Vec3.create(
                    origin.x + right.x * offsetX + actualUp.x * offsetY,
                    origin.y + right.y * offsetX + actualUp.y * offsetY,
                    origin.z + right.z * offsetX + actualUp.z * offsetY
                );

                const hit = this._raycastSystem.raycast(
                    rayOrigin,
                    direction,
                    maxDistance,
                    layerMask
                );
                if (hit) grid[row].push(hit);
            }
        }

        return grid;
    }
}

export function createShapeCaster3D(raycastSystem: RaycastSystem3D): ShapeCaster3D {
    return new ShapeCaster3D(raycastSystem);
}

export function createMultiRaycaster3D(raycastSystem: RaycastSystem3D): MultiRaycaster3D {
    return new MultiRaycaster3D(raycastSystem);
}
