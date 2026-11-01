namespace Axrone.Ui.Scene.Runtime;

using Axrone.Scene.Rendering;

/// <summary>Opt-in profile helpers that add UI hosts without touching Scene.Runtime.</summary>
public static class SceneUiHostProfileExtensions
{
    /// <summary>Adds the UI host component to a caller-composed 3D profile.</summary>
    public static SceneProfileBuilder AddUiHosts3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddUiHosts();
    }
}

/// <summary>
/// Opt-in runtime profile families that mirror the built-in ThreeD/Mixed/Full
/// compositions with <c>SceneUiHost</c> included. The built-in profiles stay
/// untouched; callers choose a UI host profile explicitly.
/// </summary>
public static class SceneUiHostRuntimeProfiles
{
    /// <summary>Stable id of the 3D UI host profile.</summary>
    public const string ThreeDId = "scene/3d-ui-host";

    /// <summary>Stable id of the mixed UI host profile.</summary>
    public const string MixedId = "scene/mixed-ui-host";

    /// <summary>Stable id of the full UI host profile.</summary>
    public const string FullId = "scene/full-ui-host";

    /// <summary>3D composition with UI hosts.</summary>
    public static SceneRuntimeProfile ThreeD { get; } =
        Create(ThreeDId, SceneRuntimeProfileKind.ThreeD, SceneRuntimeProfileIds.ThreeD, static builder => builder
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .AddPhysics3D()
            .AddTerrain3D()
            .AddParticles3D()
            .AddAnimators3D()
            .AddPathAgents3D()
            .AddSceneRenderables()
            .AddCameraControllers()
            .AddUiHosts());

    /// <summary>Mixed 2D/3D composition with UI hosts.</summary>
    public static SceneRuntimeProfile Mixed { get; } =
        Create(MixedId, SceneRuntimeProfileKind.Mixed, SceneRuntimeProfileIds.Mixed, static builder => builder
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .AddPhysics3D()
            .AddTerrain3D()
            .AddParticles3D()
            .AddTransform2D()
            .AddRendering2D(includeCamera: false)
            .AddPhysics2D()
            .AddAnimators3D()
            .AddPathAgents3D()
            .AddSceneRenderables()
            .AddCameraControllers()
            .AddUiHosts());

    /// <summary>Full composition with UI hosts.</summary>
    public static SceneRuntimeProfile Full { get; } =
        Create(FullId, SceneRuntimeProfileKind.Full, SceneRuntimeProfileIds.Full, static builder => builder
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .AddPhysics3D()
            .AddTerrain3D()
            .AddParticles3D()
            .AddAnimators3D()
            .AddPathAgents3D()
            .AddSceneRenderables()
            .AddCameraControllers()
            .AddUiHosts());

    /// <summary>Resolves a UI host profile by family; Core/TwoD/Custom are unsupported.</summary>
    public static SceneRuntimeProfile Create(SceneRuntimeProfileKind kind) => kind switch
    {
        SceneRuntimeProfileKind.ThreeD => ThreeD,
        SceneRuntimeProfileKind.Mixed => Mixed,
        SceneRuntimeProfileKind.Full => Full,
        _ => throw new SceneConfigurationException(
            $"Runtime profile family '{kind}' has no UI host composition."),
    };

    private static SceneRuntimeProfile Create(
        string id,
        SceneRuntimeProfileKind kind,
        string physicsFamily,
        Func<SceneProfileBuilder, SceneProfileBuilder> compose)
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName(id)));
        SceneProfile profile = compose(builder).Build();
        return new SceneRuntimeProfile(id, kind, profile, SceneRuntimeProfiles.ResolvePhysicsBridges(physicsFamily));
    }
}
