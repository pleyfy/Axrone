namespace Axrone.Scene.Assets;

/// <summary>
/// One material pass: ordering plus optional state overrides. Null overrides
/// inherit from the render pass or shader defaults.
/// </summary>
public sealed class SceneMaterialPass
{
    /// <summary>Creates a material pass.</summary>
    public SceneMaterialPass(
        string id = "main",
        int priority = 0,
        SceneMeshTopology? primitive = null,
        bool? depthTest = null,
        bool? depthWrite = null,
        bool? cull = null,
        bool? blend = null,
        SceneBlendState? blendState = null)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material passes require a non-empty id.");
        }

        blendState?.Validate();

        Id = id;
        Priority = priority;
        Primitive = primitive;
        DepthTest = depthTest;
        DepthWrite = depthWrite;
        Cull = cull;
        Blend = blend;
        BlendState = blendState;
    }

    /// <summary>Pass identity.</summary>
    public string Id { get; }

    /// <summary>Sort priority inside the material.</summary>
    public int Priority { get; }

    /// <summary>Optional primitive topology override.</summary>
    public SceneMeshTopology? Primitive { get; }

    /// <summary>Optional depth-test override.</summary>
    public bool? DepthTest { get; }

    /// <summary>Optional depth-write override.</summary>
    public bool? DepthWrite { get; }

    /// <summary>Optional face-culling override.</summary>
    public bool? Cull { get; }

    /// <summary>Optional blending override.</summary>
    public bool? Blend { get; }

    /// <summary>Optional explicit blend factors and equations.</summary>
    public SceneBlendState? BlendState { get; }
}
