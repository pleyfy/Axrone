namespace Axrone.Scene.Rendering;

/// <summary>
/// Marks a camera as 2D: the frame collector derives the view from the actor's
/// <c>Transform2D</c> and places the camera <see cref="Depth"/> units in front of
/// the scene plane. The remaining projection and clear settings live on the
/// attached <see cref="SceneCamera"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneCamera2D : ISceneDataComponent
{
    /// <summary>Distance from the XY plane along -Z.</summary>
    public float Depth;

    /// <summary>Default 2D camera ten units in front of the scene plane.</summary>
    public static SceneCamera2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new() { Depth = 10.0f };
    }
}

/// <summary>Selects the active 2D camera in stable actor order.</summary>
public static class SceneCamera2DSelector
{
    /// <summary>Selects a camera actor carrying both camera components.</summary>
    public static bool TrySelect(SceneWorld world, out SceneActor cameraActor)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneActor fallback = SceneActor.Null;
        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneCamera camera) ||
                !world.HasData<SceneCamera2D>(actor) ||
                !camera.Enabled)
            {
                continue;
            }

            if (camera.Primary)
            {
                cameraActor = actor;
                return true;
            }

            if (fallback.IsNull)
            {
                fallback = actor;
            }
        }

        cameraActor = fallback;
        return cameraActor.IsValid;
    }
}

/// <summary>
/// Builds camera frames for 2D scenes from a <c>Transform2D</c> pose, an
/// orthographic projection and a fixed view distance. The collector reuses one
/// frame instance, so steady-state camera updates allocate nothing.
/// </summary>
public sealed class SceneCamera2DFrameCollector
{
    private static readonly Vec3 Forward = new(0.0f, 0.0f, 1.0f);

    private readonly SceneCameraFrame _frame = new();

    /// <summary>Selects a 2D camera and collects its frame.</summary>
    public SceneCameraFrame? Collect(SceneWorld world, int viewportWidth, int viewportHeight)
    {
        ArgumentNullException.ThrowIfNull(world);
        return SceneCamera2DSelector.TrySelect(world, out SceneActor cameraActor)
            ? Collect(world, cameraActor, viewportWidth, viewportHeight)
            : null;
    }

    /// <summary>Collects the frame for an explicit 2D camera actor.</summary>
    public SceneCameraFrame? Collect(
        SceneWorld world,
        SceneActor cameraActor,
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

        if (!world.HasTransform2D ||
            !world.TryGetData(cameraActor, out SceneCamera camera) ||
            !camera.Enabled ||
            !world.TryGetData(cameraActor, out SceneCamera2D camera2D))
        {
            return null;
        }

        Validate(in camera, in camera2D);

        float aspectRatio = viewportWidth / (float)viewportHeight;
        Vec2 worldPosition = world.GetWorldPosition2D(cameraActor);
        Mat3 worldMatrix = world.GetWorldMatrix2D(cameraActor);
        float rotationRadians = MathF.Atan2(worldMatrix.M12, worldMatrix.M11);

        var position = new Vec3(worldPosition.X, worldPosition.Y, -camera2D.Depth);
        Vec3 target = position + Forward;
        var up = new Vec3(-MathF.Sin(rotationRadians), MathF.Cos(rotationRadians), 0.0f);

        Mat4 view = Mat4.CreateLookAt(position, target, up);
        Mat4 projection = SceneCamera2DDefaults.CreateProjection(
            camera.OrthographicSize,
            aspectRatio,
            camera.Near,
            camera.Far);
        Mat4 viewProjection = view * projection;
        Quat rotation = Quat.CreateFromAxisAngle(Forward, rotationRadians);

        _frame.Update(
            in cameraActor,
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

    private static void Validate(in SceneCamera camera, in SceneCamera2D camera2D)
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

        if (!float.IsFinite(camera.OrthographicSize) || camera.OrthographicSize <= 0.0f)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera orthographic size must be positive and finite.");
        }

        if (!float.IsFinite(camera2D.Depth) || camera2D.Depth <= 0.0f)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera depth must be positive and finite.");
        }
    }
}
