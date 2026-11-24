namespace Axrone.Scene.Gltf;

/// <summary>Stable glTF adapter error codes.</summary>
public static class SceneGltfErrorCodes
{
    /// <summary>The import result is malformed for scene conversion.</summary>
    public const string Invalid = "scene.gltf.invalid";

    /// <summary>A material declares a property outside the declared shader catalog.</summary>
    public const string UnknownProperty = "scene.gltf.unknown-property";

    /// <summary>A glTF extension is not mapped and the policy rejects it.</summary>
    public const string UnknownExtension = "scene.gltf.unknown-extension";
}

/// <summary>glTF adapter failure.</summary>
public sealed class SceneGltfException : SceneException
{
    /// <summary>Creates a glTF adapter failure.</summary>
    public SceneGltfException(string code, string message, Exception? inner = null)
        : base(code, message, inner)
    {
    }
}

/// <summary>One conversion diagnostic for unsupported or lossy glTF data.</summary>
public readonly record struct SceneGltfDiagnostic(string Code, string Message);

/// <summary>Blend metadata applied to transparent glTF materials.</summary>
public enum SceneGltfBlendMode
{
    /// <summary>Straight alpha blending for <c>BLEND</c> materials.</summary>
    Auto = 0,

    /// <summary>Force alpha blending for <c>BLEND</c> materials.</summary>
    Alpha = 1,

    /// <summary>Force additive blending for <c>BLEND</c> materials.</summary>
    Additive = 2
}

/// <summary>Handling policy for glTF extensions the scene bridge does not map.</summary>
public enum SceneGltfUnknownExtensionPolicy
{
    /// <summary>Report one diagnostic per unknown extension.</summary>
    Report = 0,

    /// <summary>Ignore unknown extensions silently.</summary>
    Ignore = 1,

    /// <summary>Fail the conversion.</summary>
    Reject = 2
}

/// <summary>Conversion settings for <see cref="SceneGltfAdapter"/>.</summary>
public sealed record SceneGltfImportOptions
{
    /// <summary>
    /// Shader assigned to every imported lit material. Used when the material
    /// does not declare a custom shader id.
    /// </summary>
    public SceneAssetId<ShaderAssetTag> PbrShaderId { get; init; } =
        SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.PbrShaderName);

    /// <summary>
    /// Shader assigned to materials marked unlit; overrides the declared
    /// shader id and defaults to the built-in unlit shader.
    /// </summary>
    public SceneAssetId<ShaderAssetTag>? UnlitShaderId { get; init; }

    /// <summary>
    /// Shader assigned to lit materials when <see cref="ShadingModel"/> is
    /// toon. Overrides the declared shader id.
    /// </summary>
    public SceneAssetId<ShaderAssetTag> ToonShaderId { get; init; } =
        SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.ToonShaderName);

    /// <summary>Shading model used for lit (non-unlit) materials.</summary>
    public SceneGltfShadingModel ShadingModel { get; init; } = SceneGltfShadingModel.Pbr;

    /// <summary>Whether built-in shader definitions referenced by materials are copied into the snapshot.</summary>
    public bool IncludeBuiltInShaders { get; init; } = true;

    /// <summary>Handling policy for undeclared material properties.</summary>
    public SceneGltfUnknownPropertyPolicy UnknownPropertyPolicy { get; init; } =
        SceneGltfUnknownPropertyPolicy.Preserve;

    /// <summary>Handling policy for unmapped glTF extensions.</summary>
    public SceneGltfUnknownExtensionPolicy UnknownExtensionPolicy { get; init; } =
        SceneGltfUnknownExtensionPolicy.Report;

    /// <summary>Blend metadata used for glTF <c>BLEND</c> materials.</summary>
    public SceneGltfBlendMode BlendMode { get; init; } = SceneGltfBlendMode.Auto;

    /// <summary>Prefix applied to every imported asset name.</summary>
    public string AssetPrefix { get; init; } = "gltf/";

    /// <summary>Optional table used to intern asset names so snapshots stay serializable.</summary>
    public SceneNameTable? Names { get; init; }

    /// <summary>Shader definitions copied into the snapshot before built-in definitions.</summary>
    public IReadOnlyList<SceneShaderDefinition>? Shaders { get; init; }

    /// <summary>Render-pass definitions copied into the snapshot.</summary>
    public IReadOnlyList<SceneRenderPassDefinition>? RenderPasses { get; init; }
}

/// <summary>
/// Converted scene definitions for one glTF import: shaders, meshes, materials,
/// textures, samplers and render passes with no prefab or snapshot assembly.
/// </summary>
public sealed class SceneGltfConversion
{
    /// <summary>Creates a definition conversion result.</summary>
    public SceneGltfConversion(
        IReadOnlyList<SceneShaderDefinition> shaders,
        IReadOnlyList<SceneMeshDefinition> meshes,
        IReadOnlyList<SceneMaterialDefinition> materials,
        IReadOnlyList<SceneTextureDefinition> textures,
        IReadOnlyList<SceneSamplerDefinition> samplers,
        IReadOnlyList<SceneRenderPassDefinition> renderPasses,
        IReadOnlyList<SceneGltfDiagnostic> diagnostics)
        : this(
            shaders,
            meshes,
            materials,
            textures,
            samplers,
            renderPasses,
            [],
            [],
            diagnostics)
    {
    }

