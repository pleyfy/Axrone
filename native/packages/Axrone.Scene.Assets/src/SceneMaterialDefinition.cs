namespace Axrone.Scene.Assets;

using System.Collections.Frozen;

/// <summary>
/// Immutable material definition: shader binding, surface parameters, pass
/// overrides and custom uniforms. Passes and uniforms are copied on
/// construction, so later caller mutation cannot change a registered material.
/// </summary>
public sealed class SceneMaterialDefinition : ISceneAssetDefinition<MaterialAssetTag>
{
    /// <summary>Creates a material definition.</summary>
    public SceneMaterialDefinition(
        SceneAssetId<MaterialAssetTag> id,
        SceneAssetId<ShaderAssetTag> shaderId,
        SceneMaterialSurface surface,
        IReadOnlyList<SceneMaterialPass>? passes = null,
        IReadOnlyDictionary<string, SceneUniformValue>? uniforms = null,
        string? techniqueId = null,
        IReadOnlyDictionary<string, string>? keywords = null,
        IReadOnlyDictionary<string, SceneMaterialTextureBinding>? textureUniforms = null)
    {
        if (!id.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material definitions require a non-empty id.");
        }

        if (!shaderId.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Material '{id}' requires a valid shader id.");
        }

        ArgumentNullException.ThrowIfNull(surface);
        surface.Validate();

        SceneMaterialPass[] passArray = passes is null ? [] : [.. passes];
        HashSet<string> passIds = new(StringComparer.Ordinal);
        for (int i = 0; i < passArray.Length; i++)
        {
            SceneMaterialPass pass = passArray[i] ??
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' contains a null pass.");
            if (!passIds.Add(pass.Id))
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' declares duplicate pass '{pass.Id}'.");
            }
        }

        Id = id;
        ShaderId = shaderId;
        Surface = surface;
        Passes = passArray;
        Uniforms = CreateUniforms(id, uniforms);
        TechniqueId = techniqueId;
        Keywords = CreateKeywords(id, keywords);
        TextureUniforms = CreateTextureUniforms(id, textureUniforms);
    }

    /// <inheritdoc/>
    public SceneAssetId<MaterialAssetTag> Id { get; }

    /// <summary>Shader used by the material.</summary>
    public SceneAssetId<ShaderAssetTag> ShaderId { get; }

    /// <summary>Surface parameters.</summary>
    public SceneMaterialSurface Surface { get; }

    /// <summary>Pass overrides in declaration order.</summary>
    public IReadOnlyList<SceneMaterialPass> Passes { get; }

    /// <summary>Custom uniform values.</summary>
    public IReadOnlyDictionary<string, SceneUniformValue> Uniforms { get; }

    /// <summary>
    /// Effect technique this material selects, or null for the effect default. Only meaningful
    /// when the shader asset is backed by an effect.
    /// </summary>
    public string? TechniqueId { get; }

    /// <summary>Keyword selections that pick the shader variant, copied on construction.</summary>
    public IReadOnlyDictionary<string, string> Keywords { get; }

    /// <summary>
    /// Texture bindings addressed by sampler-uniform name, copied on construction. This is the
    /// channel a dynamically compiled material graph uses for its own <c>sampler2D</c> inputs;
    /// the fixed surface maps stay on <see cref="Surface"/> and keep their reserved names.
    /// </summary>
    public IReadOnlyDictionary<string, SceneMaterialTextureBinding> TextureUniforms { get; }

    private static FrozenDictionary<string, SceneUniformValue> CreateUniforms(
        SceneAssetId<MaterialAssetTag> id,
        IReadOnlyDictionary<string, SceneUniformValue>? uniforms)
    {
        if (uniforms is null || uniforms.Count == 0)
        {
            return FrozenDictionary<string, SceneUniformValue>.Empty;
        }

        foreach (string name in uniforms.Keys)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' contains an empty uniform name.");
            }
        }

        return uniforms.ToFrozenDictionary(StringComparer.Ordinal);
    }

    private static FrozenDictionary<string, SceneMaterialTextureBinding> CreateTextureUniforms(
        SceneAssetId<MaterialAssetTag> id,
        IReadOnlyDictionary<string, SceneMaterialTextureBinding>? textureUniforms)
    {
        if (textureUniforms is null || textureUniforms.Count == 0)
        {
            return FrozenDictionary<string, SceneMaterialTextureBinding>.Empty;
        }

        foreach (KeyValuePair<string, SceneMaterialTextureBinding> pair in textureUniforms)
        {
            if (string.IsNullOrWhiteSpace(pair.Key))
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' contains an empty texture uniform name.");
            }

            if (!pair.Value.TextureId.IsValid)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' texture uniform '{pair.Key}' requires a valid texture id.");
            }
        }

        return textureUniforms.ToFrozenDictionary(StringComparer.Ordinal);
    }

    private static FrozenDictionary<string, string> CreateKeywords(
        SceneAssetId<MaterialAssetTag> id,
        IReadOnlyDictionary<string, string>? keywords)
    {
        if (keywords is null || keywords.Count == 0)
        {
            return FrozenDictionary<string, string>.Empty;
        }

        foreach (KeyValuePair<string, string> keyword in keywords)
        {
            if (string.IsNullOrWhiteSpace(keyword.Key) || string.IsNullOrWhiteSpace(keyword.Value))
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Material '{id}' contains an empty keyword name or value.");
            }
        }

        return keywords.ToFrozenDictionary(StringComparer.Ordinal);
    }
}
