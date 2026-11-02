namespace Axrone.AssetGltf;

/// <summary>Canonical imported glTF document.</summary>
public sealed class GltfDocumentAsset
{
    /// <summary>Document identity.</summary>
    public required string Id { get; init; }

    /// <summary>Source URI.</summary>
    public string? Uri { get; init; }

    /// <summary>Document name.</summary>
    public required string Name { get; init; }

    /// <summary>Container format (glb/gltf).</summary>
    public required string Format { get; init; }

    /// <summary>glTF version.</summary>
    public required string Version { get; init; }

    /// <summary>Generator string.</summary>
    public string? Generator { get; init; }

    /// <summary>Copyright string.</summary>
    public string? Copyright { get; init; }

    /// <summary>Default scene index.</summary>
    public int DefaultScene { get; init; }

    /// <summary>Scene assets.</summary>
    public required ImmutableArray<GltfDocumentSceneAsset> Scenes { get; init; }

    /// <summary>Mesh asset keys.</summary>
    public required ImmutableArray<string> MeshKeys { get; init; }

    /// <summary>Skin asset keys.</summary>
    public required ImmutableArray<string> SkinKeys { get; init; }

    /// <summary>Animation asset keys.</summary>
    public required ImmutableArray<string> AnimationKeys { get; init; }

    /// <summary>Material asset keys.</summary>
    public required ImmutableArray<string> MaterialKeys { get; init; }

    /// <summary>Texture asset keys.</summary>
    public required ImmutableArray<string> TextureKeys { get; init; }

    /// <summary>Used extensions.</summary>
    public required ImmutableArray<string> ExtensionsUsed { get; init; }

    /// <summary>Required extensions.</summary>
    public required ImmutableArray<string> ExtensionsRequired { get; init; }

    /// <summary>Named material variants.</summary>
    public ImmutableArray<GltfMaterialVariant> MaterialVariants { get; init; } = ImmutableArray<GltfMaterialVariant>.Empty;

    /// <summary>Import statistics.</summary>
    public required GltfDocumentStats Stats { get; init; }
}

/// <summary>Named material variant.</summary>
public sealed record GltfMaterialVariant(int Index, string Name);

/// <summary>Primitive material selection for one or more variants.</summary>
public readonly record struct GltfMaterialVariantMapping(
    ImmutableArray<int> Variants,
    int? MaterialIndex);

/// <summary>Import statistics.</summary>
public readonly record struct GltfDocumentStats(
    int SceneCount,
    int NodeCount,
    int CameraCount,
    int LightCount,
    int MeshCount,
    int PrimitiveCount,
    int MaterialCount,
    int TextureCount,
    int SkinCount,
    int AnimationCount);

/// <summary>Canonical scene asset.</summary>
public sealed class GltfDocumentSceneAsset
{
    /// <summary>Scene index.</summary>
    public required int SceneIndex { get; init; }

    /// <summary>Scene name.</summary>
    public required string Name { get; init; }

    /// <summary>Prefab key.</summary>
    public required string PrefabKey { get; init; }

    /// <summary>Root node ids.</summary>
    public required ImmutableArray<string> RootNodeIds { get; init; }

    /// <summary>Animation controller metadata.</summary>
    public GltfAnimationControllerMetadata? AnimationController { get; init; }
}

/// <summary>Canonical prefab asset.</summary>
public sealed class GltfPrefabAsset
{
    /// <summary>Prefab identity.</summary>
    public required string Id { get; init; }

    /// <summary>Scene index.</summary>
    public required int SceneIndex { get; init; }

    /// <summary>Prefab definition.</summary>
    public required GltfPrefabDefinition Definition { get; init; }

    /// <summary>Root node ids.</summary>
    public required ImmutableArray<string> RootNodeIds { get; init; }

    /// <summary>All node ids.</summary>
    public required ImmutableArray<string> NodeIds { get; init; }

    /// <summary>Mesh keys.</summary>
    public required ImmutableArray<string> MeshKeys { get; init; }

    /// <summary>Skin keys.</summary>
    public required ImmutableArray<string> SkinKeys { get; init; }

    /// <summary>Animation keys.</summary>
    public required ImmutableArray<string> AnimationKeys { get; init; }

    /// <summary>Material keys.</summary>
    public required ImmutableArray<string> MaterialKeys { get; init; }

    /// <summary>Animation controller metadata.</summary>
    public GltfAnimationControllerMetadata? AnimationController { get; init; }
}

/// <summary>Canonical mesh asset (one primitive).</summary>
public sealed class GltfMeshAsset
{
    /// <summary>Mesh identity.</summary>
    public required string Id { get; init; }

    /// <summary>Mesh index.</summary>
    public required int MeshIndex { get; init; }

