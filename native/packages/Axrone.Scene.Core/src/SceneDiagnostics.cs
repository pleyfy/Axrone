namespace Axrone.Scene;

/// <summary>Severity of a scene diagnostic.</summary>
public enum SceneDiagnosticSeverity : byte
{
    /// <summary>Informational event worth recording.</summary>
    Info = 0,

    /// <summary>Recoverable condition that may indicate a content or tuning issue.</summary>
    Warning = 1,

    /// <summary>Operation failed for one entity, asset or pass.</summary>
    Error = 2,

    /// <summary>Runtime-level fault that may terminate the frame.</summary>
    Critical = 3
}

/// <summary>
/// Fixed-size diagnostic record. Codes and subjects are interned symbols so a
/// hot path can report without formatting a message or allocating a payload.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneDiagnostic(
    SceneDiagnosticSeverity Severity,
    SceneStringId Code,
    SceneEntity Entity,
    SceneStringId Subject,
    int Numeric)
{
    /// <summary>Creates a diagnostic without an entity or numeric payload.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneDiagnostic Create(
        SceneDiagnosticSeverity severity,
        SceneStringId code,
        SceneStringId subject = default,
        int numeric = 0) =>
        new(severity, code, SceneEntity.Null, subject, numeric);

    /// <summary>Creates a diagnostic attributed to an entity.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneDiagnostic ForEntity(
        SceneDiagnosticSeverity severity,
        SceneStringId code,
        in SceneEntity entity,
        SceneStringId subject = default,
        int numeric = 0) =>
        new(severity, code, entity, subject, numeric);
}

/// <summary>
/// Consumer of scene diagnostics. Implementations must not throw: a failing
/// sink would turn a recoverable warning into a frame fault.
/// </summary>
public interface ISceneDiagnosticsSink
{
    /// <summary>Reports one diagnostic.</summary>
    void Report(in SceneDiagnostic diagnostic);
}

/// <summary>Discards every diagnostic; eliminated by dead-code removal.</summary>
public readonly struct NullSceneDiagnosticsSink : ISceneDiagnosticsSink
{
    /// <summary>Shared instance; safe because the sink is stateless.</summary>
    public static NullSceneDiagnosticsSink Instance => default;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Report(in SceneDiagnostic diagnostic)
    {
    }
}

/// <summary>
/// Stable diagnostic codes emitted by the scene core and its renderer.
/// </summary>
public static class SceneDiagnosticCodes
{
    /// <summary>A renderer references a mesh id that is not registered.</summary>
    public static readonly SceneStringId MissingMesh = SceneStringId.FromName("scene.render.missing-mesh");

    /// <summary>A renderer references a material id that is not registered.</summary>
    public static readonly SceneStringId MissingMaterial = SceneStringId.FromName("scene.render.missing-material");

    /// <summary>A material references a texture id that is not registered.</summary>
    public static readonly SceneStringId MissingTexture = SceneStringId.FromName("scene.render.missing-texture");

    /// <summary>A material references a shader id that is not registered.</summary>
    public static readonly SceneStringId MissingShader = SceneStringId.FromName("scene.render.missing-shader");

    /// <summary>The transparent primitive budget was exceeded.</summary>
    public static readonly SceneStringId TransparentBudgetExceeded = SceneStringId.FromName("scene.render.transparent-budget");

    /// <summary>A frame exceeded its configured CPU budget.</summary>
    public static readonly SceneStringId FrameBudgetExceeded = SceneStringId.FromName("scene.frame.budget");

    /// <summary>A managed behaviour threw during a lifecycle phase.</summary>
    public static readonly SceneStringId BehaviourFaulted = SceneStringId.FromName("scene.behaviour.faulted");

    /// <summary>An asynchronous asset load failed.</summary>
    public static readonly SceneStringId AssetLoadFailed = SceneStringId.FromName("scene.asset.load-failed");

    /// <summary>A prefab node binding could not be resolved.</summary>
    public static readonly SceneStringId StaleBinding = SceneStringId.FromName("scene.prefab.stale-binding");

    /// <summary>The active profile does not match a requested capability.</summary>
    public static readonly SceneStringId ProfileMismatch = SceneStringId.FromName("scene.profile.mismatch");
}
