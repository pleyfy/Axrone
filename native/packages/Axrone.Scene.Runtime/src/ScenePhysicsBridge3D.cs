namespace Axrone.Scene.Runtime;

using Axrone.Geometry;
using Axrone.Physics3D;

/// <summary>
/// Bridges scene actors carrying <see cref="SceneRigidbody3D"/> and
/// <see cref="SceneCollider3D"/> components into a <c>Axrone.Physics3D.World</c>.
/// The bridge creates and destroys physics bodies, syncs transforms in both
/// directions, steps the simulation and exposes contact/sensor events.
/// </summary>
public sealed class ScenePhysicsBridge3D : IDisposable
{
    private readonly SceneWorld _world;
    private readonly World _physicsWorld;
    private readonly Dictionary<SceneActor, BodyId> _bodies;
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
        _bodies = new Dictionary<SceneActor, BodyId>();
    }

    /// <summary>Backing physics world.</summary>
    public World PhysicsWorld => _physicsWorld;

    /// <summary>Number of live physics bodies.</summary>
    public int BodyCount => _bodies.Count;

    /// <summary>Creates or removes physics bodies to match scene components.</summary>
    public void SyncBodies()
    {
        ThrowIfDisposed();

        var seen = new HashSet<SceneActor>();

        foreach (SceneActor actor in _world.Actors)
        {
            if (!_world.IsActiveInHierarchy(actor) ||
                !_world.TryGetData(actor, out SceneRigidbody3D rigidbody) ||
                !rigidbody.Enabled)
            {
                continue;
            }

            seen.Add(actor);

            if (_bodies.ContainsKey(actor))
            {
                SyncBodyProperties(actor, in rigidbody);
            }
            else
            {
                CreateBody(actor, in rigidbody);
                AttachColliders(actor, bodyId: _bodies[actor]);
                ApplyMassOverride(actor, in rigidbody);
            }
        }

        // Remove bodies whose rigidbody was deleted or disabled.
        List<SceneActor>? stale = null;
        foreach (SceneActor actor in _bodies.Keys)
        {
            bool stillActive = seen.Contains(actor) &&
                _world.TryGetData(actor, out SceneRigidbody3D rb) &&
                rb.Enabled;
            if (!stillActive)
            {
                (stale ??= new List<SceneActor>()).Add(actor);
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

        foreach ((SceneActor actor, BodyId bodyId) in _bodies)
        {
            if (!_world.HasTransform3D)
            {
                continue;
            }

            RigidTransform3D transform = _physicsWorld.Bodies.GetTransform(bodyId);
            ref SceneTransform3D sceneTransform = ref _world.GetTransform3D(actor);
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

    /// <summary>Resolves the actor that owns a physics body, or null.</summary>
    public SceneActor? GetActor(BodyId bodyId)
    {
        foreach ((SceneActor actor, BodyId id) in _bodies)
        {
            if (id == bodyId)
            {
                return actor;
            }
        }

        return null;
    }

    /// <summary>Resolves the physics body owned by a scene actor.</summary>
    public bool TryGetBody(SceneActor actor, out BodyId bodyId) =>
        _bodies.TryGetValue(actor, out bodyId);

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

    private void CreateBody(SceneActor actor, in SceneRigidbody3D rigidbody)
    {
        Vec3 position = _world.HasTransform3D
            ? _world.GetWorldPosition3D(actor)
            : default;
        Quat rotation = _world.HasTransform3D
            ? Quat.Normalize(_world.GetWorldRotation3D(actor))
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

        _bodies[actor] = _physicsWorld.Bodies.Create(in def);
    }

    private void DestroyBody(SceneActor actor)
    {
        if (_bodies.Remove(actor, out BodyId bodyId))
        {
            _physicsWorld.Bodies.Destroy(bodyId);
        }
    }

    private void SyncBodyProperties(SceneActor actor, in SceneRigidbody3D rigidbody)
    {
        if (!_bodies.TryGetValue(actor, out BodyId bodyId))
        {
            return;
        }

        if (rigidbody.BodyType != SceneBodyType.Static)
        {
            _physicsWorld.Bodies.SetLinearVelocity(bodyId, rigidbody.LinearVelocity);
            _physicsWorld.Bodies.SetAngularVelocity(bodyId, rigidbody.AngularVelocity);
        }
    }

    private void AttachColliders(SceneActor actor, BodyId bodyId)
    {
        if (!_world.TryGetData(actor, out SceneCollider3D collider) || !collider.Enabled)
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

    private void ApplyMassOverride(SceneActor actor, in SceneRigidbody3D rigidbody)
    {
        if (rigidbody.Mass <= 0.0f || rigidbody.BodyType == SceneBodyType.Static)
        {
            return;
        }

        BodyId bodyId = _bodies[actor];
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
