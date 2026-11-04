namespace Axrone.AssetGltf;

/// <summary>Pipeline compile stage: canonical assets.</summary>
public static class GltfCompileExtensions
{
    /// <summary>Compiles a resolved pipeline into canonical assets.</summary>
    public static async ValueTask<GltfImportResult> CompileAsync<TDracoPolicy, TMeshoptPolicy, TTranscoderPolicy>(
        this GltfPipeline<StateResolved> pipeline,
        GltfImporterOptions options,
        CancellationToken cancellationToken = default)
        where TDracoPolicy : struct, IDracoMeshPolicy
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
        where TTranscoderPolicy : struct, ITextureTranscoderPolicy
    {
        ArgumentNullException.ThrowIfNull(pipeline);
        ArgumentNullException.ThrowIfNull(options);
        cancellationToken.ThrowIfCancellationRequested();

        GltfRawModel rawModel = pipeline.RawModel!;
        if (rawModel.IsDisposed)
        {
            throw new InvalidOperationException(
                "The parsed glTF document has already been consumed; create a new pipeline for another import.");
        }

        using var rawModelOwner = rawModel;
        GltfResourceRuntimeCache resourceRuntime = pipeline.ResourceRuntime!;
        List<GltfDiagnostic> diagnostics = pipeline.Diagnostics;

        GltfLimitsValidator.Validate(pipeline.SourceBytes.Length, rawModel, options.Limits);

        List<GltfTextureAsset> textures = await CompileTexturesAsync<TMeshoptPolicy, TTranscoderPolicy>(
            rawModel, resourceRuntime, options, diagnostics, cancellationToken).ConfigureAwait(false);

        cancellationToken.ThrowIfCancellationRequested();
        List<GltfMaterialAsset> materials = CompileMaterials(rawModel, options);
        cancellationToken.ThrowIfCancellationRequested();

        (List<GltfMeshAsset> meshes, ImmutableArray<ImmutableArray<string>> meshKeysByMesh) = await CompileMeshesAsync<TDracoPolicy, TMeshoptPolicy>(
            rawModel, resourceRuntime, options.Limits, diagnostics, cancellationToken).ConfigureAwait(false);

        (List<GltfSkinAsset> skins, ImmutableDictionary<int, string> skinKeyMap) = await CompileSkinsAsync<TMeshoptPolicy>(
            rawModel, resourceRuntime, cancellationToken).ConfigureAwait(false);

        List<GltfAnimationClipAsset> animations = await CompileAnimationsAsync<TMeshoptPolicy>(
            rawModel, resourceRuntime, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        ImmutableArray<string> animIds = animations.ConvertAll(static a => a.Id).ToImmutableArray();

        var materialVariants = ImmutableArray.CreateBuilder<GltfMaterialVariant>(rawModel.Variants.Count);
        for (int i = 0; i < rawModel.Variants.Count; i++)
        {
            materialVariants.Add(new GltfMaterialVariant(
                i,
                rawModel.Variants[i].Name ?? $"Variant_{i}"));
        }

        var prefabs = ImmutableArray.CreateBuilder<GltfPrefabAsset>(rawModel.Scenes.Count);
        var sceneAssets = ImmutableArray.CreateBuilder<GltfDocumentSceneAsset>(rawModel.Scenes.Count);
        int defaultSceneIdx = rawModel.DefaultScene >= 0 && rawModel.DefaultScene < rawModel.Scenes.Count
            ? rawModel.DefaultScene
            : rawModel.Scenes.Count > 0
                ? 0
                : -1;

        for (int s = 0; s < rawModel.Scenes.Count; s++)
        {
            GltfPrefabAsset prefab = GltfPrefabEngine.BuildPrefab(
                s,
                rawModel,
                s == defaultSceneIdx,
                diagnostics,
                meshKeysByMesh,
                skinKeyMap,
                animIds,
                options.MaxLocalLightsBudget);

            prefabs.Add(prefab);

            sceneAssets.Add(new GltfDocumentSceneAsset
            {
                SceneIndex = s,
                Name = rawModel.Scenes[s].Name ?? $"Scene_{s}",
                PrefabKey = prefab.Id,
                RootNodeIds = prefab.RootNodeIds,
                AnimationController = prefab.AnimationController,
            });
        }

        var stats = new GltfDocumentStats(
            rawModel.Scenes.Count,
            rawModel.NodeCount,
            rawModel.Cameras.Count,
            rawModel.Lights.Count,
            rawModel.Meshes.Count,
            meshes.Count,
            rawModel.Materials.Count,
            rawModel.Textures.Count,
            rawModel.Skins.Count,
            rawModel.Animations.Count);

        return new GltfImportResult
        {
            Document = new GltfDocumentAsset
            {
                Id = options.Id,
                Uri = options.SourceUri,
                Name = Path.GetFileNameWithoutExtension(options.Id),
                Format = pipeline.ContainerFormat,
                Version = rawModel.GetString(rawModel.Version),
                Generator = rawModel.GetString(rawModel.Generator),
                Copyright = rawModel.GetString(rawModel.Copyright),
                DefaultScene = defaultSceneIdx,
                Scenes = sceneAssets.MoveToImmutable(),
                MeshKeys = meshes.ConvertAll(static m => m.Id).ToImmutableArray(),
                SkinKeys = skins.ConvertAll(static s => s.Id).ToImmutableArray(),
                AnimationKeys = animIds,
                MaterialKeys = materials.ConvertAll(static m => m.Id).ToImmutableArray(),
                TextureKeys = textures.ConvertAll(static t => t.Id).ToImmutableArray(),
                ExtensionsUsed = rawModel.ExtensionsUsed.ToImmutableArray(),
                ExtensionsRequired = rawModel.ExtensionsRequired.ToImmutableArray(),
                MaterialVariants = materialVariants.MoveToImmutable(),
                Stats = stats,
            },
            Prefabs = prefabs.MoveToImmutable(),
            Meshes = meshes.ToImmutableArray(),
            Skins = skins.ToImmutableArray(),
            Animations = animations.ToImmutableArray(),
            Materials = materials.ToImmutableArray(),
            Textures = textures.ToImmutableArray(),
            Diagnostics = diagnostics.ToImmutableArray(),
        };
    }

    internal static async ValueTask<List<GltfTextureAsset>> CompileTexturesAsync<TMeshoptPolicy, TTranscoderPolicy>(
        GltfRawModel rawModel,
        GltfResourceRuntimeCache resourceRuntime,
        GltfImporterOptions options,
        List<GltfDiagnostic> diagnostics,
        CancellationToken cancellationToken)
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
        where TTranscoderPolicy : struct, ITextureTranscoderPolicy
    {
        var textures = new List<GltfTextureAsset>(rawModel.Textures.Count);
        for (int i = 0; i < rawModel.Textures.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            GltfRawModel.Texture texDef = rawModel.Textures[i];
            if (texDef.Source is int declaredSource &&
                (declaredSource < 0 || declaredSource >= rawModel.Images.Count))
            {
                ThrowHelper.ThrowTextureSource(i, declaredSource, rawModel.Images.Count);
            }

            if (texDef.Sampler is int declaredSampler &&
                (declaredSampler < 0 || declaredSampler >= rawModel.Samplers.Count))
            {
                diagnostics.Add(new GltfDiagnostic(
                    GltfDiagnosticLevel.Warning,
                    "gltf.texture.sampler.invalid",
                    $"Texture {i} references sampler {declaredSampler} but the document declares " +
                    $"{rawModel.Samplers.Count} samplers; default sampler parameters were used."));
            }

            GltfRawModel.Sampler sampDef = texDef.Sampler is int samplerIndex &&
                samplerIndex >= 0 &&
                samplerIndex < rawModel.Samplers.Count
                ? rawModel.Samplers[samplerIndex]
                : new GltfRawModel.Sampler();

            var sampler = new GltfTextureSampler(sampDef.MagFilter, sampDef.MinFilter, sampDef.WrapS, sampDef.WrapT);
            GltfTexturePayload payload;
            GltfTextureFormat runtimeFormat = GltfTextureFormat.Unknown;
            var transcodeState = new GltfTextureTranscodeState(true, null, null, GltfTextureFormat.Unknown);
            GltfRawModel.Image? imageDef = texDef.Source is int sourceIndex &&
                sourceIndex >= 0 &&
                sourceIndex < rawModel.Images.Count
                ? rawModel.Images[sourceIndex]
                : null;
            string? imageUri = imageDef?.Uri;

            if (imageDef?.BufferView is int bufferView && bufferView < rawModel.BufferViews.Count)
            {
                ReadOnlyMemory<byte> imgBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                    bufferView, rawModel, cancellationToken).ConfigureAwait(false);
                payload = new GltfRawTexturePayload(imgBytes, imageDef.MimeType ?? "application/octet-stream");
            }
            else if (!string.IsNullOrEmpty(imageUri))
            {
                if (imageUri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    payload = new GltfRawTexturePayload(
                        GltfResourceRuntimeCache.DecodeDataUri(imageUri),
                        imageDef?.MimeType ?? GltfResourceRuntimeCache.GetDataUriMimeType(imageUri) ?? "application/octet-stream");
                }
                else
                {
                    ReadOnlyMemory<byte>? resolvedImage = await resourceRuntime.TryResolveImageAsync(
                        imageUri, imageDef?.MimeType, cancellationToken).ConfigureAwait(false);

                    payload = resolvedImage.HasValue
                        ? new GltfRawTexturePayload(resolvedImage.Value, imageDef?.MimeType ?? "application/octet-stream")
                        : new GltfExternalTexturePayload(imageUri);
                }
            }
            else if (imageDef is null)
            {
                string reason = $"Texture {i} declares no image source.";
                payload = UnusablePayload(
                    diagnostics,
                    GltfDiagnosticLevel.Error,
                    "gltf.texture.source.missing",
                    GltfImageDecodeFailure.SourceMissing,
                    $"{reason} The payload is empty and marked unusable.");
                transcodeState = new GltfTextureTranscodeState(
                    false,
                    null,
                    reason,
                    GltfTextureFormat.Unknown);
            }
            else
            {
                string reason = imageDef.BufferView is int undeclaredBufferView
                    ? $"Image {texDef.Source} references bufferView {undeclaredBufferView} which the document does not declare."
                    : $"Image {texDef.Source} for texture {i} declares neither a URI nor a bufferView.";
                payload = UnusablePayload(
                    diagnostics,
                    GltfDiagnosticLevel.Error,
                    imageDef.BufferView is int
                        ? "gltf.texture.source.bufferview.invalid"
                        : "gltf.texture.source.empty",
                    GltfImageDecodeFailure.SourceMissing,
                    $"{reason} The payload is empty and marked unusable.");
                transcodeState = new GltfTextureTranscodeState(
                    false,
                    null,
                    reason,
                    GltfTextureFormat.Unknown);
            }

            if (payload is GltfRawTexturePayload encoded && !encoded.Bytes.IsEmpty)
            {
                GltfImageCodecKind codec = GltfImageCodec.Detect(
                    encoded.Bytes.Span,
                    encoded.MimeType,
                    imageUri);

                if (codec == GltfImageCodecKind.Ktx2)
                {
                    if (!GltfKtx2Reader.TryRead(encoded.Bytes, out GltfKtx2Texture? ktx2, out GltfImageDecodeError? ktx2Error))
                    {
                        bool unsupported = ktx2Error!.Value.Failure is
                            GltfImageDecodeFailure.Supercompression or GltfImageDecodeFailure.Unsupported;
                        diagnostics.Add(new GltfDiagnostic(
                            unsupported ? GltfDiagnosticLevel.Warning : GltfDiagnosticLevel.Error,
                            unsupported ? "gltf.texture.decode.unsupported" : "gltf.texture.ktx2.invalid",
                            $"Texture {i}: {ktx2Error.Value}"));
                        payload = encoded with { Unusable = ktx2Error };
                        transcodeState = new GltfTextureTranscodeState(
                            false,
                            null,
                            ktx2Error.Value.Message,
                            GltfTextureFormat.Unknown);
                    }
                    else
                    {
                        GltfCompressedTexturePayload compressed = GltfKtx2Reader.ToPayload(ktx2);
                        payload = compressed;
                        runtimeFormat = ktx2.RuntimeFormat;
                        bool policyAttempted = false;

                        if (options.TranscodeTargetFormat != GltfTextureFormat.Unknown &&
                            TTranscoderPolicy.CanTranscode(
                                encoded.Bytes.Span,
                                runtimeFormat,
                                options.TranscodeTargetFormat))
                        {
                            policyAttempted = true;
                            if (TTranscoderPolicy.TryTranscode(
                                    encoded.Bytes,
                                    runtimeFormat,
                                    options.TranscodeTargetFormat,
                                    out GltfTranscodeOutput? transcodeOutput,
                                    out string? failureReason) &&
                                transcodeOutput.HasValue)
                            {
                                transcodeState = new GltfTextureTranscodeState(
                                    true,
                                    TTranscoderPolicy.PolicyId,
                                    null,
                                    options.TranscodeTargetFormat);
                                runtimeFormat = transcodeOutput.Value.Format;
                                payload = transcodeOutput.Value.Payload;
                            }
                            else
                            {
                                GltfImageDecodeError transcodeError = new(
                                    GltfImageCodecKind.Ktx2,
                                    GltfImageDecodeFailure.TranscoderFailed,
                                    failureReason ?? "Texture transcode failed.",
                                    "transcoder");
                                transcodeState = new GltfTextureTranscodeState(
                                    false,
                                    null,
                                    failureReason,
                                    options.TranscodeTargetFormat);
                                diagnostics.Add(new GltfDiagnostic(
                                    GltfDiagnosticLevel.Error,
                                    "gltf.texture.transcode.failed",
                                    $"Texture {i}: {transcodeError}"));
                                payload = compressed with { Unusable = transcodeError };
                            }
                        }

                        if (!policyAttempted && ktx2.RequiresBasisTranscode)
                        {
                            if (GltfKtx2Reader.TryResolvePayload(
                                    ktx2,
                                    options.CompressedTextureTranscoder,
                                    options.TranscodeTargetFormat,
                                    out GltfTexturePayload? resolvedPayload,
                                    out GltfTextureFormat resolvedFormat,
                                    out GltfImageDecodeError? resolveError))
                            {
                                payload = resolvedPayload;
                                runtimeFormat = resolvedFormat;
                                if (resolvedPayload is not GltfCompressedTexturePayload)
                                {
                                    transcodeState = new GltfTextureTranscodeState(
                                        true,
                                        options.CompressedTextureTranscoder?.Id,
                                        null,
                                        resolvedFormat);
                                }
                            }
                            else
                            {
                                bool unavailable =
                                    resolveError!.Value.Failure == GltfImageDecodeFailure.TranscoderMissing;
                                diagnostics.Add(new GltfDiagnostic(
                                    unavailable ? GltfDiagnosticLevel.Warning : GltfDiagnosticLevel.Error,
                                    unavailable
                                        ? "gltf.texture.transcode.unavailable"
                                        : "gltf.texture.transcode.failed",
                                    $"Texture {i}: {resolveError.Value}"));
                                transcodeState = new GltfTextureTranscodeState(
                                    false,
                                    null,
                                    resolveError.Value.Message,
                                    options.TranscodeTargetFormat);
                                payload = compressed with { Unusable = resolveError };
                            }
                        }
                    }
                }
                else if (options.DecodeEncodedTextures &&
                         codec is GltfImageCodecKind.Png or GltfImageCodecKind.Jpeg)
                {
                    string transcoderId = codec == GltfImageCodecKind.Png ? "builtin/png" : "builtin/jpeg";
                    if (GltfImageCodec.TryDecodeRaster(
                            encoded.Bytes.Span,
                            encoded.MimeType,
                            imageUri,
                            out GltfDecodedImage? decoded,
                            out GltfImageDecodeError? decodeError))
                    {
                        payload = new GltfTranscodedTexturePayload(
                            decoded.Rgba,
                            GltfTextureFormat.R8G8B8A8_UNorm,
                            [new GltfTextureMipLevel(0, decoded.Width, decoded.Height, 0, decoded.Rgba.Length)]);
                        runtimeFormat = GltfTextureFormat.R8G8B8A8_UNorm;
                        transcodeState = new GltfTextureTranscodeState(
                            true,
                            transcoderId,
                            null,
                            GltfTextureFormat.R8G8B8A8_UNorm);
                    }
                    else
                    {
                        transcodeState = new GltfTextureTranscodeState(
                            false,
                            transcoderId,
                            decodeError?.Message,
                            GltfTextureFormat.R8G8B8A8_UNorm);
                        diagnostics.Add(new GltfDiagnostic(
                            GltfDiagnosticLevel.Error,
                            "gltf.texture.decode.failed",
                            $"Texture {i} could not be decoded as {codec}: {decodeError}"));
                        payload = encoded with { Unusable = decodeError };
                    }
                }
                else if (options.DecodeEncodedTextures && IsUnsupportedEncodedImage(encoded.MimeType))
                {
                    GltfImageDecodeError missingDecoder = new(
                        codec,
                        GltfImageDecodeFailure.DecoderMissing,
                        $"No decoder is linked for '{encoded.MimeType}'; the raw bytes are retained for a future codec.",
                        encoded.MimeType);
                    diagnostics.Add(new GltfDiagnostic(
                        GltfDiagnosticLevel.Warning,
                        "gltf.texture.decode.unsupported",
                        $"Texture {i} uses encoded format '{encoded.MimeType}' which is not decoded; " +
                        "the raw payload was retained and marked unusable."));
                    payload = encoded with { Unusable = missingDecoder };
                }
            }

            textures.Add(new GltfTextureAsset
            {
                Id = $"gltf/texture/{i}",
                TextureIndex = i,
                ImageIndex = texDef.Source ?? -1,
                Sampler = sampler,
                Payload = payload,
                UsageHints = ImmutableArray<GltfTextureUsage>.Empty,
                RuntimeFormat = runtimeFormat,
                TranscodeState = transcodeState,
            });
        }

        return textures;
    }

