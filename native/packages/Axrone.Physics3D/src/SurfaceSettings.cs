namespace Axrone.Physics3D;

/// <summary>
/// How a pair blends a surface property: the canonical engine default is
/// <see cref="Inherit"/> — friction mixes as the geometric mean, restitution
/// takes the maximum, matching the web reference solver.
/// </summary>
public enum CombineMode : byte
{
    /// <summary>No explicit choice; the pair falls back to the canonical blend.</summary>
    Inherit = 0,

    /// <summary>Arithmetic mean of the two values.</summary>
    Average = 1,

    /// <summary>Smaller of the two values.</summary>
    Minimum = 2,

    /// <summary>Larger of the two values.</summary>
    Maximum = 3,

    /// <summary>Friction: geometric mean; restitution: product.</summary>
    Multiply = 4,
}

/// <summary>
/// Per-shape surface tuning: separate static and dynamic friction with
/// optional combine overrides. A zero friction component inherits the
/// shape material friction; <see cref="CombineMode.Inherit"/> defers to the
/// pair partner and finally to the canonical blend.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SurfaceSettings(float StaticFriction, float DynamicFriction, CombineMode FrictionCombine, CombineMode RestitutionCombine)
{
    /// <summary>Material-inherited friction with canonical combine modes.</summary>
    public static SurfaceSettings Default => default;

    /// <summary>Blends one friction channel of a pair under the mode precedence.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static float MixFriction(in ShapeRecord a, in ShapeRecord b, bool staticChannel)
    {
        float valueA = staticChannel ? a.Surface.StaticFriction : a.Surface.DynamicFriction;
        float valueB = staticChannel ? b.Surface.StaticFriction : b.Surface.DynamicFriction;
        if (valueA <= 0.0f)
        {
            valueA = a.Material.Friction;
        }

        if (valueB <= 0.0f)
        {
            valueB = b.Material.Friction;
        }

        CombineMode mode = a.Surface.FrictionCombine != CombineMode.Inherit
            ? a.Surface.FrictionCombine
            : b.Surface.FrictionCombine;
        return mode switch
        {
            CombineMode.Average => (valueA + valueB) * 0.5f,
            CombineMode.Minimum => MathF.Min(valueA, valueB),
            CombineMode.Maximum => MathF.Max(valueA, valueB),
            CombineMode.Multiply => MathF.Sqrt(valueA * valueB),
            _ => MathF.Sqrt(valueA * valueB),
        };
    }

    /// <summary>Blends restitution of a pair under the mode precedence.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static float MixRestitution(in ShapeRecord a, in ShapeRecord b)
    {
        CombineMode mode = a.Surface.RestitutionCombine != CombineMode.Inherit
            ? a.Surface.RestitutionCombine
            : b.Surface.RestitutionCombine;
        float valueA = a.Material.Restitution;
        float valueB = b.Material.Restitution;
        return mode switch
        {
            CombineMode.Average => (valueA + valueB) * 0.5f,
            CombineMode.Minimum => MathF.Min(valueA, valueB),
            CombineMode.Maximum => MathF.Max(valueA, valueB),
            CombineMode.Multiply => valueA * valueB,
            _ => MathF.Max(valueA, valueB),
        };
    }
    /// <summary>Blends both surface channels and restitution of a pair into the contact.</summary>
    internal static void BlendInto(in ShapeRecord a, in ShapeRecord b, ref Contact3D contact)
    {
        contact.StaticFriction = MixFriction(in a, in b, true);
        contact.Friction = MixFriction(in a, in b, false);
        contact.Restitution = MixRestitution(in a, in b);
        contact.Blended = true;
    }

}
