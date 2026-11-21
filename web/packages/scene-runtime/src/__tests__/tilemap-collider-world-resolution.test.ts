import { describe, it, expect, afterEach } from 'vitest';
import {
    PhysicsWorld2D,
    PhysicsWorld2DComponent,
    Rigidbody2D,
    _setPhysicsWorld2DBridgeProvider,
    resolveBridgePhysicsWorld2D,
} from '@axrone/physics-2d';
import { TilemapCollider2D } from '../components/tilemap-collider-2d';

/**
 * Shared-world resolution contract for `TilemapCollider2D`.
 *
 * The tilemap collision builder is the only consumer of `physicsWorld`, and a
 * scene that authors just a `PhysicsBridge2D` has no `PhysicsWorld2DComponent`.
 * These tests pin that the component still finds the bridge's world, and that a
 * dead world can never stay cached.
 */

const disposables: PhysicsWorld2D[] = [];

function createWorld(): PhysicsWorld2D {
    const world = new PhysicsWorld2D({ gravity: { x: 0, y: -9.81 } });
    disposables.push(world);
    return world;
}

/** Mirrors `PhysicsBridge2D`: a disposed bridge hands back no world. */
function installBridgeProvider(world: PhysicsWorld2D | null): void {
    if (!world) {
        _setPhysicsWorld2DBridgeProvider(null);
        Rigidbody2D._setBridgeWorldProvider(null);
        return;
    }
    const provider = () => (world.isDisposed ? null : world);
    _setPhysicsWorld2DBridgeProvider(provider);
    Rigidbody2D._setBridgeWorldProvider(provider);
}

function disposeWorld(world: PhysicsWorld2D): void {
    world[Symbol.dispose]();
    const index = disposables.indexOf(world);
    if (index >= 0) disposables.splice(index, 1);
}

afterEach(() => {
    installBridgeProvider(null);
    _setPhysicsWorld2DBridgeProvider(null);
    Rigidbody2D._setBridgeWorldProvider(null);
    while (disposables.length) {
        disposables.pop()![Symbol.dispose]();
    }
    if (PhysicsWorld2DComponent.instance) {
        PhysicsWorld2DComponent.instance.onDestroy();
    }
});

describe('TilemapCollider2D shared world resolution', () => {
    it('resolves the bridge world with no PhysicsWorld2DComponent in the scene', () => {
        expect(PhysicsWorld2DComponent.instance).toBeNull();
        const world = createWorld();
        installBridgeProvider(world);

        const collider = new TilemapCollider2D({ mapId: 'level', collisionLayer: 'walls' });
        expect(collider.physicsWorld).toBe(world);
    });

    it('caches the resolved world instead of looking it up per access', () => {
        const world = createWorld();
        let calls = 0;
        _setPhysicsWorld2DBridgeProvider(() => {
            calls += 1;
            return world;
        });

        const collider = new TilemapCollider2D();
        expect(collider.physicsWorld).toBe(world);
        expect(collider.physicsWorld).toBe(world);
        expect(calls).toBe(1);
    });

    it('falls back to the PhysicsWorld2DComponent singleton with no bridge provider', () => {
        const world = createWorld();
        const component = new PhysicsWorld2DComponent();
        component.onLoad();
        expect(resolveBridgePhysicsWorld2D()).toBeNull();
        // The singleton adopts a bridge world when one exists, so register the
        // fallback world only after it has taken ownership.
        component.physicsWorld!.setGravity(world.gravity);
        (component as unknown as { _physicsWorld: PhysicsWorld2D })._physicsWorld = world;

        const collider = new TilemapCollider2D();
        expect(collider.physicsWorld).toBe(world);
    });

    it('drops a disposed cached world and re-resolves the live one', () => {
        const first = createWorld();
        installBridgeProvider(first);
        const collider = new TilemapCollider2D();
        expect(collider.physicsWorld).toBe(first);

        disposeWorld(first);
        installBridgeProvider(null);
        expect(collider.physicsWorld).toBeNull();

        const second = createWorld();
        installBridgeProvider(second);
        expect(collider.physicsWorld).toBe(second);
    });

    it('treats a throwing provider as absent rather than escaping an error', () => {
        _setPhysicsWorld2DBridgeProvider(() => {
            throw new Error('bridge torn down mid-frame');
        });
        Rigidbody2D._setBridgeWorldProvider(() => {
            throw new Error('bridge torn down mid-frame');
        });

        const collider = new TilemapCollider2D();
        expect(() => collider.physicsWorld).not.toThrow();
        expect(collider.physicsWorld).toBeNull();
    });

    it('ignores a provider that hands back a disposed world', () => {
        const disposed = createWorld();
        disposeWorld(disposed);
        _setPhysicsWorld2DBridgeProvider(() => disposed);

        const live = createWorld();
        const component = new PhysicsWorld2DComponent();
        component.onLoad();
        (component as unknown as { _physicsWorld: PhysicsWorld2D })._physicsWorld = live;

        const collider = new TilemapCollider2D();
        expect(collider.physicsWorld).toBe(live);
    });

    it.each([
        ['mapId', (collider: TilemapCollider2D) => (collider.mapId = 'next')],
        [
            'collisionLayer',
            (collider: TilemapCollider2D) => (collider.collisionLayer = 'solid'),
        ],
        ['oneWay', (collider: TilemapCollider2D) => (collider.oneWay = true)],
        [
            'deserialize',
            (collider: TilemapCollider2D) => collider.deserialize({ mapId: 'reloaded' }),
        ],
    ] as const)('re-resolves the world after %s changes authored data', (_name, mutate) => {
        const old = createWorld();
        installBridgeProvider(old);
        const collider = new TilemapCollider2D({ mapId: 'level' });
        expect(collider.physicsWorld).toBe(old);

        mutate(collider);

        disposeWorld(old);
        installBridgeProvider(null);
        const replacement = createWorld();
        installBridgeProvider(replacement);
        expect(collider.physicsWorld).toBe(replacement);
    });

    it('yields null once every source is gone', () => {
        const collider = new TilemapCollider2D();
        expect(collider.physicsWorld).toBeNull();
    });
});