    /// <summary>Creates a definition conversion result with skinning and animation data.</summary>
    public SceneGltfConversion(
        IReadOnlyList<SceneShaderDefinition> shaders,
        IReadOnlyList<SceneMeshDefinition> meshes,
        IReadOnlyList<SceneMaterialDefinition> materials,
        IReadOnlyList<SceneTextureDefinition> textures,
        IReadOnlyList<SceneSamplerDefinition> samplers,
        IReadOnlyList<SceneRenderPassDefinition> renderPasses,
        IReadOnlyList<SceneSkinDefinition> skins,
        IReadOnlyList<SceneAnimationClipDefinition> animations,
        IReadOnlyList<SceneGltfDiagnostic> diagnostics)
    {
        ArgumentNullException.ThrowIfNull(shaders);
        ArgumentNullException.ThrowIfNull(meshes);
        ArgumentNullException.ThrowIfNull(materials);
        ArgumentNullException.ThrowIfNull(textures);
        ArgumentNullException.ThrowIfNull(samplers);
        ArgumentNullException.ThrowIfNull(renderPasses);
        ArgumentNullException.ThrowIfNull(skins);
        ArgumentNullException.ThrowIfNull(animations);
        ArgumentNullException.ThrowIfNull(diagnostics);

        Shaders = [.. shaders];
        Meshes = [.. meshes];
        Materials = [.. materials];
        Textures = [.. textures];
        Samplers = [.. samplers];
        RenderPasses = [.. renderPasses];
        Skins = [.. skins];
        Animations = [.. animations];
        Diagnostics = [.. diagnostics];
    }

    /// <summary>Shader definitions in load order.</summary>
    public IReadOnlyList<SceneShaderDefinition> Shaders { get; }

    /// <summary>Mesh definitions in source order.</summary>
    public IReadOnlyList<SceneMeshDefinition> Meshes { get; }

    /// <summary>Material definitions in source order.</summary>
    public IReadOnlyList<SceneMaterialDefinition> Materials { get; }

    /// <summary>Texture definitions in source order.</summary>
    public IReadOnlyList<SceneTextureDefinition> Textures { get; }

    /// <summary>Sampler definitions in first-use order.</summary>
    public IReadOnlyList<SceneSamplerDefinition> Samplers { get; }

    /// <summary>Render-pass definitions in declaration order.</summary>
    public IReadOnlyList<SceneRenderPassDefinition> RenderPasses { get; }

    /// <summary>Skin definitions in import order.</summary>
    public IReadOnlyList<SceneSkinDefinition> Skins { get; }

    /// <summary>Animation clips in import order.</summary>
    public IReadOnlyList<SceneAnimationClipDefinition> Animations { get; }

    /// <summary>Conversion diagnostics in texture, material and mesh order.</summary>
    public IReadOnlyList<SceneGltfDiagnostic> Diagnostics { get; }
}

/// <summary>Converted snapshot plus conversion diagnostics.</summary>
public sealed class SceneGltfImportResult
{
    /// <summary>Creates a conversion result.</summary>
    public SceneGltfImportResult(
        SceneSnapshot snapshot,
        IReadOnlyList<SceneGltfDiagnostic> diagnostics)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(diagnostics);

        Snapshot = snapshot;
        Diagnostics = [.. diagnostics];
    }

    /// <summary>Snapshot ready for <c>SceneSnapshotLoader</c>.</summary>
    public SceneSnapshot Snapshot { get; }

    /// <summary>Unsupported or lossy features encountered during conversion.</summary>
    public IReadOnlyList<SceneGltfDiagnostic> Diagnostics { get; }
}

/// <summary>
/// Converts <see cref="GltfImportResult"/> data into scene definitions and
/// snapshots: meshes, materials with built-in shader definitions, textures,
/// samplers and a prefab with transform/camera/light/mesh components. Skins and
/// animation clips are converted as definitions; <c>SceneAnimationImporter</c>
/// builds the runtime rig, clips and controller from them. Features without
/// native scene equivalents (morph playback, compressed or encoded textures)
/// are reported as diagnostics instead of failing the import.
/// </summary>
public static class SceneGltfAdapter
{
    private const string Transform3DComponent = "Transform3D";
    private const string CameraComponent = "Camera";
    private const string MeshRendererComponent = "MeshRenderer";
    private const string DirectionalLightComponent = "DirectionalLight";
    private const string PointLightComponent = "PointLight";
    private const string SpotLightComponent = "SpotLight";

    private const int BaseColorUsageBit = 1 << (int)GltfTextureUsage.BaseColor;
    private const int EmissiveUsageBit = 1 << (int)GltfTextureUsage.Emissive;

    /// <summary>Converts glTF assets into scene definitions without building a snapshot.</summary>
    /// <param name="result">glTF import result.</param>
    /// <param name="options">Conversion options; defaults apply when null.</param>
    /// <exception cref="SceneGltfException">The import result is malformed.</exception>
    public static SceneGltfConversion Convert(
        GltfImportResult result,
        SceneGltfImportOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        options = NormalizeOptions(options ?? new SceneGltfImportOptions());

        var diagnostics = new List<SceneGltfDiagnostic>();
        var builtInShaderIds = new List<string>();
        var customShaderIds = new List<SceneAssetId<ShaderAssetTag>>();

        ApplyUnknownExtensionPolicy(result, options, diagnostics);

        ImmutableArray<GltfMaterialAsset> sourceMaterials = result.Materials.IsDefault
            ? []
            : result.Materials;
        Dictionary<string, int> textureUsage = CollectTextureUsage(sourceMaterials);
        (List<SceneTextureDefinition> textures, List<SceneSamplerDefinition> samplers,
            Dictionary<string, SceneAssetId<SamplerAssetTag>> textureSamplers) =
            ConvertTextures(result.Textures, textureUsage, options, diagnostics);

        var textureIds = new HashSet<SceneAssetId<TextureAssetTag>>(textures.Count);
        for (int i = 0; i < textures.Count; i++)
        {
            textureIds.Add(textures[i].Id);
        }

        List<SceneMaterialDefinition> materials = ConvertMaterials(
            sourceMaterials,
            options,
            textureSamplers,
            textureIds,
            builtInShaderIds,
            customShaderIds,
            diagnostics);

        List<SceneMeshDefinition> meshes = ConvertMeshes(result.Meshes, options, diagnostics);
        List<SceneSkinDefinition> skins = ConvertSkins(result.Skins, options, diagnostics);
        List<SceneAnimationClipDefinition> animations = ConvertAnimations(result.Animations, options, diagnostics);
        List<SceneShaderDefinition> shaders = CollectShaders(
            options,
            builtInShaderIds,
            customShaderIds,
            diagnostics);

        return new SceneGltfConversion(
            shaders,
            meshes,
            materials,
            textures,
            samplers,
            options.RenderPasses ?? [],
            skins,
            animations,
            diagnostics);
    }

