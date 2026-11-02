namespace Axrone.Ui.Scene;

using Axrone.Input;
using Axrone.Scene.Rendering;

/// <summary>Bridge construction settings.</summary>
public sealed record SceneUiHostBridgeOptions
{
    /// <summary>Asset payload resolver; hosts are skipped when null.</summary>
    public IUiHostAssetSource? Assets { get; init; }

    /// <summary>Shared runtime options (fonts, theme, events, atlas uploader).</summary>
    public UiHostRuntimeOptions Runtime { get; init; } = new();

    /// <summary>Maximum number of simultaneous hosts.</summary>
    public int MaxHosts { get; init; } = 64;
}

/// <summary>One live host: actor, component copy and compiled runtime.</summary>
public sealed class SceneUiHostInstance
{
    internal SceneUiHostInstance(int order, SceneActor actor, in SceneUiHost component, UiHostRuntime runtime)
    {
        Order = order;
        Actor = actor;
        Component = component;
        Runtime = runtime;
    }

    /// <summary>Gets the owning actor.</summary>
    public SceneActor Actor { get; }

    /// <summary>Gets the current component copy.</summary>
    public SceneUiHost Component { get; internal set; }

    /// <summary>Gets the compiled document runtime.</summary>
    public UiHostRuntime Runtime { get; }

    /// <summary>Gets the stable bind order.</summary>
    public int Order { get; }

    /// <summary>Gets whether the host is renderable now.</summary>
    public bool IsRenderable => Component.Enabled && Component.Visible && Component.AssetId.IsValid;

    /// <summary>Gets the world-space offscreen viewport.</summary>
    public UiViewport SurfaceViewport
    {
        get
        {
            int width = SceneUiHostLimits.SurfaceWidth(Component.WorldWidth, Component.TextureScale);
            int height = SceneUiHostLimits.SurfaceHeight(Component.WorldHeight, Component.TextureScale);
            return new UiViewport(new UiSize(width, height));
        }
    }

    /// <summary>Runs layout and compiles the next frame for a viewport.</summary>
    public UiFrame BuildFrame(in UiViewport viewport) => Runtime.BuildFrame(in viewport);
}

/// <summary>
/// Owns UI host bindings for a scene world: resolves and decodes assets, builds
/// control runtimes, routes input and exposes hosts to a renderer.
/// </summary>
/// <remarks>
/// Explicit registration only: Scene.Runtime never references this package.
/// Steady-state sync/layout/input/frame building allocates nothing once the
/// host set and glyph atlas have warmed up.
/// </remarks>
public sealed class SceneUiHostBridge : IDisposable
{
    private readonly SceneWorld _world;
    private readonly SceneUiHostBridgeOptions _options;
    private readonly List<SceneUiHostInstance> _hosts = new();
    private readonly Dictionary<SceneActor, SceneUiHostInstance> _byActor = new();
    private readonly List<SceneUiHostInstance> _scratch = new();
    private readonly UiInputAdapter _adapter = new();
    private SceneUiHostInstance? _activeHost;
    private int _order;
    private int _disposed;

    /// <summary>Creates a bridge for a scene world.</summary>
    public SceneUiHostBridge(SceneWorld world, SceneUiHostBridgeOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
        _options = options ?? new SceneUiHostBridgeOptions();
        Text = new UiHostTextSystem(_options.Runtime);
    }

    /// <summary>Gets the shared text pipeline.</summary>
    public UiHostTextSystem Text { get; }

    /// <summary>Gets the number of live hosts.</summary>
    public int HostCount => _hosts.Count;

    /// <summary>Gets a monotonic revision incremented on bind/unbind/rebind.</summary>
    public int Revision { get; private set; }

    /// <summary>Synchronizes hosts with the world's components.</summary>
    public void Sync()
    {
        ThrowIfDisposed();

        for (int i = _hosts.Count - 1; i >= 0; i--)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!_world.TryGetData(host.Actor, out SceneUiHost component) || !component.Enabled)
            {
                RemoveAt(i);
                continue;
            }

            if (!component.AssetId.IsValid)
            {
                RemoveAt(i);
                continue;
            }

