import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { PhysicsWorld2D } from '../core/physics-world';
import type { IPhysicsWorldConfig } from '../types';
import { _getPhysicsWorld2DBridgeProvider } from './physics-world-registry';
import { normalizeVec2Like } from '../core/physics-world-2d-helpers';

// The bridge provider lives in a shared registry so that Rigidbody2D, Collider2D
// and Joint2D all resolve the same bridge-managed world. This module keeps
// re-exporting the setter to preserve its public import path.
export {
    _setPhysicsWorld2DBridgeProvider,
    _getPhysicsWorld2DBridgeProvider,
} from './physics-world-registry';

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
        const provider = _getPhysicsWorld2DBridgeProvider();
        if (provider) {
            const bridgeWorld = provider();
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
            // Editor vec2 may arrive as [x, y] as well as { x, y }.
            const gravity = normalizeVec2Like(data.gravity, 0, -9.81);
            this._gravity.x = gravity.x;
            this._gravity.y = gravity.y;
        }
        this._velocityIterations = data.velocityIterations ?? 8;
        this._positionIterations = data.positionIterations ?? 3;
    }
}
