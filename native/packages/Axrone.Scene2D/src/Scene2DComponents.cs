namespace Axrone.Scene2D;

/// <summary>Axis the perspective field of view is measured against.</summary>
public enum Scene2DCameraFovAxis : byte
{
    /// <summary>Vertical field of view.</summary>
    Vertical = 0,

    /// <summary>Horizontal field of view.</summary>
    Horizontal = 1
}

/// <summary>Framebuffer clear operations requested by a 2D camera.</summary>
[Flags]
public enum Scene2DClearMask : byte
{
    /// <summary>Do not clear.</summary>
    None = 0,

    /// <summary>Clear the color attachment.</summary>
    Color = 1 << 0,

    /// <summary>Clear depth.</summary>
    Depth = 1 << 1
}

/// <summary>Shape of a sprite mask.</summary>
public enum Scene2DSpriteMaskKind : byte
{
    /// <summary>Axis-aligned rectangle.</summary>
    Rect = 0,

    /// <summary>Ellipse inscribed in the rect.</summary>
    Ellipse = 1,

    /// <summary>Rectangle with rounded corners.</summary>
    RoundedRect = 2
}

/// <summary>
/// Camera payload owned by the 2D facade. The field layout mirrors the
/// renderer camera contract without taking a rendering dependency; the
/// consumer bridge copies this payload into the rendering component.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Scene2DCamera : ISceneDataComponent
{
    /// <summary>Whether this camera wins selection over non-primary cameras.</summary>
    public bool Primary;

    /// <summary>Whether the camera participates in selection.</summary>
    public bool Enabled;

    /// <summary>Whether the projection is orthographic.</summary>
    public bool Orthographic;

    /// <summary>Axis used by the perspective field of view.</summary>
    public Scene2DCameraFovAxis FieldOfViewAxis;

    /// <summary>Perspective field of view in degrees.</summary>
    public float FieldOfViewDegrees;

    /// <summary>Orthographic half-height.</summary>
    public float OrthographicSize;

    /// <summary>Near clip distance.</summary>
    public float Near;

    /// <summary>Far clip distance.</summary>
    public float Far;

    /// <summary>Clear operations requested by this camera.</summary>
    public Scene2DClearMask ClearMask;

    /// <summary>Clear color.</summary>
    public Vec4 ClearColor;

    /// <summary>Clear depth.</summary>
    public float ClearDepth;

    /// <summary>Default 2D camera: orthographic, five-unit half-height.</summary>
    public static Scene2DCamera Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Primary = false,
            Enabled = true,
            Orthographic = true,
            FieldOfViewAxis = Scene2DCameraFovAxis.Vertical,
            FieldOfViewDegrees = 60.0f,
            OrthographicSize = 5.0f,
            Near = 0.1f,
            Far = 1000.0f,
            ClearMask = Scene2DClearMask.Color | Scene2DClearMask.Depth,
            ClearColor = new Vec4(0.08f, 0.09f, 0.11f, 1.0f),
            ClearDepth = 1.0f
        };
    }
}

/// <summary>
/// Marks a camera as 2D and carries its view distance in front of the scene
/// plane. Mirrors the renderer's 2D camera depth contract.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Scene2DCamera2D : ISceneDataComponent
{
    /// <summary>Distance from the XY plane along -Z.</summary>
    public float Depth;

    /// <summary>Default view distance of ten units.</summary>
    public static Scene2DCamera2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new() { Depth = 10.0f };
    }
}

