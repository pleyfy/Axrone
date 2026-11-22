import type { PhysicsWorld2D } from '../core/physics-world';

/**
 * Internal registry of bridge-provided physics worlds.
 *
 * Two registration slots exist because the engine has two independent public
 * entry points that a `PhysicsBridge2D` uses:
 *
 * - `_setPhysicsWorld2DBridgeProvider()` — declared on `PhysicsWorld2DComponent`,
 *   used so the singleton component can *adopt* the bridge world.
 * - `Rigidbody2D._setBridgeWorldProvider()` — used so rigidbodies resolve the
 *   bridge world without needing a `PhysicsWorld2DComponent` in the scene.
 *
 * Before this registry existed only `Rigidbody2D` consulted its slot, so in a
 * bridge-only scene (no explicit `PhysicsWorld2DComponent`) rigidbodies created
 * bodies while colliders and joints silently found no world and did nothing.
 * Every 2D component now resolves through `resolveBridgePhysicsWorld2D()`, so
 * all of them bind to the same world.
 *
 * This module intentionally imports nothing from `./` component files to keep
 * the component dependency graph acyclic.
 */

type BridgeWorldProvider = (() => PhysicsWorld2D | null) | null;

let _worldComponentProvider: BridgeWorldProvider = null;
let _rigidbodyProvider: BridgeWorldProvider = null;

/** @internal Called by PhysicsBridge2D to provide its world to `PhysicsWorld2DComponent`. */
export function _setPhysicsWorld2DBridgeProvider(provider: BridgeWorldProvider): void {
    _worldComponentProvider = provider;
}

/** @internal Current `PhysicsWorld2DComponent` bridge provider, if any. */
export function _getPhysicsWorld2DBridgeProvider(): BridgeWorldProvider {
    return _worldComponentProvider;
}

/** @internal Backing store for `Rigidbody2D._setBridgeWorldProvider`. */
export function _setRigidbody2DBridgeWorldProvider(provider: BridgeWorldProvider): void {
    _rigidbodyProvider = provider;
}

/** @internal Current `Rigidbody2D` bridge provider, if any. */
export function _getRigidbody2DBridgeWorldProvider(): BridgeWorldProvider {
    return _rigidbodyProvider;
}

/**
 * Resolve the world offered by whichever bridge provider is registered.
 *
 * Providers are expected to return `null` once their bridge (and world) has been
 * disposed; a provider that throws is treated as absent so a torn-down bridge
 * can never break scene initialisation.
 *
 * @returns the bridge world, or `null` when no bridge is active.
 */
export function resolveBridgePhysicsWorld2D(): PhysicsWorld2D | null {
    const providers: BridgeWorldProvider[] = [_worldComponentProvider, _rigidbodyProvider];
    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        if (!provider) continue;
        let world: PhysicsWorld2D | null = null;
        try {
            world = provider();
        } catch {
            world = null;
        }
        // A provider that hands back a world it has already torn down must not
        // win over the singleton fallback.
        if (world && !world.isDisposed) return world;
    }
    return null;
}

/**
 * @internal Reset both slots. Exposed for tests that need to guarantee no stale
 * bridge provider leaks into a component that expects a self-owned world.
 */
export function _resetPhysicsWorld2DBridgeProviders(): void {
    _worldComponentProvider = null;
    _rigidbodyProvider = null;
}
