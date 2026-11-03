namespace Axrone.Lighting;

/// <summary>
/// Projection-independent camera state required to build cascade matrices.
/// Vectors are normalized at build time so callers can pass either raw basis
/// vectors or values extracted from a scene transform.
/// </summary>
public readonly record struct ShadowCameraParameters
{
    /// <summary>World-space camera position.</summary>
    public readonly Vec3 Position;

    /// <summary>Normalized camera forward vector.</summary>
    public readonly Vec3 Forward;

    /// <summary>Normalized camera up vector.</summary>
    public readonly Vec3 Up;

    /// <summary>Normalized camera right vector.</summary>
    public readonly Vec3 Right;

    /// <summary>Vertical perspective field of view in radians.</summary>
    public readonly float VerticalFieldOfViewRadians;

    /// <summary>Viewport width divided by viewport height.</summary>
    public readonly float AspectRatio;

    /// <summary>Near plane distance.</summary>
    public readonly float Near;

    /// <summary>Far plane distance.</summary>
    public readonly float Far;

    /// <summary>Whether the camera projection is orthographic.</summary>
    public readonly bool Orthographic;

    /// <summary>Orthographic frustum width.</summary>
    public readonly float OrthographicWidth;

    /// <summary>Orthographic frustum height.</summary>
    public readonly float OrthographicHeight;

    /// <summary>Creates validated camera parameters.</summary>
    public ShadowCameraParameters(
        Vec3 position,
        Vec3 forward,
        Vec3 up,
        Vec3 right,
        float verticalFieldOfViewRadians,
        float aspectRatio,
        float near,
        float far,
        bool orthographic = false,
        float orthographicWidth = 1.0f,
        float orthographicHeight = 1.0f)
    {
        if (!LightingGuards.IsFinite(position) || !LightingGuards.IsFinite(forward) ||
            !LightingGuards.IsFinite(up) || !LightingGuards.IsFinite(right))
        {
            ThrowHelper.ThrowShadowValidation("Shadow camera vectors must be finite.");
        }

        if (!LightingGuards.IsFinite(verticalFieldOfViewRadians) || verticalFieldOfViewRadians <= 0.0f ||
            verticalFieldOfViewRadians >= MathF.PI)
        {
            ThrowHelper.ThrowShadowValidation("Shadow field of view must be between zero and pi radians.");
        }

        if (!LightingGuards.IsFinite(aspectRatio) || aspectRatio <= 0.0f)
        {
            ThrowHelper.ThrowShadowValidation("Shadow aspect ratio must be positive and finite.");
        }

        if (!LightingGuards.IsFinite(near) || near <= 0.0f)
        {
            ThrowHelper.ThrowShadowValidation("Shadow camera near plane must be positive and finite.");
        }

        if (!LightingGuards.IsFinite(far) || far <= near)
        {
            ThrowHelper.ThrowShadowValidation("Shadow camera far plane must be finite and greater than near.");
        }

        if (orthographic)
        {
            if (!LightingGuards.IsFinite(orthographicWidth) || orthographicWidth <= 0.0f ||
                !LightingGuards.IsFinite(orthographicHeight) || orthographicHeight <= 0.0f)
            {
                ThrowHelper.ThrowShadowValidation("Orthographic shadow frustum dimensions must be positive and finite.");
            }
        }

        Position = position;
        Forward = ShadowMath.SafeNormalize(forward, new Vec3(0.0f, 0.0f, -1.0f));
        Up = ShadowMath.SafeNormalize(up, Vec3.UnitY);
        Right = ShadowMath.SafeNormalize(right, Vec3.UnitX);
        VerticalFieldOfViewRadians = verticalFieldOfViewRadians;
        AspectRatio = aspectRatio;
        Near = near;
        Far = far;
        Orthographic = orthographic;
        OrthographicWidth = orthographicWidth;
        OrthographicHeight = orthographicHeight;
    }
}

/// <summary>Builds cascade view-projection matrices from camera and light state.</summary>
public static class ShadowCascadeFrameBuilder
{
    private static readonly Vec3 DefaultForward = new(0.0f, 0.0f, -1.0f);
    private static readonly Vec3 DefaultUp = Vec3.UnitY;
    private static readonly Vec3 DefaultRight = Vec3.UnitX;

