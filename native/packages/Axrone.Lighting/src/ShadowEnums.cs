namespace Axrone.Lighting;

/// <summary>Shadow-map sampling filter selected per frame.</summary>
public enum ShadowFilterMode : byte
{
    /// <summary>One depth compare per fragment.</summary>
    Hard = 0,

    /// <summary>Fixed 3x3 percentage-closer filtering.</summary>
    Pcf = 1,

    /// <summary>PCF with an estimated penumbra radius.</summary>
    Pcss = 2,

    /// <summary>Single-pass exponential shadow-map filtering.</summary>
    Esm = 3,

    /// <summary>Single-pass variance shadow-map filtering.</summary>
    Vsm = 4,
}

/// <summary>Supported cascade counts for the shadow atlas.</summary>
public enum ShadowCascadeCount : byte
{
    /// <summary>One full-atlas cascade.</summary>
    One = 1,

    /// <summary>Two horizontally tiled cascades.</summary>
    Two = 2,

    /// <summary>Four cascades tiled in a 2x2 atlas.</summary>
    Four = 4,
}

/// <summary>Helper mapping for cascade counts.</summary>
public static class ShadowCascadeCounts
{
    /// <summary>Maximum cascade count represented by a frame snapshot.</summary>
    public const int MaxCount = 4;

    /// <summary>Converts an enum to its cascade count.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int ToCount(ShadowCascadeCount count) =>
        count switch
        {
            ShadowCascadeCount.One => 1,
            ShadowCascadeCount.Two => 2,
            ShadowCascadeCount.Four => 4,
            _ => ThrowHelper.InvalidShadowCascadeCount<int>(),
        };

    /// <summary>Converts a supported integer to its enum.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ShadowCascadeCount FromCount(int count) =>
        count switch
        {
            1 => ShadowCascadeCount.One,
            2 => ShadowCascadeCount.Two,
            4 => ShadowCascadeCount.Four,
            _ => ThrowHelper.InvalidShadowCascadeCount<ShadowCascadeCount>(),
        };

    /// <summary>Whether a raw enum value is supported.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool IsValid(ShadowCascadeCount count) =>
        count is ShadowCascadeCount.One or ShadowCascadeCount.Two or ShadowCascadeCount.Four;

    /// <summary>Atlas grid for a cascade count.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static (int Columns, int Rows) ToGrid(ShadowCascadeCount count) =>
        count switch
        {
            ShadowCascadeCount.One => (1, 1),
            ShadowCascadeCount.Two => (2, 1),
            ShadowCascadeCount.Four => (2, 2),
            _ => ThrowHelper.InvalidShadowCascadeCount<(int, int)>(),
        };
}

/// <summary>Helper mapping for shadow filters.</summary>
public static class ShadowFilterModes
{
    /// <summary>Whether a raw enum value is supported.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool IsValid(ShadowFilterMode filter) =>
        filter is ShadowFilterMode.Hard
            or ShadowFilterMode.Pcf
            or ShadowFilterMode.Pcss
            or ShadowFilterMode.Esm
            or ShadowFilterMode.Vsm;

    /// <summary>Numeric GLSL selector, stable across package versions.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int ToShaderValue(ShadowFilterMode filter) => (int)filter;
}
