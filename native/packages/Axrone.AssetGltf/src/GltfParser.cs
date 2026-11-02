namespace Axrone.AssetGltf;

/// <summary>Manual Utf8JsonReader glTF parser (AOT-safe, no reflection).</summary>
internal static class GltfJsonParser
{
    /// <summary>Parses glTF JSON bytes into a raw model.</summary>
    /// <exception cref="GltfSchemaError">The JSON is malformed.</exception>
    public static GltfRawModel Parse(
        ReadOnlySpan<byte> jsonBytes,
        GltfImportLimits? limits = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return ParseCore(jsonBytes, limits ?? GltfImportLimits.Default, cancellationToken);
        }
        catch (Exception exception) when (exception is JsonException or FormatException or InvalidOperationException)
        {
            // Invalid UTF-8, wrong token kinds, and numeric overflow surface
            // from Utf8JsonReader as non-JsonException types.
            throw new GltfSchemaError($"glTF JSON is malformed: {exception.Message}", exception);
        }
    }

    private static GltfRawModel ParseCore(
        ReadOnlySpan<byte> jsonBytes,
        GltfImportLimits limits,
        CancellationToken cancellationToken)
    {
        var model = new GltfRawModel(limits, cancellationToken);
        try
        {
            var reader = new Utf8JsonReader(jsonBytes, new JsonReaderOptions { CommentHandling = JsonCommentHandling.Skip });

            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
            {
                ThrowHelper.ThrowContainer("Root glTF JSON payload must be an object.");
            }

            bool hasAsset = false;
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();

                if (prop.SequenceEqual("asset"u8))
                {
                    hasAsset = true;
                    ParseAsset(ref reader, model);
                }
                else if (prop.SequenceEqual("scene"u8))
                {
                    model.DefaultScene = reader.GetInt32();
                }
                else if (prop.SequenceEqual("scenes"u8))
                {
                    ParseScenes(ref reader, model);
                }
                else if (prop.SequenceEqual("cameras"u8))
                {
                    ParseCameras(ref reader, model);
                }
                else if (prop.SequenceEqual("nodes"u8))
                {
                    ParseNodes(ref reader, model);
                }
                else if (prop.SequenceEqual("meshes"u8))
                {
                    ParseMeshes(ref reader, model);
                }
                else if (prop.SequenceEqual("accessors"u8))
                {
                    ParseAccessors(ref reader, model);
                }
                else if (prop.SequenceEqual("bufferViews"u8))
                {
                    ParseBufferViews(ref reader, model);
                }
                else if (prop.SequenceEqual("buffers"u8))
                {
                    ParseBuffers(ref reader, model);
                }
                else if (prop.SequenceEqual("materials"u8))
                {
                    ParseMaterials(ref reader, model);
                }
                else if (prop.SequenceEqual("textures"u8))
                {
                    ParseTextures(ref reader, model);
                }
                else if (prop.SequenceEqual("images"u8))
                {
                    ParseImages(ref reader, model);
                }
                else if (prop.SequenceEqual("samplers"u8))
                {
                    ParseSamplers(ref reader, model);
                }
                else if (prop.SequenceEqual("skins"u8))
                {
                    ParseSkins(ref reader, model);
                }
                else if (prop.SequenceEqual("animations"u8))
                {
                    ParseAnimations(ref reader, model);
                }
                else if (prop.SequenceEqual("extensionsUsed"u8))
                {
                    ParseStringArray(ref reader, model.ExtensionsUsed);
                }
                else if (prop.SequenceEqual("extensionsRequired"u8))
                {
                    ParseStringArray(ref reader, model.ExtensionsRequired);
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    ParseRootExtensions(ref reader, model);
                }
                else
                {
                    reader.Skip();
                }
            }

            if (!hasAsset)
            {
                ThrowHelper.ThrowSchema("glTF document is missing the required 'asset' object.");
            }

            ValidateNodeReferences(model);
            return model;
        }
        catch
        {
            model.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Rejects scene and node indices that point outside their collections.
    /// JSON property order can put scenes before nodes, so this runs after the
    /// whole document is read.
    /// </summary>
    private static void ValidateNodeReferences(GltfRawModel model)
    {
        int nodeCount = model.NodeCount;
        for (int s = 0; s < model.Scenes.Count; s++)
        {
            GltfRawModel.Scene scene = model.Scenes[s];
            for (int i = 0; i < scene.Nodes.Count; i++)
            {
                int nodeIndex = scene.Nodes[i];
                if ((uint)nodeIndex >= (uint)nodeCount)
                {
                    ThrowHelper.ThrowSchema($"Scene {s} references a missing node {nodeIndex}.");
                }
            }
        }

        for (int n = 0; n < nodeCount; n++)
        {
            GltfRawModel.Node node = model.GetNode(n);
            int childCount = GltfRawModel.GetChildCount(node);
            for (int c = 0; c < childCount; c++)
            {
                int childIndex = model.GetChild(node, c);
                if ((uint)childIndex >= (uint)nodeCount)
                {
                    ThrowHelper.ThrowSchema($"Node {n} references a missing child node {childIndex}.");
                }
            }

            if (node.HasMesh && (uint)node.Mesh >= (uint)model.MeshCount)
            {
                ThrowHelper.ThrowSchema($"Node {n} references a missing mesh {node.Mesh}.");
            }

            if (node.HasSkin && (uint)node.Skin >= (uint)model.Skins.Count)
            {
                ThrowHelper.ThrowSchema($"Node {n} references a missing skin {node.Skin}.");
            }

            if (node.HasCamera && (uint)node.Camera >= (uint)model.Cameras.Count)
            {
                ThrowHelper.ThrowSchema($"Node {n} references a missing camera {node.Camera}.");
            }

            if (node.HasLight && (uint)node.Light >= (uint)model.Lights.Count)
            {
                ThrowHelper.ThrowSchema($"Node {n} references a missing light {node.Light}.");
            }
        }
    }

    private static void ParseAsset(ref Utf8JsonReader reader, GltfRawModel model)
    {
        model.Version = GltfStringRef.Empty;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("version"u8))
            {
                model.Version = model.Arena.AppendString(ref reader);
            }
            else if (prop.SequenceEqual("generator"u8))
            {
                model.Generator = model.Arena.AppendString(ref reader);
            }
            else if (prop.SequenceEqual("copyright"u8))
            {
                model.Copyright = model.Arena.AppendString(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseScenes(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var scene = new GltfRawModel.Scene();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    scene.Name = reader.GetString();
                }
                else if (prop.SequenceEqual("nodes"u8))
                {
                    ParseIntArray(ref reader, scene.Nodes);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Scenes.Add(scene);
        }
    }

    private static void ParseCameras(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var camera = new GltfRawModel.Camera();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    camera.Name = reader.GetString();
                }
                else if (prop.SequenceEqual("type"u8))
                {
                    camera.Type = reader.GetString() ?? "perspective";
                }
                else if (prop.SequenceEqual("perspective"u8))
                {
                    ParseCameraPerspective(ref reader, camera);
                }
                else if (prop.SequenceEqual("orthographic"u8))
                {
                    ParseCameraOrthographic(ref reader, camera);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Cameras.Add(camera);
        }
    }

    private static void ParseCameraPerspective(ref Utf8JsonReader reader, GltfRawModel.Camera camera)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("yfov"u8))
            {
                camera.Yfov = reader.GetSingle();
            }
            else if (prop.SequenceEqual("zfar"u8))
            {
                camera.Zfar = reader.GetSingle();
            }
            else if (prop.SequenceEqual("znear"u8))
            {
                camera.Znear = reader.GetSingle();
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseCameraOrthographic(ref Utf8JsonReader reader, GltfRawModel.Camera camera)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("xmag"u8))
            {
                camera.Xmag = reader.GetSingle();
            }
            else if (prop.SequenceEqual("ymag"u8))
            {
                camera.Ymag = reader.GetSingle();
            }
            else if (prop.SequenceEqual("zfar"u8))
            {
                camera.Zfar = reader.GetSingle();
            }
            else if (prop.SequenceEqual("znear"u8))
            {
                camera.Znear = reader.GetSingle();
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseNodes(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            model.Arena.ThrowIfCancellationRequested();

            GltfStringRef name = GltfStringRef.Empty;
            int mesh = -1;
            int skin = -1;
            int camera = -1;
            int light = -1;
            GltfSlice<int> children = GltfSlice<int>.Empty;
            bool hasMatrix = false;
            Mat4 matrix = Mat4.Identity;
            Vec3? translation = null;
            Quat? rotation = null;
            Vec3? scale = null;
            GltfSlice<float> weights = GltfSlice<float>.Empty;

            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    name = model.Arena.AppendString(ref reader);
                }
                else if (prop.SequenceEqual("mesh"u8))
                {
                    mesh = reader.GetInt32();
                }
                else if (prop.SequenceEqual("skin"u8))
                {
                    skin = reader.GetInt32();
                }
                else if (prop.SequenceEqual("camera"u8))
                {
                    camera = reader.GetInt32();
                }
                else if (prop.SequenceEqual("children"u8))
                {
                    children = ParseIntSlice(ref reader, model.Arena);
                }
                else if (prop.SequenceEqual("matrix"u8))
                {
                    matrix = ReadMatrix(ref reader);
                    hasMatrix = true;
                }
                else if (prop.SequenceEqual("translation"u8))
                {
                    translation = ReadVec3(ref reader);
                }
                else if (prop.SequenceEqual("rotation"u8))
                {
                    rotation = ReadQuat(ref reader);
                }
                else if (prop.SequenceEqual("scale"u8))
                {
                    scale = ReadVec3(ref reader);
                }
                else if (prop.SequenceEqual("weights"u8))
                {
                    weights = ParseFloatSlice(ref reader, model.Arena);
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    light = ParseNodeExtensions(ref reader);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Arena.AddNode(new GltfRawModel.Node
            {
                Name = name,
                Mesh = mesh,
                Skin = skin,
                Camera = camera,
                Light = light,
                Children = children,
                HasMatrix = hasMatrix,
                Matrix = matrix,
                Translation = translation,
                Rotation = rotation,
                Scale = scale,
                Weights = weights,
            });
        }
    }

    private static int ParseNodeExtensions(ref Utf8JsonReader reader)
    {
        int light = -1;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return light;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> extension = reader.ValueSpan;
            reader.Read();
            if (extension.SequenceEqual("KHR_lights_punctual"u8))
            {
                if (reader.TokenType != JsonTokenType.StartObject)
                {
                    reader.Skip();
                    continue;
                }

                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    ReadOnlySpan<byte> prop = reader.ValueSpan;
                    reader.Read();
                    if (prop.SequenceEqual("light"u8))
                    {
                        light = reader.GetInt32();
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
            }
            else
            {
                reader.Skip();
            }
        }

        return light;
    }

    private static void ParseRootExtensions(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> ext = reader.ValueSpan;
            reader.Read();
            if (ext.SequenceEqual("KHR_lights_punctual"u8))
            {
                ParseLightsExtension(ref reader, model);
            }
            else if (ext.SequenceEqual("KHR_materials_variants"u8))
            {
                ParseMaterialVariantsExtension(ref reader, model);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseMaterialVariantsExtension(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("variants"u8))
            {
                if (reader.TokenType != JsonTokenType.StartArray)
                {
                    reader.Skip();
                    continue;
                }

                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    var variant = new GltfRawModel.MaterialVariant();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType != JsonTokenType.PropertyName)
                        {
                            continue;
                        }

                        ReadOnlySpan<byte> variantProp = reader.ValueSpan;
                        reader.Read();
                        if (variantProp.SequenceEqual("name"u8))
                        {
                            variant.Name = reader.GetString();
                        }
                        else
                        {
                            reader.Skip();
                        }
                    }

                    model.Variants.Add(variant);
                }
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseLightsExtension(ref Utf8JsonReader reader, GltfRawModel model)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("lights"u8))
            {
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    var light = new GltfRawModel.Light();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType != JsonTokenType.PropertyName)
                        {
                            continue;
                        }

                        ReadOnlySpan<byte> prop = reader.ValueSpan;
                        reader.Read();
                        if (prop.SequenceEqual("name"u8))
                        {
                            light.Name = reader.GetString();
                        }
                        else if (prop.SequenceEqual("color"u8))
                        {
                            light.Color = ReadFloatArray(ref reader) ?? light.Color;
                        }
                        else if (prop.SequenceEqual("intensity"u8))
                        {
                            light.Intensity = reader.GetSingle();
                        }
                        else if (prop.SequenceEqual("type"u8))
                        {
                            light.Type = reader.GetString() ?? "directional";
                        }
                        else if (prop.SequenceEqual("range"u8))
                        {
                            light.Range = reader.GetSingle();
                        }
                        else if (prop.SequenceEqual("spot"u8))
                        {
                            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                            {
                                if (reader.TokenType != JsonTokenType.PropertyName)
                                {
                                    continue;
                                }

                                ReadOnlySpan<byte> spot = reader.ValueSpan;
                                reader.Read();
                                if (spot.SequenceEqual("innerConeAngle"u8))
                                {
                                    light.InnerConeAngle = reader.GetSingle();
                                }
                                else if (spot.SequenceEqual("outerConeAngle"u8))
                                {
                                    light.OuterConeAngle = reader.GetSingle();
                                }
                                else
                                {
                                    reader.Skip();
                                }
                            }
                        }
                        else
                        {
                            reader.Skip();
                        }
                    }

                    model.Lights.Add(light);
                }
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseMeshes(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            model.Arena.ThrowIfCancellationRequested();

            GltfStringRef name = GltfStringRef.Empty;
            GltfSlice<GltfRawModel.Primitive> primitives = GltfSlice<GltfRawModel.Primitive>.Empty;
            GltfSlice<float> weights = GltfSlice<float>.Empty;

            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    name = model.Arena.AppendString(ref reader);
                }
                else if (prop.SequenceEqual("primitives"u8))
                {
                    primitives = ParsePrimitives(ref reader, model.Arena);
                }
                else if (prop.SequenceEqual("weights"u8))
                {
                    weights = ParseFloatSlice(ref reader, model.Arena);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Arena.AddMesh(new GltfRawModel.Mesh
            {
                Name = name,
                Primitives = primitives,
                Weights = weights,
            });
        }
    }

    private static GltfSlice<GltfRawModel.Primitive> ParsePrimitives(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        int start = arena.PrimitiveCount;
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return GltfSlice<GltfRawModel.Primitive>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            arena.ThrowIfCancellationRequested();

            int indices = -1;
            int material = -1;
            int mode = 4;
            GltfSlice<GltfRawModel.Attribute> attributes = GltfSlice<GltfRawModel.Attribute>.Empty;
            GltfSlice<GltfRawModel.MorphTarget> targets = GltfSlice<GltfRawModel.MorphTarget>.Empty;
            GltfSlice<GltfRawModel.PrimitiveMaterialVariant> materialVariants =
                GltfSlice<GltfRawModel.PrimitiveMaterialVariant>.Empty;
            GltfRawModel.DracoPrimitiveExtension draco = default;

            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("indices"u8))
                {
                    indices = reader.GetInt32();
                }
                else if (prop.SequenceEqual("material"u8))
                {
                    material = reader.GetInt32();
                }
                else if (prop.SequenceEqual("mode"u8))
                {
                    mode = reader.GetInt32();
                }
                else if (prop.SequenceEqual("attributes"u8))
                {
                    attributes = ParseAttributeMap(ref reader, arena);
                }
                else if (prop.SequenceEqual("targets"u8))
                {
                    targets = ParseMorphTargets(ref reader, arena);
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    (draco, materialVariants) = ParsePrimitiveExtensions(ref reader, arena);
                }
                else
                {
                    reader.Skip();
                }
            }

            arena.AddPrimitive(new GltfRawModel.Primitive
            {
                Indices = indices,
                Material = material,
                Mode = mode,
                Attributes = attributes,
                Targets = targets,
                MaterialVariants = materialVariants,
                Draco = draco,
            });
        }

        return new GltfSlice<GltfRawModel.Primitive>(start, arena.PrimitiveCount - start);
    }

    private static GltfSlice<GltfRawModel.MorphTarget> ParseMorphTargets(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        int start = arena.MorphTargetCount;
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return GltfSlice<GltfRawModel.MorphTarget>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            GltfSlice<GltfRawModel.Attribute> attributes = ParseAttributeMap(ref reader, arena);
            arena.AddMorphTarget(new GltfRawModel.MorphTarget { Attributes = attributes });
        }

        return arena.CaptureMorphTargets(start);
    }

    private static GltfSlice<GltfRawModel.Attribute> ParseAttributeMap(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        int start = arena.AttributeCount;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return GltfSlice<GltfRawModel.Attribute>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            GltfMeshSemantic semantic = ParseSemantic(ref reader, arena, out GltfStringRef customName);
            reader.Read();
            int accessor = reader.GetInt32();
            arena.AddAttribute(new GltfRawModel.Attribute
            {
                Semantic = semantic,
                Accessor = accessor,
                Name = customName,
            });
        }

        return arena.CaptureAttributes(start);
    }

    private static GltfMeshSemantic ParseSemantic(
        ref Utf8JsonReader reader,
        GltfParseArena arena,
        out GltfStringRef customName)
    {
        customName = GltfStringRef.Empty;
        if (reader.ValueIsEscaped)
        {
            string escapedName = reader.GetString() ?? string.Empty;
            if (TryParseSemanticName(escapedName, out GltfMeshSemantic knownSemantic))
            {
                return knownSemantic;
            }

            customName = arena.AppendUtf8(Encoding.UTF8.GetBytes(escapedName));
            return GltfMeshSemantic.Custom;
        }

        {
            ReadOnlySpan<byte> value = reader.ValueSpan;
            if (value.SequenceEqual("POSITION"u8)) return GltfMeshSemantic.Position;
            if (value.SequenceEqual("NORMAL"u8)) return GltfMeshSemantic.Normal;
            if (value.SequenceEqual("TANGENT"u8)) return GltfMeshSemantic.Tangent;
            if (value.SequenceEqual("TEXCOORD_0"u8)) return GltfMeshSemantic.Uv0;
            if (value.SequenceEqual("TEXCOORD_1"u8)) return GltfMeshSemantic.Uv1;
            if (value.SequenceEqual("TEXCOORD_2"u8)) return GltfMeshSemantic.Uv2;
            if (value.SequenceEqual("TEXCOORD_3"u8)) return GltfMeshSemantic.Uv3;
            if (value.SequenceEqual("COLOR_0"u8)) return GltfMeshSemantic.Color0;
            if (value.SequenceEqual("COLOR_1"u8)) return GltfMeshSemantic.Color1;
            if (value.SequenceEqual("JOINTS_0"u8)) return GltfMeshSemantic.Joints0;
            if (value.SequenceEqual("JOINTS_1"u8)) return GltfMeshSemantic.Joints1;
            if (value.SequenceEqual("WEIGHTS_0"u8)) return GltfMeshSemantic.Weights0;
            if (value.SequenceEqual("WEIGHTS_1"u8)) return GltfMeshSemantic.Weights1;
        }

        customName = arena.AppendString(ref reader);
        return GltfMeshSemantic.Custom;
    }

    private static bool TryParseSemanticName(string name, out GltfMeshSemantic semantic)
    {
        switch (name)
        {
            case "POSITION": semantic = GltfMeshSemantic.Position; return true;
            case "NORMAL": semantic = GltfMeshSemantic.Normal; return true;
            case "TANGENT": semantic = GltfMeshSemantic.Tangent; return true;
            case "TEXCOORD_0": semantic = GltfMeshSemantic.Uv0; return true;
            case "TEXCOORD_1": semantic = GltfMeshSemantic.Uv1; return true;
            case "TEXCOORD_2": semantic = GltfMeshSemantic.Uv2; return true;
            case "TEXCOORD_3": semantic = GltfMeshSemantic.Uv3; return true;
            case "COLOR_0": semantic = GltfMeshSemantic.Color0; return true;
            case "COLOR_1": semantic = GltfMeshSemantic.Color1; return true;
            case "JOINTS_0": semantic = GltfMeshSemantic.Joints0; return true;
            case "JOINTS_1": semantic = GltfMeshSemantic.Joints1; return true;
            case "WEIGHTS_0": semantic = GltfMeshSemantic.Weights0; return true;
            case "WEIGHTS_1": semantic = GltfMeshSemantic.Weights1; return true;
            default: semantic = default; return false;
        }
    }

    private static (GltfRawModel.DracoPrimitiveExtension Draco, GltfSlice<GltfRawModel.PrimitiveMaterialVariant> Variants) ParsePrimitiveExtensions(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        GltfRawModel.DracoPrimitiveExtension draco = default;
        GltfSlice<GltfRawModel.PrimitiveMaterialVariant> variants =
            GltfSlice<GltfRawModel.PrimitiveMaterialVariant>.Empty;

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return (draco, variants);
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> extension = reader.ValueSpan;
            reader.Read();
            if (extension.SequenceEqual("KHR_draco_mesh_compression"u8))
            {
                draco = ParseDraco(ref reader, arena);
            }
            else if (extension.SequenceEqual("KHR_materials_variants"u8))
            {
                variants = ParsePrimitiveMaterialVariants(ref reader, arena);
            }
            else
            {
                reader.Skip();
            }
        }

        return (draco, variants);
    }

    private static GltfRawModel.DracoPrimitiveExtension ParseDraco(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        int bufferView = -1;
        GltfSlice<GltfRawModel.Attribute> attributes = GltfSlice<GltfRawModel.Attribute>.Empty;

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return new GltfRawModel.DracoPrimitiveExtension
            {
                Present = true,
                BufferView = bufferView,
                Attributes = attributes,
            };
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("bufferView"u8))
            {
                bufferView = reader.GetInt32();
            }
            else if (prop.SequenceEqual("attributes"u8))
            {
                attributes = ParseAttributeMap(ref reader, arena);
            }
            else
            {
                reader.Skip();
            }
        }

        return new GltfRawModel.DracoPrimitiveExtension
        {
            Present = true,
            BufferView = bufferView,
            Attributes = attributes,
        };
    }

    private static GltfSlice<GltfRawModel.PrimitiveMaterialVariant> ParsePrimitiveMaterialVariants(
        ref Utf8JsonReader reader,
        GltfParseArena arena)
    {
        int start = arena.MaterialVariantCount;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return GltfSlice<GltfRawModel.PrimitiveMaterialVariant>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (!prop.SequenceEqual("mappings"u8))
            {
                reader.Skip();
                continue;
            }

            if (reader.TokenType != JsonTokenType.StartArray)
            {
                reader.Skip();
                continue;
            }

            while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
            {
                int material = -1;
                GltfSlice<int> variants = GltfSlice<int>.Empty;

                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    ReadOnlySpan<byte> mappingProp = reader.ValueSpan;
                    reader.Read();
                    if (mappingProp.SequenceEqual("variants"u8))
                    {
                        variants = ParseIntSlice(ref reader, arena);
                    }
                    else if (mappingProp.SequenceEqual("material"u8))
                    {
                        material = reader.GetInt32();
                    }
                    else
                    {
                        reader.Skip();
                    }
                }

                arena.AddMaterialVariant(new GltfRawModel.PrimitiveMaterialVariant
                {
                    Variants = variants,
                    Material = material,
                });
            }
        }

        return arena.CaptureMaterialVariants(start);
    }

    private static void ParseAccessors(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            model.Arena.ThrowIfCancellationRequested();

            int bufferView = -1;
            int byteOffset = 0;
            int componentType = 0;
            bool normalized = false;
            int count = 0;
            GltfAccessorType type = GltfAccessorType.Scalar;
            GltfSlice<float> min = GltfSlice<float>.Empty;
            GltfSlice<float> max = GltfSlice<float>.Empty;
            bool hasMin = false;
            bool hasMax = false;
            GltfRawModel.AccessorSparse sparse = default;

            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("bufferView"u8))
                {
                    bufferView = reader.GetInt32();
                }
                else if (prop.SequenceEqual("byteOffset"u8))
                {
                    byteOffset = reader.GetInt32();
                }
                else if (prop.SequenceEqual("componentType"u8))
                {
                    componentType = reader.GetInt32();
                }
                else if (prop.SequenceEqual("normalized"u8))
                {
                    normalized = reader.GetBoolean();
                }
                else if (prop.SequenceEqual("count"u8))
                {
                    count = reader.GetInt32();
                }
                else if (prop.SequenceEqual("type"u8))
                {
                    type = ParseAccessorType(reader.ValueSpan);
                }
                else if (prop.SequenceEqual("min"u8))
                {
                    min = ParseFloatSlice(ref reader, model.Arena);
                    hasMin = true;
                }
                else if (prop.SequenceEqual("max"u8))
                {
                    max = ParseFloatSlice(ref reader, model.Arena);
                    hasMax = true;
                }
                else if (prop.SequenceEqual("sparse"u8))
                {
                    sparse = ParseAccessorSparse(ref reader);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Arena.AddAccessor(new GltfRawModel.Accessor
            {
                BufferView = bufferView,
                ByteOffset = byteOffset,
                ComponentType = componentType,
                Normalized = normalized,
                Count = count,
                Type = type,
                Min = min,
                HasMin = hasMin,
                Max = max,
                HasMax = hasMax,
                Sparse = sparse,
            });
        }
    }

    private static GltfAccessorType ParseAccessorType(ReadOnlySpan<byte> type)
    {
        if (type.SequenceEqual("SCALAR"u8)) return GltfAccessorType.Scalar;
        if (type.SequenceEqual("VEC2"u8)) return GltfAccessorType.Vec2;
        if (type.SequenceEqual("VEC3"u8)) return GltfAccessorType.Vec3;
        if (type.SequenceEqual("VEC4"u8)) return GltfAccessorType.Vec4;
        if (type.SequenceEqual("MAT2"u8)) return GltfAccessorType.Mat2;
        if (type.SequenceEqual("MAT3"u8)) return GltfAccessorType.Mat3;
        if (type.SequenceEqual("MAT4"u8)) return GltfAccessorType.Mat4;
        return GltfAccessorType.Scalar;
    }

    private static GltfRawModel.AccessorSparse ParseAccessorSparse(ref Utf8JsonReader reader)
    {
        int count = 0;
        GltfRawModel.SparseIndices indices = default;
        GltfRawModel.SparseValues values = default;

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return default;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("count"u8))
            {
                count = reader.GetInt32();
            }
            else if (prop.SequenceEqual("indices"u8))
            {
                indices = ParseSparseIndices(ref reader);
            }
            else if (prop.SequenceEqual("values"u8))
            {
                values = ParseSparseValues(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }

        return new GltfRawModel.AccessorSparse
        {
            HasSparse = true,
            Count = count,
            Indices = indices,
            Values = values,
        };
    }

    private static GltfRawModel.SparseIndices ParseSparseIndices(ref Utf8JsonReader reader)
    {
        int bufferView = -1;
        int byteOffset = 0;
        int componentType = 0;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("bufferView"u8))
            {
                bufferView = reader.GetInt32();
            }
            else if (prop.SequenceEqual("byteOffset"u8))
            {
                byteOffset = reader.GetInt32();
            }
            else if (prop.SequenceEqual("componentType"u8))
            {
                componentType = reader.GetInt32();
            }
            else
            {
                reader.Skip();
            }
        }

        return new GltfRawModel.SparseIndices
        {
            BufferView = bufferView,
            ByteOffset = byteOffset,
            ComponentType = componentType,
        };
    }

    private static GltfRawModel.SparseValues ParseSparseValues(ref Utf8JsonReader reader)
    {
        int bufferView = -1;
        int byteOffset = 0;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("bufferView"u8))
            {
                bufferView = reader.GetInt32();
            }
            else if (prop.SequenceEqual("byteOffset"u8))
            {
                byteOffset = reader.GetInt32();
            }
            else
            {
                reader.Skip();
            }
        }

        return new GltfRawModel.SparseValues
        {
            BufferView = bufferView,
            ByteOffset = byteOffset,
        };
    }

    private static GltfSlice<int> ParseIntSlice(ref Utf8JsonReader reader, GltfParseArena arena)
    {
        int start = arena.IntPoolCount;
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return GltfSlice<int>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            arena.AddInt(reader.GetInt32());
        }

        return arena.CaptureInts(start);
    }

    private static GltfSlice<float> ParseFloatSlice(ref Utf8JsonReader reader, GltfParseArena arena)
    {
        int start = arena.FloatPoolCount;
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return GltfSlice<float>.Empty;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            arena.AddFloat(reader.GetSingle());
        }

        return arena.CaptureFloats(start);
    }

    private static void ParseBufferViews(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var bv = new GltfRawModel.BufferView();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("buffer"u8))
                {
                    bv.Buffer = reader.GetInt32();
                }
                else if (prop.SequenceEqual("byteOffset"u8))
                {
                    bv.ByteOffset = reader.GetInt32();
                }
                else if (prop.SequenceEqual("byteLength"u8))
                {
                    bv.ByteLength = reader.GetInt32();
                }
                else if (prop.SequenceEqual("byteStride"u8))
                {
                    bv.ByteStride = reader.GetInt32();
                }
                else if (prop.SequenceEqual("target"u8))
                {
                    bv.Target = reader.GetInt32();
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    ParseBufferViewExtensions(ref reader, bv);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.BufferViews.Add(bv);
        }
    }

    private static void ParseBufferViewExtensions(ref Utf8JsonReader reader, GltfRawModel.BufferView bv)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("EXT_meshopt_compression"u8))
            {
                bv.Meshopt = new GltfRawModel.BufferViewMeshoptExtension();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    ReadOnlySpan<byte> prop = reader.ValueSpan;
                    reader.Read();
                    if (prop.SequenceEqual("buffer"u8))
                    {
                        bv.Meshopt.Buffer = reader.GetInt32();
                    }
                    else if (prop.SequenceEqual("byteOffset"u8))
                    {
                        bv.Meshopt.ByteOffset = reader.GetInt32();
                    }
                    else if (prop.SequenceEqual("byteLength"u8))
                    {
                        bv.Meshopt.ByteLength = reader.GetInt32();
                    }
                    else if (prop.SequenceEqual("byteStride"u8))
                    {
                        bv.Meshopt.ByteStride = reader.GetInt32();
                    }
                    else if (prop.SequenceEqual("count"u8))
                    {
                        bv.Meshopt.Count = reader.GetInt32();
                    }
                    else if (prop.SequenceEqual("mode"u8))
                    {
                        bv.Meshopt.Mode = reader.GetString() ?? "ATTRIBUTES";
                    }
                    else if (prop.SequenceEqual("filter"u8))
                    {
                        bv.Meshopt.Filter = reader.GetString() ?? "NONE";
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseBuffers(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var buffer = new GltfRawModel.Buffer();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("byteLength"u8))
                {
                    buffer.ByteLength = reader.GetInt32();
                }
                else if (prop.SequenceEqual("uri"u8))
                {
                    buffer.Uri = reader.GetString();
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Buffers.Add(buffer);
        }
    }

    private static void ParseMaterials(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var mat = new GltfRawModel.Material();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    mat.Name = reader.GetString();
                }
                else if (prop.SequenceEqual("alphaMode"u8))
                {
                    mat.AlphaMode = reader.GetString() ?? "OPAQUE";
                }
                else if (prop.SequenceEqual("alphaCutoff"u8))
                {
                    mat.AlphaCutoff = reader.GetSingle();
                }
                else if (prop.SequenceEqual("doubleSided"u8))
                {
                    mat.DoubleSided = reader.GetBoolean();
                }
                else if (prop.SequenceEqual("emissiveFactor"u8))
                {
                    mat.EmissiveFactor = ReadFloatArray(ref reader);
                }
                else if (prop.SequenceEqual("pbrMetallicRoughness"u8))
                {
                    ParsePbr(ref reader, mat);
                }
                else if (prop.SequenceEqual("normalTexture"u8))
                {
                    mat.NormalTexture = ParseTextureInfo(ref reader);
                }
                else if (prop.SequenceEqual("occlusionTexture"u8))
                {
                    mat.OcclusionTexture = ParseTextureInfo(ref reader);
                }
                else if (prop.SequenceEqual("emissiveTexture"u8))
                {
                    mat.EmissiveTexture = ParseTextureInfo(ref reader);
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    ParseMaterialExtensions(ref reader, mat);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Materials.Add(mat);
        }
    }

    private static void ParsePbr(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("baseColorFactor"u8))
            {
                mat.Pbr.BaseColorFactor = ReadFloatArray(ref reader);
            }
            else if (prop.SequenceEqual("metallicFactor"u8))
            {
                mat.Pbr.MetallicFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("roughnessFactor"u8))
            {
                mat.Pbr.RoughnessFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("baseColorTexture"u8))
            {
                mat.Pbr.BaseColorTexture = ParseTextureInfo(ref reader);
            }
            else if (prop.SequenceEqual("metallicRoughnessTexture"u8))
            {
                mat.Pbr.MetallicRoughnessTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static GltfRawModel.TextureInfo ParseTextureInfo(ref Utf8JsonReader reader)
    {
        var info = new GltfRawModel.TextureInfo();
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return info;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("index"u8))
            {
                info.Index = reader.GetInt32();
            }
            else if (prop.SequenceEqual("texCoord"u8))
            {
                info.TexCoord = reader.GetInt32();
            }
            else if (prop.SequenceEqual("scale"u8))
            {
                info.Scale = reader.GetSingle();
            }
            else if (prop.SequenceEqual("strength"u8))
            {
                info.Strength = reader.GetSingle();
            }
            else if (prop.SequenceEqual("extensions"u8))
            {
                ParseTextureTransformExtension(ref reader, info);
            }
            else
            {
                reader.Skip();
            }
        }

        return info;
    }

    private static void ParseTextureTransformExtension(ref Utf8JsonReader reader, GltfRawModel.TextureInfo info)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("KHR_texture_transform"u8))
            {
                var offset = Vec2.Zero;
                var scale = Vec2.One;
                float rotation = 0.0f;
                int texCoord = info.TexCoord;

                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    ReadOnlySpan<byte> prop = reader.ValueSpan;
                    reader.Read();
                    if (prop.SequenceEqual("offset"u8))
                    {
                        float[]? arr = ReadFloatArray(ref reader);
                        if (arr != null && arr.Length >= 2)
                        {
                            offset = new Vec2(arr[0], arr[1]);
                        }
                    }
                    else if (prop.SequenceEqual("scale"u8))
                    {
                        float[]? arr = ReadFloatArray(ref reader);
                        if (arr != null && arr.Length >= 2)
                        {
                            scale = new Vec2(arr[0], arr[1]);
                        }
                    }
                    else if (prop.SequenceEqual("rotation"u8))
                    {
                        rotation = reader.GetSingle();
                    }
                    else if (prop.SequenceEqual("texCoord"u8))
                    {
                        texCoord = reader.GetInt32();
                    }
                    else
                    {
                        reader.Skip();
                    }
                }

                info.Transform = new GltfTextureTransform(offset, scale, rotation, texCoord);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseMaterialExtensions(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> ext = reader.ValueSpan;
            reader.Read();
            if (ext.SequenceEqual("KHR_materials_unlit"u8))
            {
                mat.Unlit = true;
                reader.Skip();
            }
            else if (ext.SequenceEqual("KHR_materials_clearcoat"u8))
            {
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    ReadOnlySpan<byte> prop = reader.ValueSpan;
                    reader.Read();
                    if (prop.SequenceEqual("clearcoatFactor"u8))
                    {
                        mat.ClearcoatFactor = reader.GetSingle();
                    }
                    else if (prop.SequenceEqual("clearcoatRoughnessFactor"u8))
                    {
                        mat.ClearcoatRoughnessFactor = reader.GetSingle();
                    }
                    else if (prop.SequenceEqual("clearcoatTexture"u8))
                    {
                        mat.ClearcoatTexture = ParseTextureInfo(ref reader);
                    }
                    else if (prop.SequenceEqual("clearcoatRoughnessTexture"u8))
                    {
                        mat.ClearcoatRoughnessTexture = ParseTextureInfo(ref reader);
                    }
                    else if (prop.SequenceEqual("clearcoatNormalTexture"u8))
                    {
                        mat.ClearcoatNormalTexture = ParseTextureInfo(ref reader);
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
            }
            else if (ext.SequenceEqual("KHR_materials_emissive_strength"u8))
            {
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("emissiveStrength"u8))
                    {
                        reader.Read();
                        mat.EmissiveStrength = reader.GetSingle();
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
            }
            else if (ext.SequenceEqual("KHR_materials_specular"u8))
            {
                ParseSpecularExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_sheen"u8))
            {
                ParseSheenExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_transmission"u8))
            {
                ParseTransmissionExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_volume"u8))
            {
                ParseVolumeExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_ior"u8))
            {
                ParseIorExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_iridescence"u8))
            {
                ParseIridescenceExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_anisotropy"u8))
            {
                ParseAnisotropyExtension(ref reader, mat);
            }
            else if (ext.SequenceEqual("KHR_materials_dispersion"u8))
            {
                ParseDispersionExtension(ref reader, mat);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseSpecularExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("specularFactor"u8))
            {
                mat.SpecularFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("specularColorFactor"u8))
            {
                mat.SpecularColorFactor = ReadFloatArray(ref reader);
            }
            else if (prop.SequenceEqual("specularTexture"u8))
            {
                mat.SpecularTexture = ParseTextureInfo(ref reader);
            }
            else if (prop.SequenceEqual("specularColorTexture"u8))
            {
                mat.SpecularColorTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseSheenExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("sheenColorFactor"u8))
            {
                mat.SheenColorFactor = ReadFloatArray(ref reader);
            }
            else if (prop.SequenceEqual("sheenColorTexture"u8))
            {
                mat.SheenColorTexture = ParseTextureInfo(ref reader);
            }
            else if (prop.SequenceEqual("sheenRoughnessFactor"u8))
            {
                mat.SheenRoughnessFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("sheenRoughnessTexture"u8))
            {
                mat.SheenRoughnessTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseTransmissionExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("transmissionFactor"u8))
            {
                mat.TransmissionFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("transmissionTexture"u8))
            {
                mat.TransmissionTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseVolumeExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("thicknessFactor"u8))
            {
                mat.ThicknessFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("thicknessTexture"u8))
            {
                mat.ThicknessTexture = ParseTextureInfo(ref reader);
            }
            else if (prop.SequenceEqual("attenuationDistance"u8))
            {
                mat.AttenuationDistance = reader.GetSingle();
            }
            else if (prop.SequenceEqual("attenuationColor"u8))
            {
                mat.AttenuationColor = ReadFloatArray(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseIorExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("ior"u8))
            {
                reader.Read();
                mat.Ior = reader.GetSingle();
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseIridescenceExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("iridescenceFactor"u8))
            {
                mat.IridescenceFactor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("iridescenceTexture"u8))
            {
                mat.IridescenceTexture = ParseTextureInfo(ref reader);
            }
            else if (prop.SequenceEqual("iridescenceIor"u8))
            {
                mat.IridescenceIor = reader.GetSingle();
            }
            else if (prop.SequenceEqual("iridescenceThicknessMinimum"u8))
            {
                mat.IridescenceThicknessMinimum = reader.GetSingle();
            }
            else if (prop.SequenceEqual("iridescenceThicknessMaximum"u8))
            {
                mat.IridescenceThicknessMaximum = reader.GetSingle();
            }
            else if (prop.SequenceEqual("iridescenceThicknessTexture"u8))
            {
                mat.IridescenceThicknessTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseAnisotropyExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            ReadOnlySpan<byte> prop = reader.ValueSpan;
            reader.Read();
            if (prop.SequenceEqual("anisotropyStrength"u8))
            {
                mat.AnisotropyStrength = reader.GetSingle();
            }
            else if (prop.SequenceEqual("anisotropyRotation"u8))
            {
                mat.AnisotropyRotation = reader.GetSingle();
            }
            else if (prop.SequenceEqual("anisotropyTexture"u8))
            {
                mat.AnisotropyTexture = ParseTextureInfo(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseDispersionExtension(ref Utf8JsonReader reader, GltfRawModel.Material mat)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.ValueSpan.SequenceEqual("dispersion"u8))
            {
                reader.Read();
                mat.Dispersion = reader.GetSingle();
            }
            else
            {
                reader.Skip();
            }
        }
    }

    private static void ParseTextures(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var tex = new GltfRawModel.Texture();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("sampler"u8))
                {
                    tex.Sampler = reader.GetInt32();
                }
                else if (prop.SequenceEqual("source"u8))
                {
                    tex.Source = reader.GetInt32();
                }
                else if (prop.SequenceEqual("extensions"u8))
                {
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType != JsonTokenType.PropertyName)
                        {
                            continue;
                        }

                        ReadOnlySpan<byte> extension = reader.ValueSpan;
                        reader.Read();
                        if (extension.SequenceEqual("KHR_texture_basisu"u8) ||
                            extension.SequenceEqual("EXT_texture_webp"u8) ||
                            extension.SequenceEqual("EXT_texture_avif"u8))
                        {
                            if (reader.TokenType != JsonTokenType.StartObject)
                            {
                                reader.Skip();
                                continue;
                            }

                            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                            {
                                if (reader.TokenType != JsonTokenType.PropertyName)
                                {
                                    continue;
                                }

                                ReadOnlySpan<byte> extensionProp = reader.ValueSpan;
                                reader.Read();
                                if (extensionProp.SequenceEqual("source"u8))
                                {
                                    tex.Source = reader.GetInt32();
                                }
                                else
                                {
                                    reader.Skip();
                                }
                            }
                        }
                        else
                        {
                            reader.Skip();
                        }
                    }
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Textures.Add(tex);
        }
    }

    private static void ParseImages(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var img = new GltfRawModel.Image();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("uri"u8))
                {
                    img.Uri = reader.GetString();
                }
                else if (prop.SequenceEqual("mimeType"u8))
                {
                    img.MimeType = reader.GetString();
                }
                else if (prop.SequenceEqual("bufferView"u8))
                {
                    img.BufferView = reader.GetInt32();
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Images.Add(img);
        }
    }

    private static void ParseSamplers(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var samp = new GltfRawModel.Sampler();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("magFilter"u8))
                {
                    samp.MagFilter = reader.GetInt32();
                }
                else if (prop.SequenceEqual("minFilter"u8))
                {
                    samp.MinFilter = reader.GetInt32();
                }
                else if (prop.SequenceEqual("wrapS"u8))
                {
                    samp.WrapS = reader.GetInt32();
                }
                else if (prop.SequenceEqual("wrapT"u8))
                {
                    samp.WrapT = reader.GetInt32();
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Samplers.Add(samp);
        }
    }

    private static void ParseSkins(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var skin = new GltfRawModel.Skin();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    skin.Name = reader.GetString();
                }
                else if (prop.SequenceEqual("inverseBindMatrices"u8))
                {
                    skin.InverseBindMatrices = reader.GetInt32();
                }
                else if (prop.SequenceEqual("skeleton"u8))
                {
                    skin.Skeleton = reader.GetInt32();
                }
                else if (prop.SequenceEqual("joints"u8))
                {
                    ParseIntArray(ref reader, skin.Joints);
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Skins.Add(skin);
        }
    }

    private static void ParseAnimations(ref Utf8JsonReader reader, GltfRawModel model)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            var anim = new GltfRawModel.Animation();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    continue;
                }

                ReadOnlySpan<byte> prop = reader.ValueSpan;
                reader.Read();
                if (prop.SequenceEqual("name"u8))
                {
                    anim.Name = reader.GetString();
                }
                else if (prop.SequenceEqual("samplers"u8))
                {
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                    {
                        var samp = new GltfRawModel.AnimationSampler();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                        {
                            if (reader.TokenType != JsonTokenType.PropertyName)
                            {
                                continue;
                            }

                            ReadOnlySpan<byte> sprop = reader.ValueSpan;
                            reader.Read();
                            if (sprop.SequenceEqual("input"u8))
                            {
                                samp.Input = reader.GetInt32();
                            }
                            else if (sprop.SequenceEqual("interpolation"u8))
                            {
                                samp.Interpolation = reader.GetString() ?? "LINEAR";
                            }
                            else if (sprop.SequenceEqual("output"u8))
                            {
                                samp.Output = reader.GetInt32();
                            }
                            else
                            {
                                reader.Skip();
                            }
                        }

                        anim.Samplers.Add(samp);
                    }
                }
                else if (prop.SequenceEqual("channels"u8))
                {
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                    {
                        var chan = new GltfRawModel.AnimationChannel();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                        {
                            if (reader.TokenType != JsonTokenType.PropertyName)
                            {
                                continue;
                            }

                            ReadOnlySpan<byte> cprop = reader.ValueSpan;
                            reader.Read();
                            if (cprop.SequenceEqual("sampler"u8))
                            {
                                chan.Sampler = reader.GetInt32();
                            }
                            else if (cprop.SequenceEqual("target"u8))
                            {
                                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                                {
                                    if (reader.TokenType != JsonTokenType.PropertyName)
                                    {
                                        continue;
                                    }

                                    ReadOnlySpan<byte> tprop = reader.ValueSpan;
                                    reader.Read();
                                    if (tprop.SequenceEqual("node"u8))
                                    {
                                        chan.TargetNode = reader.GetInt32();
                                    }
                                    else if (tprop.SequenceEqual("path"u8))
                                    {
                                        chan.TargetPath = reader.GetString() ?? "translation";
                                    }
                                    else if (tprop.SequenceEqual("extensions"u8))
                                    {
                                        if (reader.TokenType != JsonTokenType.StartObject)
                                        {
                                            reader.Skip();
                                            continue;
                                        }

                                        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                                        {
                                            if (reader.TokenType != JsonTokenType.PropertyName)
                                            {
                                                continue;
                                            }

                                            ReadOnlySpan<byte> extension = reader.ValueSpan;
                                            reader.Read();
                                            if (extension.SequenceEqual("KHR_animation_pointer"u8) &&
                                                reader.TokenType == JsonTokenType.StartObject)
                                            {
                                                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                                                {
                                                    if (reader.TokenType != JsonTokenType.PropertyName)
                                                    {
                                                        continue;
                                                    }

                                                    ReadOnlySpan<byte> pointerProp = reader.ValueSpan;
                                                    reader.Read();
                                                    if (pointerProp.SequenceEqual("pointer"u8))
                                                    {
                                                        chan.Pointer = reader.GetString();
                                                    }
                                                    else
                                                    {
                                                        reader.Skip();
                                                    }
                                                }
                                            }
                                            else
                                            {
                                                reader.Skip();
                                            }
                                        }
                                    }
                                    else
                                    {
                                        reader.Skip();
                                    }
                                }
                            }
                            else
                            {
                                reader.Skip();
                            }
                        }

                        anim.Channels.Add(chan);
                    }
                }
                else
                {
                    reader.Skip();
                }
            }

            model.Animations.Add(anim);
        }
    }

    private static Vec3 ReadVec3(ref Utf8JsonReader reader)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return Vec3.Zero;
        }

        reader.Read();
        float x = reader.GetSingle();
        reader.Read();
        float y = reader.GetSingle();
        reader.Read();
        float z = reader.GetSingle();
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
        }

        return new Vec3(x, y, z);
    }

    private static Quat ReadQuat(ref Utf8JsonReader reader)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return Quat.Identity;
        }

        reader.Read();
        float x = reader.GetSingle();
        reader.Read();
        float y = reader.GetSingle();
        reader.Read();
        float z = reader.GetSingle();
        reader.Read();
        float w = reader.GetSingle();
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
        }

        return new Quat(x, y, z, w);
    }

    private static Mat4 ReadMatrix(ref Utf8JsonReader reader)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return Mat4.Identity;
        }

        Span<float> values = stackalloc float[16];
        int count = 0;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            if (count < 16)
            {
                values[count++] = reader.GetSingle();
            }
        }

        return count < 16 ? Mat4.Identity : new Mat4(values);
    }

    private static void ParseIntArray(ref Utf8JsonReader reader, List<int> list)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            list.Add(reader.GetInt32());
        }
    }

    private static void ParseStringArray(ref Utf8JsonReader reader, HashSet<string> set)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return;
        }

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            string? s = reader.GetString();
            if (s != null)
            {
                set.Add(s);
            }
        }
    }

    private static float[]? ReadFloatArray(ref Utf8JsonReader reader)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return null;
        }

        var list = new List<float>(4);
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            list.Add(reader.GetSingle());
        }

        return list.ToArray();
    }
}
