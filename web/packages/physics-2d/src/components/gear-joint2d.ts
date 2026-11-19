import { script } from '@axrone/ecs-runtime/decorators';
import { isComponentReference, Joint2D } from './joint2d';
import type { ConstraintId } from '../types';
import { finiteOr } from '../core/physics-world-2d-helpers';

/**
 * Gear joint: enforces a rotation ratio between two revolute/prismatic joints.
 *
 * The gear joint couples two existing constraints (typically HingeJoint2D or
 * SliderJoint2D) so that the rotation/translation of one drives the other
 * at a fixed ratio: `θ_A + ratio × θ_B = constant`.
 *
 * ## Reference resolution strategy
 *
 * The solver requires `constraintIdA` and `constraintIdB` — the runtime IDs
 * of the two coupled constraints. Exposing raw IDs as serialisable properties
 * is fragile: prefab instantiation and scene reload regenerate IDs, breaking
 * saved references.
 *
 * **This component accepts `Joint2D` component references** (`jointA`, `jointB`)
 * and resolves their `constraintId` at runtime. This survives prefab/scene
 * ID regeneration because component references are resolved by entity
 * relationship, not by persisted numeric ID.
 *
 * ### Ordering / deferred creation
 *
 * The referenced joints must have created their constraints before the gear
 * joint can resolve. If `start()` runs before the referenced joints have
 * called `createConstraint()`, the gear joint enters a **pending state**
 * (`isPending === true`) and retries resolution on the next `fixedUpdate()`.
 * Resolution is also re-attempted when `jointA`/`jointB` setters fire.
 *
 * If resolution still fails after a configurable grace period (checked via
 * `tryResolve()`), the component logs a warning — it does NOT throw, because
 * the referenced joint may be disabled or misconfigured, and a hard error
 * would prevent the rest of the scene from loading.
 *
 * ### Reference serialisation contract (Editor ↔ Engine)
 *
 * `jointA` and `jointB` are stored as **strings** in the Editor (entity/component
 * IDs), with `""` meaning "no reference". The engine stores them as `Joint2D | null`.
 *
 * - `serialize()` emits `""` for both fields (references are managed by the
 *   scene loader, not by the component's own serialiser).
 * - `deserialize()` normalises `""`, `null`, `undefined`, and whitespace-only
 *   strings to `null`. A `null` reference means "no joint coupled" — the gear
 *   constraint is NOT created and `isPending` stays `false`. This is distinct
 *   from the pending state, which only activates when non-null references are
 *   provided but their constraints haven't been created yet.
 * - Use the inherited `normalizeReferenceValue()` helper for this rule.
 *
 * **Units** (METRE campaign):
 * - `ratio` — dimensionless (radians per radian, or metres per radian)
 *
 * Maps to solver `Gear` case.
 * **Solver**: FULL — rotation ratio enforcement.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'GearJoint2D',
    priority: 80,
    description: 'Gear joint coupling two revolute/prismatic joints at a fixed ratio',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'gear'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class GearJoint2D extends Joint2D {
    private _jointA: Joint2D | null = null;
    private _jointB: Joint2D | null = null;
    private _ratio: number = 1;
    private _pendingCreation: boolean = false;
    private _pendingWarned: boolean = false;
    private _pendingJointARef: string | null = null;
    private _pendingJointBRef: string | null = null;

    get jointA(): Joint2D | null {
        return this._jointA;
    }

    set jointA(value: Joint2D | null) {
        if (isComponentReference(value)) {
            this._pendingJointARef = null;
        }
        if (this._jointA !== value) {
            this._jointA = value;
            this.recreateConstraint();
        }
    }

    get jointB(): Joint2D | null {
        return this._jointB;
    }

    set jointB(value: Joint2D | null) {
        if (isComponentReference(value)) {
            this._pendingJointBRef = null;
        }
        if (this._jointB !== value) {
            this._jointB = value;
            this.recreateConstraint();
        }
    }

    get ratio(): number {
        return this._ratio;
    }

    set ratio(value: number) {
        if (this._ratio !== value && value !== 0) {
            this._ratio = value;
            this.recreateConstraint();
        }
    }

    /**
     * Whether constraint creation is pending because referenced joints
     * have not yet produced their constraint IDs.
     */
    get isPending(): boolean {
        return this._pendingCreation;
    }

    /**
     * Unresolved `jointA`/`jointB` entity references from the scene document.
     *
     * The gear joint couples two *other* joints, so the bridge must resolve two
     * references instead of one. Non-null entries mean "resolve me".
     */
    getPendingJointRefs(): { jointA: string | null; jointB: string | null } {
        return { jointA: this._pendingJointARef, jointB: this._pendingJointBRef };
    }

    /**
     * Resolve the pending `jointA`/`jointB` references to concrete joints.
     *
     * Idempotent: passing the already-linked pair does not recreate the
     * constraint, and passing `null` clears the corresponding pending ref so a
     * dangling entity id is not retried forever.
     */
    resolveJointRefs(jointA: Joint2D | null, jointB: Joint2D | null): void {
        const nextA = isComponentReference(jointA) ? jointA : null;
        const nextB = isComponentReference(jointB) ? jointB : null;
        const unchanged = this._jointA === nextA && this._jointB === nextB;
        this._pendingJointARef = null;
        this._pendingJointBRef = null;
        if (unchanged) return;

        this._jointA = nextA;
        this._jointB = nextB;
        this.recreateConstraint();
    }

    /**
     * Idempotently make sure the gear constraint exists, driving the deferred
     * resolution path when the coupled joints are not ready yet.
     *
     * @returns `true` when a constraint id is available after the call.
     */
    tryEnsureConstraint(): boolean {
        const created = super.tryEnsureConstraint();
        if (created) return true;
        if (this._pendingCreation) return this.tryResolve();
        return false;
    }

    /**
     * Attempt to resolve deferred constraint creation.
     * Returns `true` if the constraint was successfully created.
     *
     * If resolution fails (referenced joints haven't created constraints yet),
     * a `console.warn` is emitted **once** per pending episode to avoid spam.
     * The warning resets when resolution eventually succeeds.
     */
    tryResolve(): boolean {
        if (!this._pendingCreation) return true;
        const idA = this._resolveConstraintId(this._jointA);
        const idB = this._resolveConstraintId(this._jointB);
        if (idA === null || idB === null) {
            // Log a warning once per pending episode to avoid console spam.
            if (!this._pendingWarned) {
                this._pendingWarned = true;
                console.warn(
                    'GearJoint2D: referenced joint(s) have not created constraints yet — ' +
                    'gear coupling remains pending. Ensure both joints are initialised before the gear joint.'
                );
            }
            return false;
        }

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return false;
        if (!this._rigidbodyA?.bodyId) return false;
        if (!this._connectedBody?.bodyId) return false;

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createGearConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                constraintIdA: idA,
                constraintIdB: idB,
                ratio: this._ratio,
                collideConnected: this._enableCollision,
            });
        this._pendingCreation = false;
        this._pendingWarned = false;
        return true;
    }

    protected recreateConstraint(): void {
        this.destroyConstraint();
        this._pendingCreation = false;
        this.createConstraint();
    }

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        // If both references are null (e.g. deserialised from ""), no gear
        // coupling is configured — this is NOT a pending state, just "no
        // constraint". Pending only activates when at least one reference
        // exists but its constraint ID isn't ready yet.
        if (!this._jointA && !this._jointB) return;

        if (!this._jointA || !this._jointB) {
            this._pendingCreation = true;
            return;
        }

        const idA = this._resolveConstraintId(this._jointA);
        const idB = this._resolveConstraintId(this._jointB);

        if (idA === null || idB === null) {
            // Referenced joints haven't created constraints yet — defer.
            this._pendingCreation = true;
            return;
        }

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createGearConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                constraintIdA: idA,
                constraintIdB: idB,
                ratio: this._ratio,
                collideConnected: this._enableCollision,
            });
        // Success ends the pending episode; leaving the flag set made
        // isPending report true for a fully resolved gear joint.
        if (this._constraintId) {
            this._pendingCreation = false;
            this._pendingWarned = false;
        }
    }

    protected destroyConstraint(): void {
        this._pendingCreation = false;
        if (!this._constraintId || !this._physicsWorld) return;
        (this._physicsWorld as any).getConstraintManager().destroyConstraint(this._constraintId);
        this._constraintId = null;
    }

    private _resolveConstraintId(joint: Joint2D | null): ConstraintId | null {
        // An unresolved entity reference may still sit in _jointA/_jointB as a
        // string; `.constraintId` on it is `undefined`, which previously leaked
        // into createGearConstraint() as a non-null id. Checked structurally
        // rather than with instanceof so duck-typed joint stand-ins work.
        if (!joint || typeof joint !== 'object') return null;
        const id = joint.constraintId;
        return typeof id === 'number' && Number.isFinite(id) ? id : null;
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            // jointA/jointB: serialise as "" (Editor convention for "no reference").
            // Component references are resolved by the scene loader, not persisted
            // as raw constraintIds — IDs regenerate on prefab/scene reload.
            jointA: '',
            jointB: '',
            ratio: this._ratio,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._ratio = finiteOr(data.ratio, 1);
        // jointA/jointB: normalise empty/whitespace strings to null.
        // "" = "no reference" (Editor convention) — gear constraint is not
        // created and isPending stays false. Non-empty strings are stored
        // as-is for the scene loader to resolve to Joint2D references.
        const rawA = data.jointA;
        const rawB = data.jointB;
        if (rawA !== undefined) {
            const normalisedA = this.normalizeReferenceValue(rawA);
            this._pendingJointARef = typeof normalisedA === 'string' ? normalisedA : null;
            this._jointA = (normalisedA as Joint2D) ?? null;
        }
        if (rawB !== undefined) {
            const normalisedB = this.normalizeReferenceValue(rawB);
            this._pendingJointBRef = typeof normalisedB === 'string' ? normalisedB : null;
            this._jointB = (normalisedB as Joint2D) ?? null;
        }
    }
}
