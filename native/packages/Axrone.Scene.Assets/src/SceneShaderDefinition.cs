namespace Axrone.Scene.Assets;

using System.Collections.Frozen;
using Axrone.AssetShader;

/// <summary>
/// Immutable shader definition: source pair, reflected uniform names and the
/// semantic-to-attribute binding used by the draw path.
/// </summary>
public sealed class SceneShaderDefinition : ISceneAssetDefinition<ShaderAssetTag>
{
    /// <summary>Creates a shader definition.</summary>
    public SceneShaderDefinition(
        SceneAssetId<ShaderAssetTag> id,
        string vertexSource,
        string fragmentSource,
        IReadOnlyList<string>? uniforms = null,
        IReadOnlyDictionary<SceneMeshSemantic, string>? attributes = null,
        bool depthTest = true,
        bool cull = true,
        bool blend = false,
        ShaderEffect? effect = null)
    {
        if (!id.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Shader definitions require a non-empty id.");
        }

        // Raw sources win when both are present, exactly as in the Web shader factory; an effect
        // may stand in for either stage because the renderer bakes the effect into real sources.
        bool hasSourcePair =
            !string.IsNullOrWhiteSpace(vertexSource) && !string.IsNullOrWhiteSpace(fragmentSource);
        if (!hasSourcePair && effect is null)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Shader '{id}' requires vertex and fragment source, or an effect to bake them from.");
        }

        Id = id;
        VertexSource = vertexSource;
        FragmentSource = fragmentSource;
        Uniforms = uniforms is null ? [] : [.. uniforms];
        Attributes = attributes is null
            ? FrozenDictionary<SceneMeshSemantic, string>.Empty
            : attributes.ToFrozenDictionary();
        DepthTest = depthTest;
        Cull = cull;
        Blend = blend;
        Effect = effect;
    }

    /// <inheritdoc/>
    public SceneAssetId<ShaderAssetTag> Id { get; }

    /// <summary>
    /// Effect that backs this shader, or null when the raw source pair is authoritative. When an
    /// effect is present the renderer compiles its technique passes through the variant baker
    /// instead of the raw strings, so keywords and pass overrides become real GPU programs.
    /// </summary>
    public ShaderEffect? Effect { get; }

    /// <summary>Vertex shader source.</summary>
    public string VertexSource { get; }

    /// <summary>Fragment shader source.</summary>
    public string FragmentSource { get; }

    /// <summary>Uniform names declared by the shader.</summary>
    public IReadOnlyList<string> Uniforms { get; }

    /// <summary>Semantic-to-attribute-name bindings.</summary>
    public IReadOnlyDictionary<SceneMeshSemantic, string> Attributes { get; }

    /// <summary>Default depth-test state.</summary>
    public bool DepthTest { get; }

    /// <summary>Default face-culling state.</summary>
    public bool Cull { get; }

    /// <summary>Default blending state.</summary>
    public bool Blend { get; }
}
