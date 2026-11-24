namespace Axrone.Scene.Rendering;

/// <summary>Axis the perspective field of view is measured against.</summary>
public enum SceneCameraFovAxis : byte
{
    /// <summary>Vertical field of view.</summary>
    Vertical = 0,

    /// <summary>Horizontal field of view.</summary>
    Horizontal = 1
}

/// <summary>
/// Camera data component. Projection and view matrices are produced by
/// <c>SceneCameraFrameCollector</c> from this payload and the entity's
/// world transform.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneCamera : ISceneDataComponent
{
    /// <summary>Whether this camera wins selection over non-primary cameras.</summary>
    public bool Primary;

    /// <summary>Whether the camera participates in selection.</summary>
    public bool Enabled;

    /// <summary>Whether the projection is orthographic.</summary>
    public bool Orthographic;

    /// <summary>Axis used by the perspective field of view.</summary>
    public SceneCameraFovAxis FieldOfViewAxis;

    /// <summary>Perspective field of view in degrees.</summary>
    public float FieldOfViewDegrees;

    /// <summary>Orthographic half-height.</summary>
    public float OrthographicSize;

    /// <summary>Near clip distance.</summary>
    public float Near;

    /// <summary>Far clip distance.</summary>
    public float Far;

    /// <summary>Clear operations requested by this camera.</summary>
    public SceneClearMask ClearMask;

    /// <summary>Clear color.</summary>
    public Vec4 ClearColor;

    /// <summary>Clear depth.</summary>
    public float ClearDepth;

    /// <summary>Default perspective camera with color and depth clears.</summary>
    public static SceneCamera Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Primary = false,
            Enabled = true,
            Orthographic = false,
            FieldOfViewAxis = SceneCameraFovAxis.Vertical,
            FieldOfViewDegrees = 60.0f,
            OrthographicSize = 5.0f,
            Near = 0.1f,
            Far = 1000.0f,
            ClearMask = SceneClearMask.Color | SceneClearMask.Depth,
            ClearColor = new Vec4(0.08f, 0.09f, 0.11f, 1.0f),
            ClearDepth = 1.0f
        };
    }

    /// <summary>Configures a perspective camera.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetPerspective(
        float fieldOfViewDegrees,
        float near,
        float far,
        SceneCameraFovAxis axis = SceneCameraFovAxis.Vertical)
    {
        Orthographic = false;
        FieldOfViewDegrees = fieldOfViewDegrees;
        FieldOfViewAxis = axis;
        Near = near;
        Far = far;
    }

    /// <summary>Configures an orthographic camera.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetOrthographic(float halfHeight, float near, float far)
    {
        Orthographic = true;
        OrthographicSize = halfHeight;
        Near = near;
        Far = far;
    }
}
