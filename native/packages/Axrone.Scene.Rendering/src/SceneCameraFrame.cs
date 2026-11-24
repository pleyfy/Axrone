namespace Axrone.Scene.Rendering;

/// <summary>
/// Reusable per-frame camera snapshot: world pose, matrices and extracted
/// frustum. The collector mutates one instance so steady-state camera updates
/// allocate nothing.
/// </summary>
public sealed class SceneCameraFrame
{
    private CameraFrustum _frustum;

    internal SceneCameraFrame()
    {
    }

    /// <summary>Camera entity.</summary>
    public SceneEntity Entity { get; private set; }

    /// <summary>Camera data payload.</summary>
    public SceneCamera Camera { get; private set; }

    /// <summary>View matrix.</summary>
    public Mat4 ViewMatrix { get; private set; }

    /// <summary>Projection matrix.</summary>
    public Mat4 ProjectionMatrix { get; private set; }

    /// <summary>Combined view-projection matrix.</summary>
    public Mat4 ViewProjectionMatrix { get; private set; }

    /// <summary>World position.</summary>
    public Vec3 Position { get; private set; }

    /// <summary>World rotation.</summary>
    public Quat Rotation { get; private set; }

    /// <summary>Viewport aspect ratio.</summary>
    public float AspectRatio { get; private set; }

    /// <summary>Viewport width in pixels.</summary>
    public int ViewportWidth { get; private set; }

    /// <summary>Viewport height in pixels.</summary>
    public int ViewportHeight { get; private set; }

    /// <summary>Extracted view frustum.</summary>
    public ref readonly CameraFrustum Frustum
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => ref _frustum;
    }

    internal void Update(
        in SceneEntity entity,
        in SceneCamera camera,
        in Vec3 position,
        in Quat rotation,
        in Mat4 viewMatrix,
        in Mat4 projectionMatrix,
        in Mat4 viewProjectionMatrix,
        float aspectRatio,
        int viewportWidth,
        int viewportHeight)
    {
        Entity = entity;
        Camera = camera;
        Position = position;
        Rotation = rotation;
        ViewMatrix = viewMatrix;
        ProjectionMatrix = projectionMatrix;
        ViewProjectionMatrix = viewProjectionMatrix;
        AspectRatio = aspectRatio;
        ViewportWidth = viewportWidth;
        ViewportHeight = viewportHeight;
        _frustum.SetFromMatrix(in viewProjectionMatrix);
    }
}

/// <summary>
/// Builds <see cref="SceneCameraFrame"/> instances from a scene camera and its
/// world transform. Matrix construction is allocation-free and deterministic.
/// </summary>
public sealed class SceneCameraFrameCollector
{
    private static readonly Vec3 LocalForward = new(0.0f, 0.0f, -1.0f);
    private static readonly Vec3 LocalUp = new(0.0f, 1.0f, 0.0f);
    private static readonly Vec3 FallbackUp = new(1.0f, 0.0f, 0.0f);

    private readonly SceneCameraFrame _frame = new();

    /// <summary>Selects a camera and collects its frame.</summary>
    public SceneCameraFrame? Collect(SceneWorld world, int viewportWidth, int viewportHeight)
    {
        ArgumentNullException.ThrowIfNull(world);
        return SceneCameraSelector.TrySelect(world, out SceneEntity cameraEntity)
            ? Collect(world, cameraEntity, viewportWidth, viewportHeight)
            : null;
    }

    /// <summary>Collects the frame for an explicit camera entity.</summary>
    public SceneCameraFrame? Collect(
        SceneWorld world,
        SceneEntity cameraEntity,
        int viewportWidth,
        int viewportHeight)
    {
        ArgumentNullException.ThrowIfNull(world);

        if (viewportWidth <= 0 || viewportHeight <= 0)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Camera viewport dimensions must be positive.");
        }

        if (!world.TryGetData(cameraEntity, out SceneCamera camera) ||
            !camera.Enabled ||
            !world.HasTransform3D)
        {
            return null;
        }

        Validate(camera);

        float aspectRatio = viewportWidth / (float)viewportHeight;
        float fieldOfView = camera.FieldOfViewDegrees * (MathF.PI / 180.0f);
        if (camera.FieldOfViewAxis == SceneCameraFovAxis.Horizontal)
        {
            fieldOfView = 2.0f * MathF.Atan(MathF.Tan(fieldOfView * 0.5f) / aspectRatio);
        }

        Vec3 position = world.GetWorldPosition3D(cameraEntity);
        Quat rotation = Quat.Normalize(world.GetWorldRotation3D(cameraEntity));
        Vec3 forward = rotation * LocalForward;
        Vec3 up = rotation * LocalUp;

        if (MathF.Abs(Dot(forward, up)) > 0.9999f)
        {
            up = rotation * FallbackUp;
        }

        Vec3 target = position + forward;
        Mat4 view = Mat4.CreateLookAt(position, target, up);
        Mat4 projection = camera.Orthographic
            ? Mat4.CreateOrthographic(
                camera.OrthographicSize * aspectRatio * 2.0f,
                camera.OrthographicSize * 2.0f,
                camera.Near,
                camera.Far)
            : Mat4.CreatePerspectiveFieldOfView(fieldOfView, aspectRatio, camera.Near, camera.Far);
        Mat4 viewProjection = view * projection;

        _frame.Update(
            in cameraEntity,
            in camera,
            in position,
            in rotation,
            in view,
            in projection,
            in viewProjection,
            aspectRatio,
            viewportWidth,
            viewportHeight);

        return _frame;
    }

    private static void Validate(in SceneCamera camera)
    {
        if (!float.IsFinite(camera.Near) || camera.Near <= 0.0f)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Camera near plane must be positive and finite.");
        }

        if (!float.IsFinite(camera.Far) || camera.Far <= camera.Near)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Camera far plane must be finite and greater than the near plane.");
        }

        if (camera.Orthographic)
        {
            if (!float.IsFinite(camera.OrthographicSize) || camera.OrthographicSize <= 0.0f)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ValidationInvalid,
                    "Orthographic camera size must be positive and finite.");
            }
        }
        else if (!float.IsFinite(camera.FieldOfViewDegrees) ||
                 camera.FieldOfViewDegrees <= 0.0f ||
                 camera.FieldOfViewDegrees >= 180.0f)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Perspective field of view must be between zero and 180 degrees.");
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float Dot(in Vec3 left, in Vec3 right) =>
        (left.X * right.X) + (left.Y * right.Y) + (left.Z * right.Z);
}
