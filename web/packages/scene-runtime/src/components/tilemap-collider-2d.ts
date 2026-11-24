import { Component, script } from '@axrone/ecs-runtime';
import {
    PhysicsWorld2DComponent,
    resolveBridgePhysicsWorld2D,
    type PhysicsWorld2D,
} from '@axrone/physics-2d';

export interface TilemapCollider2DConfig {
    readonly mapId?: string;
    /** Layer whose non-zero collision masks become static bodies. */
    readonly collisionLayer?: string;
    readonly oneWay?: boolean;
    readonly enabled?: boolean;
}

/**
 * Declares that an entity's map contributes static collision. The actual body
 * building lives in the collision builder and never in `@axrone/physics-2d`.
 *
 * A scene may author only a `PhysicsBridge2D`, which owns its world outside of
 * the `PhysicsWorld2DComponent` singleton. `physicsWorld` therefore resolves
 * through the same shared bridge provider every other 2D physics component uses,
 * so the builder can reach the live world with no world component in the scene.
 */
@script({
    scriptName: 'TilemapCollider2D',
    priority: 90,
    executeInEditMode: true,
    singleton: false,
    trackInstances: false,
})
export class TilemapCollider2D extends Component {
    #mapId = '';
    #collisionLayer = '';
    #oneWay = false;
    #physicsWorld: PhysicsWorld2D | null = null;

    constructor(config: TilemapCollider2DConfig = {}) {
        super();
        this.#mapId = config.mapId ?? '';
        this.#collisionLayer = config.collisionLayer ?? '';
        this.#oneWay = config.oneWay ?? false;
        if (config.enabled === false) this.enabled = false;
    }

    get mapId(): string {
        return this.#mapId;
    }

    set mapId(value: string) {
        if (this.#mapId === value) return;
        this.#mapId = value;
        this.invalidateWorldCache();
    }

    get collisionLayer(): string {
        return this.#collisionLayer;
    }

    set collisionLayer(value: string) {
        if (this.#collisionLayer === value) return;
        this.#collisionLayer = value;
        this.invalidateWorldCache();
    }

    get oneWay(): boolean {
        return this.#oneWay;
    }

    set oneWay(value: boolean) {
        if (this.#oneWay === value) return;
        this.#oneWay = value;
        this.invalidateWorldCache();
    }

    /**
     * The live 2D physics world the tilemap's static collision belongs to, or
     * `null` when neither a bridge nor a world component is active. Resolved
     * lazily on access and cached; read-only so shape work cannot leak here.
     */
    get physicsWorld(): PhysicsWorld2D | null {
        if (this.#physicsWorld) {
            if (!this.#physicsWorld.isDisposed) return this.#physicsWorld;
            // Torn down by a scene reload or bridge dispose: drop the cache so
            // the next resolve can bind to the live world.
            this.#physicsWorld = null;
        }

        const bridgeWorld = resolveBridgePhysicsWorld2D();
        if (bridgeWorld) {
            this.#physicsWorld = bridgeWorld;
            return this.#physicsWorld;
        }

        const singletonWorld = PhysicsWorld2DComponent.instance?.physicsWorld ?? null;
        if (singletonWorld && !singletonWorld.isDisposed) {
            this.#physicsWorld = singletonWorld;
            return this.#physicsWorld;
        }
        return null;
    }

    override serialize(): Record<string, unknown> {
        return {
            mapId: this.#mapId,
            collisionLayer: this.#collisionLayer,
            oneWay: this.#oneWay,
            enabled: this.enabled,
        };
    }

    override deserialize(data: Record<string, unknown>): void {
        if (typeof data.mapId === 'string') this.#mapId = data.mapId;
        if (typeof data.collisionLayer === 'string') {
            this.#collisionLayer = data.collisionLayer;
        }
        if (typeof data.oneWay === 'boolean') this.#oneWay = data.oneWay;
        if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
        this.invalidateWorldCache();
    }

    /**
     * Authored-data changes mean a rebuild, and a rebuild must target whichever
     * world is live then — never one cached before a bridge swap.
     */
    private invalidateWorldCache(): void {
        this.#physicsWorld = null;
        this.touch();
    }
}
