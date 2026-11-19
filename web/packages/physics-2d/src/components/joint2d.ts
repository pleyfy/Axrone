import { Component } from '@axrone/ecs-runtime';
import type { IVec2Like } from '@axrone/numeric';
import type { ConstraintId } from '../types';
import type { PhysicsWorld2D } from '../core/physics-world';
import { normalizeVec2Like } from '../core/physics-world-2d-helpers';
import { Rigidbody2D } from './rigidbody2d';
import { PhysicsWorld2DComponent } from './physics-world-2d-component';
import { resolveBridgePhysicsWorld2D } from './physics-world-registry';

/**
 * "No break limit" sentinel written by the Editor.
 *
 * @see Editor/src/lib/editor/state/scene-inspector/schema/sections-joints2d.ts
 *      (`JOINT_2D_BREAK_LIMIT = 1e18`)
 *
 * `Infinity` cannot survive `JSON.stringify` (it becomes `null`), so the Editor
 * stores a huge finite sentinel instead. The engine converts it back to
 * `Infinity` on load and writes the sentinel again on save.
 */
export const JOINT_2D_BREAK_LIMIT = 1e18;

/**
 * Normalise a break force/torque value from a scene document.
 *
 * Accepted inputs:
 * - `undefined` / `null` (JSON's rendering of a previous `Infinity`) → `Infinity`
 * - `Infinity` → `Infinity`
 * - any value `>= JOINT_2D_BREAK_LIMIT` → `Infinity` (Editor sentinel)
 * - negative / non-finite garbage → clamped to `0` or `Infinity` respectively
 * - a normal finite number → clamped to `>= 0`
 */
export function normalizeBreakLimit(value: unknown): number {
    if (value === null || value === undefined) return Infinity;
    if (typeof value !== 'number' || Number.isNaN(value)) return Infinity;
    if (value === Infinity) return Infinity;
    if (value === -Infinity) return 0;
    if (!Number.isFinite(value)) return Infinity;
    if (value >= JOINT_2D_BREAK_LIMIT) return Infinity;
    return Math.max(0, value);
}

/** Encode an internal break limit for a scene document (see {@link JOINT_2D_BREAK_LIMIT}). */
export function encodeBreakLimit(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : JOINT_2D_BREAK_LIMIT;
}

/**
 * Whether a serialised reference value is a component object rather than an
 * unresolved entity-id string.
 *
 * Structural (not `instanceof`) on purpose: the bridge and existing suites
 * legitimately hand over duck-typed component stand-ins.
 *
 * @internal
 */
export function isComponentReference(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
}

/**
 * 2D joint solver capability matrix.
 *
 * | Component         | Constraint type | Solver case  | Solver status |
 * |-------------------|-----------------|--------------|---------------|
 * | DistanceJoint2D   | Distance        | Distance     | **FULL** — Jacobian + Baumgarte + soft spring |
 * | SpringJoint2D     | Distance (soft) | Distance     | **FULL** — same path, stiffness/damping active |
 * | HingeJoint2D      | Revolute        | Revolute     | **FULL** — anchor + limit + motor |
 * | SliderJoint2D     | Prismatic       | Prismatic    | **FULL** — lateral lock + rotation lock + limit + motor |
 * | FixedJoint2D      | Weld            | Weld         | **FULL** — 3-row Jacobian (x, y, angle) + soft |
 * | WheelJoint2D      | Wheel           | Wheel        | **FULL** — lateral + suspension + limit + motor |
 * | MotorJoint2D      | Motor           | Motor        | **FULL** — linear offset + angular offset |
 * | MouseJoint2D      | Mouse           | Mouse        | **FULL** — soft target seek + force clamp |
 * | GearJoint2D       | Gear            | Gear         | **FULL** — rotation ratio enforcement |
 * | RopeJoint2D       | Rope            | Rope         | **FULL** — unilateral max-length guard |
 *
 * All 10 constraint types have real solver implementations with Jacobians,
 * bias computation, and impulse solving. No decorative joints.
 * All 10 also have `@script` component wrappers — users never need to
 * call the constraint manager directly.
 *
 * ## 2D / 3D asymmetry
 *
 * 2D has **10 joint types, all FULL** — zero unsupported types.
 * 3D has 10 joint types but only **3 FULL** (Distance, Revolute, Weld);
 * 4 are UNSUPPORTED (Slider, Prismatic solver exists but no component;
 * ConeTwist, Configurable have no solver); 3 are PARTIAL.
 * See `JOINT_CAPABILITY_3D` in `physics-3d` for the 3D matrix.
 */
