namespace Axrone.Scene.Rendering;

/// <summary>Shape of a sprite mask.</summary>
public enum SceneSpriteMaskKind : byte
{
    /// <summary>Axis-aligned rectangle.</summary>
    Rect = 0,

    /// <summary>Ellipse inscribed in the rect.</summary>
    Ellipse = 1
}

/// <summary>
/// Clipping mask applied to a sprite. The rect is normalized to the sprite quad
/// (0..1) so the same mask works at any world size. A mask on an ancestor actor
/// applies to every sprite below it until a nearer mask overrides it.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSpriteMask : ISceneDataComponent
{
    /// <summary>Mask shape.</summary>
    public SceneSpriteMaskKind Kind;

    /// <summary>Mask rect as (x, y, width, height) in normalized sprite space.</summary>
    public Vec4 Rect;

    /// <summary>Inverts the inside test.</summary>
    public bool Invert;

    /// <summary>Whether the mask participates in resolution.</summary>
    public bool Enabled;

    /// <summary>Default mask: enabled, full-quad rectangle.</summary>
    public static SceneSpriteMask Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Kind = SceneSpriteMaskKind.Rect,
            Rect = new Vec4(0.0f, 0.0f, 1.0f, 1.0f),
            Invert = false,
            Enabled = true
        };
    }
}

/// <summary>
/// Resolves the effective sprite mask by walking from the sprite actor toward
/// the root. The nearest enabled mask wins; disabled masks are transparent to
/// resolution. The walk is bounded so a corrupted hierarchy cannot loop.
/// </summary>
public static class SceneSpriteMaskResolver
{
    /// <summary>Maximum ancestor levels inspected during resolution.</summary>
    public const int MaxAncestorDepth = 32;

    /// <summary>Resolves the effective mask for a sprite actor.</summary>
    /// <param name="world">Scene world.</param>
    /// <param name="actor">Sprite actor.</param>
    /// <param name="mask">Resolved mask.</param>
    /// <returns><see langword="true"/> when an enabled mask was found.</returns>
    public static bool TryResolve(SceneWorld world, SceneActor actor, out SceneSpriteMask mask)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneActor current = actor;
        for (int depth = 0; depth <= MaxAncestorDepth && !current.IsNull; depth++)
        {
            if (world.TryGetData(current, out SceneSpriteMask candidate) && candidate.Enabled && IsWellFormed(in candidate))
            {
                mask = candidate;
                return true;
            }

            current = world.Hierarchy.ParentOf(current);
        }

        mask = default;
        return false;
    }

    private static bool IsWellFormed(in SceneSpriteMask mask) =>
        mask.Rect.Z > 0.0f &&
        mask.Rect.W > 0.0f &&
        float.IsFinite(mask.Rect.X) &&
        float.IsFinite(mask.Rect.Y) &&
        float.IsFinite(mask.Rect.Z) &&
        float.IsFinite(mask.Rect.W);
}
