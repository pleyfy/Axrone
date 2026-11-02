namespace Axrone.AssetGltf;

/// <summary>Raw glTF schema model (parsed JSON, unresolved).</summary>
/// <remarks>
/// High-volume geometry entities (nodes, meshes, primitives, accessors) live in
/// pooled value-type slabs owned by <see cref="GltfParseArena"/>. Low-volume or
/// deeply nested blocks (materials, textures, animations) remain reference types.
/// The document must be disposed after the compile stage consumes it; no span or
/// slice may escape that scope.
/// </remarks>
internal sealed class GltfRawModel : IDisposable
{
    private readonly GltfParseArena _arena;

    /// <summary>Creates an empty model with the given parse limits.</summary>
    public GltfRawModel(GltfImportLimits? limits = null, CancellationToken cancellationToken = default)
    {
        _arena = new GltfParseArena(limits ?? GltfImportLimits.Default, cancellationToken);
    }

    /// <summary>Transient parse storage used by the parser.</summary>
    public GltfParseArena Arena => _arena;

    /// <summary>Whether the pooled storage has been returned.</summary>
    public bool IsDisposed => _arena.IsDisposed;

    /// <summary>Node count.</summary>
    public int NodeCount => _arena.NodeCount;

    /// <summary>Mesh count.</summary>
    public int MeshCount => _arena.MeshCount;

    /// <summary>Primitive count.</summary>
    public int PrimitiveCount => _arena.PrimitiveCount;

    /// <summary>Accessor count.</summary>
    public int AccessorCount => _arena.AccessorCount;

    /// <summary>Nodes.</summary>
    public GltfSpan<Node> Nodes => _arena.Nodes;

    /// <summary>Meshes.</summary>
    public GltfSpan<Mesh> Meshes => _arena.Meshes;

    /// <summary>Accessors.</summary>
    public GltfSpan<Accessor> Accessors => _arena.Accessors;

    /// <summary>BufferViews (reference type: nested meshopt payload).</summary>
    public List<BufferView> BufferViews { get; } = new();

    /// <summary>Buffers.</summary>
    public List<Buffer> Buffers { get; } = new();

    /// <summary>Materials.</summary>
    public List<Material> Materials { get; } = new();

    /// <summary>Textures.</summary>
    public List<Texture> Textures { get; } = new();

    /// <summary>Images.</summary>
    public List<Image> Images { get; } = new();

    /// <summary>Samplers.</summary>
    public List<Sampler> Samplers { get; } = new();

    /// <summary>Skins.</summary>
    public List<Skin> Skins { get; } = new();

    /// <summary>Animations.</summary>
    public List<Animation> Animations { get; } = new();

    /// <summary>Lights.</summary>
    public List<Light> Lights { get; } = new();

    /// <summary>Material variants.</summary>
    public List<MaterialVariant> Variants { get; } = new();

    /// <summary>Cameras.</summary>
    public List<Camera> Cameras { get; } = new();

    /// <summary>Scenes.</summary>
    public List<Scene> Scenes { get; } = new();

    /// <summary>Asset version string.</summary>
    public GltfStringRef Version { get; set; }

    /// <summary>Generator string.</summary>
    public GltfStringRef Generator { get; set; }

    /// <summary>Copyright string.</summary>
    public GltfStringRef Copyright { get; set; }

    /// <summary>Default scene index (-1 when unset).</summary>
    public int DefaultScene { get; set; } = -1;

    /// <summary>Used extensions.</summary>
    public HashSet<string> ExtensionsUsed { get; } = new(StringComparer.Ordinal);

    /// <summary>Required extensions.</summary>
    public HashSet<string> ExtensionsRequired { get; } = new(StringComparer.Ordinal);

    /// <summary>Returns one node by index.</summary>
    public Node GetNode(int index) => _arena.GetNode(index);

    /// <summary>Returns one mesh by index.</summary>
    public Mesh GetMesh(int index) => _arena.GetMesh(index);

