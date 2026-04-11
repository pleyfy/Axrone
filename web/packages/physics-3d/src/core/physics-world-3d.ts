import { Vec3, type IVec3Like } from '@axrone/numeric';
import type {
    IContactListener3D,
    IPhysicsProfiler3D,
    IPhysicsWorld3DConfig,
    IQueryFilter3D,
    RaycastCallback3D,
} from '../types/physics-3d';
import {
    BodyManager3D,
    ConstraintManager3D,
    ShapeManager3D,
} from './physics-managers-3d';

export { BodyManager3D, ShapeManager3D, ConstraintManager3D } from './physics-managers-3d';

export class PhysicsWorld3D implements Disposable {
    readonly config: Readonly<IPhysicsWorld3DConfig>;
    private readonly _gravity: Vec3;

    private readonly _bodyManager: BodyManager3D;
    private readonly _shapeManager: ShapeManager3D;
    private readonly _constraintManager: ConstraintManager3D;

    private _profiler: IPhysicsProfiler3D | null = null;
    private _contactListener: IContactListener3D | null = null;
    private _disposed = false;

    constructor(config: IPhysicsWorld3DConfig = {}) {
        this.config = config;
        this._gravity = config.gravity ? Vec3.from(config.gravity) : new Vec3(0, -9.81, 0);

        const maxBodies = config.maxBodies ?? 4096;
        const maxShapes = config.maxShapes ?? 8192;
        const maxConstraints = config.maxConstraints ?? 2048;

        this._bodyManager = new BodyManager3D(maxBodies);
        this._shapeManager = new ShapeManager3D(maxShapes);
        this._constraintManager = new ConstraintManager3D(maxConstraints);

        if (config.enableProfiler) {
            this._profiler = {
                stepTime: 0,
                collisionTime: 0,
                solveTime: 0,
                broadphaseTime: 0,
                narrowphaseTime: 0,
                solveVelocityTime: 0,
                solvePositionTime: 0,
                sleepTime: 0,
                ccdTime: 0,
            };
        }
    }

    get gravity(): Readonly<IVec3Like> {
        return this._gravity;
    }

    getBodyManager(): BodyManager3D {
        return this._bodyManager;
    }

    getShapeManager(): ShapeManager3D {
        return this._shapeManager;
    }

    getConstraintManager(): ConstraintManager3D {
        return this._constraintManager;
    }

    step(deltaTime: number, velocityIterations: number = 10, positionIterations: number = 4): void {
        if (this._disposed) return;

        const t0 = performance.now();

        this._integrateVelocities(deltaTime);
        this._solveConstraints(velocityIterations);
        this._integratePositions(deltaTime);

        if (this._profiler) {
            this._profiler.stepTime = performance.now() - t0;
        }
    }

    setContactListener(listener: IContactListener3D | null): void {
        this._contactListener = listener;
    }

    raycast(
        origin: IVec3Like,
        direction: IVec3Like,
        maxDistance: number,
        callback: RaycastCallback3D,
        filter?: IQueryFilter3D
    ): void {
        void origin;
        void direction;
        void maxDistance;
        void callback;
        void filter;
    }

    private _integrateVelocities(dt: number): void {
        const bodyIds = this._bodyManager.getBodyIds();
        const gravityX = this._gravity.x * dt;
        const gravityY = this._gravity.y * dt;
        const gravityZ = this._gravity.z * dt;

        for (const bodyId of bodyIds) {
            if (this._bodyManager.getBodyType(bodyId) !== 2) continue;
            if (!this._bodyManager.isAwake(bodyId)) continue;

            const gravityScale = this._bodyManager.getGravityScale(bodyId);
            const velocity = this._bodyManager.getLinearVelocity(bodyId);

            this._bodyManager.setLinearVelocity(bodyId, {
                x: velocity.x + gravityX * gravityScale,
                y: velocity.y + gravityY * gravityScale,
                z: velocity.z + gravityZ * gravityScale,
            });
        }
    }

    private _solveConstraints(iterations: number): void {
        void iterations;
    }

    private _integratePositions(dt: number): void {
        const bodyIds = this._bodyManager.getBodyIds();

        for (const bodyId of bodyIds) {
            if (this._bodyManager.getBodyType(bodyId) === 0) continue;
            if (!this._bodyManager.isAwake(bodyId)) continue;

            const position = this._bodyManager.getPosition(bodyId);
            const velocity = this._bodyManager.getLinearVelocity(bodyId);
            const rotation = this._bodyManager.getRotation(bodyId);
            const angularVelocity = this._bodyManager.getAngularVelocity(bodyId);

            this._bodyManager.setPosition(bodyId, {
                x: position.x + velocity.x * dt,
                y: position.y + velocity.y * dt,
                z: position.z + velocity.z * dt,
            });

            const angularSpeed = Math.sqrt(
                angularVelocity.x * angularVelocity.x +
                    angularVelocity.y * angularVelocity.y +
                    angularVelocity.z * angularVelocity.z
            );

            if (angularSpeed > 1e-10) {
                const halfAngle = angularSpeed * dt * 0.5;
                const s = Math.sin(halfAngle) / angularSpeed;
                const c = Math.cos(halfAngle);

                const dqx = angularVelocity.x * s;
                const dqy = angularVelocity.y * s;
                const dqz = angularVelocity.z * s;
                const dqw = c;

                const newW =
                    dqw * rotation.w -
                    dqx * rotation.x -
                    dqy * rotation.y -
                    dqz * rotation.z;
                const newX =
                    dqw * rotation.x +
                    dqx * rotation.w +
                    dqy * rotation.z -
                    dqz * rotation.y;
                const newY =
                    dqw * rotation.y -
                    dqx * rotation.z +
                    dqy * rotation.w +
                    dqz * rotation.x;
                const newZ =
                    dqw * rotation.z +
                    dqx * rotation.y -
                    dqy * rotation.x +
                    dqz * rotation.w;

                const length = Math.sqrt(
                    newX * newX + newY * newY + newZ * newZ + newW * newW
                );
                const inverseLength = length > 1e-10 ? 1 / length : 0;

                this._bodyManager.setRotation(bodyId, {
                    x: newX * inverseLength,
                    y: newY * inverseLength,
                    z: newZ * inverseLength,
                    w: newW * inverseLength,
                });
            }
        }
    }

    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;
        this._bodyManager[Symbol.dispose]();
        this._shapeManager[Symbol.dispose]();
        this._constraintManager[Symbol.dispose]();
    }
}