namespace Axrone.Reactive.Scene;

using Axrone.Physics.Core;
using Axrone.Physics3D;
using Axrone.Scene;

/// <summary>
/// One component attached to an actor. The event carries no payload: query the world with
/// <see cref="SceneActor"/> and <typeparamref name="T"/> for the current state.
/// </summary>
public readonly record struct ComponentAdded<T>(SceneActor Actor)
    where T : unmanaged, ISceneDataComponent;

/// <summary>One component removed from an actor; the value is no longer available.</summary>
public readonly record struct ComponentRemoved<T>(SceneActor Actor)
    where T : unmanaged, ISceneDataComponent;

/// <summary>One component marked changed; query the world for the current value.</summary>
public readonly record struct ComponentChanged<T>(SceneActor Actor)
    where T : unmanaged, ISceneDataComponent;

/// <summary>Behaviour lifecycle change attached to an actor.</summary>
public readonly record struct BehaviourChange(
    SceneActor Actor,
    SceneBehaviourTypeId Type,
    SceneChangeKind Kind);

/// <summary>
/// Hierarchy change for one actor. The payload is payload-free like the journal: query
/// <see cref="SceneWorld.Hierarchy"/> for the current parent and effective active state.
/// </summary>
public readonly record struct HierarchyChange(SceneActor Actor, SceneChangeKind Kind);

/// <summary>
/// One collision from the physics step, resolved back to scene actors when possible.
/// </summary>
public readonly record struct SceneCollisionEvent(
    SceneActor? ActorA,
    BodyId BodyA,
    SceneActor? ActorB,
    BodyId BodyB,
    ContactEventType Type);

/// <summary>One sensor overlap from the physics step.</summary>
public readonly record struct SceneSensorEvent(
    SceneActor? SensorActor,
    BodyId SensorBody,
    SceneActor? VisitorActor,
    BodyId VisitorBody,
    SensorEventType Type);
