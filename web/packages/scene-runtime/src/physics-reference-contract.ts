/**
 * Structural adapter for the deferred-reference contract shared by the 2D/3D
 * physics components and the scene runtime.
 *
 * The scene runtime owns neither `@axrone/physics-2d` nor `@axrone/physics-3d`
 * component sources, and the lean 2D entry graph is architecture-banned from
 * importing `physics-2d` at all (see
 * `tests/architecture/scene-split/lean-entry-graph-boundary.test.ts`). Every
 * helper here therefore works from the members' *shapes* instead of their
 * classes, which also keeps scene-runtime compilable while the physics packages
 * grow the contract in a parallel workstream.
 *
 * Contract, as authored by the Editor and stored by the components:
 *   - reference fields (`connectedBody`, `jointA`, `jointB`) are entity id
 *     strings (`"ent_2"`) or component id strings (`"Rigidbody2D_42"`) until
 *     something resolves them to a component instance;
 *   - `tryEnsureBody` / `tryEnsureShape` / `tryEnsureConstraint` create the
 *     solver-side object on demand and report whether it now exists;
 *   - `getPendingConnectedBodyRef` / `resolveConnectedBodyRef` and
 *     `getPendingJointRefs` / `resolveJointRefs` are the typed channels for the
 *     unresolved ids, and `tryResolve` retries a deferred gear constraint.
 *
 * Nothing here throws and nothing here mutates a component that has not
 * declared the member it is given, so an older physics build degrades to
 * "reference left as authored", which the bridge retries on a later pass.
 */

const REFERENCE_ENVELOPE_KEYS = new Set(['connectedBody', 'jointA', 'jointB']);

interface PrototypeProbe {
    readonly [key: string]: unknown;
}

interface ReferenceEnvelope {
    readonly kind?: unknown;
    readonly target?: unknown;
}

interface BodyRefContract {
    getPendingConnectedBodyRef?(): string | null;
    resolveConnectedBodyRef?(body: unknown): void;
    tryEnsureConstraint?(): boolean;
    createConstraint?(): void;
    destroyConstraint?(): void;
    readonly _connectedBody?: unknown;
    readonly constraintId?: unknown;
}

interface GearRefContract {
    getPendingJointRefs?(): { jointA: string | null; jointB: string | null } | undefined;
    resolveJointRefs?(jointA: unknown, jointB: unknown): void;
    tryResolve?(): boolean;
    readonly jointA?: unknown;
    readonly jointB?: unknown;
    readonly _jointA?: unknown;
    readonly _jointB?: unknown;
}

interface BodyEnsureContract {
    tryEnsureBody?(): boolean;
    createPhysicsBody?(): void;
    readonly bodyId?: unknown;
}

interface ShapeEnsureContract {
    tryEnsureShape?(): boolean;
    createPhysicsShape?(): void;
    readonly shapeId?: unknown;
    readonly _rigidbody?: unknown;
}

/**
 * True when `key` is declared on the prototype chain of `value`.
 *
 * Reading the member directly would run user getters; declaring the member on
 * the class is the contract both physics packages honour, so the prototype
 * chain is the safe place to ask.
 */
export function hasDeclaredMember(value: unknown, key: string): boolean {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return false;
    }

    let prototype: object | null = Object.getPrototypeOf(value as object);
    while (prototype && prototype !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(prototype, key)) {
            return true;
        }
        prototype = Object.getPrototypeOf(prototype);
    }

    return Object.prototype.hasOwnProperty.call(value as object, key);
}

/** Anything exposing a `bodyId` accessor is a rigidbody to the bridge. */
export function isRigidbodyLike(value: unknown): boolean {
    return hasDeclaredMember(value, 'bodyId');
}

/**
 * True for the flat/planar rigidbody, false for the spatial one.
 *
 * The mixed scene profile runs both physics worlds, so a single entity can carry
 * a `Rigidbody2D` and a `Rigidbody3D`; a reference resolver that ignores the
 * dimension can link a 2D joint to a 3D body. The markers are the only members
 * each package declares exclusively for its dimension.
 */
