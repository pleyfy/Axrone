namespace Axrone.Ui.Scene.OpenGL;

using Axrone.Scene.Rendering;
using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;

/// <summary>
/// OpenGL execution layer for scene UI hosts: renders world-space hosts into
/// per-host offscreen surfaces and draws them as depth-tested billboards, then
/// flushes screen overlays into the active framebuffer.
/// </summary>
/// <remarks>Render-thread affine. Surfaces and glyph pages are created lazily.</remarks>
public sealed class SceneUiHostGlRenderer : ISceneUiHostRenderer, IDisposable
{
    private readonly GLContext _context;
    private readonly SceneUiHostBridge _hosts;
    private readonly UiHostGlyphAtlasUploader _atlasUploader;
    private readonly bool _ownsAtlasUploader;
    private readonly UiOpenGlBackend _backend;
    private readonly UiFrameRenderHost _renderHost;
    private readonly UiHostWorldQuadRenderer _quad;
    private readonly Dictionary<SceneActor, UiHostOffscreenSurface> _surfaces = new();
    private readonly List<SceneUiHostInstance> _worldScratch = new();
    private readonly List<SceneUiHostInstance> _screenScratch = new();
    private readonly List<SceneActor> _staleScratch = new();
    private readonly HashSet<SceneActor> _seen = new();
    private int _disposed;

    /// <summary>Creates a renderer over a GL context and host bridge.</summary>
    /// <remarks>
    /// The renderer reuses the bridge's GL uploader when the text atlas was
    /// built with one; otherwise it creates and owns a private uploader.
    /// </remarks>
    public SceneUiHostGlRenderer(GLContext context, SceneUiHostBridge hosts)
        : this(context, hosts, null, uploaderIsExplicit: false)
    {
    }

    /// <summary>Creates a renderer over an externally owned glyph atlas uploader.</summary>
    public SceneUiHostGlRenderer(GLContext context, SceneUiHostBridge hosts, UiHostGlyphAtlasUploader atlasUploader)
        : this(context, hosts, atlasUploader, uploaderIsExplicit: true)
    {
    }

    private SceneUiHostGlRenderer(
        GLContext context,
        SceneUiHostBridge hosts,
        UiHostGlyphAtlasUploader? atlasUploader,
        bool uploaderIsExplicit)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(hosts);

        if (uploaderIsExplicit && atlasUploader is null)
        {
            throw new ArgumentNullException(nameof(atlasUploader));
        }

        _context = context;
        _hosts = hosts;

        if (atlasUploader is not null)
        {
            _atlasUploader = atlasUploader;
            _ownsAtlasUploader = false;
        }
        else if (hosts.Text.GlyphUploader is UiHostGlyphAtlasUploader sharedUploader)
        {
            _atlasUploader = sharedUploader;
            _ownsAtlasUploader = false;
        }
        else
        {
            _atlasUploader = new UiHostGlyphAtlasUploader(context);
            _ownsAtlasUploader = true;
        }

