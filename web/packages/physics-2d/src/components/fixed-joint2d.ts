import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { Joint2D } from './joint2d';

/**
 * Fixed/weld joint: rigidly attaches two bodies so their relative transform
 * is preserved.
 *
 * Maps to solver `Weld` case.
 * **Solver**: FULL — 3-row Jacobian (x, y, angle) with optional soft constraint
 * (stiffness/damping via frequency/dampingRatio). Velocity + position correction active.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'FixedJoint2D',
    priority: 80,
    description: 'Fixed/weld joint for rigid attachment',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'fixed', 'weld'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class FixedJoint2D extends Joint2D {
    private _anchor: Vec2 = Vec2.ZERO.clone();
    private _dampingRatio: number = 0.7;
    private _frequency: number = 0;
    private _connectedAnchor: Vec2 = Vec2.ZERO.clone();
    private _autoConfigureConnectedAnchor: boolean = true;

    get anchor(): Vec2 {
        return this._anchor;
    }

    set anchor(value: Vec2) {
        this._anchor.x = value.x;
        this._anchor.y = value.y;
        this.recreateConstraint();
    }

    get dampingRatio(): number {
        return this._dampingRatio;
    }

    set dampingRatio(value: number) {
        if (this._dampingRatio !== value && value >= 0 && value <= 1) {
            this._dampingRatio = value;
            this.recreateConstraint();
        }
    }

    get frequency(): number {
        return this._frequency;
    }

    set frequency(value: number) {
        if (this._frequency !== value && value >= 0) {
            this._frequency = value;
            this.recreateConstraint();
        }
    }

    get connectedAnchor(): Vec2 {
        return this._connectedAnchor;
    }

    set connectedAnchor(value: Vec2) {
        this._connectedAnchor.x = value.x;
        this._connectedAnchor.y = value.y;
        this.recreateConstraint();
    }

    // No public `autoConfigureConnectedAnchor` accessor on purpose: scene-runtime
    // discriminates 2D from 3D joints by that member name (physics-reference-contract
    // isJoint3DLike), and `physics-3d` owns it. The flag stays private + authored-only.

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        const stiffness = this._frequency > 0 ? this._frequency * this._frequency : 0;
        const damping = 2 * this._dampingRatio * Math.sqrt(stiffness);

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createWeldConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchor.x, y: this._anchor.y },
                // Auto-configured maps the authored world anchor into B's space.
                localAnchorB: this._autoConfigureConnectedAnchor
                    ? this.resolveAutoConnectedAnchor(this._anchor)
                    : { x: this._connectedAnchor.x, y: this._connectedAnchor.y },
                referenceAngle: 0,
                stiffness,
                damping,
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
            anchor: { x: this._anchor.x, y: this._anchor.y },
            dampingRatio: this._dampingRatio,
            frequency: this._frequency,
            connectedAnchor: { x: this._connectedAnchor.x, y: this._connectedAnchor.y },
            autoConfigureConnectedAnchor: this._autoConfigureConnectedAnchor,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        // Vec2 fields: Editor writes ARRAY [x,y], engine uses OBJECT {x,y}.
        // normalizeVec2Value accepts both formats for backward compatibility.
        if (data.anchor !== undefined) {
            const v = this.normalizeVec2Value(data.anchor);
            this._anchor.x = v.x;
            this._anchor.y = v.y;
        }
        this._dampingRatio = data.dampingRatio ?? 0.7;
        this._frequency = data.frequency ?? 0;
        // anchorB is the Editor alias for the connected-body anchor.
        const connectedAnchorRaw = data.connectedAnchor ?? data.anchorB;
        if (connectedAnchorRaw !== undefined) {
            const v = this.normalizeVec2Value(connectedAnchorRaw);
            this._connectedAnchor.x = v.x;
            this._connectedAnchor.y = v.y;
        }
        this._autoConfigureConnectedAnchor = data.autoConfigureConnectedAnchor ?? true;
    }
}