    /// <summary>Returns one accessor by index.</summary>
    public Accessor GetAccessor(int index) => _arena.GetAccessor(index);

    /// <summary>Resolves a mesh's primitive slice.</summary>
    public GltfSpan<Primitive> GetPrimitives(in Mesh mesh) => _arena.GetPrimitives(mesh.Primitives);

    /// <summary>Returns one primitive of a mesh.</summary>
    public Primitive GetPrimitive(in Mesh mesh, int index) =>
        _arena.GetPrimitive(mesh.Primitives.Offset + index);

    /// <summary>Resolves a primitive attribute map.</summary>
    public GltfAttributeMap GetAttributes(in Primitive primitive) =>
        _arena.GetAttributes(primitive.Attributes);

    /// <summary>Resolves a Draco attribute map.</summary>
    public GltfAttributeMap GetDracoAttributes(in Primitive primitive) =>
        _arena.GetAttributes(primitive.Draco.Attributes);

    /// <summary>Resolves a morph target attribute map.</summary>
    public GltfAttributeMap GetAttributes(in MorphTarget target) =>
        _arena.GetAttributes(target.Attributes);

    /// <summary>Morph target count for a primitive.</summary>
    public static int GetMorphTargetCount(in Primitive primitive) => primitive.Targets.Length;

    /// <summary>Returns one morph target.</summary>
    public MorphTarget GetMorphTarget(in Primitive primitive, int index) =>
        _arena.GetMorphTarget(primitive.Targets.Offset + index);

    /// <summary>Material-variant mapping count for a primitive.</summary>
    public static int GetMaterialVariantCount(in Primitive primitive) => primitive.MaterialVariants.Length;

    /// <summary>Returns one material-variant mapping.</summary>
    public PrimitiveMaterialVariant GetMaterialVariant(in Primitive primitive, int index) =>
        _arena.GetMaterialVariant(primitive.MaterialVariants.Offset + index);

    /// <summary>Resolves a mapping's variant-index slice.</summary>
    public GltfSpan<int> GetVariants(in PrimitiveMaterialVariant mapping) => _arena.GetInts(mapping.Variants);

    /// <summary>Child count for a node.</summary>
    public static int GetChildCount(in Node node) => node.Children.Length;

    /// <summary>Returns one child node index.</summary>
    public int GetChild(in Node node, int index) => _arena.GetInt(node.Children.Offset + index);

    /// <summary>Morph weight count for a node.</summary>
    public static int GetWeightCount(in Node node) => node.Weights.Length;

    /// <summary>Returns one morph weight.</summary>
    public float GetWeight(in Node node, int index) => _arena.GetFloat(node.Weights.Offset + index);

    /// <summary>Morph weight count for a mesh.</summary>
    public static int GetWeightCount(in Mesh mesh) => mesh.Weights.Length;

    /// <summary>Returns one default morph weight.</summary>
    public float GetWeight(in Mesh mesh, int index) => _arena.GetFloat(mesh.Weights.Offset + index);

    /// <summary>Returns an accessor min/max component.</summary>
    public GltfSpan<float> GetMin(in Accessor accessor) => _arena.GetFloats(accessor.Min);

    /// <summary>Returns an accessor max component.</summary>
    public GltfSpan<float> GetMax(in Accessor accessor) => _arena.GetFloats(accessor.Max);

    /// <summary>Materializes one arena string.</summary>
    public string GetString(GltfStringRef value) => _arena.GetString(value);

    /// <summary>Returns raw UTF-8 bytes for one arena string.</summary>
    public ReadOnlySpan<byte> GetStringBytes(GltfStringRef value) => _arena.GetStringBytes(value);

    /// <summary>Looks up a standard semantic in an attribute map.</summary>
    public bool TryGetAttribute(
        GltfSlice<Attribute> attributes,
        GltfMeshSemantic semantic,
        out int accessor)
    {
        ReadOnlySpan<Attribute> span = _arena.GetAttributes(attributes).AsSpan();
        for (int i = 0; i < span.Length; i++)
        {
            if (span[i].Semantic == semantic)
            {
                accessor = span[i].Accessor;
                return true;
            }
        }

        accessor = -1;
        return false;
    }

