namespace Axrone.Scene.Runtime;

using Axrone.Geometry;
using Axrone.Physics3D;

/// <summary>
/// Bridges scene entities carrying <see cref="SceneRigidbody3D"/> and
/// <see cref="SceneCollider3D"/> components into a <c>Axrone.Physics3D.World</c>.
/// The bridge creates and destroys physics bodies, syncs transforms in both
/// directions, steps the simulation and exposes contact/sensor events.
/// </summary>
public sealed class ScenePhysicsBridge3D : IDisposable
{
    private readonly SceneWorld _world;
    private readonly World _physicsWorld;
    private readonly Dictionary<SceneEntity, BodyId> _bodies;
    private bool _disposed;
    private long _stepCount;

    /// <summary>Creates a physics bridge over a scene world.</summary>
    public ScenePhysicsBridge3D(SceneWorld world, in WorldDef? physicsDef = null)
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
                !_world.TryGetData(entity, out SceneRigidbody3D rigidbody) ||
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
                AttachColliders(entity, bodyId: _bodies[entity]);
                ApplyMassOverride(entity, in rigidbody);
            }
        }

        // Remove bodies whose rigidbody was deleted or disabled.
        List<SceneEntity>? stale = null;
        foreach (SceneEntity entity in _bodies.Keys)
        {
            bool stillActive = seen.Contains(entity) &&
                _world.TryGetData(entity, out SceneRigidbody3D rb) &&
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
        Interlocked.Increment(ref _stepCount);
    }

    /// <summary>Writes physics body transforms back into scene transforms.</summary>
    public void SyncTransformsFromPhysics()
    {
        ThrowIfDisposed();

        foreach ((SceneEntity entity, BodyId bodyId) in _bodies)
        {
            if (!_world.HasTransform3D)
            {
                continue;
            }

            RigidTransform3D transform = _physicsWorld.Bodies.GetTransform(bodyId);
            ref SceneTransform3D sceneTransform = ref _world.GetTransform3D(entity);
            sceneTransform.SetPosition(transform.Position);
            sceneTransform.SetRotation(transform.Rotation);
        }

        _world.UpdateTransforms();
    }

    /// <summary>Number of contact events from the last step.</summary>
    public int ContactEventCount => _physicsWorld.ContactEventCount;

    /// <summary>Number of completed physics steps; used by bridges to avoid duplicate reads.</summary>
    public long StepCount => Interlocked.Read(ref _stepCount);

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

    private void CreateBody(SceneEntity entity, in SceneRigidbody3D rigidbody)
    {
        Vec3 position = _world.HasTransform3D
            ? _world.GetWorldPosition3D(entity)
            : default;
        Quat rotation = _world.HasTransform3D
            ? Quat.Normalize(_world.GetWorldRotation3D(entity))
            : Quat.Identity;

        var def = new BodyDef
        {
            Type = rigidbody.BodyType switch
            {
                SceneBodyType.Static => BodyType.Static,
                SceneBodyType.Kinematic => BodyType.Kinematic,
                _ => BodyType.Dynamic
            },
            Position = position,
            Rotation = rotation,
            LinearVelocity = rigidbody.LinearVelocity,
            AngularVelocity = rigidbody.AngularVelocity,
            LinearDamping = rigidbody.LinearDamping,
            AngularDamping = rigidbody.AngularDamping,
            GravityScale = rigidbody.GravityScale
        };

        _bodies[entity] = _physicsWorld.Bodies.Create(in def);
    }

    private void DestroyBody(SceneEntity entity)
    {
        if (_bodies.Remove(entity, out BodyId bodyId))
        {
            _physicsWorld.Bodies.Destroy(bodyId);
        }
    }

    private void SyncBodyProperties(SceneEntity entity, in SceneRigidbody3D rigidbody)
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

    private void AttachColliders(SceneEntity entity, BodyId bodyId)
    {
        if (!_world.TryGetData(entity, out SceneCollider3D collider) || !collider.Enabled)
        {
            return;
        }

        var material = new PhysicsMaterial(collider.Friction, collider.Restitution);
        Vec3 center = collider.Offset;

        switch (collider.Shape)
        {
            case SceneColliderShape3D.Sphere:
                _physicsWorld.Shapes.AttachSphere<
                    SurfaceAreaHeuristicStrategy,
                    NullSpatialMetricsSink>(
                    _physicsWorld.Bodies,
                    _physicsWorld.Broadphase,
                    bodyId,
                    center,
                    collider.Radius,
                    collider.Density,
                    default,
                    material,
                    default,
                    Quat.Identity,
                    collider.IsTrigger);
                break;
            case SceneColliderShape3D.Box:
                _physicsWorld.Shapes.AttachBox<
                    SurfaceAreaHeuristicStrategy,
                    NullSpatialMetricsSink>(
                    _physicsWorld.Bodies,
                    _physicsWorld.Broadphase,
                    bodyId,
                    center,
                    collider.BoxHalfExtents,
                    collider.Density,
                    default,
                    material,
                    default,
                    Quat.Identity,
                    collider.IsTrigger);
                break;
            case SceneColliderShape3D.Capsule:
                var p0 = center + new Vec3(0.0f, collider.CapsuleHalfHeight, 0.0f);
                var p1 = center - new Vec3(0.0f, collider.CapsuleHalfHeight, 0.0f);
                _physicsWorld.Shapes.AttachCapsule<
                    SurfaceAreaHeuristicStrategy,
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
                    Quat.Identity,
                    collider.IsTrigger);
                break;
        }
    }

    private void ApplyMassOverride(SceneEntity entity, in SceneRigidbody3D rigidbody)
    {
        if (rigidbody.Mass <= 0.0f || rigidbody.BodyType == SceneBodyType.Static)
        {
            return;
        }

        BodyId bodyId = _bodies[entity];
        Vec3 inverseInertia = _physicsWorld.Bodies.GetInverseInertia(bodyId);
        var inertia = new Vec3(
            inverseInertia.X > 0.0f ? 1.0f / inverseInertia.X : 0.0f,
            inverseInertia.Y > 0.0f ? 1.0f / inverseInertia.Y : 0.0f,
            inverseInertia.Z > 0.0f ? 1.0f / inverseInertia.Z : 0.0f);
        _physicsWorld.Bodies.SetMassData(bodyId, rigidbody.Mass, inertia);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(ScenePhysicsBridge3D));
        }
    }
}
