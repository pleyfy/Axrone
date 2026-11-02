namespace Axrone.Scene2D;

/// <summary>Construction settings for a <see cref="Scene2D"/> facade.</summary>
public readonly record struct Scene2DCreateOptions
{
    /// <summary>
    /// Runtime profile backing the world. Null selects the lean 2D profile;
    /// custom profiles must register <c>Transform2D</c> and the Scene2D
    /// payloads through <see cref="Scene2DProfileExtensions.AddScene2D"/>.
    /// </summary>
    public SceneRuntimeProfile? RuntimeProfile { get; init; }

    /// <summary>World capacity and fault policy settings.</summary>
    public SceneWorldOptions WorldOptions { get; init; }

    /// <summary>Optional diagnostics sink forwarded to the world.</summary>
    public ISceneDiagnosticsSink? Diagnostics { get; init; }

    /// <summary>Creates default options: lean profile, 64 actor slots.</summary>
    public Scene2DCreateOptions()
    {
        RuntimeProfile = null;
        WorldOptions = new SceneWorldOptions();
        Diagnostics = null;
    }
}
