namespace Axrone.Scene.Gltf;

/// <summary>Shading model applied to lit glTF materials.</summary>
public enum SceneGltfShadingModel
{
    /// <summary>Metallic/roughness PBR.</summary>
    Pbr = 0,

    /// <summary>Stylized toon response.</summary>
    Toon = 1
}

/// <summary>Handling policy for material properties the importer does not declare.</summary>
public enum SceneGltfUnknownPropertyPolicy
{
    /// <summary>Keep the property as a material uniform and report a diagnostic.</summary>
    Preserve = 0,

    /// <summary>Drop the property and report a diagnostic.</summary>
    Ignore = 1,

    /// <summary>Fail the import.</summary>
    Reject = 2
}

/// <summary>Converted material plus the built-in shader that backs it.</summary>
public sealed class SceneGltfMaterialConversion
{
    /// <summary>Creates a material conversion result.</summary>
    /// <param name="material">Converted scene material.</param>
    /// <param name="builtInShaderId">Built-in shader id, or null for custom shaders.</param>
    /// <param name="diagnostics">Conversion diagnostics.</param>
    public SceneGltfMaterialConversion(
        SceneMaterialDefinition material,
        string? builtInShaderId,
        IReadOnlyList<SceneGltfDiagnostic> diagnostics)
    {
        ArgumentNullException.ThrowIfNull(material);
        ArgumentNullException.ThrowIfNull(diagnostics);

        Material = material;
        BuiltInShaderId = builtInShaderId;
        Diagnostics = [.. diagnostics];
    }

    /// <summary>Converted scene material.</summary>
    public SceneMaterialDefinition Material { get; }

    /// <summary>Built-in shader id, including blend and double-sided suffixes, or null.</summary>
    public string? BuiltInShaderId { get; }

    /// <summary>Conversion diagnostics.</summary>
    public IReadOnlyList<SceneGltfDiagnostic> Diagnostics { get; }

    /// <summary>Creates the built-in shader definition referenced by this material.</summary>
    /// <param name="names">Optional name table used to intern the shader id.</param>
    /// <returns>The shader definition, or null when the material uses a custom shader.</returns>
    public SceneShaderDefinition? CreateShaderDefinition(SceneNameTable? names = null) =>
        BuiltInShaderId is { } id && SceneGltfShaders.TryCreate(id, names, out SceneShaderDefinition? shader)
            ? shader
            : null;
}

/// <summary>
/// Maps a glTF material onto the scene material contract: typed shader
/// properties with deterministic ordering, surface features, albedo/normal/
/// occlusion parameters and the alpha-mode render state passes.
/// </summary>
public static class SceneGltfMaterialConverter
{
    /// <summary>Converts one glTF material.</summary>
    /// <param name="material">glTF material asset.</param>
    /// <param name="options">Conversion options; defaults apply when null.</param>
    /// <param name="textureSamplers">
    /// Optional texture-to-sampler table produced by the texture conversion.
    /// When null, sampler ids are derived from the texture key.
    /// </param>
    /// <exception cref="SceneGltfException">The material is malformed or violates the property policy.</exception>
    public static SceneGltfMaterialConversion Convert(
        GltfMaterialAsset material,
        SceneGltfImportOptions? options = null,
        IReadOnlyDictionary<string, SceneAssetId<SamplerAssetTag>>? textureSamplers = null)
    {
        ArgumentNullException.ThrowIfNull(material);
        options ??= new SceneGltfImportOptions();
        Validate(material);

        var diagnostics = new List<SceneGltfDiagnostic>();
        var uniforms = CollectUniforms(material, diagnostics);

        SceneMaterialAlphaMode alphaMode = MapAlphaMode(material.AlphaMode);
        SceneMaterialShadingModel shadingModel = ResolveShadingModel(material, options);

        InjectTexturePropertyDefaults(material, uniforms, diagnostics);
        InjectMaterialState(material, uniforms, diagnostics);
        ApplyUnknownPropertyPolicy(material, options, uniforms, diagnostics);

        SceneMaterialFeatures features = CollectFeatures(material, uniforms, shadingModel, alphaMode);
        SceneMaterialSurface surface = BuildSurface(
            material,
            uniforms,
            options,
            textureSamplers,
            shadingModel,
            alphaMode,
            features,
            diagnostics);

        SceneMaterialPass[] passes = BuildPasses(alphaMode, material.DoubleSided, options.BlendMode);

        SceneAssetId<ShaderAssetTag>? declaredShaderId = ResolveDeclaredCustomShader(material, options);
        SceneAssetId<ShaderAssetTag> baseShaderId = material.Unlit
            ? options.UnlitShaderId ?? declaredShaderId ?? MakeShaderId(SceneGltfShaders.UnlitShaderName, options)
            : shadingModel == SceneMaterialShadingModel.Toon
                ? options.ToonShaderId
                : declaredShaderId ?? options.PbrShaderId;

        string? builtInBase = ResolveBuiltInBaseName(baseShaderId);
        string? builtInShaderId = builtInBase is null
            ? null
            : SceneGltfShaders.ResolveVariantId(
                builtInBase,
                alphaMode == SceneMaterialAlphaMode.Blend,
                material.DoubleSided);

        SceneAssetId<ShaderAssetTag> shaderId = builtInShaderId is null
            ? baseShaderId
            : MakeShaderId(builtInShaderId, options);

        var definition = new SceneMaterialDefinition(
            MakeId<MaterialAssetTag>(material.Id, options),
            shaderId,
            surface,
            passes,
            uniforms);

        return new SceneGltfMaterialConversion(definition, builtInShaderId, diagnostics);
    }

