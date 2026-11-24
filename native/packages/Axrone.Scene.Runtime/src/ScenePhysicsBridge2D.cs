namespace Axrone.Scene.Runtime;

using Axrone.Physics2D;

/// <summary>
/// Bridges scene entities carrying <see cref="SceneRigidbody2D"/> and
/// <see cref="SceneCollider2D"/> components into a <c>Axrone.Physics2D.World</c>.
/// The bridge creates and destroys physics bodies, syncs 2D transforms in both
/// directions, steps the simulation and exposes contact/sensor events.
/// </summary>
public sealed class ScenePhysicsBridge2D : IDisposable
{
    private readonly SceneWorld _world;
    private readonly World _physicsWorld;
    private readonly Dictionary<SceneEntity, BodyId> _bodies;
    private bool _disposed;

    /// <summary>Creates a 2D physics bridge over a scene world.</summary>
    public ScenePhysicsBridge2D(SceneWorld world, in WorldDef? physicsDef = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
        if (physicsDef.HasValue)
        {
            WorldDef def = physicsDef.Value;
            _physicsWorld = new World(in def);
        }
        else
        {
            _physicsWorld = new World();
        }
        _bodies = new Dictionary<SceneEntity, BodyId>();
    }

    /// <summary>Backing physics world.</summary>
    public World PhysicsWorld => _physicsWorld;

    /// <summary>Number of live physics bodies.</summary>
    public int BodyCount => _bodies.Count;

    /// <summary>Creates or removes physics bodies to match scene components.</summary>
    public void SyncBodies()
    {
        ThrowIfDisposed();

        var seen = new HashSet<SceneEntity>();

        foreach (SceneEntity entity in _world.Entities)
        {
            if (!_world.IsActiveInHierarchy(entity) ||
                !_world.TryGetData(entity, out SceneRigidbody2D rigidbody) ||
                !rigidbody.Enabled)
            {
                continue;
            }

            seen.Add(entity);

            if (_bodies.ContainsKey(entity))
            {
                SyncBodyProperties(entity, in rigidbody);
            }
            else
            {
                CreateBody(entity, in rigidbody);
                AttachCollider(entity, _bodies[entity]);
                ApplyMassOverride(entity, in rigidbody);
            }
        }

        List<SceneEntity>? stale = null;
        foreach (SceneEntity entity in _bodies.Keys)
        {
            bool stillActive = seen.Contains(entity) &&
                _world.TryGetData(entity, out SceneRigidbody2D rb) &&
                rb.Enabled;
            if (!stillActive)
            {
                (stale ??= new List<SceneEntity>()).Add(entity);
            }
        }

        if (stale is not null)
        {
            for (int i = stale.Count - 1; i >= 0; i--)
            {
                DestroyBody(stale[i]);
            }
        }
    }

    /// <summary>Advances the physics simulation.</summary>
    public void Step(float deltaSeconds)
    {
        ThrowIfDisposed();
        _physicsWorld.Step(deltaSeconds);
    }

    /// <summary>Writes physics body transforms back into scene transforms.</summary>
    public void SyncTransformsFromPhysics()
    {
        ThrowIfDisposed();

        if (!_world.HasTransform2D)
        {
            return;
        }

        foreach ((SceneEntity entity, BodyId bodyId) in _bodies)
        {
            Transform2D transform = _physicsWorld.Bodies.GetTransform(bodyId);
            ref SceneTransform2D sceneTransform = ref _world.GetTransform2D(entity);
            sceneTransform.SetPosition(transform.Position);
            sceneTransform.SetRotation(MathF.Atan2(transform.Sin, transform.Cos));
        }

        _world.UpdateTransforms();
    }

    /// <summary>Number of contact events from the last step.</summary>
    public int ContactEventCount => _physicsWorld.ContactEventCount;

    /// <summary>Returns a contact event by index.</summary>
    public ContactEvent GetContactEvent(int index) => _physicsWorld.GetContactEvent(index);

    /// <summary>Number of sensor events from the last step.</summary>
    public int SensorEventCount => _physicsWorld.SensorEventCount;

    /// <summary>Returns a sensor event by index.</summary>
    public SensorEvent GetSensorEvent(int index) => _physicsWorld.GetSensorEvent(index);

    /// <summary>Resolves the entity that owns a physics body, or null.</summary>
    public SceneEntity? GetEntity(BodyId bodyId)
    {
        foreach ((SceneEntity entity, BodyId id) in _bodies)
        {
            if (id == bodyId)
            {
                return entity;
            }
        }

        return null;
    }

