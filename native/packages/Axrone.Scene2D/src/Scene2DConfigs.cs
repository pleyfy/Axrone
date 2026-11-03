namespace Axrone.Scene2D;

/// <summary>Creation settings for a 2D camera actor.</summary>
public readonly record struct Scene2DCameraConfig
{
    /// <summary>Whether the projection is orthographic.</summary>
    public bool Orthographic { get; init; }

    /// <summary>Whether this camera wins selection over non-primary cameras.</summary>
    public bool Primary { get; init; }

    /// <summary>Whether the camera participates in selection.</summary>
    public bool Enabled { get; init; }

    /// <summary>Orthographic half-height.</summary>
    public float OrthographicSize { get; init; }

    /// <summary>Perspective field of view in degrees.</summary>
    public float FieldOfViewDegrees { get; init; }

    /// <summary>Axis used by the perspective field of view.</summary>
    public Scene2DCameraFovAxis FieldOfViewAxis { get; init; }

    /// <summary>Near clip distance.</summary>
    public float Near { get; init; }

    /// <summary>Far clip distance.</summary>
    public float Far { get; init; }

    /// <summary>View distance in front of the scene plane.</summary>
    public float Depth { get; init; }

    /// <summary>Requested clear operations.</summary>
    public Scene2DClearMask ClearMask { get; init; }

    /// <summary>Clear color.</summary>
    public Vec4 ClearColor { get; init; }

    /// <summary>Clear depth.</summary>
    public float ClearDepth { get; init; }

    /// <summary>
    /// Creates the 2D camera defaults from
    /// <see cref="SceneCamera2DDefaults"/>: orthographic, primary, near 0.1,
    /// far 1000 and the reference-viewport half-height.
    /// </summary>
    public Scene2DCameraConfig()
    {
        Scene2DCamera defaults = Scene2DCamera.Default;
        SceneCamera rendererDefaults = SceneCamera2DDefaults.CreateCamera();
        Orthographic = rendererDefaults.Orthographic;
        Primary = rendererDefaults.Primary;
        Enabled = defaults.Enabled;
        OrthographicSize = rendererDefaults.OrthographicSize;
        FieldOfViewDegrees = defaults.FieldOfViewDegrees;
        FieldOfViewAxis = defaults.FieldOfViewAxis;
        Near = rendererDefaults.Near;
        Far = rendererDefaults.Far;
        Depth = Scene2DCamera2D.Default.Depth;
        ClearMask = defaults.ClearMask;
        ClearColor = defaults.ClearColor;
        ClearDepth = defaults.ClearDepth;
    }

    internal void Validate()
    {
        if (!float.IsFinite(OrthographicSize) || OrthographicSize <= 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Orthographic size must be positive and finite.");
        }

        if (!Orthographic &&
            (!float.IsFinite(FieldOfViewDegrees) || FieldOfViewDegrees <= 0.0f || FieldOfViewDegrees >= 180.0f))
        {
            Scene2DValidation.ThrowInvalid("Perspective field of view must be between zero and 180 degrees.");
        }

        if (FieldOfViewAxis is not Scene2DCameraFovAxis.Vertical and not Scene2DCameraFovAxis.Horizontal)
        {
            Scene2DValidation.ThrowInvalid("Field-of-view axis must be a defined value.");
        }

        if ((ClearMask & ~(Scene2DClearMask.Color | Scene2DClearMask.Depth)) != 0)
        {
            Scene2DValidation.ThrowInvalid("Clear mask must only contain color and depth flags.");
        }

        if (!float.IsFinite(Near) || Near <= 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Near plane must be positive and finite.");
        }

        if (!float.IsFinite(Far) || Far <= Near)
        {
            Scene2DValidation.ThrowInvalid("Far plane must be finite and greater than the near plane.");
        }

        if (!float.IsFinite(Depth) || Depth <= 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Camera depth must be positive and finite.");
        }

        if (!float.IsFinite(ClearDepth))
        {
            Scene2DValidation.ThrowInvalid("Clear depth must be finite.");
        }

        Scene2DValidation.ValidateFinite(ClearColor.X, ClearColor.Y, ClearColor.Z, ClearColor.W, "Clear color");
    }

    internal Scene2DCamera ToComponent() => new()
    {
        Primary = Primary,
        Enabled = Enabled,
        Orthographic = Orthographic,
        FieldOfViewAxis = FieldOfViewAxis,
        FieldOfViewDegrees = FieldOfViewDegrees,
        OrthographicSize = OrthographicSize,
        Near = Near,
        Far = Far,
        ClearMask = ClearMask,
        ClearColor = ClearColor,
        ClearDepth = ClearDepth
    };

    internal Scene2DCamera2D ToDepthComponent() => new() { Depth = Depth };
}

