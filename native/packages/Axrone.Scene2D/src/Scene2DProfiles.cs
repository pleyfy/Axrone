namespace Axrone.Scene2D;

/// <summary>Profile identities and resolution for the 2D scene surface.</summary>
public static class Scene2DProfiles
{
    /// <summary>Lean 2D profile: transforms plus facade-owned 2D payloads.</summary>
    public const string LeanTwoD = "scene/2d-lean";

    /// <summary>
    /// Frozen lean 2D runtime profile. The id is distinct from the engine's
    /// default 2D profile, while physics bridge selection delegates to the
    /// default 2D family so worlds step the same bridges.
    /// </summary>
    public static SceneRuntimeProfile LeanTwoDProfile { get; } = CreateLeanTwoD();

    /// <summary>Whether the profile id addresses the lean 2D surface.</summary>
    public static bool IsLeanTwoD(string profileId) =>
        string.Equals(profileId, LeanTwoD, StringComparison.Ordinal);

    /// <summary>
    /// Resolves the lean profile by id, then delegates to the engine's built-in
    /// runtime profiles. The default 2D id resolves to
    /// <see cref="SceneRuntimeProfiles.TwoD"/> without being redefined here.
    /// </summary>
    /// <exception cref="SceneConfigurationException">The id is unknown.</exception>
    public static SceneRuntimeProfile Resolve(string profileId)
    {
        ArgumentNullException.ThrowIfNull(profileId);

        if (TryResolve(profileId, out SceneRuntimeProfile? profile))
        {
            return profile;
        }

        throw new SceneConfigurationException($"Runtime profile '{profileId}' is not a known 2D profile.");
    }

    /// <summary>Resolves a lean or built-in runtime profile without throwing.</summary>
    public static bool TryResolve(
        string profileId,
        [NotNullWhen(true)] out SceneRuntimeProfile? profile)
    {
        ArgumentNullException.ThrowIfNull(profileId);

        if (IsLeanTwoD(profileId))
        {
            profile = LeanTwoDProfile;
            return true;
        }

        return SceneRuntimeProfiles.TryResolve(profileId, out profile);
    }

    private static SceneRuntimeProfile CreateLeanTwoD()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName(LeanTwoD)));
        SceneProfile profile = builder
            .AddTransform2D()
            .AddScene2D()
            .Build();

        return new SceneRuntimeProfile(
            LeanTwoD,
            SceneRuntimeProfileKind.Custom,
            profile,
            SceneRuntimeProfiles.ResolvePhysicsBridges(SceneRuntimeProfileIds.TwoD));
    }
}

/// <summary>Profile composition helpers for facade-owned 2D payloads.</summary>
public static class Scene2DProfileExtensions
{
    /// <summary>
    /// Registers the facade's camera, sprite, animator and mask payloads under
    /// their manifest names. Add <c>Transform2D</c> as well when composing a
    /// standalone 2D profile.
    /// </summary>
    public static SceneProfileBuilder AddScene2D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<Scene2DCamera>(
            Scene2DComponentIds.Camera,
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 900);

        builder.AddData<Scene2DCamera2D>(
            Scene2DComponentIds.Camera2D,
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 900);

        builder.AddData<Scene2DSpriteRenderer>(
            Scene2DComponentIds.SpriteRenderer,
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<Scene2DSpriteAnimator>(
            Scene2DComponentIds.SpriteAnimator,
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 110);

        builder.AddData<Scene2DSpriteMask>(
            Scene2DComponentIds.SpriteMask,
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 105);

        return builder;
    }
}
