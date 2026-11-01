namespace Axrone.Scene.Runtime;

using Axrone.Animation;

/// <summary>
/// Adapts the animator bridge's pose sink onto the renderer-facing bone palette
/// sink. Only the composed world palette crosses into Scene.Rendering; local
/// transforms stay inside the animation package.
/// </summary>
public sealed class SceneBonePalettePoseSink : IScenePoseSink
{
    private readonly ISceneBonePaletteSink _sink;

    /// <summary>Creates an adapter over a palette sink.</summary>
    public SceneBonePalettePoseSink(ISceneBonePaletteSink sink)
    {
        ArgumentNullException.ThrowIfNull(sink);
        _sink = sink;
    }

    /// <inheritdoc/>
    public void ApplyPose(SceneActor actor, ReadOnlySpan<LocalTransform> localPose, ReadOnlySpan<Mat4> worldPalette)
    {
        _ = localPose;
        _sink.ApplyBonePalette(actor, worldPalette);
    }
}