    /// <summary>Looks up a custom attribute by UTF-8 name.</summary>
    public bool TryGetAttribute(
        GltfSlice<Attribute> attributes,
        GltfStringRef name,
        out int accessor)
    {
        ReadOnlySpan<Attribute> span = _arena.GetAttributes(attributes).AsSpan();
        ReadOnlySpan<byte> target = GetStringBytes(name);
        for (int i = 0; i < span.Length; i++)
        {
            if (span[i].Semantic == GltfMeshSemantic.Custom &&
                GetStringBytes(span[i].Name).SequenceEqual(target))
            {
                accessor = span[i].Accessor;
                return true;
            }
        }

        accessor = -1;
        return false;
    }

    /// <summary>Looks up a standard semantic or returns a fallback.</summary>
    public int GetAttributeOrDefault(
        GltfSlice<Attribute> attributes,
        GltfMeshSemantic semantic,
        int fallback) =>
        TryGetAttribute(attributes, semantic, out int accessor) ? accessor : fallback;

    /// <summary>Releases all pooled parse storage.</summary>
    public void Dispose() => _arena.Dispose();

    /// <summary>Raw buffer descriptor.</summary>
    public sealed class Buffer
    {
        /// <summary>Declared byte length.</summary>
        public int ByteLength { get; set; }

        /// <summary>External or data URI, null for GLB chunk.</summary>
        public string? Uri { get; set; }
    }

    /// <summary>EXT_meshopt_compression bufferView extension.</summary>
    public sealed class BufferViewMeshoptExtension
    {
        /// <summary>Source buffer index.</summary>
        public int Buffer { get; set; }

        /// <summary>Byte offset into the source buffer.</summary>
        public int ByteOffset { get; set; }

        /// <summary>Compressed byte length.</summary>
        public int ByteLength { get; set; }

        /// <summary>Decompressed byte stride.</summary>
        public int ByteStride { get; set; }

        /// <summary>Element count.</summary>
        public int Count { get; set; }

        /// <summary>Compression mode.</summary>
        public string Mode { get; set; } = "ATTRIBUTES";

        /// <summary>Optional attribute filter.</summary>
        public string Filter { get; set; } = "NONE";
    }

    /// <summary>Raw bufferView descriptor.</summary>
    public sealed class BufferView
    {
        /// <summary>Buffer index.</summary>
        public int Buffer { get; set; }

        /// <summary>Byte offset into the buffer.</summary>
        public int ByteOffset { get; set; }

        /// <summary>Byte length.</summary>
        public int ByteLength { get; set; }

        /// <summary>Byte stride.</summary>
        public int ByteStride { get; set; }

        /// <summary>GL target hint.</summary>
        public int Target { get; set; }

        /// <summary>Meshopt extension payload.</summary>
        public BufferViewMeshoptExtension? Meshopt { get; set; }
    }

    /// <summary>Sparse accessor indices.</summary>
    public readonly struct SparseIndices
    {
        /// <summary>BufferView index.</summary>
        public required int BufferView { get; init; }

        /// <summary>Byte offset.</summary>
        public int ByteOffset { get; init; }

        /// <summary>Component type.</summary>
        public int ComponentType { get; init; }
    }

    /// <summary>Sparse accessor values.</summary>
    public readonly struct SparseValues
    {
        /// <summary>BufferView index.</summary>
        public required int BufferView { get; init; }

        /// <summary>Byte offset.</summary>
        public int ByteOffset { get; init; }
    }

    /// <summary>Sparse accessor patch.</summary>
    public readonly struct AccessorSparse
    {
        /// <summary>Whether a sparse patch is present.</summary>
        public bool HasSparse { get; init; }

        /// <summary>Patched element count.</summary>
        public int Count { get; init; }

        /// <summary>Index stream.</summary>
        public SparseIndices Indices { get; init; }

        /// <summary>Value stream.</summary>
        public SparseValues Values { get; init; }
    }

