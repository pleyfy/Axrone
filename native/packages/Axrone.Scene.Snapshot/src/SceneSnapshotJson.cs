namespace Axrone.Scene.Snapshot;
using Axrone.AssetShader;

/// <summary>
/// Deterministic JSON codec for self-contained scene snapshots. Asset ids are
/// written as authoring names resolved through a shared name table and interned
/// again on read, so no reflection or type metadata participates in the round
/// trip.
/// </summary>
public static class SceneSnapshotJson
{
    /// <summary>Writes a snapshot.</summary>
    public static void Write(Utf8JsonWriter writer, SceneSnapshot snapshot, SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(names);

        writer.WriteStartObject();
        writer.WriteNumber("version", SceneSnapshot.Version);

        writer.WritePropertyName("prefab");
        ScenePrefabJson.Write(writer, snapshot.Prefab);

        writer.WriteStartArray("shaders");
        for (int i = 0; i < snapshot.Shaders.Count; i++)
        {
            WriteShader(writer, snapshot.Shaders[i], names);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("meshes");
        for (int i = 0; i < snapshot.Meshes.Count; i++)
        {
            WriteMesh(writer, snapshot.Meshes[i], names);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("samplers");
        for (int i = 0; i < snapshot.Samplers.Count; i++)
        {
            WriteSampler(writer, snapshot.Samplers[i], names);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("textures");
        for (int i = 0; i < snapshot.Textures.Count; i++)
        {
            WriteTexture(writer, snapshot.Textures[i], names);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("renderPasses");
        for (int i = 0; i < snapshot.RenderPasses.Count; i++)
        {
            WriteRenderPass(writer, snapshot.RenderPasses[i], names);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("materials");
        for (int i = 0; i < snapshot.Materials.Count; i++)
        {
            WriteMaterial(writer, snapshot.Materials[i], names);
        }

        writer.WriteEndArray();

        writer.WriteEndObject();
    }

    /// <summary>Serializes a snapshot to UTF-8 JSON.</summary>
    public static byte[] Serialize(SceneSnapshot snapshot, SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(names);

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            Write(writer, snapshot, names);
        }

        return buffer.WrittenSpan.ToArray();
    }

    /// <summary>Reads a snapshot from a JSON object.</summary>
    public static SceneSnapshot Read(JsonElement root, SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new SceneSnapshotException(
                SceneSnapshotErrorCodes.Invalid,
                "Snapshot JSON root must be an object.");
        }

        int version = root.TryGetProperty("version", out JsonElement versionElement)
            ? versionElement.GetInt32()
            : SceneSnapshot.Version;

        if (version != SceneSnapshot.Version)
        {
            throw new SceneSnapshotException(
                SceneSnapshotErrorCodes.Version,
                $"Unsupported scene snapshot version {version}.");
        }

        ScenePrefabDefinition prefab = ScenePrefabJson.Read(Require(root, "prefab"));

        return new SceneSnapshot(
            prefab,
            ReadArray(root, "shaders", element => ReadShader(element, names)),
            ReadArray(root, "meshes", element => ReadMesh(element, names)),
            ReadArray(root, "materials", element => ReadMaterial(element, names)),
            ReadArray(root, "textures", element => ReadTexture(element, names)),
            ReadArray(root, "samplers", element => ReadSampler(element, names)),
            ReadArray(root, "renderPasses", element => ReadRenderPass(element, names)));
    }

    /// <summary>Deserializes a snapshot from UTF-8 JSON.</summary>
    public static SceneSnapshot Deserialize(ReadOnlySpan<byte> utf8, SceneNameTable? names = null)
    {
        if (utf8.IsEmpty)
        {
            throw new SceneSnapshotException(
                SceneSnapshotErrorCodes.Invalid,
                "Snapshot JSON payload must not be empty.");
        }

        using JsonDocument document = JsonDocument.Parse(utf8.ToArray());
        return Read(document.RootElement, names ?? new SceneNameTable());
    }

    private static T[] ReadArray<T>(JsonElement root, string name, Func<JsonElement, T> read)
    {
        if (!root.TryGetProperty(name, out JsonElement array) ||
            array.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new T[array.GetArrayLength()];
        int index = 0;
        foreach (JsonElement element in array.EnumerateArray())
        {
            result[index++] = read(element);
        }

        return result;
    }

    private static void WriteShader(Utf8JsonWriter writer, SceneShaderDefinition shader, SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", shader.Id, names);
        writer.WriteString("vertex", shader.VertexSource);
        writer.WriteString("fragment", shader.FragmentSource);
        if (shader.Effect is { } effect)
        {
            writer.WriteString("effect", ShaderSerialization.SerializeToJson(effect.Definition));
        }

        writer.WriteStartArray("uniforms");
        for (int i = 0; i < shader.Uniforms.Count; i++)
        {
            writer.WriteStringValue(shader.Uniforms[i]);
        }

        writer.WriteEndArray();

        writer.WriteStartObject("attributes");
        foreach (KeyValuePair<SceneMeshSemantic, string> attribute in shader.Attributes)
        {
            writer.WriteString(SemanticToString(attribute.Key), attribute.Value);
        }

        writer.WriteEndObject();
        writer.WriteBoolean("depthTest", shader.DepthTest);
        writer.WriteBoolean("cull", shader.Cull);
        writer.WriteBoolean("blend", shader.Blend);
        writer.WriteEndObject();
    }

    private static SceneShaderDefinition ReadShader(JsonElement element, SceneNameTable names)
    {
        var attributes = new Dictionary<SceneMeshSemantic, string>();
        if (element.TryGetProperty("attributes", out JsonElement attributesElement) &&
            attributesElement.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty attribute in attributesElement.EnumerateObject())
            {
                attributes[ParseSemantic(attribute.Name)] = attribute.Value.ValueKind switch
                {
                    JsonValueKind.String => attribute.Value.GetString()!,
                    JsonValueKind.Null => ThrowNullElement(attribute.Name),
                    _ => ThrowInvalidStringArray(attribute.Name)
                };
            }
        }

        return new SceneShaderDefinition(
            ReadAssetId<ShaderAssetTag>(element, "id", names),
            RequireString(element, "vertex"),
            RequireString(element, "fragment"),
            ReadStringArray(element, "uniforms"),
            attributes,
            GetOptionalBoolean(element, "depthTest", true),
            GetOptionalBoolean(element, "cull", true),
            GetOptionalBoolean(element, "blend", false),
            ReadEffect(element));
    }

    private static ShaderEffect? ReadEffect(JsonElement element) =>
        element.TryGetProperty("effect", out JsonElement effectElement) &&
        effectElement.ValueKind == JsonValueKind.String &&
        effectElement.GetString() is { Length: > 0 } json
            ? new ShaderEffect(ShaderSerialization.DeserializeFromJson(json))
            : null;

    private static void WriteMesh(Utf8JsonWriter writer, SceneMeshDefinition mesh, SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", mesh.Id, names);
        writer.WriteString("vertices", Convert.ToBase64String(mesh.Vertices.Span));

        writer.WriteStartArray("attributes");
        for (int i = 0; i < mesh.Attributes.Count; i++)
        {
            SceneVertexAttribute attribute = mesh.Attributes[i];
            writer.WriteStartObject();
            writer.WriteString("semantic", SemanticToString(attribute.Semantic));
            writer.WriteNumber("components", attribute.ComponentCount);
            writer.WriteNumber("offset", attribute.Offset);
            writer.WriteNumber("stride", attribute.Stride);
            writer.WriteBoolean("normalized", attribute.Normalized);
            writer.WriteBoolean("integer", attribute.Integer);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteNumber("vertexCount", mesh.VertexCount);

        if (!mesh.Indices.IsEmpty)
        {
            writer.WriteString("indices", Convert.ToBase64String(mesh.Indices.Span));
            writer.WriteString("indexFormat", mesh.IndexFormat == SceneIndexFormat.UInt32 ? "uint32" : "uint16");
            writer.WriteNumber("indexCount", mesh.IndexCount);
        }

        writer.WriteString("topology", TopologyToString(mesh.Topology));

        if (mesh.Bounds is { } bounds)
        {
            writer.WriteStartObject("bounds");
            WriteVec3(writer, "center", bounds.Center);
            writer.WriteNumber("radius", bounds.Radius);
            writer.WriteEndObject();
        }

        writer.WriteEndObject();
    }

    private static SceneMeshDefinition ReadMesh(JsonElement element, SceneNameTable names)
    {
        JsonElement attributesElement = Require(element, "attributes");
        if (attributesElement.ValueKind != JsonValueKind.Array)
        {
            throw Invalid("Mesh 'attributes' must be an array.");
        }

        var attributes = new SceneVertexAttribute[attributesElement.GetArrayLength()];
        int index = 0;
        foreach (JsonElement attribute in attributesElement.EnumerateArray())
        {
            attributes[index++] = new SceneVertexAttribute(
                ParseSemantic(RequireString(attribute, "semantic")),
                (byte)attribute.GetProperty("components").GetInt32(),
                attribute.GetProperty("offset").GetInt32(),
                attribute.GetProperty("stride").GetInt32(),
                GetOptionalBoolean(attribute, "normalized", false),
                GetOptionalBoolean(attribute, "integer", false));
        }

        byte[] vertices = Convert.FromBase64String(RequireString(element, "vertices"));
        byte[] indices = element.TryGetProperty("indices", out JsonElement indicesElement)
            ? Convert.FromBase64String(indicesElement.GetString() ?? string.Empty)
            : [];

        SceneIndexFormat indexFormat = element.TryGetProperty("indexFormat", out JsonElement formatElement)
            ? ParseIndexFormat(formatElement.GetString() ?? "uint16")
            : SceneIndexFormat.UInt16;

        SceneMeshTopology topology = element.TryGetProperty("topology", out JsonElement topologyElement)
            ? ParseTopology(topologyElement.GetString() ?? "triangles")
            : SceneMeshTopology.Triangles;

        BoundingSphere3? bounds = null;
        if (element.TryGetProperty("bounds", out JsonElement boundsElement) &&
            boundsElement.ValueKind == JsonValueKind.Object)
        {
            bounds = new BoundingSphere3(
                ReadVec3(boundsElement, "center"),
                boundsElement.GetProperty("radius").GetSingle());
        }

        return new SceneMeshDefinition(
            ReadAssetId<MeshAssetTag>(element, "id", names),
            vertices,
            attributes,
            GetOptionalInt32(element, "vertexCount", 0),
            indices,
            indexFormat,
            GetOptionalInt32(element, "indexCount", 0),
            topology,
            bounds);
    }

    private static void WriteSampler(Utf8JsonWriter writer, SceneSamplerDefinition sampler, SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", sampler.Id, names);
        writer.WriteString("minFilter", FilterToString(sampler.MinFilter));
        writer.WriteString("magFilter", FilterToString(sampler.MagFilter));
        writer.WriteString("wrapS", WrapToString(sampler.WrapS));
        writer.WriteString("wrapT", WrapToString(sampler.WrapT));
        writer.WriteString("wrapR", WrapToString(sampler.WrapR));
        writer.WriteNumber("maxAnisotropy", sampler.MaxAnisotropy);
        writer.WriteEndObject();
    }

    private static SceneSamplerDefinition ReadSampler(JsonElement element, SceneNameTable names) =>
        new(
            ReadAssetId<SamplerAssetTag>(element, "id", names),
            ParseFilter(GetOptionalString(element, "minFilter") ?? "linear"),
            ParseFilter(GetOptionalString(element, "magFilter") ?? "linear"),
            ParseWrap(GetOptionalString(element, "wrapS") ?? "repeat"),
            ParseWrap(GetOptionalString(element, "wrapT") ?? "repeat"),
            ParseWrap(GetOptionalString(element, "wrapR") ?? "repeat"),
            GetOptionalInt32(element, "maxAnisotropy", 1));

    private static void WriteTexture(Utf8JsonWriter writer, SceneTextureDefinition texture, SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", texture.Id, names);

        writer.WriteStartObject("source");
        switch (texture.Source)
        {
            case SceneTextureData data:
                writer.WriteString("kind", "data");
                writer.WriteString("bytes", Convert.ToBase64String(data.Data.Span));
                break;
            case SceneTextureUrl url:
                writer.WriteString("kind", "url");
                writer.WriteString("url", url.Url.OriginalString);
                break;
            case SceneTextureColor color:
                writer.WriteString("kind", "color");
                WriteVec4(writer, "color", color.Color);
                writer.WriteNumber("width", color.Width);
                writer.WriteNumber("height", color.Height);
                break;
            default:
                throw Invalid($"Texture '{texture.Id}' has an unknown source type.");
        }

        writer.WriteEndObject();
        writer.WriteString("format", TextureFormatToString(texture.Format));
        writer.WriteNumber("width", texture.Width);
        writer.WriteNumber("height", texture.Height);
        if (texture.SamplerId is { } samplerId)
        {
            WriteAssetId(writer, "sampler", samplerId, names);
        }

        writer.WriteBoolean("generateMipmaps", texture.GenerateMipmaps);
        writer.WriteEndObject();
    }

    private static SceneTextureDefinition ReadTexture(JsonElement element, SceneNameTable names)
    {
        JsonElement sourceElement = Require(element, "source");
        string sourceKind = RequireString(sourceElement, "kind");

        SceneTextureSource source = sourceKind switch
        {
            "data" => new SceneTextureData(Convert.FromBase64String(RequireString(sourceElement, "bytes"))),
            "url" => new SceneTextureUrl(RequireString(sourceElement, "url")),
            "color" => new SceneTextureColor(
                ReadVec4(sourceElement, "color"),
                sourceElement.GetProperty("width").GetInt32(),
                sourceElement.GetProperty("height").GetInt32()),
            _ => throw Invalid($"Unknown texture source kind '{sourceKind}'.")
        };

        SceneAssetId<SamplerAssetTag>? samplerId = element.TryGetProperty("sampler", out _)
            ? ReadAssetId<SamplerAssetTag>(element, "sampler", names)
            : null;

        return new SceneTextureDefinition(
            ReadAssetId<TextureAssetTag>(element, "id", names),
            source,
            ParseTextureFormat(GetOptionalString(element, "format") ?? "rgba8"),
            GetOptionalInt32(element, "width", 1),
            GetOptionalInt32(element, "height", 1),
            samplerId,
            GetOptionalBoolean(element, "generateMipmaps", true));
    }

    private static void WriteRenderPass(
        Utf8JsonWriter writer,
        SceneRenderPassDefinition pass,
        SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", pass.Id, names);
        writer.WriteNumber("order", pass.Order);
        writer.WriteBoolean("enabled", pass.Enabled);
        writer.WriteNumber("clearMask", (int)pass.ClearMask);

        if (pass.ClearColor is { } clearColor)
        {
            WriteVec4(writer, "clearColor", clearColor);
        }

        if (pass.ClearDepth is { } clearDepth)
        {
            writer.WriteNumber("clearDepth", clearDepth);
        }

        WriteOptionalBoolean(writer, "depthTest", pass.DepthTest);
        WriteOptionalBoolean(writer, "cull", pass.Cull);
        WriteOptionalBoolean(writer, "blend", pass.Blend);
        writer.WriteEndObject();
    }

    private static SceneRenderPassDefinition ReadRenderPass(JsonElement element, SceneNameTable names) =>
        new(
            ReadAssetId<RenderPassAssetTag>(element, "id", names),
            GetOptionalInt32(element, "order", 0),
            GetOptionalBoolean(element, "enabled", true),
            (SceneClearMask)GetOptionalInt32(element, "clearMask", 0),
            element.TryGetProperty("clearColor", out _) ? ReadVec4(element, "clearColor") : null,
            element.TryGetProperty("clearDepth", out JsonElement clearDepth) ? clearDepth.GetSingle() : null,
            GetOptionalBooleanOrNull(element, "depthTest"),
            GetOptionalBooleanOrNull(element, "cull"),
            GetOptionalBooleanOrNull(element, "blend"));

    private static void WriteMaterial(
        Utf8JsonWriter writer,
        SceneMaterialDefinition material,
        SceneNameTable names)
    {
        writer.WriteStartObject();
        WriteAssetId(writer, "id", material.Id, names);
        WriteAssetId(writer, "shader", material.ShaderId, names);
        if (material.TechniqueId is { } technique)
        {
            writer.WriteString("technique", technique);
        }

        if (material.Keywords.Count > 0)
        {
            writer.WriteStartObject("keywords");
            foreach (KeyValuePair<string, string> keyword in material.Keywords)
            {
                writer.WriteString(keyword.Key, keyword.Value);
            }

            writer.WriteEndObject();
        }

        writer.WriteStartObject("surface");
        SceneMaterialSurface surface = material.Surface;
        writer.WriteString("shadingModel", ShadingModelToString(surface.ShadingModel));
        writer.WriteString("alphaMode", AlphaModeToString(surface.AlphaMode));
        writer.WriteNumber("alphaCutoff", surface.AlphaCutoff);
        writer.WriteNumber("features", (uint)surface.Features);
        WriteVec4(writer, "albedo", surface.Albedo);
        WriteVec3(writer, "emissive", surface.Emissive);
        writer.WriteNumber("metallic", surface.Metallic);
        writer.WriteNumber("roughness", surface.Roughness);
        writer.WriteNumber("normalScale", surface.NormalScale);
        writer.WriteNumber("occlusion", surface.Occlusion);
        WriteVec2(writer, "tiling", surface.Tiling);
        WriteVec2(writer, "offset", surface.Offset);
        WriteBinding(writer, "albedoMap", surface.AlbedoMap, names);
        WriteBinding(writer, "normalMap", surface.NormalMap, names);
        WriteBinding(writer, "pbrMap", surface.PbrMap, names);
        WriteBinding(writer, "occlusionMap", surface.OcclusionMap, names);
        WriteBinding(writer, "emissiveMap", surface.EmissiveMap, names);
        writer.WriteEndObject();

        writer.WriteStartArray("passes");
        for (int i = 0; i < material.Passes.Count; i++)
        {
            WriteMaterialPass(writer, material.Passes[i]);
        }

        writer.WriteEndArray();

        writer.WriteStartObject("uniforms");
        foreach (KeyValuePair<string, SceneUniformValue> uniform in material.Uniforms)
        {
            WriteUniform(writer, uniform.Key, uniform.Value);
        }

        writer.WriteEndObject();
        writer.WriteEndObject();
    }

    private static SceneMaterialDefinition ReadMaterial(JsonElement element, SceneNameTable names)
    {
        JsonElement surfaceElement = Require(element, "surface");
        var surface = new SceneMaterialSurface
        {
            ShadingModel = ParseShadingModel(GetOptionalString(surfaceElement, "shadingModel") ?? "pbr"),
            AlphaMode = ParseAlphaMode(GetOptionalString(surfaceElement, "alphaMode") ?? "opaque"),
            AlphaCutoff = GetOptionalSingle(surfaceElement, "alphaCutoff", 0.5f),
            Features = (SceneMaterialFeatures)(uint)GetOptionalInt32(surfaceElement, "features", 0),
            Albedo = surfaceElement.TryGetProperty("albedo", out _) ? ReadVec4(surfaceElement, "albedo") : Vec4.One,
            Emissive = surfaceElement.TryGetProperty("emissive", out _) ? ReadVec3(surfaceElement, "emissive") : Vec3.Zero,
            Metallic = GetOptionalSingle(surfaceElement, "metallic", 0.0f),
            Roughness = GetOptionalSingle(surfaceElement, "roughness", 1.0f),
            NormalScale = GetOptionalSingle(surfaceElement, "normalScale", 1.0f),
            Occlusion = GetOptionalSingle(surfaceElement, "occlusion", 1.0f),
            Tiling = surfaceElement.TryGetProperty("tiling", out _) ? ReadVec2(surfaceElement, "tiling") : Vec2.One,
            Offset = surfaceElement.TryGetProperty("offset", out _) ? ReadVec2(surfaceElement, "offset") : Vec2.Zero,
            AlbedoMap = ReadBinding(surfaceElement, "albedoMap", names),
            NormalMap = ReadBinding(surfaceElement, "normalMap", names),
            PbrMap = ReadBinding(surfaceElement, "pbrMap", names),
            OcclusionMap = ReadBinding(surfaceElement, "occlusionMap", names),
            EmissiveMap = ReadBinding(surfaceElement, "emissiveMap", names)
        };

        var passes = new List<SceneMaterialPass>();
        if (element.TryGetProperty("passes", out JsonElement passesElement) &&
            passesElement.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement passElement in passesElement.EnumerateArray())
            {
                passes.Add(ReadMaterialPass(passElement));
            }
        }

        var uniforms = new Dictionary<string, SceneUniformValue>(StringComparer.Ordinal);
        if (element.TryGetProperty("uniforms", out JsonElement uniformsElement) &&
            uniformsElement.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty uniform in uniformsElement.EnumerateObject())
            {
                uniforms[uniform.Name] = ReadUniform(uniform.Value);
            }
        }

        string? technique = element.TryGetProperty("technique", out JsonElement techniqueElement) &&
            techniqueElement.ValueKind == JsonValueKind.String
            ? techniqueElement.GetString()
            : null;

        var keywords = new Dictionary<string, string>(StringComparer.Ordinal);
        if (element.TryGetProperty("keywords", out JsonElement keywordsElement) &&
            keywordsElement.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty keyword in keywordsElement.EnumerateObject())
            {
                keywords[keyword.Name] = keyword.Value.GetString() ?? string.Empty;
            }
        }

        return new SceneMaterialDefinition(
            ReadAssetId<MaterialAssetTag>(element, "id", names),
            ReadAssetId<ShaderAssetTag>(element, "shader", names),
            surface,
            passes,
            uniforms,
            technique,
            keywords);
    }

    private static void WriteBinding(
        Utf8JsonWriter writer,
        string name,
        SceneMaterialTextureBinding? binding,
        SceneNameTable names)
    {
        if (binding is not { } value)
        {
            return;
        }

        writer.WriteStartObject(name);
        WriteAssetId(writer, "texture", value.TextureId, names);
        if (value.SamplerId is { } samplerId)
        {
            WriteAssetId(writer, "sampler", samplerId, names);
        }

        writer.WriteString("uvSet", value.UvSet == SceneUvSet.Uv1 ? "uv1" : "uv0");
        if (value.Unit is { } unit)
        {
            writer.WriteNumber("unit", unit);
        }

        WriteVec2(writer, "scale", value.Scale);
        WriteVec2(writer, "offset", value.Offset);
        writer.WriteNumber("rotation", value.Rotation);
        writer.WriteEndObject();
    }

    private static SceneMaterialTextureBinding? ReadBinding(
        JsonElement element,
        string name,
        SceneNameTable names)
    {
        if (!element.TryGetProperty(name, out JsonElement binding) ||
            binding.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        SceneAssetId<SamplerAssetTag>? samplerId = binding.TryGetProperty("sampler", out _)
            ? ReadAssetId<SamplerAssetTag>(binding, "sampler", names)
            : null;

        return new SceneMaterialTextureBinding(
            ReadAssetId<TextureAssetTag>(binding, "texture", names),
            samplerId,
            string.Equals(GetOptionalString(binding, "uvSet"), "uv1", StringComparison.Ordinal)
                ? SceneUvSet.Uv1
                : SceneUvSet.Uv0,
            binding.TryGetProperty("unit", out JsonElement unit) ? unit.GetInt32() : null,
            ReadVec2(binding, "scale"),
            ReadVec2(binding, "offset"),
            GetOptionalSingle(binding, "rotation", 0.0f));
    }

    private static void WriteMaterialPass(Utf8JsonWriter writer, SceneMaterialPass pass)
    {
        writer.WriteStartObject();
        writer.WriteString("id", pass.Id);
        writer.WriteNumber("priority", pass.Priority);

        if (pass.Primitive is { } primitive)
        {
            writer.WriteString("primitive", TopologyToString(primitive));
        }

        WriteOptionalBoolean(writer, "depthTest", pass.DepthTest);
        WriteOptionalBoolean(writer, "depthWrite", pass.DepthWrite);
        WriteOptionalBoolean(writer, "cull", pass.Cull);
        WriteOptionalBoolean(writer, "blend", pass.Blend);
        writer.WriteEndObject();
    }

    private static SceneMaterialPass ReadMaterialPass(JsonElement element) =>
        new(
            GetOptionalString(element, "id") ?? "main",
            GetOptionalInt32(element, "priority", 0),
            element.TryGetProperty("primitive", out JsonElement primitive)
                ? ParseTopology(primitive.GetString() ?? "triangles")
                : null,
            GetOptionalBooleanOrNull(element, "depthTest"),
            GetOptionalBooleanOrNull(element, "depthWrite"),
            GetOptionalBooleanOrNull(element, "cull"),
            GetOptionalBooleanOrNull(element, "blend"));

    private static void WriteUniform(Utf8JsonWriter writer, string name, in SceneUniformValue value)
    {
        writer.WriteStartObject(name);

        switch (value.Kind)
        {
            case SceneUniformKind.Float:
                writer.WriteString("kind", "float");
                writer.WriteNumber("value", value.X);
                break;
            case SceneUniformKind.Int:
                writer.WriteString("kind", "int");
                writer.WriteNumber("value", value.I);
                break;
            case SceneUniformKind.UInt:
                writer.WriteString("kind", "uint");
                writer.WriteNumber("value", value.U);
                break;
            case SceneUniformKind.Bool:
                writer.WriteString("kind", "bool");
                writer.WriteBoolean("value", value.B);
                break;
            case SceneUniformKind.Vec2:
                writer.WriteString("kind", "vec2");
                writer.WriteStartArray("value");
                writer.WriteNumberValue(value.X);
                writer.WriteNumberValue(value.Y);
                writer.WriteEndArray();
                break;
            case SceneUniformKind.Vec3:
                writer.WriteString("kind", "vec3");
                writer.WriteStartArray("value");
                writer.WriteNumberValue(value.X);
                writer.WriteNumberValue(value.Y);
                writer.WriteNumberValue(value.Z);
                writer.WriteEndArray();
                break;
            default:
                writer.WriteString("kind", "vec4");
                writer.WriteStartArray("value");
                writer.WriteNumberValue(value.X);
                writer.WriteNumberValue(value.Y);
                writer.WriteNumberValue(value.Z);
                writer.WriteNumberValue(value.W);
                writer.WriteEndArray();
                break;
        }

        writer.WriteEndObject();
    }

    private static SceneUniformValue ReadUniform(JsonElement element)
    {
        string kind = RequireString(element, "kind");
        JsonElement value = Require(element, "value");

        return kind switch
        {
            "float" => SceneUniformValue.FromFloat(value.GetSingle()),
            "int" => SceneUniformValue.FromInt(value.GetInt32()),
            "uint" => SceneUniformValue.FromUInt(value.GetUInt32()),
            "bool" => SceneUniformValue.FromBool(value.GetBoolean()),
            "vec2" => SceneUniformValue.FromVec2(ReadVec2Value(value, "value")),
            "vec3" => SceneUniformValue.FromVec3(ReadVec3Value(value, "value")),
            "vec4" => SceneUniformValue.FromVec4(ReadVec4Value(value, "value")),
            _ => throw Invalid($"Unknown uniform kind '{kind}'.")
        };
    }

    private static void WriteAssetId<TTag>(
        Utf8JsonWriter writer,
        string name,
        SceneAssetId<TTag> id,
        SceneNameTable names)
        where TTag : struct
    {
        if (!names.TryResolve(id.Value, out string? resolved))
        {
            throw Invalid(
                $"Asset reference '{name}' is not present in the scene name table; " +
                "create ids through SceneAssetRegistry.CreateId.");
        }

        writer.WriteString(name, resolved);
    }

    private static SceneAssetId<TTag> ReadAssetId<TTag>(
        JsonElement element,
        string name,
        SceneNameTable names)
        where TTag : struct =>
        SceneAssetId<TTag>.FromSymbol(names.Intern(RequireString(element, name)));

    private static void WriteVec2(Utf8JsonWriter writer, string name, in Vec2 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteEndArray();
    }

    private static void WriteVec3(Utf8JsonWriter writer, string name, in Vec3 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteEndArray();
    }

    private static void WriteVec4(Utf8JsonWriter writer, string name, in Vec4 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteNumberValue(value.W);
        writer.WriteEndArray();
    }

    private static Vec2 ReadVec2(JsonElement element, string name) =>
        ReadVec2Value(Require(element, name), name);

    private static Vec2 ReadVec2Value(JsonElement value, string name)
    {
        EnsureArrayLength(value, 2, name);
        return new Vec2(value[0].GetSingle(), value[1].GetSingle());
    }

    private static Vec3 ReadVec3(JsonElement element, string name) =>
        ReadVec3Value(Require(element, name), name);

    private static Vec3 ReadVec3Value(JsonElement value, string name)
    {
        EnsureArrayLength(value, 3, name);
        return new Vec3(value[0].GetSingle(), value[1].GetSingle(), value[2].GetSingle());
    }

    private static Vec4 ReadVec4(JsonElement element, string name) =>
        ReadVec4Value(Require(element, name), name);

    private static Vec4 ReadVec4Value(JsonElement value, string name)
    {
        EnsureArrayLength(value, 4, name);
        return new Vec4(
            value[0].GetSingle(),
            value[1].GetSingle(),
            value[2].GetSingle(),
            value[3].GetSingle());
    }

    private static void EnsureArrayLength(JsonElement value, int length, string name)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < length)
        {
            throw Invalid($"'{name}' must be a {length}-component array.");
        }
    }

