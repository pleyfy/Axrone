namespace Axrone.Scene.Rendering;

/// <summary>
/// Energy-conserving analytic approximation for rectangular and disk area
/// lights. The emitter is reduced to its closest point on the light plane; the
/// resulting radiance is bounded by the emitter's total emitted radiance.
/// </summary>
public static class SceneAreaLightShading
{
    private const float Epsilon = 1e-6f;

    /// <summary>Evaluates the diffuse contribution of one area light.</summary>
    /// <param name="light">World-space emitter record.</param>
    /// <param name="point">World-space surface point.</param>
    /// <param name="normal">Unit surface normal.</param>
    /// <returns>Linear RGB contribution; zero when the surface faces away.</returns>
    public static Vec3 Evaluate(in SceneAreaLightRenderItem light, in Vec3 point, in Vec3 normal)
    {
        Vec3 right = light.Rotation * Vec3.UnitX;
        Vec3 up = light.Rotation * Vec3.UnitY;
        Vec3 forward = light.Rotation * Vec3.UnitZ;

        Vec3 delta = point - light.Position;
        float localX = Vec3.Dot(delta, right);
        float localY = Vec3.Dot(delta, up);
        float halfWidth = MathF.Max(light.Size.X * 0.5f, Epsilon);
        float halfHeight = MathF.Max(light.Size.Y * 0.5f, Epsilon);

        float representativeX;
        float representativeY;
        float area;

        if (light.Shape == SceneAreaLightShape.Disk)
        {
            float radius = MathF.Max(halfWidth, halfHeight);
            float radial = MathF.Sqrt((localX * localX) + (localY * localY));
            float scale = radial > radius ? radius / radial : 1.0f;
            representativeX = localX * scale;
            representativeY = localY * scale;
            area = MathF.PI * radius * radius;
        }
        else
        {
            representativeX = Math.Clamp(localX, -halfWidth, halfWidth);
            representativeY = Math.Clamp(localY, -halfHeight, halfHeight);
            area = 4.0f * halfWidth * halfHeight;
        }

        Vec3 representative = light.Position + (right * representativeX) + (up * representativeY);
        Vec3 toLight = representative - point;
        float distanceSquared = MathF.Max(toLight.LengthSquared(), Epsilon);
        float distance = MathF.Sqrt(distanceSquared);
        Vec3 direction = toLight / distance;

        float facing = Vec3.Dot(forward, direction);
        if (!light.TwoSided && facing > 0.0f)
        {
            return Vec3.Zero;
        }

        float cosine = MathF.Max(Vec3.Dot(normal, direction), 0.0f);
        if (cosine <= 0.0f)
        {
            return Vec3.Zero;
        }

        float emitterCosine = MathF.Min(MathF.Abs(facing), 1.0f);
        float solidAngle = MathF.Min((area * emitterCosine) / distanceSquared, MathF.PI);
        float range = MathF.Max(light.Range, Epsilon);
        float attenuation = 1.0f / (1.0f + (distanceSquared / (range * range)));
        float radiance = light.Intensity * attenuation * solidAngle / MathF.PI;

        return new Vec3(
            light.Color.X * radiance * cosine,
            light.Color.Y * radiance * cosine,
            light.Color.Z * radiance * cosine);
    }
}