/// <summary>Creation settings for a sprite renderer payload.</summary>
public readonly record struct Scene2DSpriteConfig
{
    /// <summary>Sprite texture symbol.</summary>
    public SceneStringId TextureId { get; init; }

    /// <summary>Optional material override symbol.</summary>
    public SceneStringId MaterialId { get; init; }

    /// <summary>Render pass symbol.</summary>
    public SceneStringId PassId { get; init; }

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled { get; init; }

    /// <summary>Whether the sprite is visible.</summary>
    public bool Visible { get; init; }

    /// <summary>Mirror horizontally.</summary>
    public bool FlipX { get; init; }

    /// <summary>Mirror vertically.</summary>
    public bool FlipY { get; init; }

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer { get; init; }

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder { get; init; }

    /// <summary>World-space size in units.</summary>
    public Vec2 Size { get; init; }

    /// <summary>Texture source size used by UV and slice math.</summary>
    public Vec2 SourceSize { get; init; }

    /// <summary>Anchor in normalized sprite space.</summary>
    public Vec2 Anchor { get; init; }

    /// <summary>Tint color.</summary>
    public Vec4 Color { get; init; }

    /// <summary>Atlas window as (x, y, width, height) in normalized UV space.</summary>
    public Vec4 UvRect { get; init; }

    /// <summary>Depth used to order sprites inside the same layer and order.</summary>
    public float Depth { get; init; }

    /// <summary>Creates the default sprite configuration.</summary>
    public Scene2DSpriteConfig()
    {
        Scene2DSpriteRenderer defaults = Scene2DSpriteRenderer.Default;
        TextureId = SceneStringId.Invalid;
        MaterialId = SceneStringId.Invalid;
        PassId = defaults.PassId;
        Enabled = defaults.Enabled;
        Visible = defaults.Visible;
        FlipX = defaults.FlipX;
        FlipY = defaults.FlipY;
        SortingLayer = defaults.SortingLayer;
        RenderOrder = defaults.RenderOrder;
        Size = defaults.Size;
        SourceSize = defaults.SourceSize;
        Anchor = defaults.Anchor;
        Color = defaults.Color;
        UvRect = defaults.UvRect;
        Depth = defaults.Depth;
    }

    internal void Validate()
    {
        if (!PassId.IsValid)
        {
            Scene2DValidation.ThrowInvalid("Sprite pass symbol must be set.");
        }

        Scene2DValidation.ValidateFinite(Size.X, Size.Y, "Sprite size");
        Scene2DValidation.ValidateFinite(SourceSize.X, SourceSize.Y, "Sprite source size");
        Scene2DValidation.ValidateFinite(Anchor.X, Anchor.Y, "Sprite anchor");
        Scene2DValidation.ValidateFinite(Color.X, Color.Y, Color.Z, Color.W, "Sprite color");
        Scene2DValidation.ValidateFinite(UvRect.X, UvRect.Y, UvRect.Z, UvRect.W, "Sprite UV rect");

        if (!float.IsFinite(Depth))
        {
            Scene2DValidation.ThrowInvalid("Sprite depth must be finite.");
        }
    }

    internal Scene2DSpriteRenderer ToComponent() => new()
    {
        TextureId = TextureId,
        MaterialId = MaterialId,
        PassId = PassId,
        Enabled = Enabled,
        Visible = Visible,
        FlipX = FlipX,
        FlipY = FlipY,
        SortingLayer = SortingLayer,
        RenderOrder = RenderOrder,
        Size = Size,
        SourceSize = SourceSize,
        Anchor = Anchor,
        Color = Color,
        UvRect = UvRect,
        Depth = Depth
    };
}

/// <summary>Creation settings for a sprite animation payload.</summary>
public readonly record struct Scene2DSpriteAnimatorConfig
{
    /// <summary>Animation clip symbol.</summary>
    public SceneStringId ClipId { get; init; }

    /// <summary>
    /// Optional renderer clip used by renderer-bound profiles. Lean staging
    /// profiles reject managed clips because their animator payload carries
    /// playback state only.
    /// </summary>
    public SceneSpriteAnimationClip? Clip { get; init; }

    /// <summary>Playback speed multiplier; zero pauses advancement.</summary>
    public float Speed { get; init; }

    /// <summary>Seconds spent inside the current frame.</summary>
    public float ElapsedSeconds { get; init; }

    /// <summary>Index of the frame currently displayed.</summary>
    public int FrameIndex { get; init; }

    /// <summary>Whether playback advances.</summary>
    public bool Playing { get; init; }

    /// <summary>Whether playback loops at the clip end.</summary>
    public bool Loop { get; init; }

    /// <summary>Creates the default animator configuration.</summary>
    public Scene2DSpriteAnimatorConfig()
    {
        Scene2DSpriteAnimator defaults = Scene2DSpriteAnimator.Default;
        ClipId = defaults.ClipId;
        Clip = null;
        Speed = defaults.Speed;
        ElapsedSeconds = defaults.ElapsedSeconds;
        FrameIndex = defaults.FrameIndex;
        Playing = defaults.Playing;
        Loop = defaults.Loop;
    }

    internal void Validate()
    {
        if (!float.IsFinite(Speed) || Speed < 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Animator speed must be non-negative and finite.");
        }

        if (!float.IsFinite(ElapsedSeconds) || ElapsedSeconds < 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Animator elapsed time must be non-negative and finite.");
        }

        if (FrameIndex < 0)
        {
            Scene2DValidation.ThrowInvalid("Animator frame index must not be negative.");
        }

        if (Clip is { } clip)
        {
            int count = clip.Frames.Count;
            if (count == 0)
            {
                if (FrameIndex != 0 || ElapsedSeconds > 0.0f)
                {
                    Scene2DValidation.ThrowInvalid("An empty animation clip cannot carry frame progress.");
                }
            }
            else if ((uint)FrameIndex >= (uint)count)
            {
                Scene2DValidation.ThrowInvalid("Animator frame index exceeds the animation clip frame count.");
            }
        }
    }

    internal Scene2DSpriteAnimator ToComponent() => new()
    {
        ClipId = ClipId,
        Speed = Speed,
        ElapsedSeconds = ElapsedSeconds,
        FrameIndex = FrameIndex,
        Playing = Playing,
        Loop = Loop
    };
}