    private static string[] ReadStringArray(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement array))
        {
            return [];
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            throw Invalid($"'{name}' must be an array of strings");
        }

        var result = new string[array.GetArrayLength()];
        int index = 0;
        foreach (JsonElement item in array.EnumerateArray())
        {
            result[index++] = item.ValueKind switch
            {
                JsonValueKind.String => item.GetString()!,
                JsonValueKind.Null => ThrowNullElement(name),
                _ => ThrowInvalidStringArray(name)
            };
        }

        return result;
    }

    private static void WriteOptionalBoolean(Utf8JsonWriter writer, string name, bool? value)
    {
        if (value is { } flag)
        {
            writer.WriteBoolean(name, flag);
        }
    }

    private static JsonElement Require(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value))
        {
            throw Invalid($"Required property '{name}' is missing.");
        }

        return value;
    }

    private static string RequireString(JsonElement element, string name)
    {
        JsonElement value = Require(element, name);
        if (value.ValueKind != JsonValueKind.String)
        {
            throw Invalid($"Property '{name}' must be a string.");
        }

        return value.GetString() ?? string.Empty;
    }

    private static string? GetOptionalString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value) ||
            value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return value.GetString();
    }

    private static bool GetOptionalBoolean(JsonElement element, string name, bool fallback) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetBoolean() : fallback;

    private static bool? GetOptionalBooleanOrNull(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetBoolean() : null;

    private static int GetOptionalInt32(JsonElement element, string name, int fallback) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetInt32() : fallback;

    private static float GetOptionalSingle(JsonElement element, string name, float fallback) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetSingle() : fallback;

    private static string SemanticToString(SceneMeshSemantic semantic) => semantic switch
    {
        SceneMeshSemantic.Normal => "normal",
        SceneMeshSemantic.Uv0 => "uv0",
        SceneMeshSemantic.Uv1 => "uv1",
        SceneMeshSemantic.Tangent => "tangent",
        SceneMeshSemantic.Color0 => "color0",
        SceneMeshSemantic.Joints0 => "joints0",
        SceneMeshSemantic.Weights0 => "weights0",
        _ => "position"
    };

    private static SceneMeshSemantic ParseSemantic(string value) => value switch
    {
        "position" => SceneMeshSemantic.Position,
        "normal" => SceneMeshSemantic.Normal,
        "uv0" => SceneMeshSemantic.Uv0,
        "uv1" => SceneMeshSemantic.Uv1,
        "tangent" => SceneMeshSemantic.Tangent,
        "color0" => SceneMeshSemantic.Color0,
        "joints0" => SceneMeshSemantic.Joints0,
        "weights0" => SceneMeshSemantic.Weights0,
        _ => throw Invalid($"Unknown mesh semantic '{value}'.")
    };

    private static string TopologyToString(SceneMeshTopology topology) => topology switch
    {
        SceneMeshTopology.Lines => "lines",
        SceneMeshTopology.Points => "points",
        _ => "triangles"
    };

    private static SceneMeshTopology ParseTopology(string value) => value switch
    {
        "triangles" => SceneMeshTopology.Triangles,
        "lines" => SceneMeshTopology.Lines,
        "points" => SceneMeshTopology.Points,
        _ => throw Invalid($"Unknown mesh topology '{value}'.")
    };

    private static SceneIndexFormat ParseIndexFormat(string value) => value switch
    {
        "uint16" => SceneIndexFormat.UInt16,
        "uint32" => SceneIndexFormat.UInt32,
        _ => throw Invalid($"Unknown index format '{value}'.")
    };

    private static string FilterToString(SceneFilterMode filter) => filter switch
    {
        SceneFilterMode.Nearest => "nearest",
        SceneFilterMode.NearestMipmapNearest => "nearest-mipmap-nearest",
        SceneFilterMode.LinearMipmapNearest => "linear-mipmap-nearest",
        SceneFilterMode.NearestMipmapLinear => "nearest-mipmap-linear",
        SceneFilterMode.LinearMipmapLinear => "linear-mipmap-linear",
        _ => "linear"
    };

    private static SceneFilterMode ParseFilter(string value) => value switch
    {
        "nearest" => SceneFilterMode.Nearest,
        "linear" => SceneFilterMode.Linear,
        "nearest-mipmap-nearest" => SceneFilterMode.NearestMipmapNearest,
        "linear-mipmap-nearest" => SceneFilterMode.LinearMipmapNearest,
        "nearest-mipmap-linear" => SceneFilterMode.NearestMipmapLinear,
        "linear-mipmap-linear" => SceneFilterMode.LinearMipmapLinear,
        _ => throw Invalid($"Unknown filter mode '{value}'.")
    };

    private static string WrapToString(SceneWrapMode wrap) => wrap switch
    {
        SceneWrapMode.ClampToEdge => "clamp-to-edge",
        SceneWrapMode.MirroredRepeat => "mirrored-repeat",
        _ => "repeat"
    };

    private static SceneWrapMode ParseWrap(string value) => value switch
    {
        "repeat" => SceneWrapMode.Repeat,
        "clamp-to-edge" => SceneWrapMode.ClampToEdge,
        "mirrored-repeat" => SceneWrapMode.MirroredRepeat,
        _ => throw Invalid($"Unknown wrap mode '{value}'.")
    };

    private static string TextureFormatToString(SceneTextureFormat format) => format switch
    {
        SceneTextureFormat.Srgba8 => "srgba8",
        SceneTextureFormat.Rgba16Float => "rgba16f",
        SceneTextureFormat.Rgba32Float => "rgba32f",
        SceneTextureFormat.R8 => "r8",
        SceneTextureFormat.Rg8 => "rg8",
        _ => "rgba8"
    };

    private static SceneTextureFormat ParseTextureFormat(string value) => value switch
    {
        "rgba8" => SceneTextureFormat.Rgba8,
        "srgba8" => SceneTextureFormat.Srgba8,
        "rgba16f" => SceneTextureFormat.Rgba16Float,
        "rgba32f" => SceneTextureFormat.Rgba32Float,
        "r8" => SceneTextureFormat.R8,
        "rg8" => SceneTextureFormat.Rg8,
        _ => throw Invalid($"Unknown texture format '{value}'.")
    };

    private static string ShadingModelToString(SceneMaterialShadingModel model) => model switch
    {
        SceneMaterialShadingModel.Unlit => "unlit",
        SceneMaterialShadingModel.Toon => "toon",
        SceneMaterialShadingModel.Custom => "custom",
        _ => "pbr"
    };

    private static SceneMaterialShadingModel ParseShadingModel(string value) => value switch
    {
        "unlit" => SceneMaterialShadingModel.Unlit,
        "pbr" => SceneMaterialShadingModel.Pbr,
        "toon" => SceneMaterialShadingModel.Toon,
        "custom" => SceneMaterialShadingModel.Custom,
        _ => throw Invalid($"Unknown shading model '{value}'.")
    };

    private static string AlphaModeToString(SceneMaterialAlphaMode mode) => mode switch
    {
        SceneMaterialAlphaMode.Mask => "mask",
        SceneMaterialAlphaMode.Blend => "blend",
        _ => "opaque"
    };

    private static SceneMaterialAlphaMode ParseAlphaMode(string value) => value switch
    {
        "opaque" => SceneMaterialAlphaMode.Opaque,
        "mask" => SceneMaterialAlphaMode.Mask,
        "blend" => SceneMaterialAlphaMode.Blend,
        _ => throw Invalid($"Unknown alpha mode '{value}'.")
    };

    private static SceneSnapshotException Invalid(string message) =>
        new(SceneSnapshotErrorCodes.Invalid, message);

    [DoesNotReturn]
    private static string ThrowNullElement(string name) =>
        throw new SceneSnapshotException(
            SceneSnapshotErrorCodes.InvalidNullElement,
            $"'{name}' must not contain null elements.");

    [DoesNotReturn]
    private static string ThrowInvalidStringArray(string name) =>
        throw Invalid($"'{name}' must be an array of strings");
}