    /// <summary>Converts a glTF import result into a scene snapshot.</summary>
    /// <param name="result">glTF import result.</param>
    /// <param name="options">Conversion options; defaults apply when null.</param>
    /// <exception cref="SceneGltfException">The import result is malformed.</exception>
    public static SceneGltfImportResult Import(
        GltfImportResult result,
        SceneGltfImportOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        options = NormalizeOptions(options ?? new SceneGltfImportOptions());

        SceneGltfConversion conversion = Convert(result, options);
        var diagnostics = new List<SceneGltfDiagnostic>(conversion.Diagnostics);
        ScenePrefabDefinition prefab = ConvertPrefab(result, options, diagnostics);

        var snapshot = new SceneSnapshot(
            prefab,
            conversion.Shaders,
            conversion.Meshes,
            conversion.Materials,
            conversion.Textures,
            conversion.Samplers,
            conversion.RenderPasses);

        return new SceneGltfImportResult(snapshot, diagnostics);
    }

    private static readonly string[] KnownExtensions =
    [
        "EXT_meshopt_compression",
        "EXT_texture_avif",
        "EXT_texture_webp",
        "KHR_animation_pointer",
        "KHR_draco_mesh_compression",
        "KHR_lights_punctual",
        "KHR_materials_anisotropy",
        "KHR_materials_clearcoat",
        "KHR_materials_dispersion",
        "KHR_materials_emissive_strength",
        "KHR_materials_ior",
        "KHR_materials_iridescence",
        "KHR_materials_sheen",
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_unlit",
        "KHR_materials_variants",
        "KHR_materials_volume",
        "KHR_mesh_quantization",
        "KHR_texture_basisu",
        "KHR_texture_transform"
    ];

