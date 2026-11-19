import { Component } from '@axrone/ecs-runtime';
import type { IVec2Like } from '@axrone/numeric';
import type { ConstraintId } from '../types';
import type { PhysicsWorld2D } from '../core/physics-world';
import { Rigidbody2D } from './rigidbody2d';
import { PhysicsWorld2DComponent } from './physics-world-2d-component';

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

    get constraintId(): ConstraintId | null {
        return this._constraintId;
    }

    get connectedBody(): Rigidbody2D | null {
        return this._connectedBody;
    }

    set connectedBody(value: Rigidbody2D | null) {
        if (this._connectedBody !== value) {
            this._connectedBody = value;
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
        this._breakForce = Math.max(0, value);
    }

    get breakTorque(): number {
        return this._breakTorque;
    }

    set breakTorque(value: number) {
        this._breakTorque = Math.max(0, value);
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
        if (this._physicsWorld) return this._physicsWorld;
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
        if (Array.isArray(value) && value.length >= 2) {
            return {
                x: Number.isFinite(value[0]) ? value[0] : fallbackX,
                y: Number.isFinite(value[1]) ? value[1] : fallbackY,
            };
        }
        if (value && typeof value === 'object') {
            const v = value as Record<string, unknown>;
            return {
                x: typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : fallbackX,
                y: typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : fallbackY,
            };
        }
        return { x: fallbackX, y: fallbackY };
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
            breakForce: this._breakForce,
            breakTorque: this._breakTorque,
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
            this._connectedBody = (normalised as Rigidbody2D) ?? null;
        }
        this._enableCollision = data.enableCollision ?? false;
        this._breakForce = data.breakForce ?? Infinity;
        this._breakTorque = data.breakTorque ?? Infinity;
        this._jointEnabled = data.enabled ?? true;
    }
}
