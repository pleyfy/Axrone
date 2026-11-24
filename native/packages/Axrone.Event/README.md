# Axrone.Event

Typed publish/subscribe for the Axrone engine: one router per event type, an optional priority
scheduler for deferred work and timers, a ref-struct hub for per-frame input fan-out, and
dead-letter retention for handler failures.

```csharp
using var bus = new EventBus();

using IDisposable sub = bus.Subscribe<AssetChanged>((envelope, token) =>
    Console.WriteLine(envelope.Payload.Path));

bus.Publish(new AssetChanged("textures/hero.png"));
```

## Dispatch modes

`EventBus` supports two modes. The mode is fixed at construction.

| Mode | Thread | Delivery |
|---|---|---|
| `EventDispatchMode.Background` (default) | one dedicated worker per bus | asynchronous; the worker drains continuously |
| `EventDispatchMode.FrameDriven` | none | deterministic; the owner calls `bus.Pump()` once per frame |

```csharp
using var bus = new EventBus(options, EventDispatchMode.FrameDriven);

// inside the frame:
bus.Pump(maxBatches: 4);
```

Frame-driven mode is the right choice for gameplay and editor scripting: dispatch shares the
frame's thread and clock, and nothing runs between frames. `Pump` throws on a background bus
because that bus already owns its single consumer thread.

Both modes use the same drain seam: `Axrone.Execution.CommandPump` supplies the wake queue,
backoff and lifecycle; `EventDispatcher` supplies the registration table and rotating visit order.

## Subscription lifecycle

`IEventSubscription` is an explicit state machine: `Active → Paused → Active`, and
`Active/Paused → Disposed`.

- `Pause()` stops delivery without unregistering.
- `Dispose()` always unregisters, including from the paused state, and is idempotent.
- `EventRouter.Unsubscribe(id)` returns `true` for a paused subscription and removes it.

`MaxListeners` defaults to 10, matching the TypeScript contract. Zero disables the bound. A
registration past the bound warns or throws according to `MaxListenersPolicy`.

## Publish contracts

| Call | Full transport | Re-entrant from a handler |
|---|---|---|
| `Publish` | waits up to `MaxQueueWaitMs`, then throws `EventQueueFullException` | fails fast with the same exception |
| `TryPublish` | returns `false` | returns `false` |
| `PublishImmediate` | dispatches on the caller thread | defers to the transport |
| `PublishBatch` / `TryPublishBatch` | same rules, per batch | same rules |

The re-entrant case cannot wait: the drain thread is the only consumer, so waiting there would
deadlock every event type on the bus.

Handler exceptions are caught per subscriber, recorded as dead letters and reported through
interceptors. They never abort the fan-out. This differs from the TypeScript emitter, which threw
back to the caller; the C# contract is deliberate and covered by tests.

## Scheduler

`EventScheduler<TEvent>` is the frame-driven seam for deferred work and timers:

```csharp
var scheduler = new EventScheduler<GameEvent>(new EventSchedulerOptions(1024));

EventTimerHandle timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(2), new GameEvent("boom"));

// once per frame:
scheduler.AdvanceDueTimers();
scheduler.Drain(ref dispatcher);
```

Time advances only when `AdvanceDueTimers` is called; no OS timers are created. Ordering is
`(priority, sequence)` for envelopes and `(due, priority, sequence)` for timers, backed by two
`PriorityQueue<,>` instances. Pause, resume and cancel rebuild the timer heap because the BCL
queue has no removal; advance and dequeue are allocation-free.

## Hub

`EventHub<TEvent>` is the per-frame input path: `allows ref struct` consumers, no envelope
allocation, and an immutable dispatch snapshot so a subscriber added by a handler cannot receive
the event that created it.

`EventHub.Publish` is O(active subscribers), not O(`MaxSubscribers`). The reader half
(`ReadNextAsync`) is available but not used by the shipped engine; size `WaiterPoolCapacity`
accordingly.

## Scope decisions

- **Task scheduler deleted.** `Tasks/` was a 4.65× rewrite of the TypeScript scheduler with no
  production consumer. `Axrone.Execution.CommandPump` and `WorkExecutor` own that job.
- **Scheduler kept and shrunk.** The capability is real for gameplay and scripting; the audit's
  objection was to three hand-rolled orderings, not to the feature.
- **Event sourcing kept.** It has no runtime cost unless used and carries a product-level
  contract (streams, snapshots, upgrades). Deleting it is a product decision, not cleanup.
- **Hub reader kept.** `InputEngine` only publishes and subscribes, but the reader is a public
  capability; its waiter pool is the cost to watch.

## Verification

`dotnet build -c Release` and `dotnet test -c Release` in `tests/` must stay green. Benchmarks for
the live paths live in `benchmarks/RouterBenchmarks.cs`.
