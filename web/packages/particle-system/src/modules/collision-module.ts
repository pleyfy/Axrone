import type { CollisionConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import { BaseModule } from './base-module';
import { Vec3 } from '@axrone/numeric';

export interface CollisionPrimitive {
    readonly type: 'plane' | 'sphere' | 'box' | 'cylinder' | 'mesh';
    readonly id: string;
    readonly enabled: boolean;
    readonly position: Vec3;
    readonly rotation: Vec3;
    readonly scale: Vec3;
    readonly material: CollisionMaterial;
}

export interface CollisionMaterial {
    readonly restitution: number;
    readonly friction: number;
    readonly damping: number;
    readonly adhesion: number;
}

export interface PlanePrimitive extends CollisionPrimitive {
    readonly type: 'plane';
    readonly normal: Vec3;
    readonly distance: number;
}

export interface SpherePrimitive extends CollisionPrimitive {
    readonly type: 'sphere';
    readonly radius: number;
    readonly hollow: boolean;
}

export interface BoxPrimitive extends CollisionPrimitive {
    readonly type: 'box';
    readonly size: Vec3;
    readonly hollow: boolean;
}

export interface CylinderPrimitive extends CollisionPrimitive {
    readonly type: 'cylinder';
    readonly radius: number;
    readonly height: number;
    readonly hollow: boolean;
}

export interface MeshPrimitive extends CollisionPrimitive {
    readonly type: 'mesh';
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
    readonly bvh?: CollisionBVH;
}

export interface CollisionBVH {
    readonly nodes: Float32Array;
    readonly triangles: Uint32Array;
    readonly nodeCount: number;
}

export interface CollisionContact {
    readonly particleIndex: number;
    readonly primitiveId: string;
    readonly point: Vec3;
    readonly normal: Vec3;
    readonly penetration: number;
    readonly materialProperties: CollisionMaterial;
}

export interface CollisionStats {
    totalChecks: number;
    totalContacts: number;
    avgContactsPerParticle: number;
    performanceMs: number;
    primitiveStats: Map<string, { checks: number; contacts: number }>;
}

export class CollisionModule extends BaseModule<'collision'> {
    private readonly _primitives = new Map<string, CollisionPrimitive>();
    private readonly _contacts: CollisionContact[] = [];
    private readonly _tempVec3A = new Vec3();
    private readonly _tempVec3B = new Vec3();
    private readonly _tempVec3C = new Vec3();
    private readonly _stats: CollisionStats = {
        totalChecks: 0,
        totalContacts: 0,
        avgContactsPerParticle: 0,
        performanceMs: 0,
        primitiveStats: new Map(),
    };

    private _broadPhaseEnabled = true;
    private readonly _spatialGrid = new Map<string, Set<number>>();
    private _gridCellSize = 1.0;
    private _lastUpdateTime = 0;

    constructor(configuration: CollisionConfiguration) {
        super('collision', configuration, 700);
    }

    protected onInitialize(): void {
        this._setupDefaultPrimitives();
        this._optimizeSpatialGrid();
    }

    protected onDestroy(): void {
        this._primitives.clear();
        this._contacts.length = 0;
        this._spatialGrid.clear();
    }

    protected onReset(): void {
        this._contacts.length = 0;
        this._resetStats();
    }

    protected onUpdate(deltaTime: number): void {
        this._lastUpdateTime = deltaTime;
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        const config = this.config;
        if (!config.enabled || this._primitives.size === 0) return;

        const startTime = performance.now();
        this._resetStats();

        this._contacts.length = 0;

        if (this._broadPhaseEnabled) {
            this._updateSpatialGrid(particles);
        }

        this._detectCollisions(particles);

        this._resolveCollisions(particles, deltaTime);

        this._stats.performanceMs = performance.now() - startTime;
        this._stats.avgContactsPerParticle =
            particles.count > 0 ? this._stats.totalContacts / particles.count : 0;
    }

    protected onConfigure(
        newConfig: CollisionConfiguration,
        oldConfig: CollisionConfiguration
    ): void {
        if (newConfig.broadPhase !== oldConfig.broadPhase) {
            this._broadPhaseEnabled = newConfig.broadPhase;
        }

        if (newConfig.gridCellSize !== oldConfig.gridCellSize) {
            this._gridCellSize = newConfig.gridCellSize;
            this._spatialGrid.clear();
        }
    }

    addPrimitive(primitive: CollisionPrimitive): void {
        this._primitives.set(primitive.id, primitive);
        this._stats.primitiveStats.set(primitive.id, { checks: 0, contacts: 0 });
    }

    removePrimitive(id: string): boolean {
        this._stats.primitiveStats.delete(id);
        return this._primitives.delete(id);
    }

    getPrimitive(id: string): CollisionPrimitive | undefined {
        return this._primitives.get(id);
    }

    getAllPrimitives(): CollisionPrimitive[] {
        return Array.from(this._primitives.values());
    }

    getContacts(): readonly CollisionContact[] {
        return this._contacts;
    }

    getStats(): CollisionStats {
        return { ...this._stats };
    }

    static createPlane(
        id: string,
        position: Vec3,
        normal: Vec3,
        material: CollisionMaterial = CollisionModule.defaultMaterial()
    ): PlanePrimitive {
        const normalizedNormal = Vec3.normalize(normal, new Vec3());
        return {
            type: 'plane',
            id,
            enabled: true,
            position: position.clone(),
            rotation: new Vec3(),
            scale: new Vec3(1, 1, 1),
            material,
            normal: normalizedNormal,
            distance: Vec3.dot(position, normalizedNormal),
        };
    }

    static createSphere(
        id: string,
        position: Vec3,
        radius: number,
        hollow = false,
        material: CollisionMaterial = CollisionModule.defaultMaterial()
    ): SpherePrimitive {
        return {
            type: 'sphere',
            id,
            enabled: true,
            position: position.clone(),
            rotation: new Vec3(),
            scale: new Vec3(1, 1, 1),
            material,
            radius,
            hollow,
        };
    }

    static createBox(
        id: string,
        position: Vec3,
        size: Vec3,
        rotation = new Vec3(),
        hollow = false,
        material: CollisionMaterial = CollisionModule.defaultMaterial()
    ): BoxPrimitive {
        return {
            type: 'box',
            id,
            enabled: true,
            position: position.clone(),
            rotation: rotation.clone(),
            scale: new Vec3(1, 1, 1),
            material,
            size: size.clone(),
            hollow,
        };
    }

    static defaultMaterial(): CollisionMaterial {
        return {
            restitution: 0.3,
            friction: 0.5,
            damping: 0.1,
            adhesion: 0.0,
        };
    }

    private _setupDefaultPrimitives(): void {
        const config = this.config;

        if (config.groundPlane?.enabled) {
            const plane = CollisionModule.createPlane(
                'ground',
                new Vec3(0, config.groundPlane.height, 0),
                new Vec3(0, 1, 0),
                {
                    restitution: config.groundPlane.bounce,
                    friction: config.groundPlane.friction || 0.5,
                    damping: config.groundPlane.dampen || 0.1,
                    adhesion: 0.0,
                }
            );
            this.addPrimitive(plane);
        }
    }

    private _optimizeSpatialGrid(): void {
        const config = this.config;
        if (config.autoOptimize) {
            this._gridCellSize = Math.max(0.5, config.gridCellSize || 1.0);
        }
    }

    private _updateSpatialGrid(particles: IParticleBuffer): void {
        this._spatialGrid.clear();

        const positions = particles.positions as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const i3 = i * 3;
            const x = positions[i3];
            const y = positions[i3 + 1];
            const z = positions[i3 + 2];

            const cellKey = this._getCellKey(x, y, z);
            if (!this._spatialGrid.has(cellKey)) {
                this._spatialGrid.set(cellKey, new Set());
            }
            this._spatialGrid.get(cellKey)!.add(i);
        }
    }

    private _getCellKey(x: number, y: number, z: number): string {
        const cellX = Math.floor(x / this._gridCellSize);
        const cellY = Math.floor(y / this._gridCellSize);
        const cellZ = Math.floor(z / this._gridCellSize);
        return `${cellX},${cellY},${cellZ}`;
    }

    private _detectCollisions(particles: IParticleBuffer): void {
        const positions = particles.positions as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const i3 = i * 3;
            this._tempVec3A.x = positions[i3];
            this._tempVec3A.y = positions[i3 + 1];
            this._tempVec3A.z = positions[i3 + 2];

            for (const primitive of this._primitives.values()) {
                if (!primitive.enabled) continue;

                const stats = this._stats.primitiveStats.get(primitive.id)!;
                stats.checks++;
                this._stats.totalChecks++;

                const contact = this._checkPrimitiveCollision(i, this._tempVec3A, primitive);
                if (contact) {
                    this._contacts.push(contact);
                    stats.contacts++;
                    this._stats.totalContacts++;
                }
            }
        }
    }

    private _checkPrimitiveCollision(
        particleIndex: number,
        position: Vec3,
        primitive: CollisionPrimitive
    ): CollisionContact | null {
        switch (primitive.type) {
            case 'plane':
                return this._checkPlaneCollision(
                    particleIndex,
                    position,
                    primitive as PlanePrimitive
                );
            case 'sphere':
                return this._checkSphereCollision(
                    particleIndex,
                    position,
                    primitive as SpherePrimitive
                );
            case 'box':
                return this._checkBoxCollision(particleIndex, position, primitive as BoxPrimitive);
            case 'cylinder':
                return this._checkCylinderCollision(
                    particleIndex,
                    position,
                    primitive as CylinderPrimitive
                );
            case 'mesh':
                return this._checkMeshCollision(
                    particleIndex,
                    position,
                    primitive as MeshPrimitive
                );
            default:
                return null;
        }
    }

    private _checkPlaneCollision(
        particleIndex: number,
        position: Vec3,
        plane: PlanePrimitive
    ): CollisionContact | null {
        const distance = Vec3.dot(position, plane.normal) - plane.distance;

        if (distance < 0) {
            const penetration = Math.abs(distance);
            const _tmp_plane = Vec3.multiplyScalar(plane.normal, distance, new Vec3());
            const contactPoint = Vec3.subtract(position, _tmp_plane, new Vec3());

            return {
                particleIndex,
                primitiveId: plane.id,
                point: contactPoint,
                normal: plane.normal.clone(),
                penetration,
                materialProperties: plane.material,
            };
        }

        return null;
    }

    private _checkSphereCollision(
        particleIndex: number,
        position: Vec3,
        sphere: SpherePrimitive
    ): CollisionContact | null {
        const toParticle = Vec3.subtract(position, sphere.position, this._tempVec3B);
        const distance = Vec3.len(toParticle);

        const collision = sphere.hollow ? distance > sphere.radius : distance < sphere.radius;

        if (collision) {
            const penetration = sphere.hollow ? distance - sphere.radius : sphere.radius - distance;

            const normal = sphere.hollow
                ? Vec3.negate(Vec3.normalize(toParticle.clone(), new Vec3()), new Vec3())
                : Vec3.normalize(toParticle.clone(), new Vec3());

            const _tmp_sphere = Vec3.multiplyScalar(
                normal,
                sphere.hollow ? sphere.radius : -sphere.radius,
                new Vec3()
            );
            const contactPoint = Vec3.add(sphere.position, _tmp_sphere, new Vec3());

            return {
                particleIndex,
                primitiveId: sphere.id,
                point: contactPoint,
                normal,
                penetration: Math.abs(penetration),
                materialProperties: sphere.material,
            };
        }

        return null;
    }

    private _checkBoxCollision(
        particleIndex: number,
        position: Vec3,
        box: BoxPrimitive
    ): CollisionContact | null {
        const localPos = Vec3.subtract(position, box.position, this._tempVec3B);

        const halfSize = Vec3.multiplyScalar(box.size, 0.5, this._tempVec3C);

        const collision = box.hollow
            ? Math.abs(localPos.x) > halfSize.x ||
              Math.abs(localPos.y) > halfSize.y ||
              Math.abs(localPos.z) > halfSize.z
            : Math.abs(localPos.x) < halfSize.x &&
              Math.abs(localPos.y) < halfSize.y &&
              Math.abs(localPos.z) < halfSize.z;

        if (collision) {
            const dx = halfSize.x - Math.abs(localPos.x);
            const dy = halfSize.y - Math.abs(localPos.y);
            const dz = halfSize.z - Math.abs(localPos.z);

            let normal: Vec3;
            let penetration: number;

            if (dx < dy && dx < dz) {
                normal = new Vec3(Math.sign(localPos.x), 0, 0);
                penetration = dx;
            } else if (dy < dz) {
                normal = new Vec3(0, Math.sign(localPos.y), 0);
                penetration = dy;
            } else {
                normal = new Vec3(0, 0, Math.sign(localPos.z));
                penetration = dz;
            }

            if (box.hollow) {
                Vec3.negate(normal, normal);
                penetration = Math.min(dx, dy, dz);
            }

            const _tmp_box_n = Vec3.multiplyScalar(normal, penetration, new Vec3());
            const _tmp_box_lp = Vec3.add(localPos, _tmp_box_n, new Vec3());
            const contactPoint = Vec3.add(box.position, _tmp_box_lp, new Vec3());

            return {
                particleIndex,
                primitiveId: box.id,
                point: contactPoint,
                normal,
                penetration: Math.abs(penetration),
                materialProperties: box.material,
            };
        }

        return null;
    }

    private _checkCylinderCollision(
        particleIndex: number,
        position: Vec3,
        cylinder: CylinderPrimitive
    ): CollisionContact | null {
        const localPos = Vec3.subtract(position, cylinder.position, this._tempVec3B);
        const radialDistance = Math.sqrt(localPos.x * localPos.x + localPos.z * localPos.z);
        const halfHeight = cylinder.height * 0.5;

        if (Math.abs(localPos.y) > halfHeight) return null;

        const collision = cylinder.hollow
            ? radialDistance > cylinder.radius
            : radialDistance < cylinder.radius;

        if (collision) {
            const penetration = cylinder.hollow
                ? radialDistance - cylinder.radius
                : cylinder.radius - radialDistance;

            const normal = cylinder.hollow
                ? new Vec3(-localPos.x / radialDistance, 0, -localPos.z / radialDistance)
                : new Vec3(localPos.x / radialDistance, 0, localPos.z / radialDistance);

            const _tmp_cyl = new Vec3(
                normal.x * (cylinder.hollow ? cylinder.radius : -cylinder.radius),
                localPos.y,
                normal.z * (cylinder.hollow ? cylinder.radius : -cylinder.radius)
            );
            const contactPoint = Vec3.add(cylinder.position, _tmp_cyl, new Vec3());

            return {
                particleIndex,
                primitiveId: cylinder.id,
                point: contactPoint,
                normal,
                penetration: Math.abs(penetration),
                materialProperties: cylinder.material,
            };
        }

        return null;
    }

    private _checkMeshCollision(
        particleIndex: number,
        position: Vec3,
        mesh: MeshPrimitive
    ): CollisionContact | null {
        return null;
    }

    private _resolveCollisions(particles: IParticleBuffer, deltaTime: number): void {
        if (this._contacts.length === 0) return;

        const positions = particles.positions as Float32Array;
        const velocities = particles.velocities as Float32Array;

        for (const contact of this._contacts) {
            const i = contact.particleIndex;
            const i3 = i * 3;

            const correction = Vec3.multiplyScalar(contact.normal, contact.penetration, new Vec3());
            positions[i3] += correction.x;
            positions[i3 + 1] += correction.y;
            positions[i3 + 2] += correction.z;

            const velocity = new Vec3(velocities[i3], velocities[i3 + 1], velocities[i3 + 2]);
            const normalVelocity = Vec3.dot(velocity, contact.normal);

            if (normalVelocity < 0) {
                const material = contact.materialProperties;

                const _tmp_ref = Vec3.multiplyScalar(
                    contact.normal,
                    normalVelocity * (1 + material.restitution),
                    new Vec3()
                );
                const reflectedVelocity = Vec3.subtract(velocity, _tmp_ref, new Vec3());

                const _tmp_proj = Vec3.multiplyScalar(
                    contact.normal,
                    Vec3.dot(reflectedVelocity, contact.normal),
                    new Vec3()
                );
                const tangentVelocity = Vec3.subtract(reflectedVelocity, _tmp_proj, new Vec3());

                const _tmp_tan = Vec3.multiplyScalar(
                    tangentVelocity,
                    1 - material.friction,
                    new Vec3()
                );
                const finalVelocity = Vec3.add(_tmp_proj, _tmp_tan, new Vec3());
                Vec3.multiplyScalar(finalVelocity, 1 - material.damping, finalVelocity);

                velocities[i3] = finalVelocity.x;
                velocities[i3 + 1] = finalVelocity.y;
                velocities[i3 + 2] = finalVelocity.z;
            }
        }
    }

    private _resetStats(): void {
        this._stats.totalChecks = 0;
        this._stats.totalContacts = 0;
        this._stats.avgContactsPerParticle = 0;

        for (const stats of this._stats.primitiveStats.values()) {
            stats.checks = 0;
            stats.contacts = 0;
        }
    }
}
