# Axrone.Reactive.Scene

Reactive adapter over `Axrone.Scene.Core` and `Axrone.Scene.Runtime`. The scene world stays free
of `IObservable`; this package turns its mutation journal and physics step events into typed
streams.

## Dependency direction

```
Axrone.Scene.Core      (no Reactive dependency; owns the change journal)
Axrone.Scene.Runtime   (no Reactive dependency; physics bridge, runtime loop)
Axrone.Reactive        (observable/observer engine)
Axrone.Reactive.Scene  -> Scene.Runtime + Scene.Core + Reactive
```

The adapter is optional. Game hosts that do not need reactive scene streams never reference it.

## Wiring

```csharp
using var world = new SceneWorld(registry, diagnostics);
using var physics = new ScenePhysicsBridge3D(world);
using var bridge = new SceneReactiveBridge(world, physics);

// per frame, on the loop thread, after the scene and physics have stepped:
physics.Step(deltaSeconds);
bridge.Pump();
```

`Pump` drains one batch from `world.Changes`, dispatches every entry synchronously, then reads
one frame of physics contact/sensor events. Calling it twice without a physics step does not
duplicate physics events.

A `SceneRuntimeLoop` can pump the bridge for you; the bridge detaches on dispose:

```csharp
bridge.AttachLoop(loop);   // pumps after every loop.Tick()
```

**Event–Scene boundary:** `Scene.Core` and `Scene.Runtime` do **not** reference `Axrone.Event`.
Structural mutations flow through `SceneChangeJournal`; `Axrone.Reactive.Scene` is the adapter
(`ActorCreated/Destroyed`, `ComponentAdded/Removed/Changed<T>`, `BehaviourChanges`,
`HierarchyChanges`, `Collisions`, `Sensors`). `Axrone.Event` stays the gameplay/backend transport,
so deleting the ECS event bus does not touch this path.

## Streams

| Stream | Payload |
|---|---|
| `ActorCreated` / `ActorDestroyed` | `SceneActor` |
| `ComponentAdded<T>()` / `ComponentRemoved<T>()` / `ComponentChanged<T>()` | `SceneActor` |
| `BehaviourChanges` | `SceneBehaviourTypeId` + `SceneChangeKind` |
| `HierarchyChanges` | `SceneActor` + `SceneChangeKind` (`ParentChanged` / `ActiveInHierarchyChanged`) |
| `Collisions` | `SceneCollisionEvent` (actors resolved when possible) |
| `Sensors` | `SceneSensorEvent` |

Component events deliberately carry **no payload**. They are notifications; the current value is
read with `world.TryGetData<T>(actor, out value)` or `world.GetData<T>(actor)`. This keeps the
journal allocation-free and avoids delivering stale values.

## SceneBehaviour lifetime

```csharp
public sealed class PlayerController : ISceneBehaviour
{
    public void OnAttach(SceneBehaviourContext context)
    {
        context.ObserveComponentAdded<SceneCollider3D>(_bridge, change => { });
        context.ObserveComponentChanged<SceneHealth>(_bridge, change => { });
        context.OnCollision(_bridge, collision => { });
        context.OnActorDestroyed(_bridge, actor => { });
    }
}
```

Every helper calls `SceneBehaviourContext.Track`. The behaviour table disposes the
subscriptions when the behaviour is removed or its actor is destroyed, so no manual unsubscribe
and no leak on hot reload/play-stop.

## Contracts

- **Loop thread only.** `Pump` is synchronous; no background worker. Subscribers run on the
  thread that pumps, in journal order.
- **Frame batching.** A component added and removed in the same frame produces both entries; the
  payload-free event lets consumers query at pump time. Pump once per frame for predictable
  ordering.
- **In-place writes.** `GetData<T>` returns `ref T`; a direct write is invisible to the journal.
  Call `world.MarkChanged<T>(actor)` after mutating, or use `world.SetData<T>(actor, value)`.
- **No special collider event.** A collider attach is `ComponentAdded<SceneCollider3D>`. The
  gameplay callback is `Collisions` / `OnCollision`, sourced from the physics step, so collisions
  are a stream instead of a virtual lifecycle method.
- **Liveness.** A component stream with no subscribers is skipped before any payload work.

## Verification

`dotnet test packages/Axrone.Reactive.Scene/tests -c Release` covers component add/remove/change,
actor lifecycle, behaviour lifecycle, subscription disposal and pump draining. Scene.Core tests
cover the journal ordering and drop-oldest behaviour.
