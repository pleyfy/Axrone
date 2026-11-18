import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { PhysicsWorld2D } from '../core/physics-world';
import type { IPhysicsWorldConfig } from '../types';

// Forward reference to avoid circular import — PhysicsBridge2D lives in
// @axrone/scene-runtime which depends on @axrone/physics-2d. We resolve it
// lazily through a registration callback set by the bridge at construction.
let _bridgeWorldProvider: (() => PhysicsWorld2D | null) | null = null;

/** @internal Called by PhysicsBridge2D to provide its world to this component. */
export function _setPhysicsWorld2DBridgeProvider(
    provider: (() => PhysicsWorld2D | null) | null
): void {
    _bridgeWorldProvider = provider;
}

@script({
    scriptName: 'PhysicsWorld2D',
    priority: 50,
    description: 'Singleton component that owns and steps the 2D physics world',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'world', '2d'],
    singleton: true,
    dependencies: [],
    executeInEditMode: false,
    validateDependencies: false,
    enableMetrics: false,
    enableCaching: false,
})
export class PhysicsWorld2DComponent extends Component {
    private static _instance: PhysicsWorld2DComponent | null = null;
    private _physicsWorld: PhysicsWorld2D | null = null;
    private _gravity: Vec2 = new Vec2(0, -9.81);
    private _velocityIterations: number = 8;
    private _positionIterations: number = 3;

    static get instance(): PhysicsWorld2DComponent | null {
        return PhysicsWorld2DComponent._instance;
    }

    get physicsWorld(): PhysicsWorld2D | null {
        return this._physicsWorld;
    }

    get gravity(): Readonly<Vec2> {
        return this._gravity;
    }

    set gravity(value: Readonly<Vec2>) {
        this._gravity.x = value.x;
        this._gravity.y = value.y;
        if (this._physicsWorld) {
            this._physicsWorld.setGravity(this._gravity);
        }
    }

    onLoad(): void {
        PhysicsWorld2DComponent._instance = this;
        // If a PhysicsBridge2D is active, reuse its world so that rigidbodies
        // and the bridge share the same PhysicsWorld2D instance.
        if (_bridgeWorldProvider) {
            const bridgeWorld = _bridgeWorldProvider();
            if (bridgeWorld) {
                this._physicsWorld = bridgeWorld;
                return;
            }
        }
        const config: IPhysicsWorldConfig = {
            gravity: { x: this._gravity.x, y: this._gravity.y },
        };
        this._physicsWorld = new PhysicsWorld2D(config);
    }

    fixedUpdate(deltaTime: number): void {
        if (!this._physicsWorld) return;
        this._physicsWorld.step(deltaTime, this._velocityIterations, this._positionIterations);
    }

    onDestroy(): void {
        if (this._physicsWorld) {
            this._physicsWorld[Symbol.dispose]();
            this._physicsWorld = null;
        }
        if (PhysicsWorld2DComponent._instance === this) {
            PhysicsWorld2DComponent._instance = null;
        }
    }

    serialize(): Record<string, any> {
        return {
            gravity: { x: this._gravity.x, y: this._gravity.y },
            velocityIterations: this._velocityIterations,
            positionIterations: this._positionIterations,
        };
    }

    deserialize(data: Record<string, any>): void {
        if (data.gravity) {
            this._gravity.x = data.gravity.x ?? 0;
            this._gravity.y = data.gravity.y ?? -9.81;
        }
        this._velocityIterations = data.velocityIterations ?? 8;
        this._positionIterations = data.positionIterations ?? 3;
    }
}
