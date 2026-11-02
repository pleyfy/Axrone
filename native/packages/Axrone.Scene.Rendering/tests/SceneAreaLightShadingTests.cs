namespace Axrone.Scene.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneAreaLightShadingTests
{
    private static SceneAreaLightRenderItem Rect(float intensity = 1.0f, Vec2 size = default, bool twoSided = true) =>
        new()
        {
            Shape = SceneAreaLightShape.Rect,
            Size = size == default ? Vec2.One : size,
            Position = new Vec3(0, 1, 0),
            Rotation = Quat.CreateFromAxisAngle(Vec3.UnitX, MathF.PI * 0.5f),
            Color = Vec3.One,
            Intensity = intensity,
            Range = 5.0f,
            Attenuation = 2.0f,
            TwoSided = twoSided
        };

    [Fact]
    public void ContributionIsBoundedByEmitterRadiance()
    {
        SceneAreaLightRenderItem light = Rect(intensity: 2.0f, size: new Vec2(10, 10));

        Vec3 value = SceneAreaLightShading.Evaluate(in light, Vec3.Zero, Vec3.UnitY);

        value.X.Should().BeGreaterThan(0.0f);
        value.X.Should().BeLessThanOrEqualTo(2.0f + 1e-4f);
        value.Y.Should().Be(value.X);
        value.Z.Should().Be(value.X);
    }

    [Fact]
    public void BackFacingSurfaceReceivesNothing()
    {
        SceneAreaLightRenderItem light = Rect();

        Vec3 value = SceneAreaLightShading.Evaluate(in light, Vec3.Zero, -Vec3.UnitY);

        value.Should().Be(Vec3.Zero);
    }

    [Fact]
    public void OneSidedEmitterRejectsTheBackSide()
    {
        SceneAreaLightRenderItem front = Rect(twoSided: false);
        SceneAreaLightRenderItem back = front;
        back.Position = new Vec3(0, -1, 0);
        Vec3 point = Vec3.Zero;
        Vec3 normal = Vec3.UnitY;

        SceneAreaLightShading.Evaluate(in front, in point, in normal).X.Should().BeGreaterThan(0.0f);
        SceneAreaLightShading.Evaluate(in back, in point, in normal).Should().Be(Vec3.Zero);

        Vec3 downwardNormal = -Vec3.UnitY;
        SceneAreaLightShading.Evaluate(in back, in point, in downwardNormal).Should().Be(Vec3.Zero);

        back.TwoSided = true;
        SceneAreaLightShading.Evaluate(in back, in point, in downwardNormal).X.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void DistanceFallsOffAndDiskAndRectBothRespond()
    {
        SceneAreaLightRenderItem rect = Rect(size: new Vec2(2, 2));
        Vec3 near = SceneAreaLightShading.Evaluate(in rect, new Vec3(0, 0, 0), Vec3.UnitY);
        Vec3 far = SceneAreaLightShading.Evaluate(in rect, new Vec3(0, -4, 0), Vec3.UnitY);
        near.X.Should().BeGreaterThan(far.X);

        SceneAreaLightRenderItem disk = rect;
        disk.Shape = SceneAreaLightShape.Disk;
        disk.Size = new Vec2(2, 2);
        Vec3 diskValue = SceneAreaLightShading.Evaluate(in disk, Vec3.Zero, Vec3.UnitY);
        diskValue.X.Should().BeGreaterThan(0.0f);
        diskValue.X.Should().BeLessThanOrEqualTo(rect.Intensity + 1e-4f);
    }

    [Fact]
    public void EvaluationIsZeroAllocation()
    {
        SceneAreaLightRenderItem light = Rect();
        Vec3 point = new(0, 0, 0);
        Vec3 normal = Vec3.UnitY;

        _ = SceneAreaLightShading.Evaluate(in light, in point, in normal);
        _ = SceneAreaLightShading.Evaluate(in light, in point, in normal);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 512; i++)
        {
            _ = SceneAreaLightShading.Evaluate(in light, in point, in normal);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }
}