    /// <summary>Primitive index.</summary>
    public required int PrimitiveIndex { get; init; }

    /// <summary>Mesh definition.</summary>
    public required GltfMeshDefinition Definition { get; init; }

    /// <summary>Computed bounds.</summary>
    public GltfMeshBounds? Bounds { get; init; }

    /// <summary>Material key.</summary>
    public string? MaterialKey { get; init; }

    /// <summary>Extras payload.</summary>
    public ImmutableDictionary<string, object>? Extras { get; init; }

    /// <summary>KHR_materials_variants mappings.</summary>
    public ImmutableArray<GltfMaterialVariantMapping> MaterialVariants { get; init; } =
        ImmutableArray<GltfMaterialVariantMapping>.Empty;
}

/// <summary>Morph target delta buffer.</summary>
public readonly record struct GltfMorphTargetDefinition(
    GltfMorphTargetSemantic Semantic,
    ReadOnlyMemory<byte> DeltaBuffer,
    int Stride,
    int ComponentCount);

/// <summary>Application-specific vertex attribute preserved in the interleaved buffer.</summary>
public readonly record struct GltfCustomVertexAttribute(
    string Name,
    int Offset,
    int Stride,
    int ComponentType,
    byte ComponentCount,
    bool Normalized,
    bool Integer);

/// <summary>Interleaved mesh definition.</summary>
public readonly record struct GltfMeshDefinition(
    string Id,
    ReadOnlyMemory<byte> Vertices,
    ImmutableArray<GltfVertexAttribute> Attributes,
    ImmutableArray<GltfMorphTargetDefinition> MorphTargets,
    ReadOnlyMemory<byte> Indices,
    int VertexCount,
    int IndexCount,
    bool Index16Bit,
    GltfMeshTopology Topology)
{
    /// <summary>Attributes with application-specific names (<c>_NAME</c>).</summary>
    public ImmutableArray<GltfCustomVertexAttribute> CustomAttributes { get; init; } =
        ImmutableArray<GltfCustomVertexAttribute>.Empty;

    /// <summary>Default morph weights declared by the mesh.</summary>
    public ImmutableArray<float> MorphWeights { get; init; } = ImmutableArray<float>.Empty;
}

/// <summary>Canonical skin asset.</summary>
public sealed class GltfSkinAsset
{
    /// <summary>Skin identity.</summary>
    public required string Id { get; init; }

    /// <summary>Skin index.</summary>
    public required int SkinIndex { get; init; }

    /// <summary>Joint node ids.</summary>
    public required ImmutableArray<string> JointNodeIds { get; init; }

    /// <summary>Joint node indices.</summary>
    public required ImmutableArray<int> JointNodeIndices { get; init; }

    /// <summary>Skeleton node id.</summary>
    public string? SkeletonNodeId { get; init; }

    /// <summary>Skeleton node index.</summary>
    public int? SkeletonNodeIndex { get; init; }

    /// <summary>Row-major inverse bind matrices.</summary>
    public ReadOnlyMemory<float> InverseBindMatrices { get; init; }
}

/// <summary>Canonical animation clip asset.</summary>
public sealed class GltfAnimationClipAsset
{
    /// <summary>Clip identity.</summary>
    public required string Id { get; init; }

    /// <summary>Animation index.</summary>
    public required int AnimationIndex { get; init; }

    /// <summary>Duration seconds.</summary>
    public required float Duration { get; init; }

    /// <summary>Tracks.</summary>
    public required ImmutableArray<GltfAnimationTrackAsset> Tracks { get; init; }

    /// <summary>Tags.</summary>
    public ImmutableArray<string> Tags { get; init; } = ImmutableArray<string>.Empty;
}

/// <summary>Canonical animation track asset.</summary>
public sealed class GltfAnimationTrackAsset
{
    /// <summary>Channel index.</summary>
    public required int ChannelIndex { get; init; }

    /// <summary>Sampler index.</summary>
    public required int SamplerIndex { get; init; }

    /// <summary>Input accessor.</summary>
    public required int InputAccessor { get; init; }

    /// <summary>Output accessor.</summary>
    public required int OutputAccessor { get; init; }

    /// <summary>Target node index.</summary>
    public required int TargetNodeIndex { get; init; }

    /// <summary>Target node id.</summary>
    public required string TargetNodeId { get; init; }

    /// <summary>Target path.</summary>
    public required GltfAnimationPath Path { get; init; }

    /// <summary>KHR_animation_pointer JSON pointer, when present.</summary>
    public string? Pointer { get; init; }

    /// <summary>Interpolation.</summary>
    public required GltfInterpolation Interpolation { get; init; }

    /// <summary>Keyframe count.</summary>
    public required int KeyframeCount { get; init; }