    /// <summary>Vertex attribute entry.</summary>
    public readonly struct Attribute
    {
        /// <summary>Standard semantic, or <see cref="GltfMeshSemantic.Custom"/>.</summary>
        public required GltfMeshSemantic Semantic { get; init; }

        /// <summary>Accessor index.</summary>
        public required int Accessor { get; init; }

        /// <summary>Application-specific UTF-8 name for custom semantics.</summary>
        public GltfStringRef Name { get; init; }
    }

    /// <summary>Raw accessor descriptor.</summary>
    public readonly struct Accessor
    {
        /// <summary>BufferView index (-1 when absent).</summary>
        public int BufferView { get; init; }

        /// <summary>Byte offset into the bufferView.</summary>
        public int ByteOffset { get; init; }

        /// <summary>Component type.</summary>
        public int ComponentType { get; init; }

        /// <summary>Whether integer data is normalized.</summary>
        public bool Normalized { get; init; }

        /// <summary>Element count.</summary>
        public int Count { get; init; }

        /// <summary>Element type.</summary>
        public GltfAccessorType Type { get; init; }

        /// <summary>Declared minimums.</summary>
        public GltfSlice<float> Min { get; init; }

        /// <summary>Whether minimums were declared.</summary>
        public bool HasMin { get; init; }

        /// <summary>Declared maximums.</summary>
        public GltfSlice<float> Max { get; init; }

        /// <summary>Whether maximums were declared.</summary>
        public bool HasMax { get; init; }

        /// <summary>Sparse patch.</summary>
        public AccessorSparse Sparse { get; init; }
    }

    /// <summary>KHR_draco_mesh_compression primitive extension.</summary>
    public readonly struct DracoPrimitiveExtension
    {
        /// <summary>Whether the extension is present.</summary>
        public bool Present { get; init; }

        /// <summary>BufferView index.</summary>
        public int BufferView { get; init; }

        /// <summary>Semantic to Draco unique-id mapping.</summary>
        public GltfSlice<Attribute> Attributes { get; init; }
    }

    /// <summary>Material variant mapping for one primitive.</summary>
    public readonly struct PrimitiveMaterialVariant
    {
        /// <summary>Variant indices.</summary>
        public GltfSlice<int> Variants { get; init; }

        /// <summary>Material index, or -1.</summary>
        public int Material { get; init; }

        /// <summary>Whether a material was declared.</summary>
        public bool HasMaterial => Material >= 0;
    }

    /// <summary>Morph target attribute map.</summary>
    public readonly struct MorphTarget
    {
        /// <summary>Attribute map.</summary>
        public GltfSlice<Attribute> Attributes { get; init; }
    }

    /// <summary>Raw mesh primitive.</summary>
    public readonly struct Primitive
    {
        /// <summary>Indices accessor index, or -1.</summary>
        public int Indices { get; init; }

        /// <summary>Whether indices were declared.</summary>
        public bool HasIndices => Indices >= 0;

        /// <summary>Material index, or -1.</summary>
        public int Material { get; init; }

        /// <summary>Whether a material was declared.</summary>
        public bool HasMaterial => Material >= 0;

        /// <summary>Topology mode (default triangles).</summary>
        public int Mode { get; init; }

        /// <summary>Semantic to accessor-index mapping.</summary>
        public GltfSlice<Attribute> Attributes { get; init; }

        /// <summary>Morph target maps.</summary>
        public GltfSlice<MorphTarget> Targets { get; init; }

        /// <summary>KHR_materials_variants mappings.</summary>
        public GltfSlice<PrimitiveMaterialVariant> MaterialVariants { get; init; }

        /// <summary>Draco extension payload.</summary>
        public DracoPrimitiveExtension Draco { get; init; }
    }