    private static void Validate(GltfMaterialAsset material)
    {
        if (string.IsNullOrWhiteSpace(material.Id))
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                "glTF materials require a non-empty id.");
        }

        if (material.Definition is null ||
            material.Definition.FloatUniforms is null ||
            material.Definition.ScalarUniforms is null ||
            material.Definition.IntUniforms is null)
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"Material '{material.Id}' has no definition or uniform tables.");
        }

        if (material.Textures is null)
        {
            throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"Material '{material.Id}' has no texture table.");
        }
    }

    private static SceneMaterialShadingModel ResolveShadingModel(
        GltfMaterialAsset material,
        SceneGltfImportOptions options) =>
        material.Unlit
            ? SceneMaterialShadingModel.Unlit
            : options.ShadingModel == SceneGltfShadingModel.Toon
                ? SceneMaterialShadingModel.Toon
                : SceneMaterialShadingModel.Pbr;

    private static SortedDictionary<string, SceneUniformValue> CollectUniforms(
        GltfMaterialAsset material,
        List<SceneGltfDiagnostic> diagnostics)
    {
        var uniforms = new SortedDictionary<string, SceneUniformValue>(StringComparer.Ordinal);

        foreach (KeyValuePair<string, int> pair in material.Definition.IntUniforms)
        {
            uniforms[pair.Key] = SceneUniformValue.FromInt(pair.Value);
        }

        foreach (KeyValuePair<string, float> pair in material.Definition.ScalarUniforms)
        {
            if (!float.IsFinite(pair.Value))
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.non-finite-uniform",
                    $"Material '{material.Id}' scalar uniform '{pair.Key}' is not finite and was skipped."));
                continue;
            }

            uniforms[pair.Key] = SceneUniformValue.FromFloat(pair.Value);
        }

        foreach (KeyValuePair<string, float[]> pair in material.Definition.FloatUniforms)
        {
            float[] values = pair.Value;
            if (values is null || !IsFinite(values))
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.non-finite-uniform",
                    $"Material '{material.Id}' uniform '{pair.Key}' contains non-finite components and was skipped."));
                continue;
            }

            SceneUniformValue? uniform = values.Length switch
            {
                2 => SceneUniformValue.FromVec2(new Vec2(values[0], values[1])),
                3 => SceneUniformValue.FromVec3(new Vec3(values[0], values[1], values[2])),
                4 => SceneUniformValue.FromVec4(new Vec4(values[0], values[1], values[2], values[3])),
                _ => null
            };

            if (uniform is { } value)
            {
                uniforms[pair.Key] = value;
            }
            else
            {
                diagnostics.Add(new SceneGltfDiagnostic(
                    "scene.gltf.unsupported-uniform",
                    $"Material '{material.Id}' uniform '{pair.Key}' has {values.Length} components and was skipped."));
            }
        }

        return uniforms;
    }

    private static void InjectTexturePropertyDefaults(
        GltfMaterialAsset material,
        SortedDictionary<string, SceneUniformValue> uniforms,
        List<SceneGltfDiagnostic> diagnostics)
    {
        ReadOnlySpan<SceneGltfTextureUniformSpec> specs = SceneGltfShaderProperties.TextureUniformSpecs;
        for (int i = 0; i < specs.Length; i++)
        {
            SceneGltfTextureUniformSpec spec = specs[i];
            bool bound = material.Textures.TryGetValue(spec.Usage, out GltfMaterialTextureBinding? binding) &&
                binding is not null &&
                !string.IsNullOrEmpty(binding.TextureKey);

            Vec4 st = new(1.0f, 1.0f, 0.0f, 0.0f);
            float rotation = 0.0f;
            int texCoord = -1;

            if (bound && binding is not null)
            {
                GltfTextureTransform transform = binding.Transform;
                if (IsFinite(transform.Scale.X) && IsFinite(transform.Scale.Y) &&
                    IsFinite(transform.Offset.X) && IsFinite(transform.Offset.Y))
                {
                    st = new Vec4(transform.Scale.X, transform.Scale.Y, transform.Offset.X, transform.Offset.Y);
                }
                else
                {
                    diagnostics.Add(new SceneGltfDiagnostic(
                        "scene.gltf.non-finite-uniform",
                        $"Material '{material.Id}' texture '{spec.UniformName}' transform is not finite; identity transform applied."));
                }

                rotation = IsFinite(transform.Rotation) ? transform.Rotation : 0.0f;
                texCoord = transform.TexCoord > 0 ? transform.TexCoord : binding.TexCoord;
            }

            uniforms.TryAdd(spec.UniformName + "_ST", SceneUniformValue.FromVec4(st));
            uniforms.TryAdd(spec.UniformName + "_Rotation", SceneUniformValue.FromFloat(rotation));
            uniforms.TryAdd(spec.UniformName + "_TexCoord", SceneUniformValue.FromInt(texCoord));

            if (spec.HasScale)
            {
                float scale = bound && binding is not null && IsFinite(binding.Scale) ? binding.Scale : 1.0f;
                uniforms.TryAdd(spec.UniformName + "_Scale", SceneUniformValue.FromFloat(scale));
            }

            if (spec.HasStrength)
            {
                float strength = bound && binding is not null && IsFinite(binding.Strength)
                    ? Math.Clamp(binding.Strength, 0.0f, 1.0f)
                    : 1.0f;
                uniforms.TryAdd(spec.UniformName + "_Strength", SceneUniformValue.FromFloat(strength));
            }
        }
    }

    private static void InjectMaterialState(
        GltfMaterialAsset material,
        SortedDictionary<string, SceneUniformValue> uniforms,
        List<SceneGltfDiagnostic> diagnostics)
    {
        uniforms["_AlphaMode"] = SceneUniformValue.FromInt((int)MapAlphaMode(material.AlphaMode));
        uniforms["_DoubleSided"] = SceneUniformValue.FromInt(material.DoubleSided ? 1 : 0);

        float cutoff = material.AlphaCutoff;
        if (!IsFinite(cutoff) || cutoff is < 0.0f or > 1.0f)
        {
            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.invalid-alpha-cutoff",
                $"Material '{material.Id}' alpha cutoff {cutoff.ToString(CultureInfo.InvariantCulture)} is outside zero to one; it was clamped."));
            cutoff = IsFinite(cutoff) ? Math.Clamp(cutoff, 0.0f, 1.0f) : 0.5f;
        }

        uniforms["_AlphaCutoff"] = SceneUniformValue.FromFloat(cutoff);
    }

    private static void ApplyUnknownPropertyPolicy(
        GltfMaterialAsset material,
        SceneGltfImportOptions options,
        SortedDictionary<string, SceneUniformValue> uniforms,
        List<SceneGltfDiagnostic> diagnostics)
    {
        List<string>? unknown = null;
        foreach (string name in uniforms.Keys)
        {
            if (!SceneGltfShaderProperties.IsKnownMaterialProperty(name))
            {
                (unknown ??= []).Add(name);
            }
        }

        if (unknown is null)
        {
            return;
        }

        for (int i = 0; i < unknown.Count; i++)
        {
            string name = unknown[i];
            switch (options.UnknownPropertyPolicy)
            {
                case SceneGltfUnknownPropertyPolicy.Reject:
                    throw new SceneGltfException(
                        SceneGltfErrorCodes.UnknownProperty,
                        $"Material '{material.Id}' declares unknown property '{name}'.");
                case SceneGltfUnknownPropertyPolicy.Ignore:
                    uniforms.Remove(name);
                    diagnostics.Add(new SceneGltfDiagnostic(
                        SceneGltfErrorCodes.UnknownProperty,
                        $"Material '{material.Id}' property '{name}' is not declared by the glTF shader catalog and was dropped."));
                    break;
                default:
                    diagnostics.Add(new SceneGltfDiagnostic(
                        SceneGltfErrorCodes.UnknownProperty,
                        $"Material '{material.Id}' property '{name}' is not declared by the glTF shader catalog; it was preserved as a uniform."));
                    break;
            }
        }
    }

    private static SceneMaterialFeatures CollectFeatures(
        GltfMaterialAsset material,
        SortedDictionary<string, SceneUniformValue> uniforms,
        SceneMaterialShadingModel shadingModel,
        SceneMaterialAlphaMode alphaMode)
    {
        SceneMaterialFeatures features = SceneMaterialFeatures.None;

        if (material.DoubleSided)
        {
            features |= SceneMaterialFeatures.TwoSided;
        }

        if (alphaMode == SceneMaterialAlphaMode.Mask)
        {
            features |= SceneMaterialFeatures.AlphaTest;
        }

        if (HasBinding(material, GltfTextureUsage.BaseColor))
        {
            features |= SceneMaterialFeatures.AlbedoMap;
        }

        if (UsesSecondUv(material))
        {
            features |= SceneMaterialFeatures.SecondUv;
        }

        if (shadingModel == SceneMaterialShadingModel.Unlit)
        {
            return features;
        }

        if (HasBinding(material, GltfTextureUsage.Emissive))
        {
            features |= SceneMaterialFeatures.EmissiveMap;
        }

        if (shadingModel == SceneMaterialShadingModel.Toon)
        {
            return features;
        }

        if (HasBinding(material, GltfTextureUsage.Normal))
        {
            features |= SceneMaterialFeatures.NormalMap;
        }

        if (HasBinding(material, GltfTextureUsage.MetallicRoughness))
        {
            features |= SceneMaterialFeatures.PbrMap;
            features |= SceneMaterialFeatures.MetallicRoughnessMap;
        }

        if (HasBinding(material, GltfTextureUsage.Occlusion))
        {
            features |= SceneMaterialFeatures.OcclusionMap;
        }

        bool hasClearcoatMap = HasBinding(material, GltfTextureUsage.Clearcoat);
        bool hasClearcoatRoughnessMap = HasBinding(material, GltfTextureUsage.ClearcoatRoughness);
        bool hasClearcoatNormalMap = HasBinding(material, GltfTextureUsage.ClearcoatNormal);

        if (hasClearcoatMap)
        {
            features |= SceneMaterialFeatures.ClearcoatMap;
        }

        if (hasClearcoatRoughnessMap)
        {
            features |= SceneMaterialFeatures.ClearcoatRoughnessMap;
        }

        if (hasClearcoatNormalMap)
        {
            features |= SceneMaterialFeatures.ClearcoatNormalMap;
        }

        if (ReadFloat(uniforms, "_ClearcoatFactor", 0.0f) > 0.0f ||
            hasClearcoatMap || hasClearcoatRoughnessMap || hasClearcoatNormalMap)
        {
            features |= SceneMaterialFeatures.Clearcoat;
        }

        bool hasSheenColorMap = HasBinding(material, GltfTextureUsage.SheenColor);
        bool hasSheenRoughnessMap = HasBinding(material, GltfTextureUsage.SheenRoughness);
        bool hasTransmissionMap = HasBinding(material, GltfTextureUsage.Transmission);
        bool hasIridescenceMap = HasBinding(material, GltfTextureUsage.Iridescence);
        bool hasIridescenceThicknessMap = HasBinding(material, GltfTextureUsage.IridescenceThickness);
        bool hasSubsurfaceMap = HasBinding(material, GltfTextureUsage.Subsurface);

        if (hasSheenColorMap)
        {
            features |= SceneMaterialFeatures.SheenColorMap;
        }

        if (hasSheenRoughnessMap)
        {
            features |= SceneMaterialFeatures.SheenRoughnessMap;
        }

        if (hasTransmissionMap)
        {
            features |= SceneMaterialFeatures.TransmissionMap;
        }

        if (hasIridescenceMap)
        {
            features |= SceneMaterialFeatures.IridescenceMap;
        }

        if (hasIridescenceThicknessMap)
        {
            features |= SceneMaterialFeatures.IridescenceThicknessMap;
        }

        if (HasBinding(material, GltfTextureUsage.Thickness))
        {
            features |= SceneMaterialFeatures.ThicknessMap;
        }

        if (HasBinding(material, GltfTextureUsage.Specular))
        {
            features |= SceneMaterialFeatures.SpecularMap;
        }

        if (HasBinding(material, GltfTextureUsage.SpecularColor))
        {
            features |= SceneMaterialFeatures.SpecularColorMap;
        }

        if (HasBinding(material, GltfTextureUsage.Anisotropy))
        {
            features |= SceneMaterialFeatures.AnisotropyMap;
        }

        if (hasSubsurfaceMap)
        {
            features |= SceneMaterialFeatures.SubsurfaceMap;
        }

        float anisotropy = ReadFloat(uniforms, "_AnisotropyStrength", ReadFloat(uniforms, "_AnisotropyFactor", 0.0f));
        if (MathF.Abs(anisotropy) > 0.001f)
        {
            features |= SceneMaterialFeatures.Anisotropy;
        }

        if (AnyComponentPositive(uniforms, "_SheenColorFactor") ||
            ReadFloat(uniforms, "_SheenFactor", 0.0f) > 0.001f ||
            hasSheenColorMap || hasSheenRoughnessMap)
        {
            features |= SceneMaterialFeatures.Sheen;
        }

        if (ReadFloat(uniforms, "_SubsurfaceFactor", 0.0f) > 0.001f || hasSubsurfaceMap)
        {
            features |= SceneMaterialFeatures.Subsurface;
        }

        if (ReadFloat(uniforms, "_TransmissionFactor", 0.0f) > 0.001f || hasTransmissionMap)
        {
            features |= SceneMaterialFeatures.Transmission;
        }

        if (ReadFloat(uniforms, "_IridescenceFactor", 0.0f) > 0.001f ||
            hasIridescenceMap || hasIridescenceThicknessMap)
        {
            features |= SceneMaterialFeatures.Iridescence;
        }

        return features;
    }

    private static SceneMaterialSurface BuildSurface(
        GltfMaterialAsset material,
        SortedDictionary<string, SceneUniformValue> uniforms,
        SceneGltfImportOptions options,
        IReadOnlyDictionary<string, SceneAssetId<SamplerAssetTag>>? textureSamplers,
        SceneMaterialShadingModel shadingModel,
        SceneMaterialAlphaMode alphaMode,
        SceneMaterialFeatures features,
        List<SceneGltfDiagnostic> diagnostics)
    {
        Vec4 albedo = ReadVec4(uniforms, "_BaseColorFactor") ?? Vec4.One;
        Vec3 emissive = ReadVec3(uniforms, "_EmissiveFactor") ?? Vec3.Zero;
        float metallic = Math.Clamp(ReadFloat(uniforms, "_MetallicFactor", 1.0f), 0.0f, 1.0f);
        float roughness = Math.Clamp(ReadFloat(uniforms, "_RoughnessFactor", 1.0f), 0.0f, 1.0f);

        float normalScale = ReadFloat(uniforms, "_NormalTexture_Scale", 1.0f);
        if (!IsFinite(normalScale))
        {
            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.non-finite-uniform",
                $"Material '{material.Id}' normal scale is not finite; one was used."));
            normalScale = 1.0f;
        }

        float occlusion = Math.Clamp(
            ReadFloat(uniforms, "_OcclusionTexture_Strength", 1.0f),
            0.0f,
            1.0f);

        Vec2 tiling = Vec2.One;
        Vec2 offset = Vec2.Zero;
        if (material.Textures.TryGetValue(GltfTextureUsage.BaseColor, out GltfMaterialTextureBinding? baseColor) &&
            baseColor is not null && !string.IsNullOrEmpty(baseColor.TextureKey))
        {
            GltfTextureTransform transform = baseColor.Transform;
            if (IsFinite(transform.Scale.X) && IsFinite(transform.Scale.Y))
            {
                tiling = transform.Scale;
            }

            if (IsFinite(transform.Offset.X) && IsFinite(transform.Offset.Y))
            {
                offset = transform.Offset;
            }
        }

        float alphaCutoff = Math.Clamp(ReadFloat(uniforms, "_AlphaCutoff", 0.5f), 0.0f, 1.0f);

        return new SceneMaterialSurface
        {
            ShadingModel = shadingModel,
            AlphaMode = alphaMode,
            AlphaCutoff = alphaCutoff,
            Features = features,
            Albedo = albedo,
            Emissive = emissive,
            Metallic = metallic,
            Roughness = roughness,
            NormalScale = normalScale,
            Occlusion = occlusion,
            Tiling = tiling,
            Offset = offset,
            AlbedoMap = ReadBinding(material, GltfTextureUsage.BaseColor, options, textureSamplers, diagnostics),
            NormalMap = ReadBinding(material, GltfTextureUsage.Normal, options, textureSamplers, diagnostics),
            PbrMap = ReadBinding(material, GltfTextureUsage.MetallicRoughness, options, textureSamplers, diagnostics),
            OcclusionMap = ReadBinding(material, GltfTextureUsage.Occlusion, options, textureSamplers, diagnostics),
            EmissiveMap = ReadBinding(material, GltfTextureUsage.Emissive, options, textureSamplers, diagnostics),
            ClearcoatMap = ReadBinding(material, GltfTextureUsage.Clearcoat, options, textureSamplers, diagnostics),
            ClearcoatRoughnessMap = ReadBinding(material, GltfTextureUsage.ClearcoatRoughness, options, textureSamplers, diagnostics),
            ClearcoatNormalMap = ReadBinding(material, GltfTextureUsage.ClearcoatNormal, options, textureSamplers, diagnostics),
            SheenColorMap = ReadBinding(material, GltfTextureUsage.SheenColor, options, textureSamplers, diagnostics),
            SheenRoughnessMap = ReadBinding(material, GltfTextureUsage.SheenRoughness, options, textureSamplers, diagnostics),
            TransmissionMap = ReadBinding(material, GltfTextureUsage.Transmission, options, textureSamplers, diagnostics),
            ThicknessMap = ReadBinding(material, GltfTextureUsage.Thickness, options, textureSamplers, diagnostics),
            IridescenceMap = ReadBinding(material, GltfTextureUsage.Iridescence, options, textureSamplers, diagnostics),
            IridescenceThicknessMap = ReadBinding(material, GltfTextureUsage.IridescenceThickness, options, textureSamplers, diagnostics),
            SpecularMap = ReadBinding(material, GltfTextureUsage.Specular, options, textureSamplers, diagnostics),
            SpecularColorMap = ReadBinding(material, GltfTextureUsage.SpecularColor, options, textureSamplers, diagnostics),
            AnisotropyMap = ReadBinding(material, GltfTextureUsage.Anisotropy, options, textureSamplers, diagnostics),
            SubsurfaceMap = ReadBinding(material, GltfTextureUsage.Subsurface, options, textureSamplers, diagnostics),
            Extensions = BuildExtensions(uniforms)
        };
    }

    private static SceneMaterialExtensions BuildExtensions(
        SortedDictionary<string, SceneUniformValue> uniforms)
    {
        float minimumThickness = MathF.Max(0.0f, ReadFloat(uniforms, "_IridescenceThicknessMinimum", 100.0f));
        float maximumThickness = MathF.Max(0.0f, ReadFloat(uniforms, "_IridescenceThicknessMaximum", 400.0f));
        if (minimumThickness > maximumThickness)
        {
            (minimumThickness, maximumThickness) = (maximumThickness, minimumThickness);
        }

        return new SceneMaterialExtensions
        {
            Clearcoat = Clamp01(ReadFloat(uniforms, "_ClearcoatFactor", 0.0f)),
            ClearcoatRoughness = Clamp01(ReadFloat(uniforms, "_ClearcoatRoughnessFactor", 0.0f)),
            ClearcoatNormalScale = MathF.Max(0.0f, ReadFloat(uniforms, "_ClearcoatNormalTexture_Scale", 1.0f)),
            SheenColor = ReadVec3(uniforms, "_SheenColorFactor") ?? Vec3.Zero,
            SheenRoughness = Clamp01(ReadFloat(uniforms, "_SheenRoughnessFactor", 0.5f)),
            Transmission = Clamp01(ReadFloat(uniforms, "_TransmissionFactor", 0.0f)),
            Ior = MathF.Max(1.0f, ReadFloat(uniforms, "_IorFactor", 1.5f)),
            Thickness = MathF.Max(0.0f, ReadFloat(uniforms, "_ThicknessFactor", 0.0f)),
            AttenuationDistance = MathF.Max(0.0f, ReadFloat(uniforms, "_AttenuationDistance", 0.0f)),
            AttenuationColor = ReadVec3(uniforms, "_AttenuationColor") ?? Vec3.One,
            Iridescence = Clamp01(ReadFloat(uniforms, "_IridescenceFactor", 0.0f)),
            IridescenceIor = MathF.Max(1.0f, ReadFloat(uniforms, "_IridescenceIor", 1.3f)),
            IridescenceThicknessMinimum = minimumThickness,
            IridescenceThicknessMaximum = maximumThickness,
            Subsurface = Clamp01(ReadFloat(uniforms, "_SubsurfaceFactor", 0.0f)),
            SubsurfaceColor = ReadVec3(uniforms, "_SubsurfaceColorFactor") ?? new Vec3(1.0f, 0.8f, 0.6f),
            SubsurfaceThickness = MathF.Max(0.0f, ReadFloat(uniforms, "_SubsurfaceThickness", 1.0f)),
            Specular = Clamp01(ReadFloat(uniforms, "_SpecularFactor", 1.0f)),
            SpecularColor = ReadVec3(uniforms, "_SpecularColorFactor") ?? Vec3.One,
            Anisotropy = Math.Clamp(ReadFloat(uniforms, "_AnisotropyStrength", 0.0f), -1.0f, 1.0f),
            AnisotropyRotation = ReadFloat(uniforms, "_AnisotropyRotation", 0.0f)
        };
    }

    private static float Clamp01(float value) => float.IsFinite(value) ? Math.Clamp(value, 0.0f, 1.0f) : 0.0f;

    private static SceneMaterialTextureBinding? ReadBinding(
        GltfMaterialAsset material,
        GltfTextureUsage usage,
        SceneGltfImportOptions options,
        IReadOnlyDictionary<string, SceneAssetId<SamplerAssetTag>>? textureSamplers,
        List<SceneGltfDiagnostic> diagnostics)
    {
        if (!material.Textures.TryGetValue(usage, out GltfMaterialTextureBinding? binding) ||
            binding is null ||
            string.IsNullOrEmpty(binding.TextureKey))
        {
            return null;
        }

        GltfTextureTransform transform = binding.Transform;
        int texCoord = transform.TexCoord > 0 ? transform.TexCoord : binding.TexCoord;
        SceneAssetId<SamplerAssetTag> samplerId =
            textureSamplers is not null &&
            textureSamplers.TryGetValue(binding.TextureKey, out SceneAssetId<SamplerAssetTag> resolved)
                ? resolved
                : MakeId<SamplerAssetTag>(binding.TextureKey + "/sampler", options);

        Vec2 scale = transform.Scale;
        Vec2 offset = transform.Offset;
        float rotation = transform.Rotation;
        if (!IsFinite(scale.X) || !IsFinite(scale.Y) ||
            !IsFinite(offset.X) || !IsFinite(offset.Y) ||
            !IsFinite(rotation))
        {
            diagnostics.Add(new SceneGltfDiagnostic(
                "scene.gltf.non-finite-uniform",
                $"Material '{material.Id}' texture '{binding.TextureKey}' transform is not finite; identity transform applied."));
            scale = Vec2.One;
            offset = Vec2.Zero;
            rotation = 0.0f;
        }

        return new SceneMaterialTextureBinding(
            MakeId<TextureAssetTag>(binding.TextureKey, options),
            samplerId,
            uvSet: texCoord == 1 ? SceneUvSet.Uv1 : SceneUvSet.Uv0,
            unit: null,
            scale: scale,
            offset: offset,
            rotation: rotation);
    }

    private static SceneMaterialPass[] BuildPasses(
        SceneMaterialAlphaMode alphaMode,
        bool doubleSided,
        SceneGltfBlendMode blendMode)
    {
        bool blend = alphaMode == SceneMaterialAlphaMode.Blend;
        bool cull = !doubleSided;
        SceneBlendState blendState = !blend
            ? SceneBlendState.Disabled
            : blendMode == SceneGltfBlendMode.Additive
                ? SceneBlendState.Additive
                : SceneBlendState.Alpha;

        return
        [
            new SceneMaterialPass(
                "main",
                depthTest: true,
                depthWrite: !blend,
                cull: cull,
                blend: blend,
                blendState: blendState),
            new SceneMaterialPass(
                "forward-add",
                depthTest: true,
                depthWrite: false,
                cull: cull,
                blend: true,
                blendState: SceneBlendState.Additive),
            new SceneMaterialPass(
                "shadow-caster",
                alphaMode == SceneMaterialAlphaMode.Mask ? 1 : 0,
                depthTest: true,
                depthWrite: true,
                cull: cull,
                blend: false,
                blendState: SceneBlendState.Disabled)
        ];
    }

    private static SceneMaterialAlphaMode MapAlphaMode(GltfAlphaMode mode) => mode switch
    {
        GltfAlphaMode.Mask => SceneMaterialAlphaMode.Mask,
        GltfAlphaMode.Blend => SceneMaterialAlphaMode.Blend,
        _ => SceneMaterialAlphaMode.Opaque
    };

    private static bool HasBinding(GltfMaterialAsset material, GltfTextureUsage usage) =>
        material.Textures.TryGetValue(usage, out GltfMaterialTextureBinding? binding) &&
        binding is not null &&
        !string.IsNullOrEmpty(binding.TextureKey);

    private static bool UsesSecondUv(GltfMaterialAsset material)
    {
        ReadOnlySpan<SceneGltfTextureUniformSpec> specs = SceneGltfShaderProperties.TextureUniformSpecs;
        for (int i = 0; i < specs.Length; i++)
        {
            if (material.Textures.TryGetValue(specs[i].Usage, out GltfMaterialTextureBinding? binding) &&
                binding is not null &&
                !string.IsNullOrEmpty(binding.TextureKey) &&
                (binding.Transform.TexCoord == 1 || binding.TexCoord == 1))
            {
                return true;
            }
        }

        return false;
    }

    private static float ReadFloat(
        SortedDictionary<string, SceneUniformValue> uniforms,
        string name,
        float fallback) =>
        uniforms.TryGetValue(name, out SceneUniformValue value) && value.Kind == SceneUniformKind.Float
            ? value.X
            : fallback;

    private static bool TryGetVec3(
        SortedDictionary<string, SceneUniformValue> uniforms,
        string name,
        out Vec3 value)
    {
        if (uniforms.TryGetValue(name, out SceneUniformValue uniform) &&
            uniform.Kind == SceneUniformKind.Vec3 &&
            IsFinite(uniform.X) && IsFinite(uniform.Y) && IsFinite(uniform.Z))
        {
            value = new Vec3(uniform.X, uniform.Y, uniform.Z);
            return true;
        }

        value = default;
        return false;
    }

    private static Vec3? ReadVec3(SortedDictionary<string, SceneUniformValue> uniforms, string name) =>
        TryGetVec3(uniforms, name, out Vec3 value) ? value : null;

    private static Vec4? ReadVec4(SortedDictionary<string, SceneUniformValue> uniforms, string name)
    {
        if (uniforms.TryGetValue(name, out SceneUniformValue uniform) &&
            uniform.Kind == SceneUniformKind.Vec4 &&
            IsFinite(uniform.X) && IsFinite(uniform.Y) && IsFinite(uniform.Z) && IsFinite(uniform.W))
        {
            return new Vec4(uniform.X, uniform.Y, uniform.Z, uniform.W);
        }

        return null;
    }

    private static bool AnyComponentPositive(
        SortedDictionary<string, SceneUniformValue> uniforms,
        string name) =>
        TryGetVec3(uniforms, name, out Vec3 value) &&
        (value.X > 0.0f || value.Y > 0.0f || value.Z > 0.0f);

    private static bool IsFinite(float value) => float.IsFinite(value);

    private static bool IsFinite(ReadOnlySpan<float> values)
    {
        for (int i = 0; i < values.Length; i++)
        {
            if (!float.IsFinite(values[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static SceneAssetId<ShaderAssetTag>? ResolveDeclaredCustomShader(
        GltfMaterialAsset material,
        SceneGltfImportOptions options)
    {
        string? declared = material.Definition.ShaderId;
        if (string.IsNullOrWhiteSpace(declared) ||
            SceneGltfShaders.TryCreate(declared, names: null, out _))
        {
            return null;
        }

        return options.Names is { } names
            ? SceneAssetId<ShaderAssetTag>.FromSymbol(names.Intern(declared))
            : SceneAssetId<ShaderAssetTag>.FromName(declared);
    }

    private static string? ResolveBuiltInBaseName(SceneAssetId<ShaderAssetTag> id)
    {
        if (id == SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.PbrShaderName))
        {
            return SceneGltfShaders.PbrShaderName;
        }

        if (id == SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.UnlitShaderName))
        {
            return SceneGltfShaders.UnlitShaderName;
        }

        if (id == SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.ToonShaderName))
        {
            return SceneGltfShaders.ToonShaderName;
        }

        return null;
    }

    private static SceneAssetId<ShaderAssetTag> MakeShaderId(
        string name,
        SceneGltfImportOptions options) =>
        options.Names is { } names
            ? SceneAssetId<ShaderAssetTag>.FromSymbol(names.Intern(name))
            : SceneAssetId<ShaderAssetTag>.FromName(name);

    private static SceneAssetId<TTag> MakeId<TTag>(string name, SceneGltfImportOptions options)
        where TTag : struct
    {
        string prefixed = options.AssetPrefix + name;
        return options.Names is { } names
            ? SceneAssetId<TTag>.FromSymbol(names.Intern(prefixed))
            : SceneAssetId<TTag>.FromName(prefixed);
    }
}