    /// <summary>Value component count.</summary>
    public required int ValueComponentCount { get; init; }

    /// <summary>Sample stride.</summary>
    public required int SampleStride { get; init; }

    /// <summary>Samples per keyframe: 1 normally, 3 for cubic splines.</summary>
    public int SampleMultiplier { get; init; } = 1;

    /// <summary>Keyframe times.</summary>
    public required ReadOnlyMemory<float> Times { get; init; }

    /// <summary>Keyframe values.</summary>
    public required ReadOnlyMemory<float> Values { get; init; }
}

/// <summary>Material texture binding.</summary>
public sealed class GltfMaterialTextureBinding
{
    /// <summary>Texture key.</summary>
    public required string TextureKey { get; init; }

    /// <summary>UV set.</summary>
    public required int TexCoord { get; init; }

    /// <summary>Texture scale.</summary>
    public float Scale { get; init; } = 1.0f;

    /// <summary>Texture strength.</summary>
    public float Strength { get; init; } = 1.0f;

    /// <summary>UV transform.</summary>
    public GltfTextureTransform Transform { get; init; } = GltfTextureTransform.Default;
}

/// <summary>Material shader definition.</summary>
public sealed class GltfMaterialDefinition
{
    /// <summary>Shader id.</summary>
    public required string ShaderId { get; init; }

    /// <summary>Float array uniforms.</summary>
    public required ImmutableDictionary<string, float[]> FloatUniforms { get; init; }

    /// <summary>Scalar uniforms.</summary>
    public required ImmutableDictionary<string, float> ScalarUniforms { get; init; }

    /// <summary>Integer uniforms.</summary>
    public required ImmutableDictionary<string, int> IntUniforms { get; init; }
}

/// <summary>Canonical material asset.</summary>
public sealed class GltfMaterialAsset
{
    /// <summary>Material identity.</summary>
    public required string Id { get; init; }

    /// <summary>Material index.</summary>
    public required int MaterialIndex { get; init; }

    /// <summary>Material definition.</summary>
    public required GltfMaterialDefinition Definition { get; init; }

    /// <summary>Alpha mode.</summary>
    public required GltfAlphaMode AlphaMode { get; init; }

    /// <summary>Alpha cutoff.</summary>
    public required float AlphaCutoff { get; init; }

    /// <summary>Double-sided flag.</summary>
    public required bool DoubleSided { get; init; }

    /// <summary>Unlit flag.</summary>
    public required bool Unlit { get; init; }

    /// <summary>Texture bindings by usage.</summary>
    public required ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding> Textures { get; init; }
}

/// <summary>Texture transcode state.</summary>
public readonly record struct GltfTextureTranscodeState(
    bool Success,
    string? TranscoderId,
    string? FailureReason,
    GltfTextureFormat TargetFormat);

/// <summary>Canonical texture asset.</summary>
public sealed class GltfTextureAsset
{
    /// <summary>Texture identity.</summary>
    public required string Id { get; init; }

    /// <summary>Texture index.</summary>
    public required int TextureIndex { get; init; }

    /// <summary>Image index.</summary>
    public required int ImageIndex { get; init; }

    /// <summary>Sampler parameters.</summary>
    public required GltfTextureSampler Sampler { get; init; }

    /// <summary>Texture payload.</summary>
    public required GltfTexturePayload Payload { get; init; }

    /// <summary>Usage hints.</summary>
    public required ImmutableArray<GltfTextureUsage> UsageHints { get; init; }

    /// <summary>Runtime format.</summary>
    public GltfTextureFormat RuntimeFormat { get; init; }

    /// <summary>Transcode state.</summary>
    public GltfTextureTranscodeState TranscodeState { get; init; }
}

/// <summary>Canonical import result.</summary>
public sealed class GltfImportResult
{
    /// <summary>Document asset.</summary>
    public required GltfDocumentAsset Document { get; init; }

    /// <summary>Prefab assets.</summary>
    public required ImmutableArray<GltfPrefabAsset> Prefabs { get; init; }

    /// <summary>Mesh assets.</summary>
    public required ImmutableArray<GltfMeshAsset> Meshes { get; init; }

    /// <summary>Skin assets.</summary>
    public required ImmutableArray<GltfSkinAsset> Skins { get; init; }

    /// <summary>Animation assets.</summary>
    public required ImmutableArray<GltfAnimationClipAsset> Animations { get; init; }

    /// <summary>Material assets.</summary>
    public required ImmutableArray<GltfMaterialAsset> Materials { get; init; }

    /// <summary>Texture assets.</summary>
    public required ImmutableArray<GltfTextureAsset> Textures { get; init; }

    /// <summary>Import diagnostics.</summary>
    public required ImmutableArray<GltfDiagnostic> Diagnostics { get; init; }
}