    private static GltfRawTexturePayload UnusablePayload(
        List<GltfDiagnostic> diagnostics,
        GltfDiagnosticLevel level,
        string code,
        GltfImageDecodeFailure failure,
        string message)
    {
        diagnostics.Add(new GltfDiagnostic(level, code, message));
        return new GltfRawTexturePayload(ReadOnlyMemory<byte>.Empty, "unknown")
        {
            Unusable = new GltfImageDecodeError(
                GltfImageCodecKind.Unknown,
                failure,
                message,
                "source"),
        };
    }

    private static ImmutableArray<float> CopyWeights(GltfRawModel rawModel, in GltfRawModel.Mesh mesh)
    {
        int count = GltfRawModel.GetWeightCount(mesh);
        if (count == 0)
        {
            return ImmutableArray<float>.Empty;
        }

        var builder = ImmutableArray.CreateBuilder<float>(count);
        for (int i = 0; i < count; i++)
        {
            builder.Add(rawModel.GetWeight(in mesh, i));
        }

        return builder.MoveToImmutable();
    }

    private static bool IsUnsupportedEncodedImage(string? mimeType) =>
        string.Equals(mimeType, "image/webp", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(mimeType, "image/avif", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(mimeType, "image/basis", StringComparison.OrdinalIgnoreCase);

    internal static List<GltfMaterialAsset> CompileMaterials(GltfRawModel rawModel, GltfImporterOptions options)
    {
        var materials = new List<GltfMaterialAsset>(rawModel.Materials.Count);
        for (int i = 0; i < rawModel.Materials.Count; i++)
        {
            GltfRawModel.Material mDef = rawModel.Materials[i];
            ValidateTextureBinding(mDef.Pbr.BaseColorTexture, i, rawModel.Textures.Count, "baseColorTexture");
            ValidateTextureBinding(mDef.Pbr.MetallicRoughnessTexture, i, rawModel.Textures.Count, "metallicRoughnessTexture");
            ValidateTextureBinding(mDef.NormalTexture, i, rawModel.Textures.Count, "normalTexture");
            ValidateTextureBinding(mDef.OcclusionTexture, i, rawModel.Textures.Count, "occlusionTexture");
            ValidateTextureBinding(mDef.EmissiveTexture, i, rawModel.Textures.Count, "emissiveTexture");
            ValidateTextureBinding(mDef.ClearcoatTexture, i, rawModel.Textures.Count, "clearcoatTexture");
            ValidateTextureBinding(mDef.ClearcoatRoughnessTexture, i, rawModel.Textures.Count, "clearcoatRoughnessTexture");
            ValidateTextureBinding(mDef.ClearcoatNormalTexture, i, rawModel.Textures.Count, "clearcoatNormalTexture");
            ValidateTextureBinding(mDef.SpecularTexture, i, rawModel.Textures.Count, "specularTexture");
            ValidateTextureBinding(mDef.SpecularColorTexture, i, rawModel.Textures.Count, "specularColorTexture");
            ValidateTextureBinding(mDef.SheenColorTexture, i, rawModel.Textures.Count, "sheenColorTexture");
            ValidateTextureBinding(mDef.SheenRoughnessTexture, i, rawModel.Textures.Count, "sheenRoughnessTexture");
            ValidateTextureBinding(mDef.TransmissionTexture, i, rawModel.Textures.Count, "transmissionTexture");
            ValidateTextureBinding(mDef.ThicknessTexture, i, rawModel.Textures.Count, "thicknessTexture");
            ValidateTextureBinding(mDef.IridescenceTexture, i, rawModel.Textures.Count, "iridescenceTexture");
            ValidateTextureBinding(mDef.IridescenceThicknessTexture, i, rawModel.Textures.Count, "iridescenceThicknessTexture");
            ValidateTextureBinding(mDef.AnisotropyTexture, i, rawModel.Textures.Count, "anisotropyTexture");

            var floatUniforms = ImmutableDictionary.CreateBuilder<string, float[]>(StringComparer.Ordinal);
            var scalarUniforms = ImmutableDictionary.CreateBuilder<string, float>(StringComparer.Ordinal);
            var intUniforms = ImmutableDictionary.CreateBuilder<string, int>(StringComparer.Ordinal);
            var texBindings = ImmutableDictionary.CreateBuilder<GltfTextureUsage, GltfMaterialTextureBinding>();

            float[] baseColor = mDef.Pbr.BaseColorFactor ?? [1.0f, 1.0f, 1.0f, 1.0f];
            floatUniforms.Add("_BaseColorFactor", baseColor);
            scalarUniforms.Add("_MetallicFactor", mDef.Pbr.MetallicFactor);
            scalarUniforms.Add("_RoughnessFactor", mDef.Pbr.RoughnessFactor);
            scalarUniforms.Add("_ClearcoatFactor", mDef.ClearcoatFactor);
            scalarUniforms.Add("_ClearcoatRoughnessFactor", mDef.ClearcoatRoughnessFactor);

            floatUniforms.Add("_SpecularColorFactor", mDef.SpecularColorFactor ?? [1.0f, 1.0f, 1.0f]);
            scalarUniforms.Add("_SpecularFactor", mDef.SpecularFactor);
            floatUniforms.Add("_SheenColorFactor", mDef.SheenColorFactor ?? [0.0f, 0.0f, 0.0f]);
            scalarUniforms.Add("_SheenRoughnessFactor", mDef.SheenRoughnessFactor);
            scalarUniforms.Add("_TransmissionFactor", mDef.TransmissionFactor);
            scalarUniforms.Add("_ThicknessFactor", mDef.ThicknessFactor);
            scalarUniforms.Add("_AttenuationDistance", mDef.AttenuationDistance);
            floatUniforms.Add("_AttenuationColor", mDef.AttenuationColor ?? [1.0f, 1.0f, 1.0f]);
            scalarUniforms.Add("_IorFactor", mDef.Ior);
            scalarUniforms.Add("_IridescenceFactor", mDef.IridescenceFactor);
            scalarUniforms.Add("_IridescenceIor", mDef.IridescenceIor);
            scalarUniforms.Add("_IridescenceThicknessMinimum", mDef.IridescenceThicknessMinimum);
            scalarUniforms.Add("_IridescenceThicknessMaximum", mDef.IridescenceThicknessMaximum);
            scalarUniforms.Add("_AnisotropyStrength", mDef.AnisotropyStrength);
            scalarUniforms.Add("_AnisotropyRotation", mDef.AnisotropyRotation);
            scalarUniforms.Add("_Dispersion", mDef.Dispersion);

            float[] emissive = mDef.EmissiveFactor ?? [0.0f, 0.0f, 0.0f];
            if (mDef.EmissiveStrength != 1.0f)
            {
                emissive =
                [
                    emissive[0] * mDef.EmissiveStrength,
                    emissive[1] * mDef.EmissiveStrength,
                    emissive[2] * mDef.EmissiveStrength,
                ];
            }

            floatUniforms.Add("_EmissiveFactor", emissive);

            GltfAlphaMode alphaMode = mDef.AlphaMode.ToUpperInvariant() switch
            {
                "MASK" => GltfAlphaMode.Mask,
                "BLEND" => GltfAlphaMode.Blend,
                _ => GltfAlphaMode.Opaque,
            };
            float alphaCutoff = mDef.AlphaCutoff ?? options.AlphaCutoffThreshold;
            intUniforms.Add("_AlphaMode", (int)alphaMode);
            scalarUniforms.Add("_AlphaCutoff", alphaCutoff);
            intUniforms.Add("_DoubleSided", mDef.DoubleSided ? 1 : 0);

            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.BaseColor, mDef.Pbr.BaseColorTexture, "_BaseColorTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.MetallicRoughness, mDef.Pbr.MetallicRoughnessTexture, "_MetallicRoughnessTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Normal, mDef.NormalTexture, "_NormalTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Occlusion, mDef.OcclusionTexture, "_OcclusionTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Emissive, mDef.EmissiveTexture, "_EmissiveTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Clearcoat, mDef.ClearcoatTexture, "_ClearcoatTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.ClearcoatRoughness, mDef.ClearcoatRoughnessTexture, "_ClearcoatRoughnessTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.ClearcoatNormal, mDef.ClearcoatNormalTexture, "_ClearcoatNormalTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Specular, mDef.SpecularTexture, "_SpecularTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.SpecularColor, mDef.SpecularColorTexture, "_SpecularColorTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.SheenColor, mDef.SheenColorTexture, "_SheenColorTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.SheenRoughness, mDef.SheenRoughnessTexture, "_SheenRoughnessTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Transmission, mDef.TransmissionTexture, "_TransmissionTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Thickness, mDef.ThicknessTexture, "_ThicknessTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Iridescence, mDef.IridescenceTexture, "_IridescenceTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.IridescenceThickness, mDef.IridescenceThicknessTexture, "_IridescenceThicknessTexture");
            BindTexture(texBindings, floatUniforms, scalarUniforms, intUniforms, GltfTextureUsage.Anisotropy, mDef.AnisotropyTexture, "_AnisotropyTexture");

            var definition = new GltfMaterialDefinition
            {
                ShaderId = mDef.Unlit ? "gltf/unlit" : options.MaterialShaderId,
                FloatUniforms = floatUniforms.ToImmutable(),
                ScalarUniforms = scalarUniforms.ToImmutable(),
                IntUniforms = intUniforms.ToImmutable(),
            };

            materials.Add(new GltfMaterialAsset
            {
                Id = $"gltf/material/{i}",
                MaterialIndex = i,
                Definition = definition,
                AlphaMode = alphaMode,
                AlphaCutoff = alphaCutoff,
                DoubleSided = mDef.DoubleSided,
                Unlit = mDef.Unlit,
                Textures = texBindings.ToImmutable(),
            });
        }

        return materials;
    }

    private static void ValidateTextureBinding(
        GltfRawModel.TextureInfo? info,
        int materialIndex,
        int textureCount,
        string slot)
    {
        if (info != null && info.Index >= 0 && info.Index >= textureCount)
        {
            ThrowHelper.ThrowSchema(
                $"Material {materialIndex} references missing texture {info.Index} in '{slot}'.");
        }
    }

    private static void BindTexture(
        ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding>.Builder texBindings,
        ImmutableDictionary<string, float[]>.Builder floatUniforms,
        ImmutableDictionary<string, float>.Builder scalarUniforms,
        ImmutableDictionary<string, int>.Builder intUniforms,
        GltfTextureUsage usage,
        GltfRawModel.TextureInfo? info,
        string uniformPrefix)
    {
        if (info == null || info.Index < 0)
        {
            return;
        }

        texBindings[usage] = new GltfMaterialTextureBinding
        {
            TextureKey = $"gltf/texture/{info.Index}",
            TexCoord = info.TexCoord,
            Scale = info.Scale,
            Strength = info.Strength,
            Transform = info.Transform,
        };

        floatUniforms.Add($"{uniformPrefix}_ST", [info.Transform.Scale.X, info.Transform.Scale.Y, info.Transform.Offset.X, info.Transform.Offset.Y]);
        scalarUniforms.Add($"{uniformPrefix}_Rotation", info.Transform.Rotation);
        intUniforms.Add($"{uniformPrefix}_TexCoord", info.Transform.TexCoord);
        scalarUniforms.Add($"{uniformPrefix}_Scale", info.Scale);
        scalarUniforms.Add($"{uniformPrefix}_Strength", info.Strength);
    }

    internal static async ValueTask<(List<GltfMeshAsset> Meshes, ImmutableArray<ImmutableArray<string>> MeshKeysByMesh)> CompileMeshesAsync<TDracoPolicy, TMeshoptPolicy>(
        GltfRawModel rawModel,
        GltfResourceRuntimeCache resourceRuntime,
        GltfImportLimits limits,
        List<GltfDiagnostic> diagnostics,
        CancellationToken cancellationToken)
        where TDracoPolicy : struct, IDracoMeshPolicy
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
    {
        var meshes = new List<GltfMeshAsset>();
        var meshKeysByMesh = ImmutableArray.CreateBuilder<ImmutableArray<string>>(rawModel.MeshCount);

        for (int m = 0; m < rawModel.MeshCount; m++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            GltfRawModel.Mesh meshDef = rawModel.GetMesh(m);
            var primitiveKeys = ImmutableArray.CreateBuilder<string>(meshDef.Primitives.Length);

            for (int p = 0; p < meshDef.Primitives.Length; p++)
            {
                GltfRawModel.Primitive prim = rawModel.GetPrimitive(meshDef, p);
                string meshAssetId = GltfKeys.Mesh(m, p);
                primitiveKeys.Add(meshAssetId);

                if (prim.HasMaterial && (uint)prim.Material >= (uint)rawModel.Materials.Count)
                {
                    ThrowHelper.ThrowSchema(
                        $"Mesh {m} primitive {p} references a missing material {prim.Material}.");
                }

                if (prim.HasIndices && (uint)prim.Indices >= (uint)rawModel.AccessorCount)
                {
                    ThrowHelper.ThrowSchema(
                        $"Mesh {m} primitive {p} references a missing index accessor {prim.Indices}.");
                }

                if (prim.Draco.Present && !TDracoPolicy.IsSupported)
                {
                    if (rawModel.ExtensionsRequired.Contains("KHR_draco_mesh_compression"))
                    {
                        ThrowHelper.ThrowUnsupportedExtension(
                            "KHR_draco_mesh_compression",
                            "no Draco decoder is linked for this import.");
                    }

                    diagnostics.Add(new GltfDiagnostic(
                        GltfDiagnosticLevel.Warning,
                        "gltf.extension.unsupported",
                        "KHR_draco_mesh_compression was ignored because no Draco decoder is linked."));
                }

                PrimitiveLayout layoutInfo = BuildPrimitiveLayout(rawModel, prim, m, p);
                int vertexCount = layoutInfo.VertexCount;
                var attrLayouts = layoutInfo.Attributes;
                var attributeNames = layoutInfo.Names;
                var accessorIndices = layoutInfo.Accessors;
                var isCustomAttribute = layoutInfo.IsCustom;
                int totalInterleavedStride = layoutInfo.Stride;

                if (vertexCount < 0)
                {
                    ThrowHelper.ThrowSchema($"Mesh {m} primitive {p} has no supported vertex attributes.");
                }

                GltfDracoDecodedMesh? dracoMesh = null;
                if (prim.Draco.Present && TDracoPolicy.IsSupported)
                {
                    // KHR_draco_mesh_compression only allows triangle primitives.
                    if (prim.Mode is not (4 or 5))
                    {
                        ThrowHelper.ThrowSchema(
                            $"Mesh {m} primitive {p} uses KHR_draco_mesh_compression with mode {prim.Mode}; only TRIANGLES and TRIANGLE_STRIP are allowed.");
                    }

                    ReadOnlyMemory<byte> dracoBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                        prim.Draco.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                    GltfDracoDecodeStatus status = TDracoPolicy.TryDecodeMesh(
                        dracoBytes.Span,
                        new GltfDracoDecodeLimits(limits.MaxDecodedBytes),
                        out dracoMesh,
                        out long decodedBytes);

                    if (status != GltfDracoDecodeStatus.Success || dracoMesh == null)
                    {
                        if (status == GltfDracoDecodeStatus.LimitExceeded)
                        {
                            ThrowHelper.ThrowLimit("MaxDecodedBytes", decodedBytes, limits.MaxDecodedBytes);
                        }

                        if (status == GltfDracoDecodeStatus.Unsupported)
                        {
                            ThrowHelper.ThrowAccessor(
                                rawModel.GetAttributeOrDefault(prim.Attributes, GltfMeshSemantic.Position, -1),
                                "uses a Draco attribute layout the decoder cannot represent.");
                        }

                        ThrowHelper.ThrowSchema($"Mesh {m} primitive {p} Draco payload is not a decodable triangular mesh.");
                    }

                    if (dracoMesh.VertexCount != vertexCount)
                    {
                        ThrowHelper.ThrowAccessor(
                            rawModel.GetAttributeOrDefault(prim.Attributes, GltfMeshSemantic.Position, -1),
                            $"Draco vertex count {dracoMesh.VertexCount} does not match accessor count {vertexCount}.");
                    }
                }

                byte[] interleavedVertices = GC.AllocateUninitializedArray<byte>(vertexCount * totalInterleavedStride, pinned: true);
                GltfMeshBounds bounds = GltfMeshBounds.Empty;

                for (int a = 0; a < attrLayouts.Count; a++)
                {
                    GltfVertexAttribute layout = attrLayouts[a];
                    string semStr = attributeNames[a];
                    int accessorIndex = accessorIndices[a];
                    GltfRawModel.Accessor acc = rawModel.GetAccessor(accessorIndex);

                    int compSize = GltfAccessorRuntime.GetComponentByteSize(acc.ComponentType);
                    GltfAccessorRuntime.ValidateAccessorRange(rawModel, accessorIndex, layout.ComponentCount);
                    var decodedFloats = new float[vertexCount * layout.ComponentCount];

                    if (dracoMesh != null)
                    {
                        bool hasDracoAttribute = TryGetDracoAttributeId(
                            rawModel,
                            prim,
                            layout.Semantic,
                            semStr,
                            out int dracoAttributeId);
                        if (!hasDracoAttribute)
                        {
                            ThrowHelper.ThrowAccessor(accessorIndex, "is missing from the decoded Draco primitive.");
                        }

                        float[]? dracoValues = null;
                        bool hasDracoValues = dracoMesh.Attributes.TryGetValue(dracoAttributeId, out dracoValues);
                        if (!hasDracoValues || dracoValues == null)
                        {
                            ThrowHelper.ThrowAccessor(accessorIndex, "is missing from the decoded Draco primitive.");
                        }

                        if (dracoValues.Length != vertexCount * layout.ComponentCount)
                        {
                            ThrowHelper.ThrowAccessor(accessorIndex, "Draco attribute component count does not match its accessor.");
                        }

                        // Draco stores normalized integer accessors as raw
                        // integers; float-backed attributes are already in
                        // accessor units.
                        double inverseMax = 1d;
                        if (acc.Normalized)
                        {
                            if (!dracoMesh.AttributeDataTypes.TryGetValue(dracoAttributeId, out GltfDracoAttributeDataType dataType) ||
                                dataType is GltfDracoAttributeDataType.Unknown or GltfDracoAttributeDataType.Other)
                            {
                                ThrowHelper.ThrowAccessor(
                                    accessorIndex,
                                    "has a normalized Draco attribute with an unknown storage type.");
                            }

                            if (dataType != GltfDracoAttributeDataType.Float32)
                            {
                                inverseMax = 1d / GetIntegerDataTypeMax(dataType);
                            }
                        }

                        if (inverseMax == 1d)
                        {
                            dracoValues.AsSpan().CopyTo(decodedFloats);
                        }
                        else
                        {
                            for (int i = 0; i < dracoValues.Length; i++)
                            {
                                decodedFloats[i] = (float)(dracoValues[i] * inverseMax);
                            }
                        }
                    }
                    else
                    {
                        if (acc.BufferView >= 0)
                        {
                            ReadOnlyMemory<byte> viewBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                                acc.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                            ReadOnlySpan<byte> srcSpan = viewBytes.Span.Slice(acc.ByteOffset);
                            int srcStride = rawModel.BufferViews[acc.BufferView].ByteStride;
                            GltfAccessorRuntime.DecodeFloats(srcSpan, vertexCount, acc.ComponentType, layout.ComponentCount, srcStride, acc.Normalized, decodedFloats);
                        }
                        else if (!acc.Sparse.HasSparse)
                        {
                            ThrowHelper.ThrowAccessor(accessorIndex, "has neither a base bufferView nor sparse data.");
                        }

                        if (acc.Sparse.HasSparse)
                        {
                            if (acc.Sparse.Indices.BufferView < 0 || acc.Sparse.Values.BufferView < 0)
                            {
                                ThrowHelper.ThrowAccessor(accessorIndex, "has an invalid sparse bufferView reference.");
                            }

                            ReadOnlyMemory<byte> sparseIndexBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                                acc.Sparse.Indices.BufferView, rawModel, cancellationToken).ConfigureAwait(false);
                            ReadOnlyMemory<byte> sparseValueBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                                acc.Sparse.Values.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                            ReadOnlySpan<byte> idxSpan = sparseIndexBytes.Span.Slice(acc.Sparse.Indices.ByteOffset);
                            ReadOnlySpan<byte> valSpan = sparseValueBytes.Span.Slice(acc.Sparse.Values.ByteOffset);
                            GltfAccessorRuntime.MergeSparseFloats(
                                accessorIndex,
                                idxSpan,
                                acc.Sparse.Indices.ComponentType,
                                valSpan,
                                acc.Sparse.Count,
                                vertexCount,
                                acc.ComponentType,
                                layout.ComponentCount,
                                acc.Normalized,
                                decodedFloats);
                        }
                    }

                    for (int v = 0; v < vertexCount; v++)
                    {
                        int dstOffset = (v * totalInterleavedStride) + layout.Offset;
                        for (int c = 0; c < layout.ComponentCount; c++)
                        {
                            float val = decodedFloats[(v * layout.ComponentCount) + c];
                            int compDst = dstOffset + (c * compSize);

                            switch (acc.ComponentType)
                            {
                                case 5126:
                                    BinaryPrimitives.WriteSingleLittleEndian(interleavedVertices.AsSpan(compDst, 4), val);
                                    break;
                                case 5120:
                                    interleavedVertices[compDst] = layout.Normalized
                                        ? (byte)QuantizeSignedNormalized(val, 127f)
                                        : (byte)(sbyte)val;
                                    break;
                                case 5121:
                                    interleavedVertices[compDst] = layout.Normalized
                                        ? (byte)QuantizeUnsignedNormalized(val, 255f)
                                        : (byte)val;
                                    break;
                                case 5122:
                                    BinaryPrimitives.WriteInt16LittleEndian(
                                        interleavedVertices.AsSpan(compDst, 2),
                                        layout.Normalized ? (short)QuantizeSignedNormalized(val, 32767f) : (short)val);
                                    break;
                                case 5123:
                                    BinaryPrimitives.WriteUInt16LittleEndian(
                                        interleavedVertices.AsSpan(compDst, 2),
                                        layout.Normalized ? (ushort)QuantizeUnsignedNormalized(val, 65535f) : (ushort)val);
                                    break;
                                case 5125:
                                    BinaryPrimitives.WriteUInt32LittleEndian(
                                        interleavedVertices.AsSpan(compDst, 4),
                                        layout.Normalized ? QuantizeUnsignedNormalized32(val) : (uint)val);
                                    break;
                                default:
                                    break;
                            }
                        }
                    }

                    if (layout.Semantic == GltfMeshSemantic.Position)
                    {
                        bounds = GltfMeshPipeline.ComputeBounds(decodedFloats);
                    }
                }

                ImmutableArray<GltfMorphTargetDefinition> morphTargets =
                    await BuildMorphTargetsAsync<TMeshoptPolicy>(
                        rawModel,
                        resourceRuntime,
                        prim,
                        m,
                        p,
                        vertexCount,
                        diagnostics,
                        cancellationToken).ConfigureAwait(false);

                uint[] expandedIndices;
                if (dracoMesh != null)
                {
                    ImmutableArray<uint> dracoIndices = dracoMesh.Indices;
                    if (prim.HasIndices &&
                        (uint)prim.Indices < (uint)rawModel.AccessorCount &&
                        rawModel.GetAccessor(prim.Indices).Count != dracoIndices.Length)
                    {
                        ThrowHelper.ThrowAccessor(
                            prim.Indices,
                            $"Draco index count {dracoIndices.Length} does not match accessor count {rawModel.GetAccessor(prim.Indices).Count}.");
                    }

                    GltfAccessorRuntime.ValidateIndices(
                        dracoIndices.AsSpan(),
                        vertexCount,
                        prim.Indices);
                    expandedIndices = GltfMeshPipeline.ExpandTopology(prim.Mode, dracoIndices.AsSpan(), vertexCount);
                }
                else if (prim.HasIndices && (uint)prim.Indices < (uint)rawModel.AccessorCount)
                {
                    GltfRawModel.Accessor indexAcc = rawModel.GetAccessor(prim.Indices);
                    if (indexAcc.Type != GltfAccessorType.Scalar ||
                        indexAcc.ComponentType is not (5121 or 5123 or 5125))
                    {
                        ThrowHelper.ThrowAccessor(
                            prim.Indices,
                            "index accessors must use an unsigned SCALAR component type.");
                    }

                    GltfAccessorRuntime.ValidateAccessorRange(rawModel, prim.Indices, 1);
                    ReadOnlyMemory<byte> indexBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                        indexAcc.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                    var decodedRawIndices = new uint[indexAcc.Count];
                    {
                        ReadOnlySpan<byte> indexSpan = indexBytes.Span.Slice(indexAcc.ByteOffset);
                        GltfAccessorRuntime.DecodeIndices(indexSpan, indexAcc.Count, indexAcc.ComponentType, rawModel.BufferViews[indexAcc.BufferView].ByteStride, decodedRawIndices);
                    }

                    GltfAccessorRuntime.ValidateIndices(decodedRawIndices, vertexCount, prim.Indices);
                    expandedIndices = GltfMeshPipeline.ExpandTopology(prim.Mode, decodedRawIndices, vertexCount);
                }
                else
                {
                    expandedIndices = GltfMeshPipeline.ExpandTopology(prim.Mode, ReadOnlySpan<uint>.Empty, vertexCount);
                }

                (ReadOnlyMemory<byte> downcastedBytes, bool is16Bit) = GltfMeshPipeline.DowncastIndices(expandedIndices);

                var finalAttributes = ImmutableArray.CreateBuilder<GltfVertexAttribute>(attrLayouts.Count);
                var customAttributes = ImmutableArray.CreateBuilder<GltfCustomVertexAttribute>();
                for (int a = 0; a < attrLayouts.Count; a++)
                {
                    GltfVertexAttribute la = attrLayouts[a];
                    if (isCustomAttribute[a])
                    {
                        customAttributes.Add(new GltfCustomVertexAttribute(
                            attributeNames[a],
                            la.Offset,
                            totalInterleavedStride,
                            la.ComponentType,
                            la.ComponentCount,
                            la.Normalized,
                            la.Integer));
                        continue;
                    }

                    finalAttributes.Add(new GltfVertexAttribute(la.Offset, totalInterleavedStride, la.ComponentType, la.Semantic, la.ComponentCount, la.Normalized, la.Integer));
                }

                var definition = new GltfMeshDefinition(
                    meshAssetId,
                    interleavedVertices,
                    finalAttributes.ToImmutable(),
                    morphTargets,
                    downcastedBytes,
                    vertexCount,
                    expandedIndices.Length,
                    is16Bit,
                    prim.Mode == 0 ? GltfMeshTopology.Points : (prim.Mode is 1 or 2 or 3 ? GltfMeshTopology.Lines : GltfMeshTopology.Triangles))
                {
                    CustomAttributes = customAttributes.ToImmutable(),
                    MorphWeights = CopyWeights(rawModel, in meshDef),
                };

                int variantMappingCount = GltfRawModel.GetMaterialVariantCount(prim);
                var variantMappings = ImmutableArray.CreateBuilder<GltfMaterialVariantMapping>(variantMappingCount);
                for (int v = 0; v < variantMappingCount; v++)
                {
                    GltfRawModel.PrimitiveMaterialVariant mapping = rawModel.GetMaterialVariant(prim, v);
                    GltfSpan<int> variants = rawModel.GetVariants(mapping);
                    for (int variantIndex = 0; variantIndex < variants.Count; variantIndex++)
                    {
                        int index = variants[variantIndex];
                        if ((uint)index >= (uint)rawModel.Variants.Count)
                        {
                            ThrowHelper.ThrowSchema(
                                $"Mesh {m} primitive {p} maps an unknown material variant {index}.");
                        }
                    }

                    if (mapping.HasMaterial && (uint)mapping.Material >= (uint)rawModel.Materials.Count)
                    {
                        ThrowHelper.ThrowSchema(
                            $"Mesh {m} primitive {p} maps variant material {mapping.Material} which does not exist.");
                    }

                    variantMappings.Add(new GltfMaterialVariantMapping(
                        variants.AsSpan().ToArray().ToImmutableArray(),
                        mapping.HasMaterial ? mapping.Material : null));
                }

                meshes.Add(new GltfMeshAsset
                {
                    Id = meshAssetId,
                    MeshIndex = m,
                    PrimitiveIndex = p,
                    Definition = definition,
                    Bounds = bounds,
                    MaterialKey = prim.HasMaterial ? $"gltf/material/{prim.Material}" : null,
                    MaterialVariants = variantMappings.MoveToImmutable(),
                });
            }

            meshKeysByMesh.Add(primitiveKeys.MoveToImmutable());
        }

        return (meshes, meshKeysByMesh.MoveToImmutable());
    }

    private static double GetIntegerDataTypeMax(GltfDracoAttributeDataType dataType) =>
        dataType switch
        {
            GltfDracoAttributeDataType.Int8 => sbyte.MaxValue,
            GltfDracoAttributeDataType.UInt8 => byte.MaxValue,
            GltfDracoAttributeDataType.Int16 => short.MaxValue,
            GltfDracoAttributeDataType.UInt16 => ushort.MaxValue,
            GltfDracoAttributeDataType.Int32 => int.MaxValue,
            GltfDracoAttributeDataType.UInt32 => uint.MaxValue,
            _ => 1d,
        };

    private static sbyte QuantizeSignedNormalized(float value, float max) =>
        (sbyte)MathF.Round(Math.Clamp(value, -1f, 1f) * max);

    private static byte QuantizeUnsignedNormalized(float value, float max) =>
        (byte)MathF.Round(Math.Clamp(value, 0f, 1f) * max);

    private static uint QuantizeUnsignedNormalized32(float value) =>
        (uint)Math.Round(Math.Clamp((double)value, 0d, 1d) * uint.MaxValue);

    private sealed class PrimitiveLayout
    {
        public int VertexCount = -1;
        public int Stride;
        public List<GltfVertexAttribute> Attributes { get; } = new();
        public List<string> Names { get; } = new();
        public List<int> Accessors { get; } = new();
        public List<bool> IsCustom { get; } = new();
    }

    private static PrimitiveLayout BuildPrimitiveLayout(
        GltfRawModel rawModel,
        in GltfRawModel.Primitive prim,
        int meshIndex,
        int primitiveIndex)
    {
        GltfAttributeMap attributes = rawModel.GetAttributes(prim);
        var layout = new PrimitiveLayout();
        for (int a = 0; a < attributes.Count; a++)
        {
            GltfRawModel.Attribute attribute = attributes[a];
            int accessorIndex = attribute.Accessor;
            bool isCustom = attribute.Semantic == GltfMeshSemantic.Custom;
            string attributeName = isCustom
                ? rawModel.GetString(attribute.Name)
                : GetSemanticName(attribute.Semantic);

            if ((uint)accessorIndex >= (uint)rawModel.AccessorCount)
            {
                ThrowHelper.ThrowSchema(
                    $"Mesh {meshIndex} primitive {primitiveIndex} attribute '{attributeName}' references a missing accessor {accessorIndex}.");
            }

            GltfRawModel.Accessor accessor = rawModel.GetAccessor(accessorIndex);
            if (layout.VertexCount < 0)
            {
                layout.VertexCount = accessor.Count;
            }
            else if (accessor.Count != layout.VertexCount)
            {
                ThrowHelper.ThrowAccessor(
                    accessorIndex,
                    $"attribute vertex count {accessor.Count} does not match the primitive vertex count {layout.VertexCount}.");
            }

            int compCount = GltfAccessorRuntime.GetTypeElementCount(accessor.Type);
            int compByteSize = GltfAccessorRuntime.GetComponentByteSize(accessor.ComponentType);
            int attrSize = compCount * compByteSize;

            layout.Attributes.Add(new GltfVertexAttribute(
                layout.Stride,
                0,
                accessor.ComponentType,
                attribute.Semantic,
                (byte)compCount,
                accessor.Normalized,
                accessor.ComponentType != 5126));
            layout.Names.Add(attributeName);
            layout.Accessors.Add(accessorIndex);
            layout.IsCustom.Add(isCustom);
            layout.Stride += attrSize;
        }

        return layout;
    }

    private static async ValueTask<ImmutableArray<GltfMorphTargetDefinition>> BuildMorphTargetsAsync<TMeshoptPolicy>(
        GltfRawModel rawModel,
        GltfResourceRuntimeCache resourceRuntime,
        GltfRawModel.Primitive prim,
        int meshIndex,
        int primitiveIndex,
        int vertexCount,
        List<GltfDiagnostic> diagnostics,
        CancellationToken cancellationToken)
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
    {
        int targetCount = GltfRawModel.GetMorphTargetCount(prim);
        var builder = ImmutableArray.CreateBuilder<GltfMorphTargetDefinition>(targetCount);
        for (int t = 0; t < targetCount; t++)
        {
            int attributeCount = rawModel.GetAttributes(rawModel.GetMorphTarget(prim, t)).Count;
            for (int a = 0; a < attributeCount; a++)
            {
                GltfRawModel.Attribute attribute = rawModel
                    .GetAttributes(rawModel.GetMorphTarget(prim, t))[a];
                int accessorIndex = attribute.Accessor;
                string attributeName = attribute.Semantic == GltfMeshSemantic.Custom
                    ? rawModel.GetString(attribute.Name)
                    : GetSemanticName(attribute.Semantic);

                if ((uint)accessorIndex >= (uint)rawModel.AccessorCount)
                {
                    ThrowHelper.ThrowSchema(
                        $"Mesh {meshIndex} primitive {primitiveIndex} morph target {t} attribute '{attributeName}' references a missing accessor {accessorIndex}.");
                }

                GltfRawModel.Accessor targetAccessor = rawModel.GetAccessor(accessorIndex);
                int targetCompCount = GltfAccessorRuntime.GetTypeElementCount(targetAccessor.Type);
                if (targetAccessor.Count != vertexCount)
                {
                    ThrowHelper.ThrowAccessor(
                        accessorIndex,
                        $"morph target vertex count {targetAccessor.Count} does not match the primitive vertex count {vertexCount}.");
                }

                GltfMorphTargetSemantic morphSemantic;
                switch (attribute.Semantic)
                {
                    case GltfMeshSemantic.Position:
                        morphSemantic = GltfMorphTargetSemantic.Position;
                        break;
                    case GltfMeshSemantic.Normal:
                        morphSemantic = GltfMorphTargetSemantic.Normal;
                        break;
                    case GltfMeshSemantic.Tangent:
                        morphSemantic = GltfMorphTargetSemantic.Tangent;
                        break;
                    default:
                        diagnostics.Add(new GltfDiagnostic(
                            GltfDiagnosticLevel.Warning,
                            "gltf.mesh.target.attribute.unsupported",
                            $"Morph target attribute '{attributeName}' bypassed."));
                        continue;
                }

                GltfAccessorRuntime.ValidateAccessorRange(rawModel, accessorIndex, targetCompCount);

                ReadOnlyMemory<byte> targetBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                    targetAccessor.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                var deltaFloats = new float[targetAccessor.Count * targetCompCount];
                ReadOnlySpan<byte> targetSpan = targetBytes.Span.Slice(targetAccessor.ByteOffset);
                GltfAccessorRuntime.DecodeFloats(
                    targetSpan,
                    targetAccessor.Count,
                    targetAccessor.ComponentType,
                    targetCompCount,
                    rawModel.BufferViews[targetAccessor.BufferView].ByteStride,
                    false,
                    deltaFloats);

                byte[] deltaBytes = GC.AllocateUninitializedArray<byte>(deltaFloats.Length * 4, pinned: true);
                MemoryMarshal.Cast<float, byte>(deltaFloats).CopyTo(deltaBytes);

                builder.Add(new GltfMorphTargetDefinition(
                    morphSemantic,
                    deltaBytes,
                    targetCompCount * 4,
                    targetCompCount));
            }
        }

        return builder.ToImmutable();
    }

    private static bool TryGetDracoAttributeId(
        GltfRawModel rawModel,
        in GltfRawModel.Primitive prim,
        GltfMeshSemantic semantic,
        string attributeName,
        out int attributeId)
    {
        GltfAttributeMap attributes = rawModel.GetDracoAttributes(prim);
        if (semantic != GltfMeshSemantic.Custom)
        {
            return attributes.TryGet(semantic, out attributeId);
        }

        for (int i = 0; i < attributes.Count; i++)
        {
            GltfRawModel.Attribute attribute = attributes[i];
            if (attribute.Semantic == GltfMeshSemantic.Custom &&
                string.Equals(rawModel.GetString(attribute.Name), attributeName, StringComparison.Ordinal))
            {
                attributeId = attribute.Accessor;
                return true;
            }
        }

        attributeId = -1;
        return false;
    }

    private static string GetSemanticName(GltfMeshSemantic semantic) =>
        semantic switch
        {
            GltfMeshSemantic.Position => "POSITION",
            GltfMeshSemantic.Normal => "NORMAL",
            GltfMeshSemantic.Tangent => "TANGENT",
            GltfMeshSemantic.Uv0 => "TEXCOORD_0",
            GltfMeshSemantic.Uv1 => "TEXCOORD_1",
            GltfMeshSemantic.Uv2 => "TEXCOORD_2",
            GltfMeshSemantic.Uv3 => "TEXCOORD_3",
            GltfMeshSemantic.Color0 => "COLOR_0",
            GltfMeshSemantic.Color1 => "COLOR_1",
            GltfMeshSemantic.Joints0 => "JOINTS_0",
            GltfMeshSemantic.Joints1 => "JOINTS_1",
            GltfMeshSemantic.Weights0 => "WEIGHTS_0",
            GltfMeshSemantic.Weights1 => "WEIGHTS_1",
            _ => "CUSTOM",
        };

    private static string NodeName(GltfRawModel model, int index)
    {
        GltfRawModel.Node node = model.GetNode(index);
        return node.Name.IsEmpty ? "unnamed" : model.GetString(node.Name);
    }

    private static bool TryParseSemantic(string name, out GltfMeshSemantic semantic)
    {
        switch (name)
        {
            case "POSITION": semantic = GltfMeshSemantic.Position; return true;
            case "NORMAL": semantic = GltfMeshSemantic.Normal; return true;
            case "TEXCOORD_0": semantic = GltfMeshSemantic.Uv0; return true;
            case "TEXCOORD_1": semantic = GltfMeshSemantic.Uv1; return true;
            case "TEXCOORD_2": semantic = GltfMeshSemantic.Uv2; return true;
            case "TEXCOORD_3": semantic = GltfMeshSemantic.Uv3; return true;
            case "TANGENT": semantic = GltfMeshSemantic.Tangent; return true;
            case "COLOR_0": semantic = GltfMeshSemantic.Color0; return true;
            case "COLOR_1": semantic = GltfMeshSemantic.Color1; return true;
            case "JOINTS_0": semantic = GltfMeshSemantic.Joints0; return true;
            case "JOINTS_1": semantic = GltfMeshSemantic.Joints1; return true;
            case "WEIGHTS_0": semantic = GltfMeshSemantic.Weights0; return true;
            case "WEIGHTS_1": semantic = GltfMeshSemantic.Weights1; return true;
            default: semantic = default; return false;
        }
    }

    internal static async ValueTask<(List<GltfSkinAsset> Skins, ImmutableDictionary<int, string> SkinKeyMap)> CompileSkinsAsync<TMeshoptPolicy>(
        GltfRawModel rawModel,
        GltfResourceRuntimeCache resourceRuntime,
        CancellationToken cancellationToken)
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
    {
        var skins = new List<GltfSkinAsset>(rawModel.Skins.Count);
        var skinKeyMap = ImmutableDictionary.CreateBuilder<int, string>();

        for (int s = 0; s < rawModel.Skins.Count; s++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            GltfRawModel.Skin skinDef = rawModel.Skins[s];
            string skinId = $"gltf/skin/{s}";
            skinKeyMap[s] = skinId;

            var jointIds = ImmutableArray.CreateBuilder<string>(skinDef.Joints.Count);
            for (int j = 0; j < skinDef.Joints.Count; j++)
            {
                int jointIndex = skinDef.Joints[j];
                if (jointIndex < 0 || jointIndex >= rawModel.NodeCount)
                {
                    ThrowHelper.ThrowSchema($"Skin {s} references a missing joint node {jointIndex}.");
                }

                jointIds.Add($"node_{jointIndex}_{NodeName(rawModel, jointIndex)}");
            }

            if (skinDef.Skeleton.HasValue &&
                (skinDef.Skeleton.Value < 0 || skinDef.Skeleton.Value >= rawModel.NodeCount))
            {
                ThrowHelper.ThrowSchema($"Skin {s} references a missing skeleton node {skinDef.Skeleton.Value}.");
            }

            ReadOnlyMemory<float> rowMajorIbm = ReadOnlyMemory<float>.Empty;
            if (skinDef.InverseBindMatrices.HasValue)
            {
                int inverseBindAccessorIndex = skinDef.InverseBindMatrices.Value;
                if (inverseBindAccessorIndex < 0 || inverseBindAccessorIndex >= rawModel.AccessorCount)
                {
                    ThrowHelper.ThrowSchema($"Skin {s} references a missing inverse-bind accessor {inverseBindAccessorIndex}.");
                }

                GltfRawModel.Accessor ibmAcc = rawModel.GetAccessor(inverseBindAccessorIndex);
                if (ibmAcc.Type != GltfAccessorType.Mat4 ||
                    ibmAcc.ComponentType != 5126)
                {
                    ThrowHelper.ThrowAccessor(
                        inverseBindAccessorIndex,
                        "inverse bind matrices must use FLOAT MAT4 accessors.");
                }

                if (ibmAcc.Count != skinDef.Joints.Count)
                {
                    ThrowHelper.ThrowAccessor(
                        inverseBindAccessorIndex,
                        "inverse bind matrix count does not match the skin joint count.");
                }

                GltfAccessorRuntime.ValidateAccessorRange(rawModel, inverseBindAccessorIndex, 16);
                ReadOnlyMemory<byte> viewBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                    ibmAcc.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                var rawFloats = new float[ibmAcc.Count * 16];
                {
                    ReadOnlySpan<byte> srcSpan = viewBytes.Span.Slice(ibmAcc.ByteOffset);
                    GltfAccessorRuntime.DecodeFloats(srcSpan, ibmAcc.Count, ibmAcc.ComponentType, 16, rawModel.BufferViews[ibmAcc.BufferView].ByteStride, false, rawFloats);
                }

                float[] transposed = GC.AllocateUninitializedArray<float>(rawFloats.Length, pinned: true);
                for (int mIdx = 0; mIdx < ibmAcc.Count; mIdx++)
                {
                    int baseIdx = mIdx * 16;
                    for (int r = 0; r < 4; r++)
                    {
                        for (int c = 0; c < 4; c++)
                        {
                            transposed[baseIdx + (r * 4) + c] = rawFloats[baseIdx + (c * 4) + r];
                        }
                    }
                }

                rowMajorIbm = transposed;
            }

            skins.Add(new GltfSkinAsset
            {
                Id = skinId,
                SkinIndex = s,
                JointNodeIds = jointIds.MoveToImmutable(),
                JointNodeIndices = skinDef.Joints.ToImmutableArray(),
                SkeletonNodeId = skinDef.Skeleton.HasValue ? $"node_{skinDef.Skeleton.Value}_{NodeName(rawModel, skinDef.Skeleton.Value)}" : null,
                SkeletonNodeIndex = skinDef.Skeleton,
                InverseBindMatrices = rowMajorIbm,
            });
        }

        return (skins, skinKeyMap.ToImmutable());
    }

    internal static async ValueTask<List<GltfAnimationClipAsset>> CompileAnimationsAsync<TMeshoptPolicy>(
        GltfRawModel rawModel,
        GltfResourceRuntimeCache resourceRuntime,
        CancellationToken cancellationToken)
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
    {
        var animations = new List<GltfAnimationClipAsset>(rawModel.Animations.Count);

        for (int a = 0; a < rawModel.Animations.Count; a++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            GltfRawModel.Animation animDef = rawModel.Animations[a];
            string animId = $"gltf/animation/{a}";

            var tracks = ImmutableArray.CreateBuilder<GltfAnimationTrackAsset>(animDef.Channels.Count);
            float maxDuration = 0.0f;

            for (int c = 0; c < animDef.Channels.Count; c++)
            {
                GltfRawModel.AnimationChannel chan = animDef.Channels[c];
                if (chan.Sampler < 0 || chan.Sampler >= animDef.Samplers.Count)
                {
                    ThrowHelper.ThrowSchema($"Animation {a} channel {c} references a missing sampler {chan.Sampler}.");
                }

                GltfRawModel.AnimationSampler samp = animDef.Samplers[chan.Sampler];
                if (samp.Input < 0 || samp.Input >= rawModel.AccessorCount ||
                    samp.Output < 0 || samp.Output >= rawModel.AccessorCount)
                {
                    ThrowHelper.ThrowSchema($"Animation {a} sampler {chan.Sampler} references a missing accessor.");
                }

                bool isPointer = !string.IsNullOrEmpty(chan.Pointer);
                if (isPointer)
                {
                    if (chan.TargetNode >= rawModel.NodeCount)
                    {
                        ThrowHelper.ThrowSchema($"Animation {a} channel {c} references a missing target node {chan.TargetNode}.");
                    }
                }
                else if (chan.TargetNode < 0 || chan.TargetNode >= rawModel.NodeCount)
                {
                    ThrowHelper.ThrowSchema($"Animation {a} channel {c} references a missing target node {chan.TargetNode}.");
                }

                GltfRawModel.Accessor inAcc = rawModel.GetAccessor(samp.Input);
                GltfRawModel.Accessor outAcc = rawModel.GetAccessor(samp.Output);
                if (inAcc.Type != GltfAccessorType.Scalar ||
                    inAcc.ComponentType != 5126)
                {
                    ThrowHelper.ThrowAccessor(samp.Input, "animation input must use FLOAT SCALAR accessors.");
                }

                if (outAcc.ComponentType != 5126)
                {
                    ThrowHelper.ThrowAccessor(samp.Output, "animation output must use FLOAT components.");
                }

                if (inAcc.BufferView < 0 || outAcc.BufferView < 0)
                {
                    ThrowHelper.ThrowAccessor(
                        inAcc.BufferView < 0 ? samp.Input : samp.Output,
                        "animation accessors must be backed by a bufferView.");
                }

                GltfAccessorRuntime.ValidateAccessorRange(rawModel, samp.Input, 1);

                ReadOnlyMemory<byte> inBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                    inAcc.BufferView, rawModel, cancellationToken).ConfigureAwait(false);
                ReadOnlyMemory<byte> outBytes = await resourceRuntime.ResolveBufferViewAsync<TMeshoptPolicy>(
                    outAcc.BufferView, rawModel, cancellationToken).ConfigureAwait(false);

                var times = new float[inAcc.Count];
                {
                    ReadOnlySpan<byte> inSpan = inBytes.Span.Slice(inAcc.ByteOffset);
                    GltfAccessorRuntime.DecodeFloats(inSpan, inAcc.Count, inAcc.ComponentType, 1, rawModel.BufferViews[inAcc.BufferView].ByteStride, false, times);
                }

                for (int t = 1; t < times.Length; t++)
                {
                    if (times[t] < 0.0f || times[t] < times[t - 1])
                    {
                        ThrowHelper.ThrowAccessor(samp.Input, "animation input times must be non-negative and sorted.");
                    }
                }

                if (times.Length > 0 && times[^1] > maxDuration)
                {
                    maxDuration = times[^1];
                }

                GltfAnimationPath path;
                if (isPointer)
                {
                    path = GltfAnimationPath.Pointer;
                }
                else
                {
                    string pathText = chan.TargetPath.ToLowerInvariant();
                    if (pathText is not ("translation" or "rotation" or "scale" or "weights"))
                    {
                        ThrowHelper.ThrowSchema($"Animation {a} channel {c} has unsupported target path '{chan.TargetPath}'.");
                    }

                    path = pathText switch
                    {
                        "rotation" => GltfAnimationPath.Rotation,
                        "scale" => GltfAnimationPath.Scale,
                        "weights" => GltfAnimationPath.Weights,
                        _ => GltfAnimationPath.Translation,
                    };
                }

                string interpolationText = samp.Interpolation.ToUpperInvariant();
                if (interpolationText is not ("LINEAR" or "STEP" or "CUBICSPLINE"))
                {
                    ThrowHelper.ThrowSchema($"Animation {a} sampler {chan.Sampler} has unsupported interpolation '{samp.Interpolation}'.");
                }

                GltfInterpolation interp = interpolationText switch
                {
                    "STEP" => GltfInterpolation.Step,
                    "CUBICSPLINE" => GltfInterpolation.CubicSpline,
                    _ => GltfInterpolation.Linear,
                };

                int keyframeCount = inAcc.Count;
                int sampleMultiplier = interp == GltfInterpolation.CubicSpline ? 3 : 1;
                int expectedOutputElements = keyframeCount * sampleMultiplier;
                int valCompCount;

                if (path == GltfAnimationPath.Weights)
                {
                    if (expectedOutputElements <= 0 || outAcc.Count % expectedOutputElements != 0)
                    {
                        ThrowHelper.ThrowAccessor(samp.Output, "morph weight output count does not align with its keyframes.");
                    }

                    valCompCount = outAcc.Count / expectedOutputElements;
                }
                else if (path == GltfAnimationPath.Pointer)
                {
                    valCompCount = GltfAccessorRuntime.GetTypeElementCount(outAcc.Type);
                    if (valCompCount <= 0 || outAcc.Count != expectedOutputElements)
                    {
                        ThrowHelper.ThrowAccessor(samp.Output, "animation pointer output count does not match its keyframes and component type.");
                    }
                }
                else
                {
                    valCompCount = GltfAccessorRuntime.GetTypeElementCount(outAcc.Type);
                    int expectedComponentCount = path == GltfAnimationPath.Rotation ? 4 : 3;
                    if (valCompCount != expectedComponentCount || outAcc.Count != expectedOutputElements)
                    {
                        ThrowHelper.ThrowAccessor(samp.Output, "animation output count does not match its keyframes and component type.");
                    }
                }

                int sampleStride = sampleMultiplier * valCompCount;
                GltfAccessorRuntime.ValidateAccessorRange(
                    rawModel,
                    samp.Output,
                    GltfAccessorRuntime.GetTypeElementCount(outAcc.Type));
                var values = new float[keyframeCount * sampleStride];
                {
                    ReadOnlySpan<byte> outSpan = outBytes.Span.Slice(outAcc.ByteOffset);
                    GltfAccessorRuntime.DecodeFloats(
                        outSpan,
                        expectedOutputElements,
                        outAcc.ComponentType,
                        valCompCount,
                        rawModel.BufferViews[outAcc.BufferView].ByteStride,
                        outAcc.Normalized,
                        values);
                }

                tracks.Add(new GltfAnimationTrackAsset
                {
                    ChannelIndex = c,
                    SamplerIndex = chan.Sampler,
                    InputAccessor = samp.Input,
                    OutputAccessor = samp.Output,
                    TargetNodeIndex = chan.TargetNode,
                    TargetNodeId = chan.TargetNode >= 0 ? $"node_{chan.TargetNode}_{NodeName(rawModel, chan.TargetNode)}" : string.Empty,
                    Path = path,
                    Pointer = isPointer ? chan.Pointer : null,
                    Interpolation = interp,
                    KeyframeCount = keyframeCount,
                    ValueComponentCount = valCompCount,
                    SampleStride = sampleStride,
                    SampleMultiplier = sampleMultiplier,
                    Times = times,
                    Values = values,
                });
            }

            animations.Add(new GltfAnimationClipAsset
            {
                Id = animId,
                AnimationIndex = a,
                Duration = maxDuration,
                Tracks = tracks.MoveToImmutable(),
            });
        }

        return animations;
    }
}

