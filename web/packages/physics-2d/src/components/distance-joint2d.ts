import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { Joint2D } from './joint2d';
import { finiteNumberOr, finiteOr } from '../core/physics-world-2d-helpers';

/**
 * Distance joint: maintains a fixed distance between two anchor points.
 *
 * **Solver**: FULL — Baumgarte-stabilized sequential impulse with optional
 * soft constraint (stiffness/damping). Velocity + position correction active.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'DistanceJoint2D',
    priority: 80,
    description: 'Distance constraint between two rigidbodies',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'distance'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class DistanceJoint2D extends Joint2D {
    private _distance: number = 1.0;
    private _minDistance: number = 0;
    private _maxDistance: number = Infinity;
    private _stiffness: number = 0;
    private _damping: number = 0;
    private _anchorA: Vec2 = Vec2.ZERO.clone();
    private _anchorB: Vec2 = Vec2.ZERO.clone();
    private _autoConfigureDistance: boolean = true;

    get distance(): number {
        return this._distance;
    }

    set distance(value: number) {
        if (this._distance !== value && value >= 0) {
            this._distance = value;
            this.recreateConstraint();
        }
    }

    get minDistance(): number {
        return this._minDistance;
    }

    set minDistance(value: number) {
        if (this._minDistance !== value && value >= 0) {
            this._minDistance = value;
            this.recreateConstraint();
        }
    }

    get maxDistance(): number {
        return this._maxDistance;
    }

    set maxDistance(value: number) {
        if (this._maxDistance !== value && value >= 0) {
            this._maxDistance = value;
            this.recreateConstraint();
        }
    }

    get stiffness(): number {
        return this._stiffness;
    }

    set stiffness(value: number) {
        if (this._stiffness !== value && value >= 0) {
            this._stiffness = value;
            this.recreateConstraint();
        }
    }

    get damping(): number {
        return this._damping;
    }

    set damping(value: number) {
        if (this._damping !== value && value >= 0) {
            this._damping = value;
            this.recreateConstraint();
        }
    }

    get anchorA(): Vec2 {
        return this._anchorA;
    }

    set anchorA(value: Vec2) {
        this._anchorA.x = value.x;
        this._anchorA.y = value.y;
        this.recreateConstraint();
    }

    get anchorB(): Vec2 {
        return this._anchorB;
    }

    set anchorB(value: Vec2) {
        this._anchorB.x = value.x;
        this._anchorB.y = value.y;
        this.recreateConstraint();
    }

    get autoConfigureDistance(): boolean {
        return this._autoConfigureDistance;
    }

    set autoConfigureDistance(value: boolean) {
        if (this._autoConfigureDistance !== value) {
            this._autoConfigureDistance = value;
            this.recreateConstraint();
        }
    }

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        if (this._autoConfigureDistance) {
            const posA = this._rigidbodyA.getPosition();
            const posB = this._connectedBody.getPosition();
            this._distance = posA.distance(posB);
        }

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createDistanceConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchorA.x, y: this._anchorA.y },
                localAnchorB: { x: this._anchorB.x, y: this._anchorB.y },
                length: this._distance,
                minLength: this._minDistance,
                maxLength: this._maxDistance,
                stiffness: this._stiffness,
                damping: this._damping,
                collideConnected: this._enableCollision,
            });
    }

    protected destroyConstraint(): void {
        if (!this._constraintId || !this._physicsWorld) return;
        (this._physicsWorld as any).getConstraintManager().destroyConstraint(this._constraintId);
        this._constraintId = null;
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            distance: this._distance,
            minDistance: this._minDistance,
            maxDistance: this._maxDistance,
            stiffness: this._stiffness,
            damping: this._damping,
            anchorA: { x: this._anchorA.x, y: this._anchorA.y },
            anchorB: { x: this._anchorB.x, y: this._anchorB.y },
            autoConfigureDistance: this._autoConfigureDistance,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        // Scalars: NaN from a malformed document must not reach the solver.
        // maxDistance legitimately allows Infinity, so it keeps the Infinity-
        // tolerant coercion.
        this._distance = finiteOr(data.distance, 1.0);
        this._minDistance = finiteOr(data.minDistance, 0);
        this._maxDistance = finiteNumberOr(data.maxDistance, Infinity);
        this._stiffness = finiteOr(data.stiffness, 0);
        this._damping = finiteOr(data.damping, 0);
        // Vec2 fields: Editor writes ARRAY [x,y], engine uses OBJECT {x,y}.
        // normalizeVec2Value accepts both formats for backward compatibility.
        if (data.anchorA !== undefined) {
            const v = this.normalizeVec2Value(data.anchorA);
            this._anchorA.x = v.x;
            this._anchorA.y = v.y;
        }
        if (data.anchorB !== undefined) {
            const v = this.normalizeVec2Value(data.anchorB);
            this._anchorB.x = v.x;
            this._anchorB.y = v.y;
        }
        this._autoConfigureDistance = data.autoConfigureDistance ?? true;
    }
}