export const JOINT_CAPABILITY_2D = {
    DISTANCE: 'full',
    SPRING: 'full',
    REVOLUTE: 'full',
    PRISMATIC: 'full',
    WELD: 'full',
    WHEEL: 'full',
    MOTOR: 'full',
    MOUSE: 'full',
    GEAR: 'full',
    ROPE: 'full',
} as const;

export type JointCapability2D = typeof JOINT_CAPABILITY_2D[keyof typeof JOINT_CAPABILITY_2D];

/**
 * Base class for all 2D joint components.
 *
 * All 10 joint types (Distance, Spring, Hinge, Slider, Fixed, Wheel, Motor,
 * Mouse, Gear, Rope) have fully functional solvers AND `@script` component
 * wrappers. See {@link JOINT_CAPABILITY_2D} for the complete capability matrix.
 *
 * Lifecycle: `onLoad()` resolves the local Rigidbody2D → `start()` calls
 * `createConstraint()` → `onDestroy()` calls `destroyConstraint()`.
 * Property setters call `recreateConstraint()` which destroys and re-creates.
 *
 * ## Reference serialisation contract (Editor ↔ Engine)
 *
 * Component references (`connectedBody`, `jointA`, `jointB`) are stored as
 * **strings** in the Editor (entity/component IDs), with `""` meaning "no
 * reference". The engine stores them as typed object references (`Rigidbody2D
 * | null`, `Joint2D | null`).
 *
 * - `serialize()` emits `""` when the reference is `null`, matching the
 *   Editor's expected default.
 * - `deserialize()` normalises `""`, `undefined`, `null`, and whitespace-only
 *   strings to `null`. Non-empty string values are stored as-is (the scene
 *   loader resolves them to component references via entity relationships
 *   after `deserialize()` completes).
 * - Use {@link normalizeReferenceValue} to apply this rule in subclasses.
 *
 * @see JOINT_CAPABILITY_2D
 */
export abstract class Joint2D extends Component {
    protected _constraintId: ConstraintId | null = null;
    protected _physicsWorld: PhysicsWorld2D | null = null;
    protected _rigidbodyA: Rigidbody2D | null = null;
    protected _rigidbodyB: Rigidbody2D | null = null;

    protected _connectedBody: Rigidbody2D | null = null;
    protected _enableCollision: boolean = false;
    protected _breakForce: number = Infinity;
    protected _breakTorque: number = Infinity;
    protected _jointEnabled: boolean = true;

    /**
     * Entity reference string received from the scene document that the scene
     * loader / bridge has not resolved to a `Rigidbody2D` yet (`"ent_2"`).
     *
     * `_connectedBody` keeps whatever the document handed over (a resolved
     * component, or the raw value) to preserve the existing serialisation
     * contract; this field is the *typed* pending channel used by
     * {@link getPendingConnectedBodyRef} / {@link resolveConnectedBodyRef}.
     */
    protected _pendingConnectedBodyRef: string | null = null;

    get constraintId(): ConstraintId | null {
        return this._constraintId;
    }

    get connectedBody(): Rigidbody2D | null {
        return this._connectedBody;
    }

    set connectedBody(value: Rigidbody2D | null) {
        if (isComponentReference(value)) {
            this._pendingConnectedBodyRef = null;
        }
        if (this._connectedBody !== value) {
            this._connectedBody = value;
            this.recreateConstraint();
        }
    }

    /**
     * Unresolved `connectedBody` entity reference from the scene document.
     *
     * The bridge owns the entity-id → component map, so it asks every joint for
     * a non-null ref, resolves it, and feeds it back through
     * {@link resolveConnectedBodyRef}. Returns `null` once resolved or when no
     * reference was authored.
     */
    getPendingConnectedBodyRef(): string | null {
        return this._pendingConnectedBodyRef;
    }

    /**
     * Resolve the pending `connectedBody` reference to a concrete rigidbody.
     *
     * Idempotent: calling it with the same body twice does not recreate the
     * constraint, and calling it with `null` simply clears the pending ref so a
     * dangling entity id cannot be retried forever.
     *
     * @param body resolved body, or `null` when the reference could not be found.
     */
    resolveConnectedBodyRef(body: Rigidbody2D | null): void {
        const resolved = isComponentReference(body) ? body : null;
        const alreadyLinked = this._connectedBody === resolved;
        this._pendingConnectedBodyRef = null;
        if (alreadyLinked) return;

        this._connectedBody = resolved;
        // Only (re)build the constraint once both ends have real bodies;
        // recreateConstraint() is a no-op-safe call otherwise.
        if (this._rigidbodyA?.bodyId) {
            this.recreateConstraint();
        }
    }

