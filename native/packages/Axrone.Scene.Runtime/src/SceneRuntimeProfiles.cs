namespace Axrone.Scene.Runtime;

/// <summary>
/// Built-in runtime profiles and resolution rules. Profiles mirror the web
/// engine's core/2d/3d/mixed/full families: each one composes the component
/// registries a scene family needs and declares which physics bridges it steps.
/// </summary>
public static class SceneRuntimeProfiles
{
    /// <summary>Transforms and hierarchy only.</summary>
    public static SceneRuntimeProfile Core { get; } = CreateCore();

    /// <summary>2D cameras and sprites.</summary>
    public static SceneRuntimeProfile TwoD { get; } = CreateTwoD();

    /// <summary>3D cameras, meshes, lights and fog.</summary>
    public static SceneRuntimeProfile ThreeD { get; } = CreateThreeD();

    /// <summary>2D and 3D paths together.</summary>
    public static SceneRuntimeProfile Mixed { get; } = CreateMixed();

    /// <summary>Default full engine composition (3D today).</summary>
    public static SceneRuntimeProfile Full { get; } = CreateFull();

    /// <summary>Resolves a built-in profile by family.</summary>
    /// <exception cref="SceneConfigurationException">The family has no built-in profile.</exception>
    public static SceneRuntimeProfile Get(SceneRuntimeProfileKind kind) => kind switch
    {
        SceneRuntimeProfileKind.Core => Core,
        SceneRuntimeProfileKind.TwoD => TwoD,
        SceneRuntimeProfileKind.ThreeD => ThreeD,
        SceneRuntimeProfileKind.Mixed => Mixed,
        SceneRuntimeProfileKind.Full => Full,
        _ => throw new SceneConfigurationException(
            $"Runtime profile family '{kind}' has no built-in profile.")
    };

    /// <summary>Resolves a built-in profile by stable id.</summary>
    public static bool TryResolve(
        string id,
        [NotNullWhen(true)] out SceneRuntimeProfile? profile)
    {
        ArgumentNullException.ThrowIfNull(id);

        if (string.Equals(id, Core.Id, StringComparison.Ordinal))
        {
            profile = Core;
            return true;
        }

        if (string.Equals(id, TwoD.Id, StringComparison.Ordinal))
        {
            profile = TwoD;
            return true;
        }

        if (string.Equals(id, ThreeD.Id, StringComparison.Ordinal))
        {
            profile = ThreeD;
            return true;
        }

        if (string.Equals(id, Mixed.Id, StringComparison.Ordinal))
        {
            profile = Mixed;
            return true;
        }

        if (string.Equals(id, Full.Id, StringComparison.Ordinal))
        {
            profile = Full;
            return true;
        }

        profile = null;
        return false;
    }

    /// <summary>
    /// Resolves the runtime profile from an explicit runtime profile, a custom
    /// scene composition, or the full default, in that order.
    /// </summary>
    public static SceneRuntimeProfile Resolve(
        SceneRuntimeProfile? runtimeProfile,
        SceneProfile? customProfile)
    {
        if (runtimeProfile is not null)
        {
            return runtimeProfile;
        }

        return customProfile is not null
            ? CreateCustom(SceneRuntimeProfileIds.Custom, customProfile)
            : Full;
    }

    /// <summary>Wraps a caller-composed scene profile as a custom runtime profile.</summary>
    public static SceneRuntimeProfile CreateCustom(string id, SceneProfile profile)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(profile);

        return new SceneRuntimeProfile(
            id,
            SceneRuntimeProfileKind.Custom,
            profile,
            ResolvePhysicsBridges(id));
    }

    /// <summary>
    /// Physics bridges a profile id participates in. Only the 2D family steps a
    /// 2D world and only the mixed family steps both; everything else,
    /// including unknown ids, uses the 3D bridge.
    /// </summary>
    public static ScenePhysicsBridgeSelection ResolvePhysicsBridges(string? profileId)
    {
        if (string.Equals(profileId, SceneRuntimeProfileIds.TwoD, StringComparison.Ordinal))
        {
            return new ScenePhysicsBridgeSelection(Bridge3D: false, Bridge2D: true);
        }

        if (string.Equals(profileId, SceneRuntimeProfileIds.Mixed, StringComparison.Ordinal))
        {
            return new ScenePhysicsBridgeSelection(Bridge3D: true, Bridge2D: true);
        }

        return new ScenePhysicsBridgeSelection(Bridge3D: true, Bridge2D: false);
    }

    private static SceneRuntimeProfile CreateCore() =>
        Create(
            SceneRuntimeProfileIds.Core,
            SceneRuntimeProfileKind.Core,
            static builder => builder.AddTransform3D());

    private static SceneRuntimeProfile CreateTwoD() =>
        Create(
            SceneRuntimeProfileIds.TwoD,
            SceneRuntimeProfileKind.TwoD,
            static builder => builder
                .AddTransform2D()
                .AddRendering2D()
                .AddSceneRenderables(SceneRenderableFeatures.SpriteMask)
                .AddPhysics2D());

    private static SceneRuntimeProfile CreateThreeD() =>
        Create(
            SceneRuntimeProfileIds.ThreeD,
            SceneRuntimeProfileKind.ThreeD,
            static builder => builder
                .AddTransform3D()
                .AddRendering3D()
                .AddLighting3D()
                .AddPhysics3D()
                .AddTerrain3D()
                .AddParticles3D()
                .AddAnimators3D()
                .AddPathAgents3D()
                .AddSceneRenderables()
                .AddCameraControllers());

    private static SceneRuntimeProfile CreateMixed() =>
        Create(
            SceneRuntimeProfileIds.Mixed,
            SceneRuntimeProfileKind.Mixed,
            static builder => builder
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
                .AddCameraControllers());

    private static SceneRuntimeProfile CreateFull() =>
        Create(
            SceneRuntimeProfileIds.Full,
            SceneRuntimeProfileKind.Full,
            static builder => builder
                .AddTransform3D()
                .AddRendering3D()
                .AddLighting3D()
                .AddPhysics3D()
                .AddTerrain3D()
                .AddParticles3D()
                .AddAnimators3D()
                .AddPathAgents3D()
                .AddSceneRenderables()
                .AddCameraControllers());

    private static SceneRuntimeProfile Create(
        string id,
        SceneRuntimeProfileKind kind,
        Func<SceneProfileBuilder, SceneProfileBuilder> compose)
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName(id)));
        SceneProfile profile = compose(builder).Build();

        return new SceneRuntimeProfile(id, kind, profile, ResolvePhysicsBridges(id));
    }
}
