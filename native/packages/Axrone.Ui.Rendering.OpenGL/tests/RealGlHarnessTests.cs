namespace Axrone.Ui.Rendering.OpenGL.Tests;

using Axrone.Render.OpenGL.Texture;
using Axrone.Ui;
using Axrone.Ui.Rendering;
using Axrone.Ui.Testing.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class RealGlHarnessTests
{
    [RealGpuFact]
    public void Harness_CreatesLiveDeviceOrSkipsWithReason()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();

        device.Description.Should().Contain("OpenGL");
        device.Context.IsLost.Should().BeFalse();

        using var probe = new PixelProbe(device.Context, 4, 4);
        probe.Begin(new UiColor(0f, 0f, 1f, 1f));

        PixelSurface surface = probe.Read();

        surface.Pixel(1, 1).Should().Be(new Pixel(0, 0, 255, 255));
        surface.Pixel(0, 0).Should().Be(new Pixel(0, 0, 255, 255));
    }

    [RealGpuFact]
    public void Harness_CreatesAtlasPagesAndReadsThemBack()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        byte[] pagePixels = GlyphFields.Constant(4, 4, 200);
        using var scene = new GlyphTestScene(device.Context, TextureFormat.R8, UiGlyphFormat.Sdf, 4, 4, pagePixels);
        using var backend = scene.CreateBackend();

        backend.IsReady.Should().BeTrue();

        PixelSurface readback = TextureReadback.Read(device.Context, scene.PageTexture, TextureFormat.R8, 4, 4);

        readback.Channels.Should().Be(1);
        readback.Channel(2, 2, 0).Should().Be(200);
    }
}