    /// <summary>Resolves the physics body owned by a scene entity.</summary>
    public bool TryGetBody(SceneEntity entity, out BodyId bodyId) =>
        _bodies.TryGetValue(entity, out bodyId);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _bodies.Clear();
        _physicsWorld.Dispose();
        _disposed = true;
    }

    private void CreateBody(SceneEntity entity, in SceneRigidbody2D rigidbody)
    {
        Vec2 position = _world.HasTransform2D
            ? _world.GetWorldPosition2D(entity)
            : default;
        float angle = _world.HasTransform2D
            ? GetWorldAngle(entity)
            : 0.0f;

        var def = new BodyDef
        {
            Type = rigidbody.BodyType switch
            {
                SceneBodyType.Static => BodyType.Static,
                SceneBodyType.Kinematic => BodyType.Kinematic,
                _ => BodyType.Dynamic
            },
            Position = position,
            Angle = angle,
            LinearVelocity = rigidbody.LinearVelocity,
            AngularVelocity = rigidbody.AngularVelocity,
            LinearDamping = rigidbody.LinearDamping,
            AngularDamping = rigidbody.AngularDamping,
            GravityScale = rigidbody.GravityScale
        };

        _bodies[entity] = _physicsWorld.Bodies.Create(in def);
    }

    private float GetWorldAngle(SceneEntity entity)
    {
        Mat3 matrix = _world.GetWorldMatrix2D(entity);
        return MathF.Atan2(matrix.M12, matrix.M11);
    }

    private void DestroyBody(SceneEntity entity)
    {
        if (_bodies.Remove(entity, out BodyId bodyId))
        {
            _physicsWorld.Bodies.Destroy(bodyId);
        }
    }

    private void SyncBodyProperties(SceneEntity entity, in SceneRigidbody2D rigidbody)
    {
        if (!_bodies.TryGetValue(entity, out BodyId bodyId))
        {
            return;
        }

        if (rigidbody.BodyType != SceneBodyType.Static)
        {
            _physicsWorld.Bodies.SetLinearVelocity(bodyId, rigidbody.LinearVelocity);
            _physicsWorld.Bodies.SetAngularVelocity(bodyId, rigidbody.AngularVelocity);
        }
    }

    private void AttachCollider(SceneEntity entity, BodyId bodyId)
    {
        if (!_world.TryGetData(entity, out SceneCollider2D collider) || !collider.Enabled)
        {
            return;
        }

        var material = new PhysicsMaterial(collider.Friction, collider.Restitution);
        Vec2 offset = collider.Offset;

        switch (collider.Shape)
        {
            case SceneColliderShape2D.Circle:
                _physicsWorld.Shapes.AttachCircle<
                    SurfaceAreaHeuristicStrategy2D,
                    NullSpatialMetricsSink>(
                    _physicsWorld.Bodies,
                    _physicsWorld.Broadphase,
                    bodyId,
                    offset,
                    collider.Radius,
                    collider.Density,
                    default,
                    material,
                    default,
                    0.0f,
                    collider.IsTrigger);
                break;
            case SceneColliderShape2D.Box:
                Polygon2D box = Polygon2D.CreateBox(collider.BoxHalfExtents);
                _physicsWorld.Shapes.AttachPolygon<
                    SurfaceAreaHeuristicStrategy2D,
                    NullSpatialMetricsSink>(
                    _physicsWorld.Bodies,
                    _physicsWorld.Broadphase,
                    bodyId,
                    box.Vertices,
                    collider.Density,
                    default,
                    material,
                    offset,
                    0.0f,
                    collider.IsTrigger);
                break;
            case SceneColliderShape2D.Capsule:
                var p0 = offset + new Vec2(collider.CapsuleHalfHeight, 0.0f);
                var p1 = offset - new Vec2(collider.CapsuleHalfHeight, 0.0f);
                _physicsWorld.Shapes.AttachCapsule<
                    SurfaceAreaHeuristicStrategy2D,
                    NullSpatialMetricsSink>(
                    _physicsWorld.Bodies,
                    _physicsWorld.Broadphase,
                    bodyId,
                    p0,
                    p1,
                    collider.Radius,
                    collider.Density,
                    default,
                    material,
                    default,
                    0.0f,
                    collider.IsTrigger);
                break;
        }
    }

    private void ApplyMassOverride(SceneEntity entity, in SceneRigidbody2D rigidbody)
    {
        if (rigidbody.Mass <= 0.0f || rigidbody.BodyType == SceneBodyType.Static)
        {
            return;
        }

        BodyId bodyId = _bodies[entity];
        float inverseInertia = _physicsWorld.Bodies.GetInverseInertia(bodyId);
        float inertia = inverseInertia > 0.0f ? 1.0f / inverseInertia : 0.0f;
        _physicsWorld.Bodies.SetMassData(bodyId, rigidbody.Mass, inertia);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(ScenePhysicsBridge2D));
        }
    }
}