    /// <summary>Raw mesh.</summary>
    public readonly struct Mesh
    {
        /// <summary>Mesh name.</summary>
        public GltfStringRef Name { get; init; }

        /// <summary>Primitive slice.</summary>
        public GltfSlice<Primitive> Primitives { get; init; }

        /// <summary>Default morph weights.</summary>
        public GltfSlice<float> Weights { get; init; }
    }

    /// <summary>Texture sampler binding with KHR_texture_transform.</summary>
    public sealed class TextureInfo
    {
        /// <summary>Texture index (-1 when unset).</summary>
        public int Index { get; set; } = -1;

        /// <summary>UV set.</summary>
        public int TexCoord { get; set; }

        /// <summary>Texture scale (clearcoat/occlusion strength).</summary>
        public float Scale { get; set; } = 1.0f;

        /// <summary>Texture strength.</summary>
        public float Strength { get; set; } = 1.0f;

        /// <summary>UV transform.</summary>
        public GltfTextureTransform Transform { get; set; } = GltfTextureTransform.Default;
    }

    /// <summary>PBR metallic-roughness block.</summary>
    public sealed class PbrMetallicRoughness
    {
        /// <summary>Base color factor.</summary>
        public float[]? BaseColorFactor { get; set; }

        /// <summary>Base color texture.</summary>
        public TextureInfo? BaseColorTexture { get; set; }

        /// <summary>Metallic factor.</summary>
        public float MetallicFactor { get; set; } = 1.0f;

        /// <summary>Roughness factor.</summary>
        public float RoughnessFactor { get; set; } = 1.0f;

        /// <summary>Metallic-roughness texture.</summary>
        public TextureInfo? MetallicRoughnessTexture { get; set; }
    }

    /// <summary>Raw material.</summary>
    public sealed class Material
    {
        /// <summary>Material name.</summary>
        public string? Name { get; set; }

        /// <summary>PBR block.</summary>
        public PbrMetallicRoughness Pbr { get; set; } = new();

        /// <summary>Normal texture.</summary>
        public TextureInfo? NormalTexture { get; set; }

        /// <summary>Occlusion texture.</summary>
        public TextureInfo? OcclusionTexture { get; set; }

        /// <summary>Emissive texture.</summary>
        public TextureInfo? EmissiveTexture { get; set; }

        /// <summary>Emissive factor.</summary>
        public float[]? EmissiveFactor { get; set; }

        /// <summary>Alpha mode string.</summary>
        public string AlphaMode { get; set; } = "OPAQUE";

        /// <summary>Alpha cutoff, or null when the document omits it.</summary>
        public float? AlphaCutoff { get; set; }

        /// <summary>Double-sided flag.</summary>
        public bool DoubleSided { get; set; }

        /// <summary>KHR_materials_unlit flag.</summary>
        public bool Unlit { get; set; }

        /// <summary>Clearcoat factor.</summary>
        public float ClearcoatFactor { get; set; }

        /// <summary>Clearcoat roughness factor.</summary>
        public float ClearcoatRoughnessFactor { get; set; }

        /// <summary>Clearcoat texture.</summary>
        public TextureInfo? ClearcoatTexture { get; set; }

        /// <summary>Clearcoat roughness texture.</summary>
        public TextureInfo? ClearcoatRoughnessTexture { get; set; }

        /// <summary>Clearcoat normal texture.</summary>
        public TextureInfo? ClearcoatNormalTexture { get; set; }

        /// <summary>KHR_materials_emissive_strength value.</summary>
        public float EmissiveStrength { get; set; } = 1.0f;

        /// <summary>KHR_materials_specular factor.</summary>
        public float SpecularFactor { get; set; } = 1.0f;

        /// <summary>KHR_materials_specular color factor.</summary>
        public float[]? SpecularColorFactor { get; set; }

        /// <summary>KHR_materials_specular specular texture (alpha channel).</summary>
        public TextureInfo? SpecularTexture { get; set; }

        /// <summary>KHR_materials_specular color texture (RGB channels).</summary>
        public TextureInfo? SpecularColorTexture { get; set; }

