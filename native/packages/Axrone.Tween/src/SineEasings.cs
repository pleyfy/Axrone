namespace Axrone.Tween;

/// <summary>Sine curves matching the TS Sinusoidal easing family.</summary>
public readonly struct EaseInSineCurve : IEasingFunction
{
    /// <inheritdoc/>
    public static float Evaluate(float t) => 1.0f - MathF.Cos(t * MathF.PI * 0.5f);
}

/// <summary>Sine ease-out curve.</summary>
public readonly struct EaseOutSineCurve : IEasingFunction
{
    /// <inheritdoc/>
    public static float Evaluate(float t) => MathF.Sin(t * MathF.PI * 0.5f);
}

/// <summary>Sine ease-in-out curve.</summary>
public readonly struct EaseInOutSineCurve : IEasingFunction
{
    /// <inheritdoc/>
    public static float Evaluate(float t) => 0.5f * (1.0f - MathF.Cos(MathF.PI * t));
}