export function isRigidbody3DLike(value: unknown): boolean {
    return (
        isRigidbodyLike(value) &&
        (hasDeclaredMember(value, 'useGravity') || hasDeclaredMember(value, 'isKinematic'))
    );
}

/** Anything exposing a `constraintId` accessor is a joint to the bridge. */
export function isJointLike(value: unknown): boolean {
    return hasDeclaredMember(value, 'constraintId') && hasDeclaredMember(value, 'connectedBody');
}

/** The spatial joint marker: only `physics-3d` authors a connected anchor. */
export function isJoint3DLike(value: unknown): boolean {
    return isJointLike(value) && hasDeclaredMember(value, 'autoConfigureConnectedAnchor');
}

/** A gear joint couples two other joints, so it declares both ends. */
export function isGearJointLike(value: unknown): boolean {
    return (
        isJointLike(value) &&
        hasDeclaredMember(value, 'jointA') &&
        hasDeclaredMember(value, 'jointB')
    );
}

/**
 * Extracts an id from an authored reference value.
 *
 * Accepts the bare id string the Editor writes and the `{ kind, target }`
 * envelope `@axrone/scene-prefab` uses, and returns `null` for empties and for
 * values that are already resolved component references.
 */
export function readReferenceId(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.trim().length > 0 ? value : null;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const target = (value as ReferenceEnvelope).target;
        if (typeof target === 'string' && target.trim().length > 0) {
            return target;
        }
    }

    return null;
}

/** True when `key` is one of the reference fields this adapter understands. */
export function isComponentReferenceField(key: string): boolean {
    return REFERENCE_ENVELOPE_KEYS.has(key);
}

/**
 * The unresolved `connectedBody` id of a joint, from whichever channel the
 * physics build exposes.
 *
 * The typed pending channel wins; the raw backing field is still read because
 * a scene document that nothing has resolved yet leaves the id there.
 */
export function readPendingBodyReference(joint: unknown): string | null {
    const contract = joint as BodyRefContract;

    if (typeof contract.getPendingConnectedBodyRef === 'function') {
        const pending = readReferenceId(contract.getPendingConnectedBodyRef());
        if (pending !== null) {
            return pending;
        }
    }

    return readReferenceId(contract._connectedBody);
}

/**
 * The unresolved `jointA` / `jointB` ids of a gear joint.
 *
 * `jointA` / `jointB` are typed as component references but hold whatever the
 * scene document authored, so an id string is read as pending — only an object
 * that is not a `{ kind, target }` envelope counts as already resolved.
 */
export function readPendingJointReferences(
    gear: unknown
): { readonly jointA: string | null; readonly jointB: string | null } {
    const contract = gear as GearRefContract;
    let jointA: string | null = null;
    let jointB: string | null = null;

    if (typeof contract.getPendingJointRefs === 'function') {
        const pending = contract.getPendingJointRefs();
        if (pending) {
            jointA = readReferenceId(pending.jointA);
            jointB = readReferenceId(pending.jointB);
        }
    }

    if (jointA === null) {
        jointA = readReferenceId(contract.jointA) ?? readReferenceId(contract._jointA);
    }
    if (jointB === null) {
        jointB = readReferenceId(contract.jointB) ?? readReferenceId(contract._jointB);
    }

    return { jointA, jointB };
}

/**
 * The joint instance already linked to one end of a gear joint, if any.
 *
 * An authored-but-unresolved reference (id string, `{ kind, target }` envelope)
 * is not a link and reads back as `null`, so callers can distinguish "already
 * coupled" from "still an id".
 */
export function readResolvedJointReference(gear: unknown, end: 'jointA' | 'jointB'): unknown | null {
    const value = (gear as GearRefContract)[end];
    if (!value || typeof value !== 'object') {
        return null;
    }
    const target = (value as ReferenceEnvelope).target;
    return typeof target === 'string' ? null : value;
}

/**
 * Links a resolved rigidbody into a joint.
 *
 * `resolveConnectedBodyRef(null)` clears the pending reference on builds that
 * have it, so callers must only use it for a body that was actually found; a
 * dangling id may describe an entity that a later prefab instance will create.
 */