/// <summary>Creation settings for a sprite mask payload.</summary>
public readonly record struct Scene2DSpriteMaskConfig
{
    /// <summary>Mask shape.</summary>
    public Scene2DSpriteMaskKind Kind { get; init; }

    /// <summary>Mask rect as (x, y, width, height) in normalized sprite space.</summary>
    public Vec4 Rect { get; init; }

    /// <summary>Inverts the inside test.</summary>
    public bool Invert { get; init; }

    /// <summary>Soft edge width in normalized mask units.</summary>
    public float Feather { get; init; }

    /// <summary>Corner radius for rounded rectangles in normalized units.</summary>
    public float CornerRadius { get; init; }

    /// <summary>Whether the mask participates in resolution.</summary>
    public bool Enabled { get; init; }

    /// <summary>Creates the default full-quad rectangle mask.</summary>
    public Scene2DSpriteMaskConfig()
    {
        Scene2DSpriteMask defaults = Scene2DSpriteMask.Default;
        Kind = defaults.Kind;
        Rect = defaults.Rect;
        Invert = defaults.Invert;
        Feather = defaults.Feather;
        CornerRadius = defaults.CornerRadius;
        Enabled = defaults.Enabled;
    }

    internal void Validate()
    {
        if (Kind is not Scene2DSpriteMaskKind.Rect and not Scene2DSpriteMaskKind.Ellipse and
            not Scene2DSpriteMaskKind.RoundedRect)
        {
            Scene2DValidation.ThrowInvalid("Sprite mask kind must be a defined value.");
        }

        Scene2DValidation.ValidateFinite(Rect.X, Rect.Y, Rect.Z, Rect.W, "Sprite mask rect");

        if (Rect.Z <= 0.0f || Rect.W <= 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Sprite mask rect width and height must be positive.");
        }

        if (!float.IsFinite(Feather) || Feather < 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Sprite mask feather must be non-negative and finite.");
        }

        if (!float.IsFinite(CornerRadius) || CornerRadius < 0.0f)
        {
            Scene2DValidation.ThrowInvalid("Sprite mask corner radius must be non-negative and finite.");
        }
    }

    internal Scene2DSpriteMask ToComponent() => new()
    {
        Kind = Kind,
        Rect = Rect,
        Invert = Invert,
        Feather = Feather,
        CornerRadius = CornerRadius,
        Enabled = Enabled
    };
}

/// <summary>One sprite in a bulk creation batch.</summary>
public readonly record struct Scene2DSpriteSpec
{
    /// <summary>Actor creation settings.</summary>
    public SceneActorConfig ActorConfig { get; init; }

    /// <summary>Sprite renderer settings.</summary>
    public Scene2DSpriteConfig Sprite { get; init; }

    /// <summary>Local 2D position.</summary>
    public Vec2 Position { get; init; }

    /// <summary>Creates a default spec: active actor, default sprite, origin.</summary>
    public Scene2DSpriteSpec()
    {
        ActorConfig = new SceneActorConfig();
        Sprite = new Scene2DSpriteConfig();
        Position = Vec2.Zero;
    }

    internal void Validate()
    {
        Scene2DValidation.ValidateFinite(Position.X, Position.Y, "Sprite position");
        Sprite.Validate();
    }
}

internal static class Scene2DValidation
{
    public static void ValidateFinite(float x, float y, string name)
    {
        if (!float.IsFinite(x) || !float.IsFinite(y))
        {
            ThrowInvalid($"{name} components must be finite.");
        }
    }

    public static void ValidateFinite(float x, float y, float z, float w, string name)
    {
        if (!float.IsFinite(x) || !float.IsFinite(y) || !float.IsFinite(z) || !float.IsFinite(w))
        {
            ThrowInvalid($"{name} components must be finite.");
        }
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalid(string message) =>
        throw new SceneValidationException(SceneErrorCodes.ValidationInvalid, message);
}