/// <summary>
/// Sprite renderer staging payload. Asset references use scene symbols so the
/// facade stays independent of the asset catalog; the bridge resolves them to
/// texture and material asset ids.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Scene2DSpriteRenderer : ISceneDataComponent
{
    /// <summary>Sprite texture symbol.</summary>
    public SceneStringId TextureId;

    /// <summary>Optional material override symbol.</summary>
    public SceneStringId MaterialId;

    /// <summary>Render pass symbol.</summary>
    public SceneStringId PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled;

    /// <summary>Whether the sprite is visible.</summary>
    public bool Visible;

    /// <summary>Mirror horizontally.</summary>
    public bool FlipX;

    /// <summary>Mirror vertically.</summary>
    public bool FlipY;

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer;

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder;

    /// <summary>World-space size in units.</summary>
    public Vec2 Size;

    /// <summary>Texture source size used by UV and slice math.</summary>
    public Vec2 SourceSize;

    /// <summary>Anchor in normalized sprite space.</summary>
    public Vec2 Anchor;

    /// <summary>Tint color.</summary>
    public Vec4 Color;

    /// <summary>Atlas window as (x, y, width, height) in normalized UV space.</summary>
    public Vec4 UvRect;

    /// <summary>Depth used to order sprites inside the same layer and order.</summary>
    public float Depth;

    private static readonly SceneStringId MainPassSymbol = SceneStringId.FromUtf8("main"u8);

    /// <summary>Default sprite: visible, main pass, unit size, centered anchor.</summary>
    public static Scene2DSpriteRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            TextureId = SceneStringId.Invalid,
            MaterialId = SceneStringId.Invalid,
            PassId = MainPassSymbol,
            Enabled = true,
            Visible = true,
            FlipX = false,
            FlipY = false,
            SortingLayer = 0,
            RenderOrder = 0,
            Size = Vec2.One,
            SourceSize = Vec2.One,
            Anchor = new Vec2(0.5f, 0.5f),
            Color = Vec4.One,
            UvRect = new Vec4(0.0f, 0.0f, 1.0f, 1.0f),
            Depth = 0.0f
        };
    }
}

/// <summary>
/// Sprite animation staging payload. The clip symbol resolves through the asset
/// catalog in the consumer bridge; playback state is carried here so facade
/// creation remains allocation-free.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Scene2DSpriteAnimator : ISceneDataComponent
{
    /// <summary>Animation clip symbol.</summary>
    public SceneStringId ClipId;

    /// <summary>Playback speed multiplier; zero pauses advancement.</summary>
    public float Speed;

    /// <summary>Seconds spent inside the current frame.</summary>
    public float ElapsedSeconds;

    /// <summary>Index of the frame currently displayed.</summary>
    public int FrameIndex;

    /// <summary>Whether playback advances.</summary>
    public bool Playing;

    /// <summary>Whether playback loops at the clip end.</summary>
    public bool Loop;

    /// <summary>Default animator: playing, looping, speed one.</summary>
    public static Scene2DSpriteAnimator Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ClipId = SceneStringId.Invalid,
            Speed = 1.0f,
            ElapsedSeconds = 0.0f,
            FrameIndex = 0,
            Playing = true,
            Loop = true
        };
    }
}

/// <summary>
/// Clipping mask applied to a sprite. The rect is normalized to the sprite quad
/// so the same mask works at any world size. Mirrors the renderer mask payload.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Scene2DSpriteMask : ISceneDataComponent
{
    /// <summary>Mask shape.</summary>
    public Scene2DSpriteMaskKind Kind;

    /// <summary>Mask rect as (x, y, width, height) in normalized sprite space.</summary>
    public Vec4 Rect;

    /// <summary>Inverts the inside test.</summary>
    public bool Invert;

    /// <summary>Soft edge width in normalized mask units; zero is a hard edge.</summary>
    public float Feather;

    /// <summary>Corner radius for rounded rectangles in normalized units.</summary>
    public float CornerRadius;

    /// <summary>Whether the mask participates in resolution.</summary>
    public bool Enabled;

    /// <summary>Default mask: enabled, full-quad rectangle.</summary>
    public static Scene2DSpriteMask Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Kind = Scene2DSpriteMaskKind.Rect,
            Rect = new Vec4(0.0f, 0.0f, 1.0f, 1.0f),
            Invert = false,
            Feather = 0.0f,
            CornerRadius = 0.0f,
            Enabled = true
        };
    }
}
