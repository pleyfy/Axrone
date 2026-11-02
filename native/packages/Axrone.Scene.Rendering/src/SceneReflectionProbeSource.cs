namespace Axrone.Scene.Rendering;

/// <summary>Optional frame-source extension for the selected reflection probe.</summary>
public interface ISceneReflectionProbeSource
{
    /// <summary>Gets the highest-priority probe containing the camera.</summary>
    bool TryGetSelectedProbe(out SceneReflectionProbeRenderItem probe);
}
