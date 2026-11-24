namespace Axrone.Reactive.Scene;

using Axrone.Physics.Core;
using Axrone.Physics3D;
using Axrone.Scene;

/// <summary>
/// One component attached to an entity. The event carries no payload: query the world with
/// <see cref="SceneEntity"/> and <typeparamref name="T"/> for the current state.
/// </summary>
public readonly record struct ComponentAdded<T>(SceneEntity Entity)
    where T : unmanaged, ISceneDataComponent;

/// <summary>One component removed from an entity; the value is no longer available.</summary>
public readonly record struct ComponentRemoved<T>(SceneEntity Entity)
    where T : unmanaged, ISceneDataComponent;

/// <summary>One component marked changed; query the world for the current value.</summary>
public readonly record struct ComponentChanged<T>(SceneEntity Entity)
    where T : unmanaged, ISceneDataComponent;

/// <summary>Behaviour lifecycle change attached to an entity.</summary>
public readonly record struct BehaviourChange(
    SceneEntity Entity,
    SceneBehaviourTypeId Type,
    SceneChangeKind Kind);

/// <summary>
/// Hierarchy change for one entity. The payload is payload-free like the journal: query
/// <see cref="SceneWorld.Hierarchy"/> for the current parent and effective active state.
/// </summary>
public readonly record struct HierarchyChange(SceneEntity Entity, SceneChangeKind Kind);

/// <summary>
/// One collision from the physics step, resolved back to scene entities when possible.
/// </summary>
public readonly record struct SceneCollisionEvent(
    SceneEntity? EntityA,
    BodyId BodyA,
    SceneEntity? EntityB,
    BodyId BodyB,
    ContactEventType Type);

/// <summary>One sensor overlap from the physics step.</summary>
public readonly record struct SceneSensorEvent(
    SceneEntity? SensorEntity,
    BodyId SensorBody,
    SceneEntity? VisitorEntity,
    BodyId VisitorBody,
    SensorEventType Type);
