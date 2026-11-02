namespace Axrone.Ui.Testing.OpenGL;

using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Native;
using Axrone.Render.OpenGL.Resources;
using Axrone.Render.OpenGL.Texture;
using Axrone.Ui;

internal sealed class PixelProbe : IDisposable
{
    private readonly GLTexture _color;
    private readonly GLFramebuffer _framebuffer;
    private int _disposed;

    public PixelProbe(GLContext context, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(context);
        Context = context;
        Width = width;
        Height = height;
        _color = new GLTexture(context, GLConst.Texture2D, TextureFormat.Rgba8, width, height, label: "UiPixelProbe");
        _framebuffer = new GLFramebuffer(context, width, height, "UiPixelProbeFbo");
        // Deleted names can be recycled by the driver while stale cache entries survive; force a
        // real bind before attaching.
        context.State.Invalidate();
        _framebuffer.AttachColor(_color);
        _framebuffer.EnsureComplete();
    }

    public GLContext Context { get; }

    public int Width { get; }

    public int Height { get; }

    public GLTexture Texture => _color;

    public void Begin(in UiColor clearColor)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        _framebuffer.Bind();
        Context.State.SetViewport(0, 0, Width, Height);
        Context.State.SetClearColor(clearColor.R, clearColor.G, clearColor.B, clearColor.A);
        _framebuffer.Clear(color: true, depth: false);
    }

    public PixelSurface Read()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        byte[] pixels = new byte[Width * Height * 4];
        _framebuffer.ReadPixels(pixels);
        return PixelSurface.FromRaw(Width, Height, pixels, 4);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _framebuffer.Dispose();
        _color.Dispose();
    }
}

internal sealed class PixelSurface
{
    private PixelSurface(int width, int height, int channels, byte[] data)
    {
        Width = width;
        Height = height;
        Channels = channels;
        Data = data;
    }

    public int Width { get; }

    public int Height { get; }

    public int Channels { get; }

    public byte[] Data { get; }

    /// <summary>Reorients a bottom-up GL readback into top-down UI coordinates.</summary>
    public static PixelSurface FromRaw(int width, int height, byte[] bottomUp, int channels)
    {
        var topDown = new byte[bottomUp.Length];
        int stride = width * channels;
        for (int y = 0; y < height; y++)
        {
            Buffer.BlockCopy(bottomUp, (height - 1 - y) * stride, topDown, y * stride, stride);
        }

        return new PixelSurface(width, height, channels, topDown);
    }

    public byte Channel(int x, int y, int channel)
    {
        int index = (y * Width + x) * Channels + channel;
        return Data[index];
    }

    public Pixel Pixel(int x, int y)
    {
        if (Channels != 4)
        {
            throw new InvalidOperationException($"Pixel access requires an RGBA surface; this surface has {Channels} channels.");
        }

        int index = (y * Width + x) * 4;
        return new Pixel(Data[index], Data[index + 1], Data[index + 2], Data[index + 3]);
    }

    public string Describe(int x, int y) =>
        Channels == 4
            ? $"[{x},{y}] = {Pixel(x, y)}"
            : $"[{x},{y}] = channels({string.Join(',', Enumerable.Range(0, Channels).Select(c => Channel(x, y, c)))})";
}

internal readonly record struct Pixel(byte R, byte G, byte B, byte A)
{
    public override string ToString() => $"rgba({R}, {G}, {B}, {A})";
}

internal static class TextureReadback
{
    public static PixelSurface Read(GLContext context, GLTexture texture, TextureFormat format, int width, int height)
    {
        using var framebuffer = new GLFramebuffer(context, width, height, "UiTextureReadback");
        context.State.Invalidate();
        framebuffer.AttachColor(texture);
        framebuffer.EnsureComplete();
        int bytesPerPixel = TextureFormats.Get(format).BytesPerPixel;
        byte[] pixels = new byte[width * height * bytesPerPixel];
        context.State.SetPackAlignment(1);
        framebuffer.ReadPixels(pixels);
        return PixelSurface.FromRaw(width, height, pixels, bytesPerPixel);
    }

    public static GLTexture CreateTexture(
        GLContext context,
        TextureFormat format,
        int width,
        int height,
        ReadOnlySpan<byte> pixels)
    {
        var texture = new GLTexture(context, GLConst.Texture2D, format, width, height, label: "UiTestPage");
        texture.SetParameter(GLConst.TextureMinFilter, GLConst.Nearest);
        texture.SetParameter(GLConst.TextureMagFilter, GLConst.Nearest);
        texture.SetParameter(GLConst.TextureWrapS, GLConst.ClampToEdge);
        texture.SetParameter(GLConst.TextureWrapT, GLConst.ClampToEdge);
        if (!pixels.IsEmpty)
        {
            texture.UploadSubData2D(pixels, 0, 0, width, height);
        }

        return texture;
    }
}
