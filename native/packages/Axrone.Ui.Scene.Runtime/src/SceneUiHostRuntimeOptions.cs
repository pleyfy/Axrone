namespace Axrone.Ui.Scene.Runtime;

/// <summary>Failure codes for the one-call UI host composition.</summary>
public enum SceneUiHostComposeError
{
    /// <summary>Composition succeeded.</summary>
    None = 0,

    /// <summary>No asset source was supplied.</summary>
    MissingAssets = 1,

    /// <summary>The runtime profile does not register <c>SceneUiHost</c>.</summary>
    MissingProfileComponent = 2,

    /// <summary>Rendering was requested without a context or renderer factory.</summary>
    MissingRenderer = 3,

    /// <summary>The renderer factory failed or returned null.</summary>
    RendererFailed = 4,

    /// <summary>Codec, bridge or renderer construction failed.</summary>
    CompositionFailed = 5,
}

/// <summary>Result of a composed attach attempt.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneUiHostComposeResult(
    bool Success,
    SceneUiHostComposeError Error,
    string Message)
{
    /// <summary>Gets the success result.</summary>
    public static SceneUiHostComposeResult Ok => new(true, SceneUiHostComposeError.None, string.Empty);
}

/// <summary>Creates a host renderer for an attached bridge.</summary>
public interface ISceneUiHostRendererFactory
{
    /// <summary>Creates the renderer; return null to fail the attach.</summary>
    ISceneUiHostRenderer? Create(SceneRuntime runtime, SceneUiHostBridge bridge);
}

/// <summary>Default factory over a live GL context.</summary>
public sealed class SceneUiHostGlRendererFactory : ISceneUiHostRendererFactory
{
    private readonly GLContext _context;

    /// <summary>Creates a factory over a GL context.</summary>
    public SceneUiHostGlRendererFactory(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
    }

    /// <inheritdoc/>
    public ISceneUiHostRenderer? Create(SceneRuntime runtime, SceneUiHostBridge bridge)
    {
        _ = runtime;
        return new Axrone.Ui.Scene.OpenGL.SceneUiHostGlRenderer(_context, bridge);
    }
}

/// <summary>One-call composition settings for scene UI hosts.</summary>
public sealed record SceneUiHostRuntimeOptions
{
    /// <summary>Asset payload source; required.</summary>
    public IUiHostAssetSource? Assets { get; init; }

    /// <summary>Shared UI host runtime options (fonts, theme, events).</summary>
    public UiHostRuntimeOptions HostRuntime { get; init; } = new();

    /// <summary>Maximum number of hosts.</summary>
    public int MaxHosts { get; init; } = 64;

    /// <summary>Whether a renderer is created and attached.</summary>
    public bool EnableRendering { get; init; } = true;

    /// <summary>GL context used by the default renderer factory.</summary>
    public GLContext? Context { get; init; }

    /// <summary>Explicit renderer factory; overrides <see cref="Context"/>.</summary>
    public ISceneUiHostRendererFactory? RendererFactory { get; init; }
}
