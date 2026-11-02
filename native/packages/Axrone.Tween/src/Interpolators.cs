namespace Axrone.Tween;

/// <summary>Scalar and vector linear interpolators.</summary>
public readonly struct FloatInterpolator : IInterpolator<float>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float Interpolate(in float start, in float finish, float factor) => start + ((finish - start) * factor);
}

/// <inheritdoc cref="FloatInterpolator"/>
public readonly struct Vec2Interpolator : IInterpolator<Vec2>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec2 Interpolate(in Vec2 start, in Vec2 finish, float factor) => start + ((finish - start) * factor);
}

/// <inheritdoc cref="FloatInterpolator"/>
public readonly struct Vec3Interpolator : IInterpolator<Vec3>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec3 Interpolate(in Vec3 start, in Vec3 finish, float factor) => start + ((finish - start) * factor);
}

/// <inheritdoc cref="FloatInterpolator"/>
public readonly struct Vec4Interpolator : IInterpolator<Vec4>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec4 Interpolate(in Vec4 start, in Vec4 finish, float factor) => start + ((finish - start) * factor);
}
