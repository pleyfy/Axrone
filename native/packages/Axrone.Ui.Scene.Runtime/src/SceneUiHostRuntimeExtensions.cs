namespace Axrone.Ui.Scene.Runtime;

/// <summary>
/// One-call composition of a scene runtime, UI host bridge, codec and optional
/// renderer. Attach is idempotent per runtime; failures leave no partial state.
/// </summary>
/// <remarks>
/// Scene.Runtime has no UI dependency: the application opts in by calling this
/// extension after constructing the runtime.
/// </remarks>
public static class SceneUiHostRuntimeExtensions
{
    private static readonly ConditionalWeakTable<SceneRuntime, SceneUiHostsRuntime> s_bindings = new();
    private static readonly Lock s_gate = new();

    /// <summary>Attaches UI hosts and returns the existing handle when already attached.</summary>
    public static SceneUiHostsRuntime AttachUiHosts(this SceneRuntime runtime, SceneUiHostRuntimeOptions? options = null)
    {
        if (!TryAttachUiHosts(runtime, options, out SceneUiHostsRuntime? hosts, out SceneUiHostComposeResult result))
        {
            throw new SceneValidationException(SceneErrorCodes.CapabilityMissing, result.Message);
        }

        return hosts;
    }

    /// <summary>Attempts to attach UI hosts without throwing.</summary>
    public static bool TryAttachUiHosts(
        this SceneRuntime runtime,
        SceneUiHostRuntimeOptions? options,
        [NotNullWhen(true)] out SceneUiHostsRuntime? hosts,
        out SceneUiHostComposeResult result)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        hosts = null;
        options ??= new SceneUiHostRuntimeOptions();

        lock (s_gate)
        {
            if (s_bindings.TryGetValue(runtime, out SceneUiHostsRuntime? existing))
            {
                if (!existing.IsDisposed)
                {
                    hosts = existing;
                    result = SceneUiHostComposeResult.Ok;
                    return true;
                }

                s_bindings.Remove(runtime);
            }

            if (options.Assets is null)
            {
                result = new SceneUiHostComposeResult(false, SceneUiHostComposeError.MissingAssets, "UI host composition requires an asset source.");
                return false;
            }

            if (!runtime.World.Registry.TryGetDataByType(typeof(SceneUiHost), out _))
            {
                result = new SceneUiHostComposeResult(
                    false,
                    SceneUiHostComposeError.MissingProfileComponent,
                    "The runtime profile does not register SceneUiHost; call AddUiHosts or use a UI host runtime profile.");
                return false;
            }

            ISceneUiHostRendererFactory? factory = options.RendererFactory;
            if (factory is null && options.Context is not null)
            {
                factory = new SceneUiHostGlRendererFactory(options.Context);
            }

            if (options.EnableRendering && factory is null)
            {
                result = new SceneUiHostComposeResult(
                    false,
                    SceneUiHostComposeError.MissingRenderer,
                    "Rendering is enabled but neither a GL context nor a renderer factory was supplied.");
                return false;
            }

            SceneUiHostBridge? bridge = null;
            UiHostGlyphAtlasUploader? atlasUploader = null;
            bool ownsAtlasUploader = false;
            try
            {
                if (!runtime.Codecs.TryGet("SceneUiHost", out _))
                {
                    SceneUiHostRegistration.RegisterCodecs(runtime.Codecs, runtime.World.Registry);
                }

                if (options.EnableRendering)
                {
                    if (options.HostRuntime.GlyphUploader is not null &&
                        options.HostRuntime.GlyphUploader is not UiHostGlyphAtlasUploader)
                    {
                        result = new SceneUiHostComposeResult(
                            false,
                            SceneUiHostComposeError.RendererUploaderUnsupported,
                            "A rendering UI host requires a UiHostGlyphAtlasUploader so the renderer can resolve atlas textures.");
                        return false;
                    }

                    atlasUploader = options.HostRuntime.GlyphUploader as UiHostGlyphAtlasUploader;
                    if (atlasUploader is null && options.Context is not null)
                    {
                        atlasUploader = new UiHostGlyphAtlasUploader(options.Context);
                        ownsAtlasUploader = true;
                    }

                    if (factory is not null &&
                        factory is not ISceneUiHostRendererFactoryWithAtlas &&
                        (atlasUploader is not null || options.HostRuntime.Fonts is not null))
                    {
                        if (ownsAtlasUploader)
                        {
                            atlasUploader?.Dispose();
                        }

                        result = new SceneUiHostComposeResult(
                            false,
                            SceneUiHostComposeError.RendererUploaderUnsupported,
                            "The custom renderer factory does not accept the shared glyph uploader; implement ISceneUiHostRendererFactoryWithAtlas or use SceneUiHostGlRendererFactory.");
                        return false;
                    }
                }

                UiHostRuntimeOptions hostRuntime = atlasUploader is null
                    ? options.HostRuntime
                    : options.HostRuntime with { GlyphUploader = atlasUploader };

                bridge = new SceneUiHostBridge(runtime.World, new SceneUiHostBridgeOptions
                {
                    Assets = options.Assets,
                    Runtime = hostRuntime,
                    MaxHosts = options.MaxHosts,
                });

                ISceneUiHostRenderer? renderer = null;
                if (options.EnableRendering && factory is not null)
                {
                    renderer = factory.Create(runtime, bridge, atlasUploader);
                    if (renderer is null)
                    {
                        throw new SceneValidationException(SceneErrorCodes.CapabilityMissing, "The renderer factory returned null.");
                    }
                }

                hosts = new SceneUiHostsRuntime(runtime, bridge, renderer, atlasUploader, ownsAtlasUploader);
                if (!runtime.TryAttach(hosts))
                {
                    hosts.DetachAndDispose();
                    hosts = null;
                    result = new SceneUiHostComposeResult(
                        false,
                        SceneUiHostComposeError.AttachmentFailed,
                        "The scene runtime rejected the UI host lifecycle attachment.");
                    return false;
                }

                s_bindings.Add(runtime, hosts);
                result = SceneUiHostComposeResult.Ok;
                return true;
            }
            catch (Exception exception)
            {
                if (hosts is not null)
                {
                    hosts.DetachAndDispose();
                    hosts = null;
                }
                else
                {
                    bridge?.Dispose();
                    if (ownsAtlasUploader)
                    {
                        atlasUploader?.Dispose();
                    }
                }

                result = new SceneUiHostComposeResult(
                    false,
                    SceneUiHostComposeError.RendererFailed,
                    $"UI host composition failed: {exception.Message}");
                return false;
            }
        }
    }

    /// <summary>Detaches and disposes the composition, if any.</summary>
    public static bool TryDetachUiHosts(this SceneRuntime runtime)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        SceneUiHostsRuntime? detached;
        lock (s_gate)
        {
            if (!s_bindings.TryGetValue(runtime, out detached))
            {
                return false;
            }

            s_bindings.Remove(runtime);
        }

        _ = runtime.TryDetach(detached);
        detached.DetachAndDispose();
        return true;
    }

    internal static void RemoveBinding(SceneRuntime runtime, SceneUiHostsRuntime hosts)
    {
        lock (s_gate)
        {
            if (s_bindings.TryGetValue(runtime, out SceneUiHostsRuntime? current) && ReferenceEquals(current, hosts))
            {
                s_bindings.Remove(runtime);
            }
        }
    }
}