            if (component.AssetId != host.Component.AssetId ||
                component.RenderMode != host.Component.RenderMode)
            {
                if (!TryRebind(host, in component))
                {
                    RemoveAt(i);
                    continue;
                }
            }

            host.Component = component;
        }

        foreach (SceneActor actor in _world.Actors)
        {
            if (_hosts.Count >= _options.MaxHosts ||
                _byActor.ContainsKey(actor) ||
                !_world.TryGetData(actor, out SceneUiHost component) ||
                !component.Enabled ||
                !component.AssetId.IsValid)
            {
                continue;
            }

            TryAddHost(actor, in component);
        }
    }

    /// <summary>Updates screen-overlay layouts for the viewport and synchronizes hosts.</summary>
    public int Update(in UiViewport viewport)
    {
        ThrowIfDisposed();
        Sync();

        int passes = 0;
        for (int i = 0; i < _hosts.Count; i++)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!host.Component.IsWorldSpace)
            {
                passes += host.Runtime.UpdateLayout(in viewport);
            }
        }

        return passes;
    }

    /// <summary>Gets a host by bind index.</summary>
    public bool TryGetHostAt(int index, [NotNullWhen(true)] out SceneUiHostInstance? host)
    {
        if ((uint)index < (uint)_hosts.Count)
        {
            host = _hosts[index];
            return true;
        }

        host = null;
        return false;
    }

    /// <summary>Gets the host of an actor.</summary>
    public bool TryGetHost(SceneActor actor, [NotNullWhen(true)] out SceneUiHostInstance? host) =>
        _byActor.TryGetValue(actor, out host);

    /// <summary>
    /// Rebuilds one host's runtime from its asset. Returns false when the asset
    /// cannot be resolved or decoded.
    /// </summary>
    public bool Reload(SceneActor actor)
    {
        ThrowIfDisposed();
        if (!_byActor.TryGetValue(actor, out SceneUiHostInstance? host) ||
            !_world.TryGetData(actor, out SceneUiHost component))
        {
            return false;
        }

        return TryRebind(host, in component);
    }

    /// <summary>Rebuilds every host runtime.</summary>
    public void ReloadAll()
    {
        ThrowIfDisposed();
        for (int i = _hosts.Count - 1; i >= 0; i--)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!_world.TryGetData(host.Actor, out SceneUiHost component) || !TryRebind(host, in component))
            {
                RemoveAt(i);
            }
        }
    }

    /// <summary>
    /// Routes a pointer event expressed in screen pixels. Screen hosts are
    /// tried front-to-back; world hosts are hit-tested against the quad.
    /// </summary>
    public bool ProcessPointer(in UiPointerEvent args, in UiViewport viewport, SceneCameraFrame? camera = null)
    {
        ThrowIfDisposed();

        _scratch.Clear();
        for (int i = 0; i < _hosts.Count; i++)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!host.Component.IsWorldSpace && host.Component.ReceiveInput && host.IsRenderable)
            {
                _scratch.Add(host);
            }
        }

        _scratch.Sort(static (left, right) =>
        {
            int order = right.Component.SortingOrder.CompareTo(left.Component.SortingOrder);
            return order != 0 ? order : right.Order.CompareTo(left.Order);
        });

        for (int i = 0; i < _scratch.Count; i++)
        {
            SceneUiHostInstance host = _scratch[i];
            if (host.Runtime.DispatchPointer(in args))
            {
                _activeHost = host;
                return true;
            }
        }

        if (camera is null)
        {
            return false;
        }

        SceneUiHostInstance? hitHost = null;
        UiPointerEvent localEvent = default;
        float nearest = float.PositiveInfinity;

        for (int i = 0; i < _hosts.Count; i++)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!host.Component.IsWorldSpace || !host.Component.ReceiveInput || !host.IsRenderable)
            {
                continue;
            }

            SceneUiHost component = host.Component;
            if (!TryMapWorldPointer(
                    _world,
                    host.Actor,
                    in component,
                    in viewport,
                    camera,
                    args.Position,
                    out Vec2 local,
                    out float distance) ||
                distance >= nearest)
            {
                continue;
            }

            nearest = distance;
            hitHost = host;
            localEvent = new UiPointerEvent(
                UiNodeId.Invalid,
                args.Phase,
                local,
                Vec2.Zero,
                args.PointerId,
                args.Button,
                args.Buttons,
                args.Modifiers,
                args.Timestamp);
        }

        if (hitHost is not null && hitHost.Runtime.DispatchPointer(in localEvent))
        {
            _activeHost = hitHost;
            return true;
        }

        return false;
    }

    /// <summary>Routes a key event to the active or topmost input host.</summary>
    public bool ProcessKey(in UiKeyEvent args)
    {
        ThrowIfDisposed();
        return ResolveInputHost()?.Runtime.DispatchKey(in args) ?? false;
    }

    /// <summary>Routes committed text to the active or topmost input host.</summary>
    public bool ProcessText(in UiTextInputEvent args)
    {
        ThrowIfDisposed();
        return ResolveInputHost()?.Runtime.DispatchText(in args) ?? false;
    }

    /// <summary>Routes a window focus transition to every host.</summary>
    public void ProcessWindowFocus(in UiWindowFocusEvent args)
    {
        ThrowIfDisposed();
        for (int i = 0; i < _hosts.Count; i++)
        {
            _ = _hosts[i].Runtime.DispatchWindowFocus(in args);
        }

        if (!args.Focused)
        {
            _activeHost = null;
        }
    }

    /// <summary>Maps a raw engine event through the UI adapter and routes it.</summary>
    public bool ProcessRaw(in RawInputEvent raw, in UiViewport viewport, SceneCameraFrame? camera = null)
    {
        ThrowIfDisposed();

        if (_adapter.TryMapPointer(in raw, out UiPointerEvent pointer))
        {
            return ProcessPointer(in pointer, in viewport, camera);
        }

        if (_adapter.TryMapKey(in raw, out UiKeyEvent key))
        {
            return ProcessKey(in key);
        }

        if (_adapter.TryMapText(in raw, out UiTextInputEvent text))
        {
            return ProcessText(in text);
        }

        return false;
    }

    /// <summary>
    /// Projects a screen pixel onto a world-space host quad and returns the
    /// offscreen-surface pixel plus the ray distance.
    /// </summary>
    public static bool TryMapWorldPointer(
        SceneWorld world,
        SceneActor actor,
        in SceneUiHost component,
        in UiViewport screenViewport,
        SceneCameraFrame camera,
        Vec2 screenPoint,
        out Vec2 surfacePoint,
        out float distance)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        surfacePoint = default;
        distance = float.PositiveInfinity;

        if (screenViewport.Width <= 0.0f || screenViewport.Height <= 0.0f || !world.HasData<SceneTransform3D>(actor))
        {
            return false;
        }

        Vec3 cameraPosition = camera.Position;
        if (!SceneUiHostMath.TryBuildWorldModel(world, actor, in component, in cameraPosition, out Mat4 model) ||
            !camera.ViewProjectionMatrix.Invert(out Mat4 inverseViewProjection) ||
            !model.Invert(out Mat4 inverseModel))
        {
            return false;
        }

        float ndcX = ((2.0f * screenPoint.X) / screenViewport.Width) - 1.0f;
        float ndcY = 1.0f - ((2.0f * screenPoint.Y) / screenViewport.Height);

        Vec4 nearWorld = new Vec4(ndcX, ndcY, 0.0f, 1.0f) * inverseViewProjection;
        Vec4 farWorld = new Vec4(ndcX, ndcY, 1.0f, 1.0f) * inverseViewProjection;
        if (MathF.Abs(nearWorld.W) <= 1e-6f || MathF.Abs(farWorld.W) <= 1e-6f)
        {
            return false;
        }

        nearWorld = new Vec4(nearWorld.X / nearWorld.W, nearWorld.Y / nearWorld.W, nearWorld.Z / nearWorld.W, 1.0f);
        farWorld = new Vec4(farWorld.X / farWorld.W, farWorld.Y / farWorld.W, farWorld.Z / farWorld.W, 1.0f);

        Vec4 nearLocal = nearWorld * inverseModel;
        Vec4 farLocal = farWorld * inverseModel;
        float directionZ = farLocal.Z - nearLocal.Z;
        if (MathF.Abs(directionZ) <= 1e-6f)
        {
            return false;
        }

        float t = -nearLocal.Z / directionZ;
        float localX = nearLocal.X + ((farLocal.X - nearLocal.X) * t);
        float localY = nearLocal.Y + ((farLocal.Y - nearLocal.Y) * t);
        if (localX < -0.5f || localX > 0.5f || localY < -0.5f || localY > 0.5f)
        {
            return false;
        }

        int surfaceWidth = SceneUiHostLimits.SurfaceWidth(component.WorldWidth, component.TextureScale);
        int surfaceHeight = SceneUiHostLimits.SurfaceHeight(component.WorldHeight, component.TextureScale);
        surfacePoint = new Vec2((localX + 0.5f) * surfaceWidth, (0.5f - localY) * surfaceHeight);
        distance = t;
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        for (int i = 0; i < _hosts.Count; i++)
        {
            _hosts[i].Runtime.Dispose();
        }

        _hosts.Clear();
        _byActor.Clear();
        _scratch.Clear();
        _activeHost = null;
        Text.Dispose();
    }

    private SceneUiHostInstance? ResolveInputHost()
    {
        if (_activeHost is not null &&
            _activeHost.Component.ReceiveInput &&
            _activeHost.IsRenderable &&
            _byActor.TryGetValue(_activeHost.Actor, out SceneUiHostInstance? live) &&
            ReferenceEquals(live, _activeHost))
        {
            return _activeHost;
        }

        SceneUiHostInstance? best = null;
        for (int i = 0; i < _hosts.Count; i++)
        {
            SceneUiHostInstance host = _hosts[i];
            if (!host.Component.ReceiveInput || !host.IsRenderable)
            {
                continue;
            }

            if (best is null || host.Component.SortingOrder >= best.Component.SortingOrder)
            {
                best = host;
            }
        }

        return best;
    }

    private bool TryAddHost(SceneActor actor, in SceneUiHost component)
    {
        UiHostRuntimeOptions runtimeOptions = _options.Runtime;
        if (_options.Assets is null ||
            !UiHostRuntime.TryCreate(
                _options.Assets,
                component.AssetId,
                in runtimeOptions,
                Text,
                out UiHostRuntime? runtime,
                out _) ||
            runtime is null)
        {
            return false;
        }

        var host = new SceneUiHostInstance(++_order, actor, in component, runtime);
        _hosts.Add(host);
        _byActor.Add(actor, host);
        Revision++;
        return true;
    }

    private bool TryRebind(SceneUiHostInstance host, in SceneUiHost component)
    {
        UiHostRuntimeOptions runtimeOptions = _options.Runtime;
        if (_options.Assets is null ||
            !UiHostRuntime.TryCreate(
                _options.Assets,
                component.AssetId,
                in runtimeOptions,
                Text,
                out UiHostRuntime? runtime,
                out _) ||
            runtime is null)
        {
            return false;
        }

        host.Runtime.Dispose();
        SceneUiHostInstance replacement = new(host.Order, host.Actor, in component, runtime);
        int index = _hosts.IndexOf(host);
        if (index >= 0)
        {
            _hosts[index] = replacement;
        }

        _byActor[host.Actor] = replacement;
        if (ReferenceEquals(_activeHost, host))
        {
            _activeHost = replacement;
        }

        Revision++;
        return true;
    }

    private void RemoveAt(int index)
    {
        SceneUiHostInstance host = _hosts[index];
        _hosts.RemoveAt(index);
        _byActor.Remove(host.Actor);
        host.Runtime.Dispose();
        if (ReferenceEquals(_activeHost, host))
        {
            _activeHost = null;
        }

        Revision++;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
}

/// <summary>Renderer contract consumed by scene loops after the scene passes.</summary>
public interface ISceneUiHostRenderer : IDisposable
{
    /// <summary>Renders world hosts and then screen overlays for one frame.</summary>
    void Render(SceneWorld world, SceneCameraFrame? camera, in UiViewport viewport, SceneUiHostBridge hosts);
}
