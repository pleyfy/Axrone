namespace Axrone.Scene.Runtime;

/// <summary>
/// Positions a 3D camera on an orbit around a target point. Distance and
/// elevation are clamped, azimuth wraps freely, and the camera always looks at
/// the target with a pole-safe up vector.
/// </summary>
public sealed class SceneOrbitCameraControllerBehaviour : ISceneBehaviour
{
    private Vec3 _target;
    private Vec3 _up = Vec3.UnitY;
    private float _distance = 6.0f;
    private float _minDistance = 1.0f;
    private float _maxDistance = 64.0f;
    private float _azimuth;
    private float _elevation = 0.35f;
    private float _autoRotateSpeed;
    private SceneWorld? _world;
    private SceneActor _actor = SceneActor.Null;

    /// <summary>Creates an orbit controller at the default distance.</summary>
    public SceneOrbitCameraControllerBehaviour()
    {
    }

    /// <summary>Point the camera orbits and aims at.</summary>
    public Vec3 Target
    {
        get => _target;
        set => _target = value;
    }

    /// <summary>World up axis used for the look rotation; normalized on assignment.</summary>
    public Vec3 Up
    {
        get => _up;
        set => _up = SceneCameraOrbitMath.NormalizeUp(value);
    }

    /// <summary>Orbit radius, always inside the min/max range.</summary>
    public float Distance
    {
        get => _distance;
        set => _distance = SceneCameraOrbitMath.ClampDistance(value, _minDistance, _maxDistance);
    }

    /// <summary>Lower distance clamp; strictly positive.</summary>
    public float MinDistance
    {
        get => _minDistance;
        set
        {
            _minDistance = MathF.Max(SceneCameraOrbitMath.MinimumDistance, value);
            _maxDistance = MathF.Max(_maxDistance, _minDistance);
            _distance = SceneCameraOrbitMath.ClampDistance(_distance, _minDistance, _maxDistance);
        }
    }

    /// <summary>Upper distance clamp; never below <see cref="MinDistance"/>.</summary>
    public float MaxDistance
    {
        get => _maxDistance;
        set
        {
            _maxDistance = MathF.Max(_minDistance, value);
            _distance = SceneCameraOrbitMath.ClampDistance(_distance, _minDistance, _maxDistance);
        }
    }

    /// <summary>Horizontal angle in radians.</summary>
    public float Azimuth
    {
        get => _azimuth;
        set => _azimuth = value;
    }

    /// <summary>Vertical angle in radians, clamped short of the poles.</summary>
    public float Elevation
    {
        get => _elevation;
        set => _elevation = SceneCameraOrbitMath.ClampElevation(value);
    }

    /// <summary>Automatic azimuth speed in radians per second.</summary>
    public float AutoRotateSpeed
    {
        get => _autoRotateSpeed;
        set => _autoRotateSpeed = value;
    }

    /// <summary>Applies an azimuth and elevation delta.</summary>
    public void Orbit(float deltaAzimuth, float deltaElevation)
    {
        _azimuth += deltaAzimuth;
        Elevation = _elevation + deltaElevation;
    }

    /// <summary>Applies a distance delta inside the clamp range.</summary>
    public void Zoom(float deltaDistance) => Distance = _distance + deltaDistance;

    /// <summary>
    /// Advances the orbit controller outside the world behaviour loop. Editor
    /// camera rigs drive the transform manually while the world is paused.
    /// </summary>
    public void Tick(float deltaSeconds) => Update(deltaSeconds);

    /// <inheritdoc/>
    public void OnAttach(SceneBehaviourContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _world = context.World;
        _actor = context.Actor;
        context.OnUpdate(Update);
        context.OnDetach(ClearAttachment);
    }

    private void ClearAttachment()
    {
        _world = null;
        _actor = SceneActor.Null;
    }

    private void Update(float deltaSeconds)
    {
        if (_autoRotateSpeed != 0.0f)
        {
            _azimuth += _autoRotateSpeed * deltaSeconds;
        }

        SceneWorld? world = _world;
        if (world is null || !world.HasTransform3D)
        {
            return;
        }

        Vec3 position = SceneCameraOrbitMath.ComposePosition(
            _target,
            _azimuth,
            _elevation,
            _distance);
        ref SceneTransform3D transform = ref world.GetTransform3D(_actor);
        SceneCameraOrbitMath.ApplyLook(ref transform, position, _target, _up);
    }
}
