namespace Axrone.Physics.Core;

/// <summary>
/// How the two sides of a contact merge one material property. Each shape
/// owns its mode; the pair resolves through the stricter rule when the modes
/// disagree, so a bouncy surface never loses its bounce against a dead one.
/// </summary>
public enum CombineMode : byte
{
    /// <summary>Larger of the two values; the stricter rule when disagreeing.</summary>
    Max = 0,

    /// <summary>Arithmetic mean of the two values.</summary>
    Average = 1,

    /// <summary>Smaller of the two values.</summary>
    Min = 2,

    /// <summary>Product of the two values.</summary>
    Multiply = 3,
}

/// <summary>
/// Contact-material combination shared by both dimensions: one table of
/// merge rules so a 2D pair and a 3D pair blend the same numbers.
/// </summary>
public static class MaterialCombiner
{
    /// <summary>
    /// Merges two contact-reaction coefficients through the mode selected by
    /// the slower (smaller) side, mirroring Box2D's stricter-rule dispatch.
    /// </summary>
    /// <param name="a">Coefficient of the first shape; never negative.</param>
    /// <param name="b">Coefficient of the second shape; never negative.</param>
    /// <param name="modeA">Combine mode carried by the first shape.</param>
    /// <param name="modeB">Combine mode carried by the second shape.</param>
    /// <returns>The combined coefficient.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float CombineFriction(float a, float b, CombineMode modeA, CombineMode modeB)
    {
        return a < b ? Combine(b, a, modeA) : Combine(a, b, modeB);
    }

    /// <summary>
    /// Merges two restitution coefficients through the mode selected by the
    /// faster (larger) side, mirroring Box2D's stricter-rule dispatch.
    /// </summary>
    /// <param name="a">Coefficient of the first shape; the closed interval [0, 1].</param>
    /// <param name="b">Coefficient of the second shape; the closed interval [0, 1].</param>
    /// <param name="modeA">Combine mode carried by the first shape.</param>
    /// <param name="modeB">Combine mode carried by the second shape.</param>
    /// <returns>The combined coefficient.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float CombineRestitution(float a, float b, CombineMode modeA, CombineMode modeB)
    {
        return a > b ? Combine(a, b, modeA) : Combine(b, a, modeB);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float Combine(float larger, float smaller, CombineMode mode) => mode switch
    {
        CombineMode.Average => (larger + smaller) * 0.5f,
        CombineMode.Min => smaller,
        CombineMode.Multiply => larger * smaller,
        _ => larger,
    };
}