export function applyBodyReference(joint: unknown, body: unknown): void {
    const contract = joint as BodyRefContract;
    if (typeof contract.resolveConnectedBodyRef === 'function') {
        contract.resolveConnectedBodyRef(body);
        return;
    }

    if (typeof contract._connectedBody === 'string') {
        (contract as { _connectedBody?: unknown })._connectedBody = body;
    }
}

/**
 * Links resolved joints into a gear joint's `jointA` / `jointB`.
 *
 * The typed API takes both ends at once and clears whatever it is not given, so
 * it is only used when at least one pending reference exists and every pending
 * reference is resolvable now; otherwise the resolvable ends are written
 * directly. With nothing pending the gear joint's own links are authoritative
 * and are left untouched.
 */
export function applyJointReferences(
    gear: unknown,
    resolvedA: unknown | null,
    resolvedB: unknown | null,
    pendingA: string | null,
    pendingB: string | null
): boolean {
    const contract = gear as GearRefContract;
    if (pendingA === null && pendingB === null) {
        return false;
    }

    const bothReady =
        (pendingA === null || resolvedA !== null) && (pendingB === null || resolvedB !== null);

    if (bothReady && typeof contract.resolveJointRefs === 'function') {
        contract.resolveJointRefs(resolvedA, resolvedB);
        return resolvedA !== null || resolvedB !== null;
    }

    let changed = false;
    if (pendingA !== null && resolvedA !== null && typeof contract._jointA === 'string') {
        (contract as { _jointA?: unknown })._jointA = resolvedA;
        changed = true;
    }
    if (pendingB !== null && resolvedB !== null && typeof contract._jointB === 'string') {
        (contract as { _jointB?: unknown })._jointB = resolvedB;
        changed = true;
    }

    return changed;
}

/** @returns true when the joint owns a solver constraint after this call. */
export function ensureJointConstraint(joint: unknown): boolean {
    const contract = joint as BodyRefContract & GearRefContract;
    if (contract.constraintId != null) return true;

    if (typeof contract.tryEnsureConstraint === 'function') {
        contract.tryEnsureConstraint();
    } else if (typeof contract.createConstraint === 'function') {
        contract.createConstraint();
    }

    // A gear constraint can only be built once both coupled constraints exist,
    // which is the one case createConstraint() defers instead of solving.
    if (contract.constraintId == null && typeof contract.tryResolve === 'function') {
        contract.tryResolve();
    }

    return contract.constraintId != null;
}

/** @returns true when this call destroyed a live constraint. */
export function destroyJointConstraint(joint: unknown): boolean {
    const contract = joint as BodyRefContract;
    if (contract.constraintId == null) return false;

    if (typeof contract.destroyConstraint === 'function') {
        contract.destroyConstraint();
    }

    return contract.constraintId == null;
}

/** @returns true when this call produced the body id. */
export function ensureRigidbodyBody(rigidbody: unknown): boolean {
    const contract = rigidbody as BodyEnsureContract;
    if (contract.bodyId != null) return false;

    if (typeof contract.tryEnsureBody === 'function') {
        contract.tryEnsureBody();
    } else if (typeof contract.createPhysicsBody === 'function') {
        contract.createPhysicsBody();
    }

    return contract.bodyId != null;
}

/**
 * @param rigidbody local body, used only by builds without `tryEnsureShape()`.
 * @returns true when this call produced the shape id.
 */
export function ensureColliderShape(collider: unknown, rigidbody: unknown): boolean {
    const contract = collider as ShapeEnsureContract;
    if (contract.shapeId != null) return false;

    if (typeof contract.tryEnsureShape === 'function') {
        contract.tryEnsureShape();
        return contract.shapeId != null;
    }

    // Pre-contract fallback for the two hazards tryEnsureShape() covers: a
    // rigidbody attached after the collider, and one without a body id yet.
    if (!contract._rigidbody) {
        (contract as { _rigidbody?: unknown })._rigidbody = rigidbody;
    }
    if (!isRigidbodyLike(contract._rigidbody) || (contract._rigidbody as BodyEnsureContract).bodyId == null) {
        return false;
    }

    if (typeof contract.createPhysicsShape === 'function') {
        contract.createPhysicsShape();
    }

    return contract.shapeId != null;
}
