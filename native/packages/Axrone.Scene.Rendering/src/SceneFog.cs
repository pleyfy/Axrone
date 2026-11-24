namespace Axrone.Scene.Rendering;

/// <summary>Fog falloff mode.</summary>
public enum SceneFogMode : byte
{
    /// <summary>Linear falloff between the range start and end.</summary>
    Linear = 0,

    /// <summary>Exponential density falloff.</summary>
    Exponential = 1,

    /// <summary>Squared exponential density falloff.</summary>
    ExponentialSquared = 2
}

/// <summary>
/// Scene fog data component. One active entity carries the fog settings; the
/// frame planner resolves them into <see cref="SceneFogState"/> for the shader
/// uniform binder.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneFog : ISceneDataComponent
{
    /// <summary>Whether fog is applied.</summary>
    public bool Enabled;

    /// <summary>Linear fog color.</summary>
    public Vec3 Color;

    /// <summary>Falloff mode.</summary>
    public SceneFogMode Mode;

    /// <summary>Density for exponential modes, clamped to the zero-to-one range.</summary>
    public float Density;

    /// <summary>Linear range start.</summary>
    public float RangeStart;

    /// <summary>Linear range end.</summary>
    public float RangeEnd;

    /// <summary>Default fog: disabled, neutral blue-grey, exponential density.</summary>
    public static SceneFog Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Enabled = false,
            Color = new Vec3(0.533f, 0.6f, 0.667f),
            Mode = SceneFogMode.Exponential,
            Density = 0.015f,
            RangeStart = 0.0f,
            RangeEnd = 300.0f
        };
    }

    /// <summary>Configures linear fog.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetLinear(in Vec3 color, float rangeStart, float rangeEnd)
    {
        Enabled = true;
        Color = color;
        Mode = SceneFogMode.Linear;
        RangeStart = rangeStart;
        RangeEnd = rangeEnd;
    }

    /// <summary>Configures exponential fog.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetExponential(in Vec3 color, float density, bool squared = false)
    {
        Enabled = true;
        Color = color;
        Mode = squared ? SceneFogMode.ExponentialSquared : SceneFogMode.Exponential;
        Density = density;
    }
}

/// <summary>Resolved fog settings for one frame.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneFogState(
    bool Enabled,
    Vec3 Color,
    SceneFogMode Mode,
    float Density,
    float RangeStart,
    float RangeEnd)
{
    /// <summary>Fog disabled with the engine defaults.</summary>
    public static SceneFogState Default => new(
        false,
        new Vec3(0.533f, 0.6f, 0.667f),
        SceneFogMode.Exponential,
        0.015f,
        0.0f,
        300.0f);

    /// <summary>Resolves and sanitizes a fog component.</summary>
    public static SceneFogState FromComponent(in SceneFog fog)
    {
        float density = Math.Clamp(fog.Density, 0.0f, 1.0f);
        float start = MathF.Min(fog.RangeStart, fog.RangeEnd);
        float end = MathF.Max(fog.RangeStart, fog.RangeEnd);

        return new SceneFogState(fog.Enabled, fog.Color, fog.Mode, density, start, end);
    }
}

/// <summary>Selects the scene fog component in stable entity order.</summary>
public static class SceneFogSelector
{
    /// <summary>Resolves fog from the first active entity that carries a fog component.</summary>
    public static bool TrySelect(SceneWorld world, out SceneFogState state)
    {
        ArgumentNullException.ThrowIfNull(world);

        foreach (SceneEntity entity in world.Entities)
        {
            if (!world.IsActiveInHierarchy(entity) ||
                !world.TryGetData(entity, out SceneFog fog))
            {
                continue;
            }

            state = SceneFogState.FromComponent(in fog);
            return true;
        }

        state = SceneFogState.Default;
        return false;
    }
}
