import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { Joint2D } from './joint2d';
import { finiteOr } from '../core/physics-world-2d-helpers';

/**
 * Spring joint: soft distance constraint with Hooke's law restoring force
 * and damping. Uses the same solver path as DistanceJoint2D but with
 * non-zero stiffness/damping, producing soft constraint behavior.
 *
 * Maps to solver `Distance` case (soft formulation).
 * **Solver**: FULL — soft sequential impulse with spring/damping.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'SpringJoint2D',
    priority: 80,
    description: 'Spring joint with damping for soft constraints',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'spring'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class SpringJoint2D extends Joint2D {
    private _distance: number = 1.0;
    private _stiffness: number = 10.0;
    private _damping: number = 0.5;
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
            stiffness: this._stiffness,
            damping: this._damping,
            anchorA: { x: this._anchorA.x, y: this._anchorA.y },
            anchorB: { x: this._anchorB.x, y: this._anchorB.y },
            autoConfigureDistance: this._autoConfigureDistance,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._distance = finiteOr(data.distance, 1.0);
        this._stiffness = finiteOr(data.stiffness, 10.0);
        this._damping = finiteOr(data.damping, 0.5);
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