        /// <summary>KHR_materials_sheen color factor.</summary>
        public float[]? SheenColorFactor { get; set; }

        /// <summary>KHR_materials_sheen color texture.</summary>
        public TextureInfo? SheenColorTexture { get; set; }

        /// <summary>KHR_materials_sheen roughness factor.</summary>
        public float SheenRoughnessFactor { get; set; }

        /// <summary>KHR_materials_sheen roughness texture (alpha channel).</summary>
        public TextureInfo? SheenRoughnessTexture { get; set; }

        /// <summary>KHR_materials_transmission factor.</summary>
        public float TransmissionFactor { get; set; }

        /// <summary>KHR_materials_transmission texture (red channel).</summary>
        public TextureInfo? TransmissionTexture { get; set; }

        /// <summary>KHR_materials_volume thickness factor.</summary>
        public float ThicknessFactor { get; set; }

        /// <summary>KHR_materials_volume thickness texture (green channel).</summary>
        public TextureInfo? ThicknessTexture { get; set; }

        /// <summary>KHR_materials_volume attenuation distance.</summary>
        public float AttenuationDistance { get; set; } = float.PositiveInfinity;

        /// <summary>KHR_materials_volume attenuation color.</summary>
        public float[]? AttenuationColor { get; set; }

        /// <summary>KHR_materials_ior index of refraction.</summary>
        public float Ior { get; set; } = 1.5f;

        /// <summary>KHR_materials_iridescence factor.</summary>
        public float IridescenceFactor { get; set; }

        /// <summary>KHR_materials_iridescence texture.</summary>
        public TextureInfo? IridescenceTexture { get; set; }

        /// <summary>KHR_materials_iridescence index of refraction.</summary>
        public float IridescenceIor { get; set; } = 1.3f;

        /// <summary>KHR_materials_iridescence minimum thickness in nanometers.</summary>
        public float IridescenceThicknessMinimum { get; set; } = 100.0f;

        /// <summary>KHR_materials_iridescence maximum thickness in nanometers.</summary>
        public float IridescenceThicknessMaximum { get; set; } = 400.0f;

        /// <summary>KHR_materials_iridescence thickness texture (green channel).</summary>
        public TextureInfo? IridescenceThicknessTexture { get; set; }

        /// <summary>KHR_materials_anisotropy strength.</summary>
        public float AnisotropyStrength { get; set; }

        /// <summary>KHR_materials_anisotropy rotation in radians.</summary>
        public float AnisotropyRotation { get; set; }

        /// <summary>KHR_materials_anisotropy texture.</summary>
        public TextureInfo? AnisotropyTexture { get; set; }

        /// <summary>KHR_materials_dispersion strength.</summary>
        public float Dispersion { get; set; }
    }

    /// <summary>Raw texture.</summary>
    public sealed class Texture
    {
        /// <summary>Sampler index.</summary>
        public int? Sampler { get; set; }

        /// <summary>Image index.</summary>
        public int? Source { get; set; }
    }

    /// <summary>Raw image.</summary>
    public sealed class Image
    {
        /// <summary>External or data URI.</summary>
        public string? Uri { get; set; }

        /// <summary>MIME type.</summary>
        public string? MimeType { get; set; }

        /// <summary>BufferView index.</summary>
        public int? BufferView { get; set; }
    }

    /// <summary>Raw sampler.</summary>
    public sealed class Sampler
    {
        /// <summary>Magnification filter.</summary>
        public int MagFilter { get; set; } = 9729;

        /// <summary>Minification filter.</summary>
        public int MinFilter { get; set; } = 9729;

        /// <summary>S wrap mode.</summary>
        public int WrapS { get; set; } = 10497;

        /// <summary>T wrap mode.</summary>
        public int WrapT { get; set; } = 10497;
    }

    /// <summary>Raw skin.</summary>
    public sealed class Skin
    {
        /// <summary>Skin name.</summary>
        public string? Name { get; set; }