    get enableCollision(): boolean {
        return this._enableCollision;
    }

    set enableCollision(value: boolean) {
        if (this._enableCollision !== value) {
            this._enableCollision = value;
            this.recreateConstraint();
        }
    }

    get breakForce(): number {
        return this._breakForce;
    }

    set breakForce(value: number) {
        this._breakForce = normalizeBreakLimit(value);
    }

    get breakTorque(): number {
        return this._breakTorque;
    }

    set breakTorque(value: number) {
        this._breakTorque = normalizeBreakLimit(value);
    }

    private _missingBodyWarned: boolean = false;

    onLoad(): void {
        this.resolveRigidbodyA();
        if (!this._rigidbodyA && !this._missingBodyWarned) {
            this._missingBodyWarned = true;
            // The editor adds components in arbitrary order, so a joint may be
            // created before its body. Keep the component and bind once the
            // body exists instead of failing the add.
            console.warn(
                `[Joint2D] ${this.constructor.name} has no Rigidbody2D on its actor; ` +
                    'the joint stays inactive until one is added.'
            );
        }
    }

    start(): void {
        this.resolveRigidbodyA();
        this.createConstraint();
    }

    /**
     * Retries the deferred bind while the joint has no constraint. This covers
     * the editor path where the Rigidbody2D is added after the joint, and the
     * scene-loader path where a reference resolves after deserialize.
     */
    update(): void {
        if (this._constraintId) {
            return;
        }

        if (!this.resolveRigidbodyA() || !this._connectedBody) {
            return;
        }

        this.createConstraint();
    }

    onDestroy(): void {
        this.destroyConstraint();
    }

    /**
     * Idempotently make sure this joint owns a solver constraint.
     *
     * Handles the ordering hazards of a bridge-driven scene, where the joint may
     * be touched before its own `onLoad()`/`start()` ran, before the local
     * Rigidbody2D produced a bodyId, or before the connected body reference was
     * resolved by the bridge.
     *
     * Safe to call repeatedly; returns `false` while a prerequisite is missing
     * so the caller can retry on a later pass instead of throwing.
     */
    tryEnsureConstraint(): boolean {
        if (this._constraintId) return true;
        if (!this._jointEnabled || this.enabled === false) return false;

        if (!this._rigidbodyA) {
            const comp = this.getComponent(Rigidbody2D as any) as Rigidbody2D | undefined;
            if (isComponentReference(comp)) this._rigidbodyA = comp as Rigidbody2D;
        }
        if (!this._rigidbodyA) return false;

        // A connectedBody that is still an unresolved entity reference cannot
        // produce a constraint — wait for resolveConnectedBodyRef().
        if (this._connectedBody && !isComponentReference(this._connectedBody)) {
            return false;
        }

        if (!this._rigidbodyA.bodyId) {
            // Duck-typed guard: stand-in bodies may not implement the ensure API.
            const ensureBody = (this._rigidbodyA as { tryEnsureBody?: () => boolean })
                .tryEnsureBody;
            if (typeof ensureBody === 'function') ensureBody.call(this._rigidbodyA);
        }
        if (!this._rigidbodyA.bodyId) return false;

        this.createConstraint();
        return Boolean(this._constraintId);
    }

    /** Authored enabled state of the joint (ECS `enabled` is owned by Component). */
    get jointEnabled(): boolean {
        return this._jointEnabled;
    }

    set jointEnabled(value: boolean) {
        this.syncEnabledState(value);
    }

    /**
     * Set the authored enabled state and push it to the solver constraint, so a
     * disabled joint stops constraining without being destroyed.
     */
    syncEnabledState(enabled: boolean): void {
        const next = enabled && this.enabled !== false;
        if (this._jointEnabled !== enabled) {
            this._jointEnabled = enabled;
        }
        if (!this._constraintId || !this._physicsWorld || this._physicsWorld.isDisposed) return;
        (this._physicsWorld as any)
            .getConstraintManager()
            .setEnabled(this._constraintId, next);
    }

    /**
     * Resolves the local body once. Safe to call every frame while unbound.
     */
    protected resolveRigidbodyA(): Rigidbody2D | null {
        if (this._rigidbodyA) {
            return this._rigidbodyA;
        }

        const comp = this.getComponent(Rigidbody2D as any);
        this._rigidbodyA = comp instanceof Rigidbody2D ? comp : null;
        return this._rigidbodyA;
    }

