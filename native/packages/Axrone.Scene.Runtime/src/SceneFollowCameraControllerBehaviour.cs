namespace Axrone.Scene.Runtime;

/// <summary>
/// Follows another actor (or a fixed point) with a damped orbit camera. The
/// look direction is applied every late update so movement observed earlier in
/// the frame is reflected in the final view.
/// </summary>
public sealed class SceneFollowCameraControllerBehaviour : ISceneBehaviour
{
    private static readonly Vec3 DefaultTargetOffset = new(0.0f, 1.5f, 0.0f);

    private SceneActor _targetActor = SceneActor.Null;
    private Vec3 _target;
    private Vec3 _targetOffset = DefaultTargetOffset;
    private Vec3 _up = Vec3.UnitY;
    private Vec3 _smoothedTarget;
    private float _distance = 7.0f;
    private float _minDistance = 1.5f;
    private float _maxDistance = 24.0f;
    private float _azimuth;
    private float _elevation = 0.45f;
    private float _positionDamping = 10.0f;
    private float _targetDamping = 14.0f;
    private bool _initialized;
    private SceneWorld? _world;
    private SceneActor _actor = SceneActor.Null;

    /// <summary>Creates a follow controller at the default distance.</summary>
    public SceneFollowCameraControllerBehaviour()
    {
    }

    /// <summary>Fixed world point followed when no target actor is set.</summary>
    public Vec3 Target
    {
        get => _target;
        set => _target = value;
    }

    /// <summary>Actor followed when set; overrides <see cref="Target"/>.</summary>
    public SceneActor TargetActor => _targetActor;

    /// <summary>Offset added to the resolved target position.</summary>
    public Vec3 TargetOffset
    {
        get => _targetOffset;
        set => _targetOffset = value;
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

    /// <summary>Camera position damping; zero snaps instantly.</summary>
    public float PositionDamping
    {
        get => _positionDamping;
        set => _positionDamping = MathF.Max(0.0f, value);
    }

    /// <summary>Followed-target damping; zero snaps instantly.</summary>
    public float TargetDamping
    {
        get => _targetDamping;
        set => _targetDamping = MathF.Max(0.0f, value);
    }

    /// <summary>Sets the actor to follow, optionally snapping on the next update.</summary>
    public void SetTarget(SceneActor target, bool snap = true)
    {
        _targetActor = target;
        if (snap)
        {
            Snap();
        }
    }

    /// <summary>Re-initializes smoothing so the next update snaps into place.</summary>
    public void Snap() => _initialized = false;

    /// <summary>Applies an azimuth and elevation delta.</summary>
    public void Orbit(float deltaAzimuth, float deltaElevation)
    {
        _azimuth += deltaAzimuth;
        Elevation = _elevation + deltaElevation;
    }

    /// <summary>Applies a distance delta inside the clamp range.</summary>
    public void Zoom(float deltaDistance) => Distance = _distance + deltaDistance;

    /// <inheritdoc/>
    public void OnAttach(SceneBehaviourContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _world = context.World;
        _actor = context.Actor;
        context.OnLateUpdate(LateUpdate);
        context.OnDetach(ClearAttachment);
    }

    private void ClearAttachment()
    {
        _world = null;
        _actor = SceneActor.Null;
    }

    private void LateUpdate(float deltaSeconds)
    {
        SceneWorld? world = _world;
        if (world is null || !world.HasTransform3D)
        {
            return;
        }

        Vec3 desiredTarget = ResolveDesiredTarget(world);
        if (!_initialized)
        {
            _smoothedTarget = desiredTarget;
            Vec3 initialPosition = SceneCameraOrbitMath.ComposePosition(
                _smoothedTarget,
                _azimuth,
                _elevation,
                _distance);
            ref SceneTransform3D initialTransform = ref world.GetTransform3D(_actor);
            SceneCameraOrbitMath.ApplyLook(ref initialTransform, initialPosition, _smoothedTarget, _up);
            _initialized = true;
            return;
        }

        float targetSmoothing = SmoothingFactor(_targetDamping, deltaSeconds);
        _smoothedTarget = Vec3.Lerp(_smoothedTarget, desiredTarget, targetSmoothing);

        Vec3 desiredPosition = SceneCameraOrbitMath.ComposePosition(
            _smoothedTarget,
            _azimuth,
            _elevation,
            _distance);

        ref SceneTransform3D transform = ref world.GetTransform3D(_actor);
        float positionSmoothing = SmoothingFactor(_positionDamping, deltaSeconds);
        Vec3 position = Vec3.Lerp(transform.Position, desiredPosition, positionSmoothing);
        SceneCameraOrbitMath.ApplyLook(ref transform, position, _smoothedTarget, _up);
    }

    private Vec3 ResolveDesiredTarget(SceneWorld world)
    {
        Vec3 source = _targetActor.IsValid && world.TryGetActor(_targetActor, out _)
            ? world.GetWorldPosition3D(_targetActor)
            : _target;
        return source + _targetOffset;
    }

    private static float SmoothingFactor(float damping, float deltaSeconds)
    {
        if (damping <= 0.0f || deltaSeconds <= 0.0f)
        {
            return 1.0f;
        }

        return 1.0f - MathF.Exp(-damping * deltaSeconds);
    }
}
