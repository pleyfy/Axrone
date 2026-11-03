namespace Axrone.Ui.Scene.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Texture;
using Axrone.Ui;
using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;
using Axrone.Ui.Testing.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class RealGpuScenePixelTests
{
    private const int Tolerance = 2;
    private static readonly UiTextLayoutId LayoutId = new(1);
    private static readonly UiFontFaceId Face = new(1);
    private static readonly UiGlyphAtlasPageId Page = GlyphSceneFactory.Page;
    private const int CodePoint = 65;

    [RealGpuFact]
    public void OffscreenSurface_RendersIntoItsOwnColorAttachment()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var backend = new UiOpenGlBackend(device.Context);
        using var surface = new UiHostOffscreenSurface(device.Context, 32, 32);

        surface.Bind();
        backend.BeginFrame(new UiViewport(32, 32, 1, 0, 0));
        backend.DrawBatch(GlyphSceneFactory.QuadKey(), [WhiteQuad(8, 8, 16, 16)]);
        backend.EndFrame();
        surface.Unbind();

        PixelSurface pixels = TextureReadback.Read(device.Context, surface.Texture, TextureFormat.Rgba8, 32, 32);

        AssertPixel(pixels, 16, 16, 255, 255, 255, 255, Tolerance, "surface centre");
        pixels.Pixel(1, 1).Should().Be(new Pixel(0, 0, 0, 0), "the surface is cleared transparent");
        backend.DrawCalls.Should().Be(1);
    }

    [RealGpuFact]
    public void OffscreenSurface_ResizeReallocatesAndRendersAtTheNewSize()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var backend = new UiOpenGlBackend(device.Context);
        using var surface = new UiHostOffscreenSurface(device.Context, 16, 16);

        surface.Resize(48, 40);
        surface.Width.Should().Be(48);
        surface.Height.Should().Be(40);

        surface.Bind();
        backend.BeginFrame(new UiViewport(48, 40, 1, 0, 0));
        backend.DrawBatch(GlyphSceneFactory.QuadKey(), [WhiteQuad(16, 12, 16, 16)]);
        backend.EndFrame();
        surface.Unbind();

        PixelSurface pixels = TextureReadback.Read(device.Context, surface.Texture, TextureFormat.Rgba8, 48, 40);

        AssertPixel(pixels, 24, 20, 255, 255, 255, 255, Tolerance, "resized surface centre");
        pixels.Pixel(1, 1).Should().Be(new Pixel(0, 0, 0, 0));
    }

    [RealGpuFact]
    public void OffscreenSurface_DisposeRejectsFurtherUse()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        var surface = new UiHostOffscreenSurface(device.Context, 8, 8);

        surface.Dispose();

        Action bind = () => surface.Bind();
        bind.Should().Throw<ObjectDisposedException>();
        Action texture = () => _ = surface.Texture;
        texture.Should().Throw<ObjectDisposedException>();
        surface.Dispose();
    }

    [RealGpuFact]
    public void Uploader_R8PageFeedsTheCoveragePath()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 8, 8);
        using var uploader = new UiHostGlyphAtlasUploader(device.Context);
        UiResourceId resource = uploader.CreatePage(Page, 8, 8, UiGlyphFormat.Alpha8);
        uploader.UploadGlyph(Page, new Rect(0, 0, 8, 8), GlyphFields.Constant(8, 8, 200));

        using var backend = CreateBackend(device.Context, uploader, resource, new Rect(0, 0, 1, 1), 8, 8, UiGlyphFormat.Alpha8);
        DrawText(backend, probe, new Rect(0, 0, 8, 8), UiColor.White);

        PixelSurface pixels = probe.Read();
        AssertChannel(pixels, 4, 4, 200, 1, "R8 coverage through the uploader");
        backend.CoverageGlyphBatches.Should().Be(1);
    }

    [RealGpuFact]
    public void Uploader_Rgba8PageUploadsFullPremultipliedStride()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 4, 4);
        using var uploader = new UiHostGlyphAtlasUploader(device.Context);
        UiResourceId resource = uploader.CreatePage(Page, 8, 8, UiGlyphFormat.Rgba32);
        uploader.UploadGlyph(Page, new Rect(0, 0, 4, 4), GlyphFields.ConstantRgba(4, 4, 64, 32, 16, 128));

        using var backend = CreateBackend(device.Context, uploader, resource, new Rect(0, 0, 0.5f, 0.5f), 4, 4, UiGlyphFormat.Rgba32);
        DrawText(backend, probe, new Rect(0, 0, 4, 4), UiColor.White);

        PixelSurface pixels = probe.Read();
        AssertPixel(pixels, 2, 2, 64, 32, 16, 128, 1, "premultiplied RGBA upload");
        backend.ColorGlyphBatches.Should().Be(1);
    }

    [RealGpuFact]
    public void Uploader_Rgb8PageUploadsThreeChannelsForMsdf()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var probe = new PixelProbe(device.Context, 8, 8);
        using var uploader = new UiHostGlyphAtlasUploader(device.Context);
        UiResourceId resource = uploader.CreatePage(Page, 8, 8, UiGlyphFormat.Msdf);
        uploader.UploadGlyph(Page, new Rect(0, 0, 8, 8), GlyphFields.ConstantRgb(8, 8, 200, 20, 30));

        using var backend = CreateBackend(device.Context, uploader, resource, new Rect(0, 0, 1, 1), 8, 8, UiGlyphFormat.Msdf);
        DrawText(backend, probe, new Rect(0, 0, 8, 8), new UiColor(0f, 1f, 0f, 1f));

        PixelSurface pixels = probe.Read();
        AssertPixel(pixels, 4, 4, 0, 255, 0, 255, 1, "MSDF red channel coverage");
        backend.SdfGlyphBatches.Should().Be(1);
    }

    [RealGpuFact]
    public void Uploader_RejectsShortAndOutOfBoundsPayloads()
    {
        using GlHarnessDevice device = GlHarnessDevice.Require();
        using var uploader = new UiHostGlyphAtlasUploader(device.Context);
        _ = uploader.CreatePage(Page, 8, 8, UiGlyphFormat.Rgba32);

        Action shortPayload = () => uploader.UploadGlyph(Page, new Rect(0, 0, 2, 2), new byte[4]);
        shortPayload.Should().Throw<ArgumentException>();

        Action outOfBounds = () => uploader.UploadGlyph(Page, new Rect(4, 4, 8, 8), new byte[8 * 8 * 4]);
        outOfBounds.Should().Throw<ArgumentOutOfRangeException>();

        Action unknownPage = () => uploader.UploadGlyph(new UiGlyphAtlasPageId(99), new Rect(0, 0, 1, 1), new byte[4]);
        unknownPage.Should().NotThrow("an evicted page is a no-op, not an error");
    }

    private static UiOpenGlBackend CreateBackend(
        GLContext context,
        IUiTextureSource textures,
        UiResourceId resource,
        in Rect uvRect,
        float width,
        float height,
        UiGlyphFormat format) =>
        new(context, new UiOpenGlBackendOptions
        {
            GlyphAtlas = GlyphSceneFactory.CreateAtlas(
                Face,
                CodePoint,
                Page,
                resource,
                in uvRect,
                width,
                height,
                format),
            TextLayouts = GlyphSceneFactory.CreateLayouts(
                LayoutId,
                Face,
                new UiShapedGlyph(CodePoint, 0, 0, 0, width, 0)),
            Textures = textures,
        });

    private static void DrawText(UiOpenGlBackend backend, PixelProbe probe, in Rect bounds, in UiColor color)
    {
        probe.Begin(new UiColor(0f, 0f, 0f, 0f));
        backend.BeginFrame(new UiViewport(probe.Width, probe.Height, 1, 0, 0));
        backend.DrawBatch(
            GlyphSceneFactory.TextKey(),
            [UiRenderCommand.Text(new UiNodeId(1), in bounds, LayoutId, in color, 0)]);
        backend.EndFrame();
    }

    private static UiRenderCommand WhiteQuad(float x, float y, float width, float height) =>
        UiRenderCommand.Quad(new UiNodeId(1), new Rect(x, y, width, height), UiColor.White, 0);

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