    private static void ApplyUnknownExtensionPolicy(
        GltfImportResult result,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        if (options.UnknownExtensionPolicy == SceneGltfUnknownExtensionPolicy.Ignore ||
            result.Document is null ||
            result.Document.ExtensionsUsed.IsDefaultOrEmpty)
        {
            return;
        }

        ImmutableArray<string> used = result.Document.ExtensionsUsed;
        var reported = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < used.Length; i++)
        {
            string name = used[i];
            if (string.IsNullOrEmpty(name) || IsKnownExtension(name) || !reported.Add(name))
            {
                continue;
            }

            if (options.UnknownExtensionPolicy == SceneGltfUnknownExtensionPolicy.Reject)
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.UnknownExtension,
                    $"glTF extension '{name}' is not mapped by the scene bridge.");
            }

            diagnostics.Add(new SceneGltfDiagnostic(
                SceneGltfErrorCodes.UnknownExtension,
                $"glTF extension '{name}' is not mapped by the scene bridge; it was ignored."));
        }
    }

    private static bool IsKnownExtension(string name)
    {
        for (int i = 0; i < KnownExtensions.Length; i++)
        {
            if (string.Equals(KnownExtensions[i], name, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static List<SceneSkinDefinition> ConvertSkins(
        ImmutableArray<GltfSkinAsset> source,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var skins = new List<SceneSkinDefinition>(source.IsDefault ? 0 : source.Length);
        if (source.IsDefault)
        {
            return skins;
        }

        var names = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < source.Length; i++)
        {
            GltfSkinAsset skin = source[i] ??
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF skin asset at index {i} is null.");

            RequireName(skin.Id, "Skin");
            if (!names.Add(skin.Id))
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF import result declares duplicate skin id '{skin.Id}'.");
            }

            skins.Add(new SceneSkinDefinition(
                MakeId<SkinAssetTag>(skin.Id, options),
                skin.JointNodeIds,
                skin.JointNodeIndices,
                skin.SkeletonNodeId,
                skin.InverseBindMatrices));
        }

        if (skins.Count > 0)
        {
            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.skins",
                $"{skins.Count} skin(s) converted to scene skin definitions; SceneAnimationImporter builds the runtime rig from them."));
        }

        return skins;
    }

    private static List<SceneAnimationClipDefinition> ConvertAnimations(
        ImmutableArray<GltfAnimationClipAsset> source,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var animations = new List<SceneAnimationClipDefinition>(
            source.IsDefault ? 0 : source.Length);
        if (source.IsDefault)
        {
            return animations;
        }

        var names = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < source.Length; i++)
        {
            GltfAnimationClipAsset clip = source[i] ??
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF animation asset at index {i} is null.");

            RequireName(clip.Id, "Animation");
            if (!names.Add(clip.Id))
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF import result declares duplicate animation id '{clip.Id}'.");
            }

            ImmutableArray<GltfAnimationTrackAsset> trackSource = clip.Tracks.IsDefault
                ? []
                : clip.Tracks;
            var tracks = new List<SceneAnimationTrackDefinition>(trackSource.Length);
            for (int t = 0; t < trackSource.Length; t++)
            {
                GltfAnimationTrackAsset track = trackSource[t];
                if (string.IsNullOrEmpty(track.TargetNodeId))
                {
                    diagnostics.Add(new SceneGltfDiagnostic(
                        "scene.gltf.animation-target",
                        $"Animation '{clip.Id}' track {track.ChannelIndex} has no target node and was skipped."));
                    continue;
                }

                tracks.Add(new SceneAnimationTrackDefinition(
                    track.TargetNodeId,
                    MapAnimationPath(track.Path),
                    MapAnimationInterpolation(track.Interpolation),
                    track.KeyframeCount,
                    track.ValueComponentCount,
                    track.SampleStride,
                    track.Times,
                    track.Values,
                    track.Pointer));
            }

            animations.Add(new SceneAnimationClipDefinition(
                MakeId<AnimationAssetTag>(clip.Id, options),
                clip.Duration,
                tracks,
                clip.Tags));
        }

        if (animations.Count > 0)
        {
            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.animations",
                $"{animations.Count} animation clip(s) converted to scene animation definitions; SceneAnimationImporter builds runtime clips from them."));
        }

        return animations;
    }

    private static SceneAnimationPath MapAnimationPath(GltfAnimationPath path) => path switch
    {
        GltfAnimationPath.Rotation => SceneAnimationPath.Rotation,
        GltfAnimationPath.Scale => SceneAnimationPath.Scale,
        GltfAnimationPath.Weights => SceneAnimationPath.Weights,
        GltfAnimationPath.Pointer => SceneAnimationPath.Pointer,
        _ => SceneAnimationPath.Translation
    };

    private static SceneAnimationInterpolation MapAnimationInterpolation(GltfInterpolation interpolation) =>
        interpolation switch
        {
            GltfInterpolation.Step => SceneAnimationInterpolation.Step,
            GltfInterpolation.CubicSpline => SceneAnimationInterpolation.CubicSpline,
            _ => SceneAnimationInterpolation.Linear
        };

    private static SceneGltfImportOptions NormalizeOptions(SceneGltfImportOptions options)
    {
        if (options.Names is not { } names)
        {
            return options;
        }

        return options with
        {
            PbrShaderId = InternDefaultShader(options.PbrShaderId, names, SceneGltfShaders.PbrShaderName),
            UnlitShaderId = options.UnlitShaderId is { } unlit
                ? InternDefaultShader(unlit, names, SceneGltfShaders.UnlitShaderName)
                : null,
            ToonShaderId = InternDefaultShader(options.ToonShaderId, names, SceneGltfShaders.ToonShaderName)
        };
    }

    private static Dictionary<string, int> CollectTextureUsage(ImmutableArray<GltfMaterialAsset> materials)
    {
        var usage = new Dictionary<string, int>(StringComparer.Ordinal);
        ReadOnlySpan<SceneGltfTextureUniformSpec> specs = SceneGltfShaderProperties.TextureUniformSpecs;

        for (int m = 0; m < materials.Length; m++)
        {
            GltfMaterialAsset material = materials[m];
            if (material?.Textures is null)
            {
                continue;
            }

            for (int i = 0; i < specs.Length; i++)
            {
                SceneGltfTextureUniformSpec spec = specs[i];
                if (!material.Textures.TryGetValue(spec.Usage, out GltfMaterialTextureBinding? binding) ||
                    binding is null ||
                    string.IsNullOrEmpty(binding.TextureKey))
                {
                    continue;
                }

                string key = binding.TextureKey;
                int bit = 1 << (int)spec.Usage;
                usage[key] = usage.TryGetValue(key, out int mask) ? mask | bit : bit;
            }
        }

        return usage;
    }

    private static (List<SceneTextureDefinition> Textures, List<SceneSamplerDefinition> Samplers,
        Dictionary<string, SceneAssetId<SamplerAssetTag>> TextureSamplers) ConvertTextures(
        ImmutableArray<GltfTextureAsset> source,
        Dictionary<string, int> usage,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var textures = new List<SceneTextureDefinition>(source.IsDefault ? 0 : source.Length);
        var samplers = new List<SceneSamplerDefinition>(textures.Capacity);
        var textureSamplers = new Dictionary<string, SceneAssetId<SamplerAssetTag>>(textures.Capacity, StringComparer.Ordinal);
        var samplerByState = new Dictionary<SceneSamplerKey, SceneAssetId<SamplerAssetTag>>(textures.Capacity);
        var textureNames = new HashSet<string>(StringComparer.Ordinal);

        if (source.IsDefault)
        {
            return (textures, samplers, textureSamplers);
        }

        for (int i = 0; i < source.Length; i++)
        {
            GltfTextureAsset texture = source[i] ??
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF texture asset at index {i} is null.");

            RequireName(texture.Id, "Texture");
            if (!textureNames.Add(texture.Id))
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF import result declares duplicate texture id '{texture.Id}'.");
            }

            if (texture.Payload is not GltfTranscodedTexturePayload payload)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-texture",
                    $"Texture '{texture.Id}' uses a payload without decoded RGBA8 levels; it was skipped."));
                continue;
            }

            if (payload.Format != GltfTextureFormat.R8G8B8A8_UNorm)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-texture",
                    $"Texture '{texture.Id}' uses format '{payload.Format}'; only RGBA8 is supported."));
                continue;
            }

            if (payload.Levels.IsDefaultOrEmpty)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-texture",
                    $"Texture '{texture.Id}' has no decoded mip levels; it was skipped."));
                continue;
            }

            if (payload.Bytes.IsEmpty)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-texture",
                    $"Texture '{texture.Id}' has no decoded bytes; it was skipped."));
                continue;
            }

            SceneSamplerKey samplerKey = new(
                MapMinFilter(texture.Sampler.MinFilter),
                MapMagFilter(texture.Sampler.MagFilter),
                MapWrap(texture.Sampler.WrapS),
                MapWrap(texture.Sampler.WrapT));

            if (!samplerByState.TryGetValue(samplerKey, out SceneAssetId<SamplerAssetTag> samplerId))
            {
                samplerId = MakeId<SamplerAssetTag>(texture.Id + "/sampler", options);
                samplerByState.Add(samplerKey, samplerId);
                samplers.Add(new SceneSamplerDefinition(
                    samplerId,
                    samplerKey.Min,
                    samplerKey.Mag,
                    samplerKey.WrapS,
                    samplerKey.WrapT,
                    SceneWrapMode.Repeat));
            }

            GltfTextureMipLevel level0 = payload.Levels[0];
            if (level0.Width <= 0 || level0.Height <= 0)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-texture",
                    $"Texture '{texture.Id}' declares non-positive dimensions; it was skipped."));
                continue;
            }

            SceneAssetId<TextureAssetTag> textureId = MakeId<TextureAssetTag>(texture.Id, options);
            SceneTextureFormat format = ResolveTextureFormat(texture, usage);
            textures.Add(new SceneTextureDefinition(
                textureId,
                new SceneTextureData(payload.Bytes),
                format,
                level0.Width,
                level0.Height,
                samplerId));
            textureSamplers.Add(texture.Id, samplerId);
        }

        return (textures, samplers, textureSamplers);
    }

    private static SceneTextureFormat ResolveTextureFormat(
        GltfTextureAsset texture,
        Dictionary<string, int> usage)
    {
        int mask = 0;
        if (usage.TryGetValue(texture.Id, out int materialMask))
        {
            mask |= materialMask;
        }

        ImmutableArray<GltfTextureUsage> hints = texture.UsageHints;
        if (!hints.IsDefaultOrEmpty)
        {
            for (int i = 0; i < hints.Length; i++)
            {
                mask |= 1 << (int)hints[i];
            }
        }

        return (mask & (BaseColorUsageBit | EmissiveUsageBit)) != 0
            ? SceneTextureFormat.Srgba8
            : SceneTextureFormat.Rgba8;
    }

    private static List<SceneMaterialDefinition> ConvertMaterials(
        ImmutableArray<GltfMaterialAsset> source,
        SceneGltfImportOptions options,
        Dictionary<string, SceneAssetId<SamplerAssetTag>> textureSamplers,
        HashSet<SceneAssetId<TextureAssetTag>> textureIds,
        List<string> builtInShaderIds,
        List<SceneAssetId<ShaderAssetTag>> customShaderIds,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var materials = new List<SceneMaterialDefinition>(source.IsDefault ? 0 : source.Length);
        var materialNames = new HashSet<string>(StringComparer.Ordinal);
        var seenShaderIds = new HashSet<string>(StringComparer.Ordinal);
        var seenCustomShaderIds = new HashSet<SceneAssetId<ShaderAssetTag>>();

        if (source.IsDefault)
        {
            return materials;
        }

        for (int i = 0; i < source.Length; i++)
        {
            GltfMaterialAsset material = source[i] ??
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF material asset at index {i} is null.");

            if (!materialNames.Add(material.Id))
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF import result declares duplicate material id '{material.Id}'.");
            }

            GltfMaterialAsset filtered = FilterMissingTextures(material, textureIds, options, diagnostics);
            SceneGltfMaterialConversion conversion =
                SceneGltfMaterialConverter.Convert(filtered, options, textureSamplers);

            diagnostics.AddRange(conversion.Diagnostics);
            materials.Add(conversion.Material);

            if (conversion.BuiltInShaderId is { } builtIn)
            {
                if (seenShaderIds.Add(builtIn))
                {
                    builtInShaderIds.Add(builtIn);
                }
            }
            else if (seenCustomShaderIds.Add(conversion.Material.ShaderId))
            {
                customShaderIds.Add(conversion.Material.ShaderId);
            }
        }

        return materials;
    }

    private static GltfMaterialAsset FilterMissingTextures(
        GltfMaterialAsset material,
        HashSet<SceneAssetId<TextureAssetTag>> textureIds,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        if (material.Textures is null || material.Textures.IsEmpty)
        {
            return material;
        }

        ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding>.Builder? filtered = null;

        ReadOnlySpan<SceneGltfTextureUniformSpec> specs = SceneGltfShaderProperties.TextureUniformSpecs;
        for (int i = 0; i < specs.Length; i++)
        {
            SceneGltfTextureUniformSpec spec = specs[i];
            if (!material.Textures.TryGetValue(spec.Usage, out GltfMaterialTextureBinding? binding) ||
                binding is null ||
                string.IsNullOrEmpty(binding.TextureKey))
            {
                continue;
            }

            SceneAssetId<TextureAssetTag> textureId = MakeId<TextureAssetTag>(binding.TextureKey, options);
            if (textureIds.Contains(textureId))
            {
                continue;
            }

            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.missing-texture",
                $"Material '{material.Id}' references texture '{binding.TextureKey}' for usage '{spec.Usage}' which was not converted."));
            filtered ??= material.Textures.ToBuilder();
            filtered.Remove(spec.Usage);
        }

        if (filtered is null)
        {
            return material;
        }

        return new GltfMaterialAsset
        {
            Id = material.Id,
            MaterialIndex = material.MaterialIndex,
            Definition = material.Definition,
            AlphaMode = material.AlphaMode,
            AlphaCutoff = material.AlphaCutoff,
            DoubleSided = material.DoubleSided,
            Unlit = material.Unlit,
            Textures = filtered.ToImmutable()
        };
    }

    private static List<SceneMeshDefinition> ConvertMeshes(
        ImmutableArray<GltfMeshAsset> source,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var meshes = new List<SceneMeshDefinition>(source.IsDefault ? 0 : source.Length);
        var meshNames = new HashSet<string>(StringComparer.Ordinal);

        if (source.IsDefault)
        {
            return meshes;
        }

        for (int i = 0; i < source.Length; i++)
        {
            GltfMeshAsset mesh = source[i] ??
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF mesh asset at index {i} is null.");

            GltfMeshDefinition definition = mesh.Definition;

            RequireName(definition.Id, "Mesh");
            if (!meshNames.Add(definition.Id))
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"glTF import result declares duplicate mesh id '{definition.Id}'.");
            }

            if (definition.Vertices.IsEmpty)
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"Mesh '{definition.Id}' has no vertex data.");
            }

            if (definition.Attributes.IsDefaultOrEmpty)
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"Mesh '{definition.Id}' has no vertex attributes.");
            }

            if (!definition.CustomAttributes.IsDefaultOrEmpty)
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.custom-attributes",
                    $"Mesh '{definition.Id}' declares {definition.CustomAttributes.Length} custom attributes; only standard semantics are imported."));
            }

            var morphTargets = new List<SceneMorphTargetDefinition>(
                definition.MorphTargets.IsDefault ? 0 : definition.MorphTargets.Length);
            if (!definition.MorphTargets.IsDefaultOrEmpty)
            {
                for (int targetIndex = 0; targetIndex < definition.MorphTargets.Length; targetIndex++)
                {
                    GltfMorphTargetDefinition target = definition.MorphTargets[targetIndex];
                    morphTargets.Add(new SceneMorphTargetDefinition(
                        MapMorphSemantic(target.Semantic),
                        target.DeltaBuffer,
                        target.Stride,
                        target.ComponentCount));
                }
            }

            var attributes = new List<SceneVertexAttribute>(definition.Attributes.Length);
            for (int attributeIndex = 0; attributeIndex < definition.Attributes.Length; attributeIndex++)
            {
                GltfVertexAttribute attribute = definition.Attributes[attributeIndex];
                if (!TryMapSemantic(attribute.Semantic, out SceneMeshSemantic semantic))
                {
                    diagnostics.Add(new SceneGltfDiagnostic(
                        "scene.gltf.unsupported-attribute",
                        $"Mesh '{definition.Id}' attribute '{attribute.Semantic}' has no scene semantic and was skipped."));
                    continue;
                }

                attributes.Add(new SceneVertexAttribute(
                    semantic,
                    attribute.ComponentCount,
                    attribute.Offset,
                    attribute.Stride,
                    attribute.Normalized,
                    attribute.Integer,
                    ComponentByteSize(attribute.ComponentType)));
            }

            if (attributes.Count == 0)
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"Mesh '{definition.Id}' has no attributes with scene semantics.");
            }

            SceneAssetId<MeshAssetTag> id = MakeId<MeshAssetTag>(definition.Id, options);

            SceneMeshDefinition meshDefinition;
            try
            {
                meshDefinition = new SceneMeshDefinition(
                    id,
                    definition.Vertices,
                    attributes,
                    definition.VertexCount,
                    definition.Indices,
                    definition.Index16Bit ? SceneIndexFormat.UInt16 : SceneIndexFormat.UInt32,
                    definition.IndexCount,
                    MapTopology(definition.Topology),
                    bounds: null,
                    morphTargets);
            }
            catch (SceneAssetException exception)
            {
                throw new SceneGltfException(
                    SceneGltfErrorCodes.Invalid,
                    $"Mesh '{definition.Id}' is not a valid scene mesh: {exception.Message}",
                    exception);
            }

            meshes.Add(WithComputedBounds(meshDefinition));
        }

        return meshes;
    }

    private static List<SceneShaderDefinition> CollectShaders(
        SceneGltfImportOptions options,
        List<string> builtInShaderIds,
        List<SceneAssetId<ShaderAssetTag>> customShaderIds,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var shaders = new List<SceneShaderDefinition>(
            (options.Shaders?.Count ?? 0) + builtInShaderIds.Count);
        var shaderIds = new HashSet<SceneAssetId<ShaderAssetTag>>();

        if (options.Shaders is { } supplied)
        {
            for (int i = 0; i < supplied.Count; i++)
            {
                SceneShaderDefinition shader = supplied[i] ??
                    throw new SceneGltfException(
                        SceneGltfErrorCodes.Invalid,
                        $"Shader definition at index {i} is null.");
                shaders.Add(shader);
                shaderIds.Add(shader.Id);
            }
        }

        if (options.IncludeBuiltInShaders)
        {
            for (int i = 0; i < builtInShaderIds.Count; i++)
            {
                if (!SceneGltfShaders.TryCreate(
                        builtInShaderIds[i],
                        options.Names,
                        out SceneShaderDefinition? shader))
                {
                    continue;
                }

                if (shaderIds.Add(shader.Id))
                {
                    shaders.Add(shader);
                }
            }
        }

        for (int i = 0; i < customShaderIds.Count; i++)
        {
            SceneAssetId<ShaderAssetTag> shaderId = customShaderIds[i];
            if (!shaderIds.Contains(shaderId))
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.missing-shader",
                    $"Material shader '{shaderId}' has no definition; supply it through SceneGltfImportOptions.Shaders."));
            }
        }

        return shaders;
    }

    private static ScenePrefabDefinition ConvertPrefab(
        GltfImportResult result,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        GltfPrefabAsset? prefabAsset = FindDefaultPrefab(result);
        if (prefabAsset is null || prefabAsset.Definition is null)
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                "The glTF import result contains no prefab assets.");
        }

        ImmutableArray<GltfActorSnapshot> sourceActors = prefabAsset.Definition.Actors;
        if (sourceActors.IsDefault)
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"Prefab '{prefabAsset.Id}' has no actor list.");
        }

        var actors = new List<SceneActorSnapshot>(sourceActors.Length);

        for (int i = 0; i < sourceActors.Length; i++)
        {
            GltfActorSnapshot actor = sourceActors[i];
            actors.Add(new SceneActorSnapshot(
                actor.NodeId,
                actor.Name,
                (ushort)Math.Clamp(actor.Layer, 0, ushort.MaxValue),
                actor.Tag,
                actor.Active,
                actor.Persistent,
                actor.Pooled,
                ConvertComponents(actor, options, diagnostics),
                actor.ParentNodeId));
        }

        return new ScenePrefabDefinition(prefabAsset.Id, actors);
    }

    private static GltfPrefabAsset? FindDefaultPrefab(GltfImportResult result)
    {
        if (result.Prefabs.IsDefaultOrEmpty)
        {
            return null;
        }

        int defaultScene = result.Document?.DefaultScene ?? 0;
        foreach (GltfPrefabAsset prefab in result.Prefabs)
        {
            if (prefab.SceneIndex == defaultScene)
            {
                return prefab;
            }
        }

        return result.Prefabs[0];
    }

    private static List<SceneComponentSnapshot> ConvertComponents(
        GltfActorSnapshot actor,
        SceneGltfImportOptions options,
        List<SceneGltfDiagnostic> diagnostics)
    {
        ImmutableArray<GltfComponentSnapshot> sourceComponents = actor.Components;
        if (sourceComponents.IsDefault)
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"Node '{actor.NodeId}' has no component list.");
        }

        var components = new List<SceneComponentSnapshot>(sourceComponents.Length);

        for (int componentIndex = 0; componentIndex < sourceComponents.Length; componentIndex++)
        {
            GltfComponentSnapshot component = sourceComponents[componentIndex];
            switch (component)
            {
                case GltfTransformComponent transform:
                    components.Add(new SceneComponentSnapshot(
                        Transform3DComponent,
                        WriteJson(writer =>
                        {
                            WriteVec3(writer, "position", transform.Position);
                            WriteQuat(writer, "rotation", transform.Rotation);
                            WriteVec3(writer, "scale", transform.Scale);
                        })));
                    break;

                case GltfCameraComponent camera:
                    components.Add(new SceneComponentSnapshot(
                        CameraComponent,
                        WriteJson(writer =>
                        {
                            writer.WriteBoolean("primary", camera.Primary);
                            writer.WriteBoolean("enabled", true);
                            writer.WriteBoolean("orthographic", camera.Orthographic);
                            writer.WriteString("fovAxis", "vertical");
                            writer.WriteNumber("fieldOfView", camera.FieldOfView);
                            writer.WriteNumber("orthographicSize", camera.OrthographicSize);
                            writer.WriteNumber("near", camera.Near);
                            writer.WriteNumber("far", camera.Far);
                            writer.WriteNumber("clearMask", (int)(SceneClearMask.Color | SceneClearMask.Depth));
                            writer.WriteStartArray("clearColor");
                            writer.WriteNumberValue(0.08f);
                            writer.WriteNumberValue(0.09f);
                            writer.WriteNumberValue(0.11f);
                            writer.WriteNumberValue(1.0f);
                            writer.WriteEndArray();
                            writer.WriteNumber("clearDepth", 1.0f);
                        })));
                    break;

                case GltfDirectionalLightComponent light:
                    components.Add(new SceneComponentSnapshot(
                        DirectionalLightComponent,
                        WriteJson(writer =>
                        {
                            WriteVec3(writer, "color", light.Color);
                            WriteVec3(writer, "ambient", Vec3.Zero);
                            writer.WriteNumber("intensity", light.Intensity);
                            writer.WriteBoolean("primary", light.Primary);
                            writer.WriteBoolean("enabled", true);
                        })));
                    break;

                case GltfPointLightComponent light:
                    components.Add(new SceneComponentSnapshot(
                        PointLightComponent,
                        WriteJson(writer =>
                        {
                            WriteVec3(writer, "color", light.Color);
                            writer.WriteNumber("intensity", light.Intensity);
                            writer.WriteNumber("range", light.Range);
                            writer.WriteNumber("attenuation", 2.0f);
                            writer.WriteBoolean("enabled", true);
                        })));
                    break;

                case GltfSpotLightComponent light:
                    components.Add(new SceneComponentSnapshot(
                        SpotLightComponent,
                        WriteJson(writer =>
                        {
                            WriteVec3(writer, "color", light.Color);
                            writer.WriteNumber("intensity", light.Intensity);
                            writer.WriteNumber("range", light.Range);
                            writer.WriteNumber("attenuation", 2.0f);
                            writer.WriteNumber("innerConeAngle", light.InnerConeAngle);
                            writer.WriteNumber("outerConeAngle", light.OuterConeAngle);
                            writer.WriteBoolean("enabled", true);
                        })));
                    break;

                case GltfMeshRendererComponent renderer:
                    if (string.IsNullOrEmpty(renderer.MeshId))
                    {
                        diagnostics.Add(new SceneGltfDiagnostic(
                            "scene.gltf.mesh-renderer",
                            $"Node '{actor.NodeId}' has a mesh renderer without a mesh id."));
                        break;
                    }

                    if (!string.IsNullOrEmpty(renderer.SkinId))
                    {
                        diagnostics.Add(new SceneGltfDiagnostic(
                            "scene.gltf.skinning",
                            $"Node '{actor.NodeId}' references skin '{renderer.SkinId}'; the skin is converted and can be bound through SceneAnimationImporter."));
                    }

                    if (renderer.MorphTargetCount > 0)
                    {
                        diagnostics.Add(new SceneGltfDiagnostic(
                            "scene.gltf.morph-targets",
                            $"Node '{actor.NodeId}' has {renderer.MorphTargetCount} morph targets; delta streams are converted but runtime morph playback is not wired."));
                    }

                    components.Add(new SceneComponentSnapshot(
                        MeshRendererComponent,
                        WriteJson(writer =>
                        {
                            writer.WriteString("mesh", Prefixed(renderer.MeshId, options));
                            if (!string.IsNullOrEmpty(renderer.MaterialId))
                            {
                                writer.WriteString("material", Prefixed(renderer.MaterialId, options));
                            }

                            if (!string.IsNullOrEmpty(renderer.SkinId))
                            {
                                writer.WriteString("skin", Prefixed(renderer.SkinId, options));
                            }

                            if (!renderer.MorphWeights.IsDefaultOrEmpty)
                            {
                                writer.WriteStartArray("morphWeights");
                                for (int weightIndex = 0; weightIndex < renderer.MorphWeights.Length; weightIndex++)
                                {
                                    writer.WriteNumberValue(renderer.MorphWeights[weightIndex]);
                                }

                                writer.WriteEndArray();
                            }

                            writer.WriteString("pass", renderer.PassId);
                            writer.WriteBoolean("visible", renderer.Visible);
                            writer.WriteBoolean("receiveLighting", renderer.ReceiveLighting);
                            writer.WriteBoolean("transparent", false);
                            writer.WriteNumber("renderOrder", renderer.RenderOrder);
                        })));
                    break;

                case GltfAnimatorComponent:
                    diagnostics.Add(new SceneGltfDiagnostic(
                        "scene.gltf.animator",
                        $"Node '{actor.NodeId}' declares an animator; clips are converted and can be bound through SceneAnimationImporter."));
                    break;
            }
        }

        return components;
    }

    private static SceneMeshDefinition WithComputedBounds(SceneMeshDefinition mesh)
    {
        if (!SceneMeshBounds.TryCompute(mesh, out BoundingSphere3 bounds))
        {
            return mesh;
        }

        return new SceneMeshDefinition(
            mesh.Id,
            mesh.Vertices,
            mesh.Attributes,
            mesh.VertexCount,
            mesh.Indices,
            mesh.IndexFormat,
            mesh.IndexCount,
            mesh.Topology,
            bounds,
            mesh.MorphTargets);
    }

    private static void RequireName(string? name, string kind)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"glTF {kind} assets require a non-empty id.");
        }
    }

    private static SceneMorphTargetSemantic MapMorphSemantic(GltfMorphTargetSemantic semantic) =>
        semantic switch
        {
            GltfMorphTargetSemantic.Normal => SceneMorphTargetSemantic.Normal,
            GltfMorphTargetSemantic.Tangent => SceneMorphTargetSemantic.Tangent,
            _ => SceneMorphTargetSemantic.Position
        };

    private static byte ComponentByteSize(int componentType) => componentType switch
    {
        5120 or 5121 => 1,
        5122 or 5123 => 2,
        5125 or 5126 => 4,
        5130 => 8,
        _ => 4,
    };

    private static bool TryMapSemantic(GltfMeshSemantic semantic, out SceneMeshSemantic mapped)
    {
        switch (semantic)
        {
            case GltfMeshSemantic.Position:
                mapped = SceneMeshSemantic.Position;
                return true;
            case GltfMeshSemantic.Normal:
                mapped = SceneMeshSemantic.Normal;
                return true;
            case GltfMeshSemantic.Uv0:
                mapped = SceneMeshSemantic.Uv0;
                return true;
            case GltfMeshSemantic.Uv1:
                mapped = SceneMeshSemantic.Uv1;
                return true;
            case GltfMeshSemantic.Tangent:
                mapped = SceneMeshSemantic.Tangent;
                return true;
            case GltfMeshSemantic.Color0:
                mapped = SceneMeshSemantic.Color0;
                return true;
            case GltfMeshSemantic.Joints0:
                mapped = SceneMeshSemantic.Joints0;
                return true;
            case GltfMeshSemantic.Weights0:
                mapped = SceneMeshSemantic.Weights0;
                return true;
            case GltfMeshSemantic.Joints1:
                mapped = SceneMeshSemantic.Joints1;
                return true;
            case GltfMeshSemantic.Weights1:
                mapped = SceneMeshSemantic.Weights1;
                return true;
            default:
                mapped = default;
                return false;
        }
    }

    private static SceneMeshTopology MapTopology(GltfMeshTopology topology) => topology switch
    {
        GltfMeshTopology.Lines => SceneMeshTopology.Lines,
        GltfMeshTopology.Points => SceneMeshTopology.Points,
        _ => SceneMeshTopology.Triangles
    };

    private static SceneFilterMode MapMinFilter(int value) => value switch
    {
        9728 => SceneFilterMode.Nearest,
        9729 => SceneFilterMode.Linear,
        9984 => SceneFilterMode.NearestMipmapNearest,
        9985 => SceneFilterMode.LinearMipmapNearest,
        9986 => SceneFilterMode.NearestMipmapLinear,
        _ => SceneFilterMode.LinearMipmapLinear
    };

    private static SceneFilterMode MapMagFilter(int value) => value switch
    {
        9728 => SceneFilterMode.Nearest,
        _ => SceneFilterMode.Linear
    };

    private static SceneWrapMode MapWrap(int value) => value switch
    {
        33071 => SceneWrapMode.ClampToEdge,
        33648 => SceneWrapMode.MirroredRepeat,
        _ => SceneWrapMode.Repeat
    };

    private static SceneAssetId<ShaderAssetTag> InternDefaultShader(
        SceneAssetId<ShaderAssetTag> id,
        SceneNameTable names,
        string defaultName)
    {
        // Custom shader ids must be interned by the caller; the built-in
        // defaults are interned here so snapshots stay serializable.
        return id == SceneAssetId<ShaderAssetTag>.FromName(defaultName)
            ? SceneAssetId<ShaderAssetTag>.FromSymbol(names.Intern(defaultName))
            : id;
    }

    private static SceneAssetId<TTag> MakeId<TTag>(string name, SceneGltfImportOptions options)
        where TTag : struct
    {
        string prefixed = Prefixed(name, options);
        return options.Names is { } names
            ? SceneAssetId<TTag>.FromSymbol(names.Intern(prefixed))
            : SceneAssetId<TTag>.FromName(prefixed);
    }

    private static string Prefixed(string name, SceneGltfImportOptions options) =>
        options.AssetPrefix + name;

    private static JsonElement WriteJson(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            write(writer);
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static void WriteVec3(Utf8JsonWriter writer, string name, in Vec3 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteEndArray();
    }

    private static void WriteQuat(Utf8JsonWriter writer, string name, in Quat value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteNumberValue(value.W);
        writer.WriteEndArray();
    }

    private readonly record struct SceneSamplerKey(
        SceneFilterMode Min,
        SceneFilterMode Mag,
        SceneWrapMode WrapS,
        SceneWrapMode WrapT);
}
