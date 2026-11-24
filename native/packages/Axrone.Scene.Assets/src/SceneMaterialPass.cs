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
        SceneBlendState? blendState = null,
        string? shaderId = null,
        string? phase = null,
        string? cullMode = null,
        string? enabledWhenUniformNonZero = null)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material passes require a non-empty id.");
        }

        if (shaderId is not null && string.IsNullOrWhiteSpace(shaderId))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material pass shaderId must not be whitespace.");
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
        ShaderId = shaderId;
        Phase = phase;
        CullMode = cullMode;
        EnabledWhenUniformNonZero = enabledWhenUniformNonZero;
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

    /// <summary>Optional explicit blend fentities and equations.</summary>
    public SceneBlendState? BlendState { get; }

    /// <summary>Optional pass-specific built-in or generated shader identifier.</summary>
    public string? ShaderId { get; }

    /// <summary>Optional Material Contract pass phase (e.g. default, shadow-caster, outline).</summary>
    public string? Phase { get; }

    /// <summary>Optional cull face directive (back, front, none).</summary>
    public string? CullMode { get; }

    /// <summary>Optional scalar uniform name gating pass execution when non-zero.</summary>
    public string? EnabledWhenUniformNonZero { get; }
}