    protected abstract createConstraint(): void;
    protected abstract destroyConstraint(): void;

    protected recreateConstraint(): void {
        this.resolveRigidbodyA();
        this.destroyConstraint();
        this.createConstraint();
    }

    protected getPhysicsWorld(): PhysicsWorld2D | null {
        if (this._physicsWorld) {
            if (!this._physicsWorld.isDisposed) return this._physicsWorld;
            // The cached world was torn down (scene reload / bridge dispose):
            // drop it so the next resolve can bind to the live world.
            this._physicsWorld = null;
        }
        // 1. Bridge-managed world first, so joints attach to the same world the
        //    bridge steps even when the scene has no PhysicsWorld2DComponent.
        const bridgeWorld = resolveBridgePhysicsWorld2D();
        if (bridgeWorld) {
            this._physicsWorld = bridgeWorld;
            return this._physicsWorld;
        }
        // 2. Fall back to the PhysicsWorld2DComponent singleton.
        const worldComponent = PhysicsWorld2DComponent.instance;
        if (worldComponent?.physicsWorld) {
            this._physicsWorld = worldComponent.physicsWorld;
            return this._physicsWorld;
        }
        return null;
    }

    /**
     * Normalise a serialised Vec2 value to {x, y} object format.
     *
     * The Editor stores Vec2 values as **arrays** `[x, y]` in scene JSON
     * (source: `Editor/src-tauri/src/scene/components.rs` `*_properties()`).
     * The engine's internal representation uses `{x, y}` objects (IVec2Like).
     *
     * This helper accepts BOTH formats for backward compatibility:
     * - Array: `[x, y]` → `{x, y}` (Editor contract)
     * - Object: `{x, y}` → pass-through (engine round-trip)
     *
     * @see normalizeVec3Value in `physics-3d/src/components/joint3d.ts` —
     *   3D counterpart. Both MUST change together if the format contract evolves.
     * @see normalizeReferenceValue for the reference normalisation pattern.
     * @see JOINT_CAPABILITY_2D for the joint capability matrix.
     */
    protected normalizeVec2Value(
        value: unknown,
        fallbackX: number = 0,
        fallbackY: number = 0
    ): IVec2Like {
        return normalizeVec2Like(value, fallbackX, fallbackY);
    }

    /**
     * Normalise a serialised reference value to the engine's internal
     * representation.
     *
     * The Editor stores component references as strings (`""` = no reference).
     * This method converts `""`, `null`, `undefined`, and whitespace-only
     * strings to `null`. Any other value (entity ID string, or already-resolved
     * component reference) is returned as-is for the scene loader to resolve.
     *
     * @param value - Raw value from serialised data (Editor contract: `string`).
     * @returns `null` when the reference is empty/missing, otherwise the
     *   original value for downstream resolution.
     */
    protected normalizeReferenceValue(value: unknown): unknown {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
            return value.trim() === '' ? null : value;
        }
        // Already a resolved component reference — pass through.
        return value;
    }

    serialize(): Record<string, any> {
        return {
            // Reference serialisation contract: emit "" for null references
            // (Editor convention). Non-null references are resolved by the
            // scene loader — the serialised placeholder keeps the key present.
            connectedBody: '',
            enableCollision: this._enableCollision,
            // Infinity is not JSON-representable; emit the Editor's sentinel so a
            // saved scene round-trips to the same unbounded break limit.
            breakForce: encodeBreakLimit(this._breakForce),
            breakTorque: encodeBreakLimit(this._breakTorque),
            enabled: this._jointEnabled,
        };
    }

    deserialize(data: Record<string, any>): void {
        // connectedBody: Editor sends "" for no reference, or an entity ID
        // string. Normalise empties to null; non-empty values are resolved
        // by the scene loader after this call.
        const rawCB = data.connectedBody;
        if (rawCB !== undefined) {
            const normalised = this.normalizeReferenceValue(rawCB);
            // Entity-id strings go to the typed pending channel for the bridge;
            // already-resolved component references pass through untouched.
            this._pendingConnectedBodyRef = typeof normalised === 'string' ? normalised : null;
            this._connectedBody = (normalised as Rigidbody2D) ?? null;
        }
        this._enableCollision = data.enableCollision ?? false;
        this._breakForce = normalizeBreakLimit(data.breakForce);
        this._breakTorque = normalizeBreakLimit(data.breakTorque);
        this._jointEnabled = data.enabled ?? true;
    }
}
