namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Resolved texture/sampler pair for one material slot.</summary>
public readonly record struct SceneGlTextureSlot(
    string UniformName,
    int Unit,
    GLTexture Texture,
    GLSampler Sampler);

/// <summary>Flattened custom uniform entry used by the allocation-free draw loop.</summary>
public readonly record struct SceneGlUniformEntry(string Name, SceneUniformValue Value);

/// <summary>
/// GPU-ready material: compiled shader, resolved texture slots and the canonical
/// definition used for uniform and state binding.
/// </summary>
public sealed class SceneGlMaterial
{
    /// <summary>Creates a GPU material.</summary>
    public SceneGlMaterial(
        SceneMaterialDefinition definition,
        SceneGlShader shader,
        SceneGlTextureSlot[] textureSlots,
        SceneGlShader? skinnedShader = null)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(shader);
        ArgumentNullException.ThrowIfNull(textureSlots);

        Definition = definition;
        Shader = shader;
        SkinnedShader = skinnedShader;
        TextureSlots = textureSlots;
        PrimaryPass = ResolvePrimaryPass(definition.Passes);
        UniformEntries = FlattenUniforms(definition.Uniforms);
    }

    /// <summary>Canonical material definition.</summary>
    public SceneMaterialDefinition Definition { get; }

    /// <summary>Compiled shader.</summary>
    public SceneGlShader Shader { get; }

    /// <summary>Skinning variant of <see cref="Shader"/>, or null when the material vertex shader cannot be skinned.</summary>
    public SceneGlShader? SkinnedShader { get; }

    /// <summary>Resolved texture slots.</summary>
    public ReadOnlyMemory<SceneGlTextureSlot> TextureSlots { get; }

    /// <summary>Flattened custom uniforms in declaration order.</summary>
    public ReadOnlyMemory<SceneGlUniformEntry> UniformEntries { get; }

    /// <summary>Pass used for state overrides, if any.</summary>
    public SceneMaterialPass? PrimaryPass { get; }

    /// <summary>Surface parameters.</summary>
    public SceneMaterialSurface Surface => Definition.Surface;

    /// <summary>Custom uniform values.</summary>
    public IReadOnlyDictionary<string, SceneUniformValue> Uniforms => Definition.Uniforms;

    private static SceneMaterialPass? ResolvePrimaryPass(IReadOnlyList<SceneMaterialPass> passes)
    {
        if (passes.Count == 0)
        {
            return null;
        }

        for (int i = 0; i < passes.Count; i++)
        {
            if (string.Equals(passes[i].Id, "main", StringComparison.Ordinal))
            {
                return passes[i];
            }
        }

        return passes[0];
    }

    private static SceneGlUniformEntry[] FlattenUniforms(
        IReadOnlyDictionary<string, SceneUniformValue> uniforms)
    {
        if (uniforms.Count == 0)
        {
            return [];
        }

        var entries = new SceneGlUniformEntry[uniforms.Count];
        int index = 0;
        foreach (KeyValuePair<string, SceneUniformValue> pair in uniforms)
        {
            entries[index++] = new SceneGlUniformEntry(pair.Key, pair.Value);
        }

        return entries;
    }
}
