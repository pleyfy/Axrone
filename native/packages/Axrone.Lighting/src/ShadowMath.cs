namespace Axrone.Lighting;

internal static class ShadowMath
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static Vec3 SafeNormalize(Vec3 value, Vec3 fallback) =>
        value.LengthSquared() < 1e-12f ? fallback : Vec3.Normalize(value);
}
