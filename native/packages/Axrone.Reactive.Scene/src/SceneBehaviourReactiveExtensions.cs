namespace Axrone.Reactive.Scene;

using Axrone.Scene;

/// <summary>
/// Lifetime-bound subscriptions for a scene behaviour attachment. Every helper registers the
/// returned subscription with <see cref="SceneBehaviourContext.Track"/>, so the owning table
/// disposes it when the behaviour is removed or its entity is destroyed.
/// </summary>
public static class SceneBehaviourReactiveExtensions
{
    /// <summary>Observes component additions for one unmanaged component type.</summary>
    public static IDisposable ObserveComponentAdded<T>(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<ComponentAdded<T>> handler)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        IDisposable subscription = bridge.ComponentAdded<T>().Subscribe(new ActionObserver<ComponentAdded<T>>(handler));
        return context.Track(subscription);
    }

    /// <summary>Observes component removals for one unmanaged component type.</summary>
    public static IDisposable ObserveComponentRemoved<T>(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<ComponentRemoved<T>> handler)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        IDisposable subscription = bridge.ComponentRemoved<T>().Subscribe(new ActionObserver<ComponentRemoved<T>>(handler));
        return context.Track(subscription);
    }

    /// <summary>Observes component changes for one unmanaged component type.</summary>
    public static IDisposable ObserveComponentChanged<T>(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<ComponentChanged<T>> handler)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        IDisposable subscription = bridge.ComponentChanged<T>().Subscribe(new ActionObserver<ComponentChanged<T>>(handler));
        return context.Track(subscription);
    }

    /// <summary>Observes collisions that involve this behaviour's entity.</summary>
    public static IDisposable OnCollision(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<SceneCollisionEvent> handler)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        SceneEntity entity = context.Entity;
        IDisposable subscription = bridge.Collisions.Subscribe(new ActionObserver<SceneCollisionEvent>(
            collision =>
            {
                if (collision.EntityA == entity || collision.EntityB == entity)
                {
                    handler(collision);
                }
            }));

        return context.Track(subscription);
    }

    /// <summary>Observes sensor overlaps that involve this behaviour's entity.</summary>
    public static IDisposable OnSensor(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<SceneSensorEvent> handler)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        SceneEntity entity = context.Entity;
        IDisposable subscription = bridge.Sensors.Subscribe(new ActionObserver<SceneSensorEvent>(
            sensor =>
            {
                if (sensor.SensorEntity == entity || sensor.VisitorEntity == entity)
                {
                    handler(sensor);
                }
            }));

        return context.Track(subscription);
    }

    /// <summary>Runs the handler once when this behaviour's entity is destroyed.</summary>
    public static IDisposable OnEntityDestroyed(
        this SceneBehaviourContext context,
        SceneReactiveBridge bridge,
        Action<SceneEntity> handler)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(bridge);
        ArgumentNullException.ThrowIfNull(handler);

        SceneEntity entity = context.Entity;
        IDisposable subscription = bridge.EntityDestroyed.Subscribe(new ActionObserver<SceneEntity>(
            destroyed =>
            {
                if (destroyed == entity)
                {
                    handler(destroyed);
                }
            }));

        return context.Track(subscription);
    }

    private sealed class ActionObserver<T>(Action<T> handler) : IObserver<T>
    {
        public void OnNext(T value) => handler(value);

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }
}