        _backend = new UiOpenGlBackend(context, new UiOpenGlBackendOptions
        {
            Textures = _atlasUploader,
            GlyphAtlas = hosts.Text.GlyphAtlas,
            TextLayouts = new UiHostTextLayoutSource(hosts),
        });
        _renderHost = new UiFrameRenderHost(_backend);
        _quad = new UiHostWorldQuadRenderer(context);
    }

    /// <summary>Gets the number of completed render calls.</summary>
    public int FrameCount { get; private set; }

    /// <summary>Gets the number of world hosts drawn in the last frame.</summary>
    public int LastWorldHosts { get; private set; }

    /// <summary>Gets the number of screen hosts drawn in the last frame.</summary>
    public int LastScreenHosts { get; private set; }

    /// <summary>Gets the number of cached world-space surfaces.</summary>
    public int SurfaceCount => _surfaces.Count;

    /// <summary>Gets the backend's missing-glyph count.</summary>
    public long MissedGlyphs => _backend.MissedGlyphs;

    /// <summary>Gets the backend's missing-texture count.</summary>
    public long MissingTextures => _backend.MissingTextures;

    /// <summary>Gets the backend's completed draw-call count.</summary>
    public long DrawCalls => _backend.DrawCalls;

    /// <summary>Gets the pixel size of one cached world-space surface.</summary>
    public bool TryGetSurfaceSize(SceneActor actor, out int width, out int height)
    {
        if (_surfaces.TryGetValue(actor, out UiHostOffscreenSurface? surface))
        {
            width = surface.Width;
            height = surface.Height;
            return true;
        }

        width = 0;
        height = 0;
        return false;
    }

    /// <inheritdoc/>
    public void Render(SceneWorld world, SceneCameraFrame? camera, in UiViewport viewport, SceneUiHostBridge hosts)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(hosts);
        _context.AssertRenderThread();

        _worldScratch.Clear();
        _screenScratch.Clear();
        _seen.Clear();

        for (int i = 0; i < hosts.HostCount; i++)
        {
            if (!hosts.TryGetHostAt(i, out SceneUiHostInstance? host) || !host.IsRenderable)
            {
                continue;
            }

            _seen.Add(host.Actor);
            if (host.Component.IsWorldSpace)
            {
                _worldScratch.Add(host);
            }
            else
            {
                _screenScratch.Add(host);
            }
        }

        SortByOrder(_worldScratch);
        SortByOrder(_screenScratch);

        LastWorldHosts = 0;
        LastScreenHosts = 0;

        if (camera is not null)
        {
            for (int i = 0; i < _worldScratch.Count; i++)
            {
                RenderWorldHost(world, camera, in viewport, _worldScratch[i]);
            }
        }

        _context.State.SetViewport(0, 0, (int)viewport.Width, (int)viewport.Height);
        for (int i = 0; i < _screenScratch.Count; i++)
        {
            SceneUiHostInstance host = _screenScratch[i];
            UiFrame frame = host.BuildFrame(in viewport);
            _renderHost.Submit(frame);
            _renderHost.Flush();
            LastScreenHosts++;
        }

        PruneSurfaces();
        FrameCount++;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        foreach (UiHostOffscreenSurface surface in _surfaces.Values)
        {
            surface.Dispose();
        }

        _surfaces.Clear();
        _quad.Dispose();
        _renderHost.Dispose();
        _backend.Dispose();
        if (_ownsAtlasUploader)
        {
            _atlasUploader.Dispose();
        }
    }

    private void RenderWorldHost(SceneWorld world, SceneCameraFrame camera, in UiViewport screenViewport, SceneUiHostInstance host)
    {
        UiViewport surfaceViewport = host.SurfaceViewport;
        UiHostOffscreenSurface surface = GetSurface(host.Actor, (int)surfaceViewport.Width, (int)surfaceViewport.Height);
        surface.Bind();
        UiFrame frame = host.BuildFrame(in surfaceViewport);
        _renderHost.Submit(frame);
        _renderHost.Flush();
        surface.Unbind();

        _context.State.SetViewport(0, 0, (int)screenViewport.Width, (int)screenViewport.Height);
        Vec3 cameraPosition = camera.Position;
        SceneUiHost component = host.Component;
        Mat4 viewProjection = camera.ViewProjectionMatrix;
        if (SceneUiHostMath.TryBuildWorldModel(world, host.Actor, in component, in cameraPosition, out Mat4 model))
        {
            _quad.Draw(surface.Texture, in model, in viewProjection, depthTest: true);
            LastWorldHosts++;
        }
    }

    private UiHostOffscreenSurface GetSurface(SceneActor actor, int width, int height)
    {
        if (!_surfaces.TryGetValue(actor, out UiHostOffscreenSurface? surface))
        {
            surface = new UiHostOffscreenSurface(_context, width, height);
            _surfaces.Add(actor, surface);
            return surface;
        }

        surface.Resize(width, height);
        return surface;
    }

    private void PruneSurfaces()
    {
        _staleScratch.Clear();
        foreach (KeyValuePair<SceneActor, UiHostOffscreenSurface> entry in _surfaces)
        {
            if (!_seen.Contains(entry.Key))
            {
                _staleScratch.Add(entry.Key);
            }
        }

        for (int i = 0; i < _staleScratch.Count; i++)
        {
            SceneActor actor = _staleScratch[i];
            _surfaces[actor].Dispose();
            _surfaces.Remove(actor);
        }
    }

    private static void SortByOrder(List<SceneUiHostInstance> hosts) =>
        hosts.Sort(static (left, right) =>
        {
            int order = left.Component.SortingOrder.CompareTo(right.Component.SortingOrder);
            return order != 0 ? order : left.Order.CompareTo(right.Order);
        });
}
