namespace Axrone.Scene.Rendering;

/// <summary>
/// Single source for the 2D camera defaults shared by profiles, scene authors
/// and the frame collector: pixels-per-unit, zoom, clip range and the
/// orthographic half-height derived from the viewport height. The web engine
/// wires the same chain (zoom, pixels-per-unit, origin) for its 2D profile.
/// </summary>
public static class SceneCamera2DDefaults
{
    /// <summary>World units per viewport pixel.</summary>
    public const float PixelsPerUnit = 100.0f;

    /// <summary>Default orthographic zoom factor.</summary>
    public const float Zoom = 1.0f;

    /// <summary>Default near clip distance.</summary>
    public const float Near = 0.1f;

    /// <summary>Default far clip distance.</summary>
    public const float Far = 1000.0f;

    /// <summary>Default distance from the scene plane along -Z.</summary>
    public const float Depth = 10.0f;

    /// <summary>Reference viewport height used when no viewport is supplied.</summary>
    public const int ReferenceViewportHeight = 720;

    /// <summary>Computes the orthographic half-height for a viewport height.</summary>
    public static float OrthographicSizeFor(
        int viewportHeight,
        float pixelsPerUnit = PixelsPerUnit,
        float zoom = Zoom)
    {
        if (viewportHeight <= 0)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera viewport height must be positive.");
        }

        if (!(pixelsPerUnit > 0.0f) || !float.IsFinite(pixelsPerUnit))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D pixels-per-unit must be positive and finite.");
        }

        if (!(zoom > 0.0f) || !float.IsFinite(zoom))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera zoom must be positive and finite.");
        }

        return viewportHeight / (2.0f * pixelsPerUnit * zoom);
    }

    /// <summary>Creates the default orthographic camera for a viewport height.</summary>
    public static SceneCamera CreateCamera(
        int viewportHeight = ReferenceViewportHeight,
        float zoom = Zoom,
        float pixelsPerUnit = PixelsPerUnit,
        float near = Near,
        float far = Far)
    {
        if (!(far > near) || !float.IsFinite(near) || !float.IsFinite(far))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera clip range must be finite with far greater than near.");
        }

        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        camera.SetOrthographic(OrthographicSizeFor(viewportHeight, pixelsPerUnit, zoom), near, far);
        return camera;
    }

    /// <summary>Creates the default 2D camera marker.</summary>
    public static SceneCamera2D CreateCamera2D() => new() { Depth = Depth };

    /// <summary>Builds the orthographic projection used by the 2D frame collector.</summary>
    public static Mat4 CreateProjection(
        float orthographicHalfHeight,
        float aspectRatio,
        float near = Near,
        float far = Far)
    {
        if (!(orthographicHalfHeight > 0.0f) || !float.IsFinite(orthographicHalfHeight))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera orthographic size must be positive and finite.");
        }

        if (!(aspectRatio > 0.0f) || !float.IsFinite(aspectRatio))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "2D camera aspect ratio must be positive and finite.");
        }

        return Mat4.CreateOrthographic(
            orthographicHalfHeight * aspectRatio * 2.0f,
            orthographicHalfHeight * 2.0f,
            near,
            far);
    }
}
