namespace Axrone.Scene.Rendering;

/// <summary>Emitter shape of an area light.</summary>
public enum SceneAreaLightShape : byte
{
    /// <summary>Rectangular emitter.</summary>
    Rect = 0,

    /// <summary>Disk emitter.</summary>
    Disk = 1
}

/// <summary>
/// Rect or disk area light. The lighting rig has no native area-light record, so
/// the collector feeds a point-light approximation for the radiance budget while
/// exposing the full emitter record to renderers that implement area shading.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneAreaLight : ISceneDataComponent
{
    /// <summary>Emitter shape.</summary>
    public SceneAreaLightShape Shape;

    /// <summary>Emitter size: width/height for rects, diameter for disks.</summary>
    public Vec2 Size;

    /// <summary>Linear color.</summary>
    public Vec3 Color;

    /// <summary>Intensity multiplier.</summary>
    public float Intensity;

    /// <summary>Influence range in world units.</summary>
    public float Range;

    /// <summary>Falloff exponent.</summary>
    public float Attenuation;

    /// <summary>Whether the back face emits.</summary>
    public bool TwoSided;

    /// <summary>Whether the light participates in collection.</summary>
    public bool Enabled;

    /// <summary>Default light: white one-unit rect, range 5, two-sided.</summary>
    public static SceneAreaLight Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Shape = SceneAreaLightShape.Rect,
            Size = Vec2.One,
            Color = Vec3.One,
            Intensity = 1.0f,
            Range = 5.0f,
            Attenuation = 2.0f,
            TwoSided = true,
            Enabled = true
        };
    }
}

/// <summary>World-space area-light record emitted alongside the lighting selection.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneAreaLightRenderItem
{
    /// <summary>Owning actor.</summary>
    public SceneActor Actor;

    /// <summary>Emitter shape.</summary>
    public SceneAreaLightShape Shape;

    /// <summary>Emitter size.</summary>
    public Vec2 Size;

    /// <summary>World position.</summary>
    public Vec3 Position;

    /// <summary>World rotation.</summary>
    public Quat Rotation;

    /// <summary>Linear color.</summary>
    public Vec3 Color;

    /// <summary>Intensity multiplier.</summary>
    public float Intensity;

    /// <summary>Influence range.</summary>
    public float Range;

    /// <summary>Falloff exponent.</summary>
    public float Attenuation;

    /// <summary>Whether the back face emits.</summary>
    public bool TwoSided;
}