/// <summary>Convenience importer with default (null) compression policies.</summary>
public sealed class GltfImporter
{
    private readonly GltfImporterOptions _options;

    /// <summary>Creates an importer.</summary>
    public GltfImporter(GltfImporterOptions? options = null)
    {
        _options = options ?? new GltfImporterOptions();
    }

    /// <summary>Imports glTF or GLB bytes with the default null codecs.</summary>
    public ValueTask<GltfImportResult> ImportAsync(
        ReadOnlyMemory<byte> sourceBytes,
        CancellationToken cancellationToken = default) =>
        ImportAsync<NoDracoCompressionPolicy, NoMeshoptCompressionPolicy, PassthroughTranscoderPolicy>(
            sourceBytes,
            cancellationToken);

    /// <summary>Imports glTF or GLB bytes with explicit compression policies.</summary>
    public async ValueTask<GltfImportResult> ImportAsync<TDracoPolicy, TMeshoptPolicy, TTranscoderPolicy>(
        ReadOnlyMemory<byte> sourceBytes,
        CancellationToken cancellationToken = default)
        where TDracoPolicy : struct, IDracoMeshPolicy
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
        where TTranscoderPolicy : struct, ITextureTranscoderPolicy
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (sourceBytes.Length > _options.Limits.MaxSourceBytes)
        {
            ThrowHelper.ThrowLimit("MaxSourceBytes", sourceBytes.Length, _options.Limits.MaxSourceBytes);
        }

        GltfPipeline<StateUnparsed> pipeline = GltfPipeline<StateUnparsed>.Create(sourceBytes);
        GltfPipeline<StateSchemaParsed> parsed = pipeline.ParseSchema(_options.Limits, cancellationToken);
        GltfPipeline<StateResolved> resolved = parsed.ResolveResources(_options.ResourceResolver);

        return await resolved.CompileAsync<TDracoPolicy, TMeshoptPolicy, TTranscoderPolicy>(
            _options,
            cancellationToken).ConfigureAwait(false);
    }
}