    /// <summary>
    /// Populates a reusable shadow frame. The builder fits a bounding sphere to
    /// each cascade sub-frustum and emits an orthographic light projection; all
    /// arithmetic is deterministic for identical inputs.
    /// </summary>
    /// <param name="frame">Reusable destination frame.</param>
    /// <param name="settings">Shadow settings.</param>
    /// <param name="camera">Camera parameters.</param>
    /// <param name="lightDirection">Direction from the light toward the scene.</param>
    /// <param name="atlasWidth">Atlas width in pixels.</param>
    /// <param name="atlasHeight">Atlas height in pixels.</param>
    /// <returns>Number of populated cascades.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="frame"/> is null.</exception>
    /// <exception cref="LightingValidationException">The configuration is invalid.</exception>
    public static int Build(
        ShadowFrameData frame,
        in ShadowSettings settings,
        in ShadowCameraParameters camera,
        in Vec3 lightDirection,
        int atlasWidth = 2048,
        int atlasHeight = 2048)
    {
        ArgumentNullException.ThrowIfNull(frame);
        frame.ApplySettings(settings, atlasWidth, atlasHeight);

        if (!settings.Enabled)
        {
            return 0;
        }

        if (atlasWidth < ShadowSettings.MinAtlasSize || atlasHeight < ShadowSettings.MinAtlasSize)
        {
            ThrowHelper.ThrowShadowValidation($"Shadow atlas dimensions must be at least {ShadowSettings.MinAtlasSize}.");
        }

        Vec3 light = ShadowMath.SafeNormalize(lightDirection, DefaultForward);
        Vec3 lightUp = ChooseLightUp(light);
        Span<float> splits = stackalloc float[ShadowCascadeCounts.MaxCount];
        ShadowSplits.Compute(
            camera.Near,
            camera.Far,
            settings.CascadeCount,
            settings.CascadeSplitLambda,
            settings.MaxDistance,
            splits);

        int count = ShadowCascadeCounts.ToCount(settings.CascadeCount);
        for (int index = 0; index < count; index++)
        {
            float near = index == 0 ? camera.Near : splits[index - 1];
            float far = splits[index];
            if (far <= near)
            {
                far = MathF.Max(far, near + ShadowSplits.MinSpan);
            }

            Vec3 center = FitSubFrustumSphere(in camera, near, far, out float radius);
            radius = MathF.Max(radius, ShadowSplits.MinSpan);
            float extent = radius * 2.0f;
            float depth = MathF.Max(radius * 8.0f, ShadowSplits.MinSpan);
            Vec3 eye = center - (light * depth);
            Mat4 view = Mat4.CreateLookAt(eye, center, lightUp);
            Mat4 projection = Mat4.CreateOrthographic(extent, extent, -depth, depth);
            Mat4 lightViewProjection = view * projection;
            Vec4 tile = ShadowAtlasLayout.GetTile(settings.CascadeCount, index);
            frame.SetCascade(index, in lightViewProjection, far, in tile);
        }

        return count;
    }

    private static Vec3 FitSubFrustumSphere(in ShadowCameraParameters camera, float near, float far, out float radius)
    {
        Span<Vec3> corners = stackalloc Vec3[8];
        FillNearRing(in camera, near, corners[..4]);
        FillNearRing(in camera, far, corners[4..]);

        Vec3 center = default;
        for (int i = 0; i < corners.Length; i++)
        {
            center += corners[i];
        }

        center *= 0.125f;
        float maxDistance = 0.0f;
        for (int i = 0; i < corners.Length; i++)
        {
            maxDistance = MathF.Max(maxDistance, Vec3.Distance(center, corners[i]));
        }

        radius = maxDistance;
        return center;
    }

    private static void FillNearRing(in ShadowCameraParameters camera, float distance, Span<Vec3> destination)
    {
        if (destination.Length < 4)
        {
            ThrowHelper.ThrowShadowValidation("Frustum ring destination requires four corners.");
        }

        float halfWidth;
        float halfHeight;
        if (camera.Orthographic)
        {
            halfWidth = camera.OrthographicWidth * 0.5f;
            halfHeight = camera.OrthographicHeight * 0.5f;
        }
        else
        {
            float tangent = MathF.Tan(camera.VerticalFieldOfViewRadians * 0.5f);
            halfHeight = tangent * distance;
            halfWidth = halfHeight * camera.AspectRatio;
        }

        Vec3 center = camera.Position + (camera.Forward * distance);
        destination[0] = center - (camera.Right * halfWidth) - (camera.Up * halfHeight);
        destination[1] = center + (camera.Right * halfWidth) - (camera.Up * halfHeight);
        destination[2] = center - (camera.Right * halfWidth) + (camera.Up * halfHeight);
        destination[3] = center + (camera.Right * halfWidth) + (camera.Up * halfHeight);
    }

    private static Vec3 ChooseLightUp(Vec3 direction)
    {
        float dot = MathF.Abs(Vec3.Dot(direction, DefaultUp));
        return dot > 0.999f ? DefaultRight : DefaultUp;
    }
}
