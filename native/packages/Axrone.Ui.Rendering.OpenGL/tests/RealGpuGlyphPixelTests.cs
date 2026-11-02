namespace Axrone.Ui.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Texture;
using Axrone.Ui;
using Axrone.Ui.Rendering;
using Axrone.Ui.Testing.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class RealGpuGlyphPixelTests
{
    private const int Tolerance = 2;

    [RealGpuFact]
    public void SdfGlyph_ProducesAntialiasedEdgeAndObeysThreshold()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 64, 64);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            32,
            32,
            GlyphFields.SdfCircle(32, 32, radius: 10f, spreadPixels: 4f));
        using var backend = scene.CreateBackend();

        UiRenderCommand command = GlyphSceneFactory.TextCommand(new Rect(8, 8, 32, 32), UiColor.White);
        Draw(backend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        // Circle centre is 10px inside the field: fully covered.
        AssertChannel(surface, 24, 24, 255, 3, "centre");
        // 2px inside the radius: still saturated.
        AssertChannel(surface, 30, 24, 255, 3, "inside 2px");
        // On the radius the smoothstep threshold crosses 0.5; the exact AA value is derivative
        // dependent, so only the fractional band is asserted here.
        surface.Pixel(34, 24).A.Should().BeInRange((byte)40, (byte)215, "the radius pixel must be fractional");
        // 3px outside: empty.
        AssertChannel(surface, 37, 24, 0, 1, "outside 3px");
        // Outside the glyph quad the target keeps its cleared value.
        surface.Pixel(2, 2).Should().Be(new Pixel(0, 0, 0, 0));

        int previous = 256;
        int fractional = 0;
        for (int x = 24; x < 40; x++)
        {
            int alpha = surface.Pixel(x, 24).A;
            alpha.Should().BeLessThanOrEqualTo(previous + 1, $"the SDF edge must not brighten outward at x={x}");
            previous = alpha;
            if (alpha is > 8 and < 247)
            {
                fractional++;
            }
        }

        fractional.Should().BeInRange(1, 4, "a 4px SDF spread must produce a narrow, non-binary AA band");
        backend.SdfGlyphBatches.Should().Be(1);
        backend.CoverageGlyphBatches.Should().Be(0);
    }

    [RealGpuFact]
    public void SdfGlyph_RampCrossesTheHalfThresholdMonotonically()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 16, 8);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            16,
            8,
            GlyphFields.SdfRamp(16, 8, first: 110, last: 145));
        using var backend = scene.CreateBackend();

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 16, 8), UiColor.White),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        surface.Pixel(0, 4).A.Should().Be(0, "110/255 is below the SDF threshold band");
        surface.Pixel(15, 4).A.Should().Be(255, "145/255 is above the SDF threshold band");

        int previous = -1;
        int fractional = 0;
        for (int x = 0; x < 16; x++)
        {
            int alpha = surface.Pixel(x, 4).A;
            alpha.Should().BeGreaterThanOrEqualTo(previous, $"the threshold ramp must be monotonic at x={x}");
            previous = alpha;
            if (alpha is > 8 and < 247)
            {
                fractional++;
            }
        }

        fractional.Should().BeInRange(1, 4, "the smoothstep threshold must produce a compact AA transition");
    }

    [RealGpuFact]
    public void CoverageGlyph_ProducesExactAlphaAndPremultipliesOverTransparentBlack()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 8, 4);
        byte[] levels = [0, 51, 102, 153, 204, 255, 255, 0];
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Alpha8,
            8,
            4,
            GlyphFields.CoverageRamp(8, 4, levels));
        using var backend = scene.CreateBackend();

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 8, 4), UiColor.White),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        for (int x = 0; x < 8; x++)
        {
            Pixel pixel = surface.Pixel(x, 2);
            int expected = levels[x];
            pixel.A.Should().BeInRange((byte)Math.Max(0, expected - 1), (byte)Math.Min(255, expected + 1), $"alpha at x={x}");
            // Straight-alpha blending over transparent black yields premultiplied-looking colour.
            pixel.R.Should().BeInRange((byte)Math.Max(0, expected - 1), (byte)Math.Min(255, expected + 1), $"red at x={x}");
        }

        backend.CoverageGlyphBatches.Should().Be(1);
        backend.SdfGlyphBatches.Should().Be(0);
    }

    [RealGpuFact]
    public void CoverageGlyph_AppliesOpacityMultiplier()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 4, 4);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Alpha8,
            4,
            4,
            GlyphFields.Constant(4, 4, 200));
        using var backend = scene.CreateBackend();

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 4, 4), UiColor.White, opacity: 0.5f),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        surface.Pixel(2, 2).A.Should().BeInRange((byte)99, (byte)101, "200 coverage at 0.5 opacity is 100");
    }

    [RealGpuFact]
    public void Rgba8Atlas_UploadsPremultipliedChannelsAndRendersWithPremultipliedBlend()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 8, 8);
        const byte red = 64;
        const byte green = 32;
        const byte blue = 16;
        const byte alpha = 128;
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.Rgba8,
            UiGlyphFormat.Rgba32,
            8,
            8,
            GlyphFields.ConstantRgba(8, 8, red, green, blue, alpha));
        using var backend = scene.CreateBackend();

        PixelSurface page = TextureReadback.Read(device.Context, scene.PageTexture, TextureFormat.Rgba8, 8, 8);
        page.Channels.Should().Be(4);
        page.Pixel(4, 4).Should().Be(new Pixel(red, green, blue, alpha));

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 8, 8), UiColor.White),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface overTransparent = probe.Read();
        AssertPixel(overTransparent, 4, 4, red, green, blue, alpha, 1, "premultiplied over transparent");

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 8, 8), UiColor.White),
            new UiColor(0f, 0f, 1f, 1f));

        PixelSurface overBlue = probe.Read();
        // src.rgb (premultiplied) + dst.rgb * (1 - a): 64, 32, 16 + 255 * (1 - 128/255) = 64, 32, 143.
        AssertPixel(overBlue, 4, 4, red, green, 143, 255, 2, "premultiplied over opaque blue");

        backend.ColorGlyphBatches.Should().Be(2);
        backend.CoverageGlyphBatches.Should().Be(0);
        backend.SdfGlyphBatches.Should().Be(0);
    }

    [RealGpuFact]
    public void MsdfPage_UploadsThreeChannelsAndUsesTheRedChannelAsCoverage()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 8, 8);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.Rgb8,
            UiGlyphFormat.Msdf,
            8,
            8,
            GlyphFields.ConstantRgb(8, 8, 200, 20, 30));
        using var backend = scene.CreateBackend();

        PixelSurface page = TextureReadback.Read(device.Context, scene.PageTexture, TextureFormat.Rgb8, 8, 8);
        page.Channels.Should().Be(3);
        page.Channel(4, 4, 0).Should().Be(200);
        page.Channel(4, 4, 1).Should().Be(20);
        page.Channel(4, 4, 2).Should().Be(30);

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(0, 0, 8, 8), new UiColor(0f, 1f, 0f, 1f)),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        // Only the red channel feeds the SDF threshold; green/blue in the page must not bleed.
        AssertPixel(surface, 4, 4, 0, 255, 0, 255, 1, "green fill from the MSDF red channel");
        backend.SdfGlyphBatches.Should().Be(1);
    }

    [RealGpuFact]
    public void GlyphBatch_ProducesPixelEvidenceInsideTheGlyphQuad()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 48, 48);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            32,
            32,
            GlyphFields.SdfCircle(32, 32, radius: 12f, spreadPixels: 4f));
        using var backend = scene.CreateBackend();

        Draw(
            backend,
            probe,
            GlyphSceneFactory.TextKey(),
            GlyphSceneFactory.TextCommand(new Rect(4, 4, 32, 32), UiColor.White),
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        int lit = 0;
        for (int y = 4; y < 36; y++)
        {
            for (int x = 4; x < 36; x++)
            {
                if (surface.Pixel(x, y).A != 0)
                {
                    lit++;
                }
            }
        }

        lit.Should().BeGreaterThan(300, "the glyph batch must actually rasterize visible pixels");
        AssertChannel(surface, 20, 20, 255, 3, "glyph centre");
        surface.Pixel(40, 20).Should().Be(new Pixel(0, 0, 0, 0), "outside the glyph quad must stay cleared");
        backend.Instances.Should().Be(1);
    }

    [RealGpuFact]
    public void BlendModes_ComposeKnownColors()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 32, 32);
        using var backend = new UiOpenGlBackend(device.Context);
        UiRenderCommand quad = UiRenderCommand.Quad(
            new UiNodeId(1),
            new Rect(8, 8, 16, 16),
            new UiColor(1f, 0.5f, 0f, 0.5f),
            0);
        var blue = new UiColor(0f, 0f, 1f, 1f);

        Draw(backend, probe, GlyphSceneFactory.QuadKey(UiBlendMode.Alpha), quad, blue);
        AssertPixel(probe.Read(), 16, 16, 128, 64, 128, 255, Tolerance, "alpha blend");

        Draw(backend, probe, GlyphSceneFactory.QuadKey(UiBlendMode.Additive), quad, blue);
        AssertPixel(probe.Read(), 16, 16, 128, 64, 255, 255, Tolerance, "additive blend");

        Draw(backend, probe, GlyphSceneFactory.QuadKey(UiBlendMode.Opaque), quad, blue);
        AssertPixel(probe.Read(), 16, 16, 255, 128, 0, 128, Tolerance, "opaque blend");

        Draw(backend, probe, GlyphSceneFactory.QuadKey(UiBlendMode.Multiply), quad, blue);
        AssertPixel(probe.Read(), 16, 16, 0, 0, 0, 255, Tolerance, "multiply blend");
    }

    [RealGpuFact]
    public void Clip_ScissorsTheDrawToTheUiRect()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 32, 32);
        using var backend = new UiOpenGlBackend(device.Context);
        UiRenderCommand quad = UiRenderCommand.Quad(
            new UiNodeId(1),
            new Rect(0, 0, 32, 32),
            UiColor.White,
            0);
        var clip = new Rect(8, 8, 8, 8);

        Draw(
            backend,
            probe,
            GlyphSceneFactory.QuadKey(hasClip: true, clip: clip),
            quad,
            new UiColor(0f, 0f, 0f, 0f));

        PixelSurface surface = probe.Read();

        AssertPixel(surface, 12, 12, 255, 255, 255, 255, Tolerance, "inside the clip");
        surface.Pixel(4, 12).Should().Be(new Pixel(0, 0, 0, 0), "left of the clip");
        surface.Pixel(20, 12).Should().Be(new Pixel(0, 0, 0, 0), "right of the clip");
        surface.Pixel(12, 4).Should().Be(new Pixel(0, 0, 0, 0), "above the clip (UI top-left origin)");
        surface.Pixel(12, 20).Should().Be(new Pixel(0, 0, 0, 0), "below the clip (UI top-left origin)");
    }

    [RealGpuFact]
    public void Rendering_IsByteIdenticalAcrossRuns()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 48, 48);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            32,
            32,
            GlyphFields.SdfCircle(32, 32, radius: 10f, spreadPixels: 4f));
        using var backend = scene.CreateBackend();
        UiRenderCommand command = GlyphSceneFactory.TextCommand(new Rect(8, 8, 32, 32), UiColor.White);

        Draw(backend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
        byte[] first = probe.Read().Data;

        Draw(backend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
        byte[] second = probe.Read().Data;

        second.Should().Equal(first, "identical frames on the same device must produce identical bytes");
    }

    [RealGpuFact]
    public void ContextRestore_RebuildsResourcesAndRendersIdenticalPixels()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 48, 48);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            32,
            32,
            GlyphFields.SdfCircle(32, 32, radius: 10f, spreadPixels: 4f));
        using var backend = scene.CreateBackend();
        UiRenderCommand command = GlyphSceneFactory.TextCommand(new Rect(8, 8, 32, 32), UiColor.White);

        Draw(backend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
        byte[] beforeLoss = probe.Read().Data;

        device.Context.NotifyContextLost();
        backend.IsReady.Should().BeFalse();

        Action drawWhileLost = () =>
        {
            backend.BeginFrame(new UiViewport(probe.Width, probe.Height, 1, 0, 0));
            backend.EndFrame();
        };
        drawWhileLost.Should().Throw<InvalidOperationException>();

        device.Context.NotifyContextRestored();
        backend.IsReady.Should().BeTrue();

        Draw(backend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
        byte[] afterRestore = probe.Read().Data;

        afterRestore.Should().Equal(beforeLoss, "restoring the context must rebuild programs without changing pixels");
    }

    [RealGpuFact]
    public void DisposedBackend_LeavesTheContextUsableForANewBackend()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 48, 48);
        using var scene = new GlyphTestScene(
            device.Context,
            TextureFormat.R8,
            UiGlyphFormat.Sdf,
            32,
            32,
            GlyphFields.SdfCircle(32, 32, radius: 10f, spreadPixels: 4f));
        UiRenderCommand command = GlyphSceneFactory.TextCommand(new Rect(8, 8, 32, 32), UiColor.White);

        byte[] first;
        using (var firstBackend = scene.CreateBackend())
        {
            Draw(firstBackend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
            first = probe.Read().Data;
            firstBackend.Dispose();
            firstBackend.IsDisposed.Should().BeTrue();
        }

        using var secondBackend = scene.CreateBackend();
        Draw(secondBackend, probe, GlyphSceneFactory.TextKey(), command, new UiColor(0f, 0f, 0f, 0f));
        byte[] second = probe.Read().Data;

        second.Should().Equal(first);
    }

    private static void Draw(
        UiOpenGlBackend backend,
        PixelProbe probe,
        in UiBatchKey key,
        in UiRenderCommand command,
        in UiColor clear)
    {
        probe.Begin(in clear);
        backend.BeginFrame(new UiViewport(probe.Width, probe.Height, 1, 0, 0));
        backend.DrawBatch(in key, [command]);
        backend.EndFrame();
    }

    private static void AssertPixel(
        PixelSurface surface,
        int x,
        int y,
        int r,
        int g,
        int b,
        int a,
        int tolerance,
        string because)
    {
        Pixel pixel = surface.Pixel(x, y);
        pixel.R.Should().BeInRange((byte)Math.Max(0, r - tolerance), (byte)Math.Min(255, r + tolerance), $"{because}: red at {surface.Describe(x, y)}");
        pixel.G.Should().BeInRange((byte)Math.Max(0, g - tolerance), (byte)Math.Min(255, g + tolerance), $"{because}: green at {surface.Describe(x, y)}");
        pixel.B.Should().BeInRange((byte)Math.Max(0, b - tolerance), (byte)Math.Min(255, b + tolerance), $"{because}: blue at {surface.Describe(x, y)}");
        pixel.A.Should().BeInRange((byte)Math.Max(0, a - tolerance), (byte)Math.Min(255, a + tolerance), $"{because}: alpha at {surface.Describe(x, y)}");
    }

    private static void AssertChannel(PixelSurface surface, int x, int y, int expected, int tolerance, string because)
    {
        byte alpha = surface.Pixel(x, y).A;
        alpha.Should().BeInRange((byte)Math.Max(0, expected - tolerance), (byte)Math.Min(255, expected + tolerance), $"{because}: {surface.Describe(x, y)}");
    }
}