        /// <summary>Inverse-bind-matrices accessor.</summary>
        public int? InverseBindMatrices { get; set; }

        /// <summary>Skeleton node.</summary>
        public int? Skeleton { get; set; }

        /// <summary>Joint node indices.</summary>
        public List<int> Joints { get; } = new();
    }

    /// <summary>Raw animation sampler.</summary>
    public sealed class AnimationSampler
    {
        /// <summary>Input (time) accessor.</summary>
        public int Input { get; set; }

        /// <summary>Interpolation string.</summary>
        public string Interpolation { get; set; } = "LINEAR";

        /// <summary>Output accessor.</summary>
        public int Output { get; set; }
    }

    /// <summary>Raw animation channel.</summary>
    public sealed class AnimationChannel
    {
        /// <summary>Sampler index.</summary>
        public int Sampler { get; set; }

        /// <summary>Target node index (-1 when unset).</summary>
        public int TargetNode { get; set; } = -1;

        /// <summary>Target path string.</summary>
        public string TargetPath { get; set; } = "translation";

        /// <summary>KHR_animation_pointer JSON pointer, when present.</summary>
        public string? Pointer { get; set; }
    }

    /// <summary>Raw animation.</summary>
    public sealed class Animation
    {
        /// <summary>Animation name.</summary>
        public string? Name { get; set; }

        /// <summary>Samplers.</summary>
        public List<AnimationSampler> Samplers { get; } = new();

        /// <summary>Channels.</summary>
        public List<AnimationChannel> Channels { get; } = new();
    }

    /// <summary>KHR_lights_punctual light.</summary>
    public sealed class Light
    {
        /// <summary>Light name.</summary>
        public string? Name { get; set; }

        /// <summary>RGB color.</summary>
        public float[] Color { get; set; } = [1f, 1f, 1f];

        /// <summary>Intensity.</summary>
        public float Intensity { get; set; } = 1.0f;

        /// <summary>Light type string.</summary>
        public string Type { get; set; } = "directional";

        /// <summary>Range (point/spot).</summary>
        public float? Range { get; set; }

        /// <summary>Spot inner cone angle.</summary>
        public float InnerConeAngle { get; set; }

        /// <summary>Spot outer cone angle.</summary>
        public float OuterConeAngle { get; set; } = 0.785398f;
    }

    /// <summary>Raw camera.</summary>
    public sealed class Camera
    {
        /// <summary>Camera name.</summary>
        public string? Name { get; set; }

        /// <summary>Camera type string.</summary>
        public string Type { get; set; } = "perspective";

        /// <summary>Vertical field of view.</summary>
        public float Yfov { get; set; } = 0.785398f;

        /// <summary>Far plane.</summary>
        public float Zfar { get; set; } = 1000f;

        /// <summary>Near plane.</summary>
        public float Znear { get; set; } = 0.1f;

        /// <summary>Orthographic horizontal size.</summary>
        public float Xmag { get; set; } = 1.0f;

        /// <summary>Orthographic vertical size.</summary>
        public float Ymag { get; set; } = 1.0f;
    }

    /// <summary>Raw node.</summary>
    public readonly struct Node
    {
        /// <summary>Node name.</summary>
        public GltfStringRef Name { get; init; }

        /// <summary>Mesh index, or -1.</summary>
        public int Mesh { get; init; }

        /// <summary>Whether a mesh is attached.</summary>
        public bool HasMesh => Mesh >= 0;

        /// <summary>Skin index, or -1.</summary>
        public int Skin { get; init; }

        /// <summary>Whether a skin is attached.</summary>
        public bool HasSkin => Skin >= 0;

        /// <summary>Camera index, or -1.</summary>
        public int Camera { get; init; }

        /// <summary>Whether a camera is attached.</summary>
        public bool HasCamera => Camera >= 0;

        /// <summary>Light index, or -1.</summary>
        public int Light { get; init; }

        /// <summary>Whether a light is attached.</summary>
        public bool HasLight => Light >= 0;

        /// <summary>Child node indices.</summary>
        public GltfSlice<int> Children { get; init; }

        /// <summary>Whether an explicit matrix is present.</summary>
        public bool HasMatrix { get; init; }

        /// <summary>Column-major transform matrix.</summary>
        public Mat4 Matrix { get; init; }

        /// <summary>Translation, when explicitly present.</summary>
        public Vec3? Translation { get; init; }

        /// <summary>Rotation, when explicitly present.</summary>
        public Quat? Rotation { get; init; }

        /// <summary>Scale, when explicitly present.</summary>
        public Vec3? Scale { get; init; }

        /// <summary>Morph weights.</summary>
        public GltfSlice<float> Weights { get; init; }

        /// <summary>Whether morph weights are present.</summary>
        public bool HasWeights => Weights.Length > 0;
    }

