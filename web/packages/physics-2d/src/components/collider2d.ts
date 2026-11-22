import { Component } from '@axrone/ecs-runtime';
import { Vec2 } from '@axrone/numeric';
import type { CollisionFilter, ShapeId } from '../types';
import type { PhysicsWorld2D } from '../core/physics-world';
import { normalizeVec2Like } from '../core/physics-world-2d-helpers';
import { Rigidbody2D } from './rigidbody2d';
import { PhysicsWorld2DComponent } from './physics-world-2d-component';
import { resolveBridgePhysicsWorld2D } from './physics-world-registry';

export interface PhysicsMaterial2D {
    friction: number;
    restitution: number;
    density: number;
}

export abstract class Collider2D extends Component {
    protected _shapeId: ShapeId | null = null;
    protected _physicsWorld: PhysicsWorld2D | null = null;
    protected _rigidbody: Rigidbody2D | null = null;

    protected _isTrigger: boolean = false;
    protected _material: PhysicsMaterial2D = {
        friction: 0.4,
        restitution: 0.0,
        density: 1.0,
    };
    protected _offset: Vec2 = Vec2.ZERO.clone();
    protected _colliderEnabled: boolean = true;

    protected _collisionFilter: any = {
        categoryBits: 0x0001,
        maskBits: 0xffff,
        groupIndex: 0,
    };

    get shapeId(): ShapeId | null {
        return this._shapeId;
    }

    get isTrigger(): boolean {
        return this._isTrigger;
    }

    set isTrigger(value: boolean) {
        if (this._isTrigger !== value) {
            this._isTrigger = value;
            this.updateTrigger();
        }
    }

    get material(): Readonly<PhysicsMaterial2D> {
        return this._material;
    }

    set material(value: PhysicsMaterial2D) {
        this._material = Object.assign({}, value);
        this.updateMaterial();
    }

    get friction(): number {
        return this._material.friction;
    }

    set friction(value: number) {
        this._material.friction = Math.max(0, value);
        this.updateMaterial();
    }

    get restitution(): number {
        return this._material.restitution;
    }

    set restitution(value: number) {
        this._material.restitution = Math.max(0, Math.min(1, value));
        this.updateMaterial();
    }

    get density(): number {
        return this._material.density;
    }

    set density(value: number) {
        this._material.density = Math.max(0, value);
        this.updateMaterial();
    }

    get offset(): Vec2 {
        return this._offset;
    }

    set offset(value: Vec2) {
        this._offset.x = value.x;
        this._offset.y = value.y;
        this.updateOffset();
    }

    get collisionFilter(): Readonly<CollisionFilter> {
        return this._collisionFilter;
    }

    set collisionFilter(value: CollisionFilter) {
        this._collisionFilter = Object.assign({}, value);
        this.updateCollisionFilter();
    }

    onLoad(): void {
        this._rigidbody = this.resolveRigidbody();
    }

    start(): void {
        this.createPhysicsShape();
    }

    onDestroy(): void {
        this.destroyPhysicsShape();
    }

    private resolveRigidbody(): Rigidbody2D | null {
        const comp = this.getComponent(Rigidbody2D as any);
        return comp instanceof Rigidbody2D ? comp : null;
    }

    /**
     * Idempotently make sure this collider owns a physics shape.
     *
     * Covers the two ordering hazards of a bridge-driven scene:
     * 1. `onLoad()` ran before a Rigidbody2D was attached to the same node, so
     *    `_rigidbody` is still null — look it up again.
     * 2. The Rigidbody2D exists but has not produced its bodyId yet — ask it to
     *    ensure its body before giving up.
     *
     * Safe to call repeatedly; it is a no-op once a shape exists, and it does
     * nothing while the component or the collider is disabled.
     *
     * @returns `true` when a shape id is available after the call.
     */
    tryEnsureShape(): boolean {
        if (this._shapeId) return true;
        if (!this._colliderEnabled || this.enabled === false) return false;

        if (!this._rigidbody) {
            this._rigidbody = this.resolveRigidbody();
        }
        if (!this._rigidbody) return false;

        if (!this._rigidbody.bodyId) {
            // Duck-typed guard: stand-in bodies may not implement the ensure API.
            const ensureBody = (this._rigidbody as { tryEnsureBody?: () => boolean })
                .tryEnsureBody;
            if (typeof ensureBody === 'function') ensureBody.call(this._rigidbody);
        }
        if (!this._rigidbody.bodyId) return false;

        this.createPhysicsShape();
        return Boolean(this._shapeId);
    }

    /**
     * Authored enabled state of the collider, as written by `deserialize()`.
     * Distinct from the ECS `enabled` flag: `enabled` is intentionally not
     * overridden here because the Component base class owns it.
     */
    get colliderEnabled(): boolean {
        return this._colliderEnabled;
    }

    /**
     * Set the authored enabled state. A disabled collider keeps its shape-free
     * state until it is re-enabled and `tryEnsureShape()` runs again.
     */
    set colliderEnabled(value: boolean) {
        if (this._colliderEnabled === value) return;
        this._colliderEnabled = value;
        if (!value) {
            this.destroyPhysicsShape();
        }
    }

    protected abstract createPhysicsShape(): void;
    protected abstract destroyPhysicsShape(): void;
    protected abstract updateTrigger(): void;
    protected abstract updateMaterial(): void;
    protected abstract updateOffset(): void;
    protected abstract updateCollisionFilter(): void;

    protected getPhysicsWorld(): PhysicsWorld2D | null {
        if (this._physicsWorld) {
            if (!this._physicsWorld.isDisposed) return this._physicsWorld;
            // The cached world was torn down (scene reload / bridge dispose):
            // drop it so the next resolve can bind to the live world.
            this._physicsWorld = null;
        }
        // 1. Bridge-managed world first, so a scene that only has a
        //    PhysicsBridge2D (no explicit PhysicsWorld2DComponent) still binds
        //    colliders to the same world the rigidbodies live in.
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

    serialize(): Record<string, any> {
        return {
            isTrigger: this._isTrigger,
            material: { ...this._material },
            offset: { x: this._offset.x, y: this._offset.y },
            enabled: this._colliderEnabled,
            collisionFilter: { ...this._collisionFilter },
        };
    }

    deserialize(data: Record<string, any>): void {
        this._isTrigger = data.isTrigger ?? false;
        // Copy material fields — never alias the caller's object, otherwise a
        // later `friction = x` would mutate the scene document.
        const material = data.material;
        this._material = {
            friction: Math.max(0, material?.friction ?? 0.4),
            restitution: Math.min(1, Math.max(0, material?.restitution ?? 0.0)),
            density: Math.max(0, material?.density ?? 1.0),
        };
        const offset = this.normalizeVec2(data.offset);
        this._offset = new Vec2(offset.x, offset.y);
        this._colliderEnabled = data.enabled ?? true;
        this._collisionFilter = data.collisionFilter ?? {
            categoryBits: 0x0001,
            maskBits: 0xffff,
            groupIndex: 0,
        };
    }

    /**
     * Normalise a serialised Vec2 that may arrive either as the Editor's array
     * form `[x, y]` or the engine's object form `{x, y}`.
     *
     * @see normalizeVec2Like — shared with `Joint2D`.
     */
    protected normalizeVec2(
        value: unknown,
        fallbackX: number = 0,
        fallbackY: number = 0
    ): { x: number; y: number } {
        return normalizeVec2Like(value, fallbackX, fallbackY);
    }
}