    /// <summary>Raw scene.</summary>
    public sealed class Scene
    {
        /// <summary>Scene name.</summary>
        public string? Name { get; set; }

        /// <summary>Root node indices.</summary>
        public List<int> Nodes { get; } = new();
    }

    /// <summary>Named material variant.</summary>
    public sealed class MaterialVariant
    {
        /// <summary>Variant name.</summary>
        public string? Name { get; set; }
    }
}

/// <summary>Allocation-free lookup over one primitive's attribute slice.</summary>
internal readonly ref struct GltfAttributeMap
{
    private readonly ReadOnlySpan<GltfRawModel.Attribute> _attributes;
    private readonly ReadOnlySpan<byte> _strings;

    public GltfAttributeMap(
        ReadOnlySpan<GltfRawModel.Attribute> attributes,
        ReadOnlySpan<byte> strings)
    {
        _attributes = attributes;
        _strings = strings;
    }

    public int Count => _attributes.Length;

    public ref readonly GltfRawModel.Attribute this[int index] => ref _attributes[index];

    public ReadOnlySpan<GltfRawModel.Attribute> AsSpan() => _attributes;

    public bool TryGet(GltfMeshSemantic semantic, out int accessor)
    {
        for (int i = 0; i < _attributes.Length; i++)
        {
            if (_attributes[i].Semantic == semantic)
            {
                accessor = _attributes[i].Accessor;
                return true;
            }
        }

        accessor = -1;
        return false;
    }

    public bool TryGet(GltfStringRef name, out int accessor)
    {
        ReadOnlySpan<byte> target = Resolve(name);
        for (int i = 0; i < _attributes.Length; i++)
        {
            GltfRawModel.Attribute attribute = _attributes[i];
            if (attribute.Semantic == GltfMeshSemantic.Custom &&
                Resolve(attribute.Name).SequenceEqual(target))
            {
                accessor = attribute.Accessor;
                return true;
            }
        }

        accessor = -1;
        return false;
    }

    public int GetOrDefault(GltfMeshSemantic semantic, int fallback) =>
        TryGet(semantic, out int accessor) ? accessor : fallback;

    public string GetName(in GltfRawModel.Attribute attribute) =>
        attribute.Name.IsEmpty ? string.Empty : Encoding.UTF8.GetString(Resolve(attribute.Name));

    public Enumerator GetEnumerator() => new(_attributes);

    private ReadOnlySpan<byte> Resolve(GltfStringRef value) =>
        value.IsEmpty ? [] : _strings.Slice(value.Offset, value.Length);

    public ref struct Enumerator
    {
        private readonly ReadOnlySpan<GltfRawModel.Attribute> _attributes;
        private int _index;

        public Enumerator(ReadOnlySpan<GltfRawModel.Attribute> attributes)
        {
            _attributes = attributes;
            _index = -1;
        }

        public bool MoveNext()
        {
            int next = _index + 1;
            if ((uint)next >= (uint)_attributes.Length)
            {
                return false;
            }

            _index = next;
            return true;
        }

        public ref readonly GltfRawModel.Attribute Current => ref _attributes[_index];
    }
}
