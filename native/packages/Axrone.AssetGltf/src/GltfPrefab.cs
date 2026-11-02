namespace Axrone.AssetGltf;

/// <summary>Scene graph synthesizer: prefabs from raw nodes.</summary>
internal static class GltfPrefabEngine
{
    /// <summary>Decomposes a node matrix or TRS into translation/rotation/scale.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void DecomposeTransform(
        GltfRawModel.Node node,
        out Vec3 translation,
        out Quat rotation,
        out Vec3 scale)
    {
        if (node.HasMatrix && node.Matrix.Decompose(out scale, out rotation, out translation))
        {
            return;
        }

        translation = node.Translation ?? Vec3.Zero;
        rotation = node.Rotation ?? Quat.Identity;
        scale = node.Scale ?? Vec3.One;
    }

    /// <summary>Builds a prefab asset for one scene.</summary>
    public static GltfPrefabAsset BuildPrefab(
        int sceneIndex,
        GltfRawModel model,
        bool isDefaultScene,
        List<GltfDiagnostic> diagnostics,
        ImmutableArray<ImmutableArray<string>> meshKeysByMesh,
        ImmutableDictionary<int, string> skinKeyMap,
        ImmutableArray<string> animationClipIds,
        int maxLocalLights)
    {
        string prefabId = $"gltf/scene/{sceneIndex}";
        GltfRawModel.Scene scene = model.Scenes[sceneIndex];

        var actorList = new List<GltfActorSnapshot>();
        var rootNodeIds = new List<string>();
        var allNodeIds = new HashSet<string>(StringComparer.Ordinal);
        var materialKeys = new SortedSet<string>(StringComparer.Ordinal);

        bool primaryCameraAssigned = false;
        bool primaryDirectionalAllocated = false;
        int localLightCount = 0;

        var stack = new Stack<(int NodeIndex, string? ParentNodeId)>();
        var visited = new HashSet<int>();

        for (int i = scene.Nodes.Count - 1; i >= 0; i--)
        {
            stack.Push((scene.Nodes[i], null));
        }

        bool firstRoot = true;

        while (stack.Count > 0)
        {
            (int nodeIdx, string? parentId) = stack.Pop();
            if (!visited.Add(nodeIdx))
            {
                diagnostics.Add(new GltfDiagnostic(
                    GltfDiagnosticLevel.Warning,
                    "gltf.prefab.cycle",
                    $"Scene traversal cycle detected at node index {nodeIdx}."));
                continue;
            }

            GltfRawModel.Node node = model.GetNode(nodeIdx);
            string nodeName = model.GetString(node.Name);
            string nodeId = $"node_{nodeIdx}_{(node.Name.IsEmpty ? "unnamed" : nodeName)}";
            allNodeIds.Add(nodeId);

            if (parentId == null)
            {
                rootNodeIds.Add(nodeId);
            }

            DecomposeTransform(node, out Vec3 t, out Quat r, out Vec3 s);
            var compBuilder = ImmutableArray.CreateBuilder<GltfComponentSnapshot>();
            compBuilder.Add(new GltfTransformComponent(t, r, s));

            if (node.HasCamera && (uint)node.Camera < (uint)model.Cameras.Count)
            {
                GltfRawModel.Camera cam = model.Cameras[node.Camera];
                bool isPrimaryCam = isDefaultScene && parentId == null && !primaryCameraAssigned;
                bool isOrtho = string.Equals(cam.Type, "orthographic", StringComparison.OrdinalIgnoreCase);

                compBuilder.Add(new GltfCameraComponent(
                    isPrimaryCam,
                    cam.Znear,
                    cam.Zfar,
                    cam.Yfov,
                    isOrtho,
                    cam.Ymag));

                primaryCameraAssigned |= isPrimaryCam;
            }

            if (node.HasLight && (uint)node.Light < (uint)model.Lights.Count)
            {
                GltfRawModel.Light light = model.Lights[node.Light];
                var color = new Vec3(light.Color[0], light.Color[1], light.Color[2]);

                if (string.Equals(light.Type, "directional", StringComparison.OrdinalIgnoreCase))
                {
                    bool isPrimaryLight = !primaryDirectionalAllocated;
                    primaryDirectionalAllocated = true;
                    compBuilder.Add(new GltfDirectionalLightComponent(color, light.Intensity, isPrimaryLight));
                }
                else if (string.Equals(light.Type, "point", StringComparison.OrdinalIgnoreCase))
                {
                    localLightCount++;
                    if (localLightCount > maxLocalLights)
                    {
                        diagnostics.Add(new GltfDiagnostic(
                            GltfDiagnosticLevel.Warning,
                            "gltf.light.local.runtime-limit",
                            $"Local lights exceed engine budget limit of {maxLocalLights}."));
                    }

                    compBuilder.Add(new GltfPointLightComponent(color, light.Intensity, light.Range ?? 0.0f));
                }
                else if (string.Equals(light.Type, "spot", StringComparison.OrdinalIgnoreCase))
                {
                    localLightCount++;
                    if (localLightCount > maxLocalLights)
                    {
                        diagnostics.Add(new GltfDiagnostic(
                            GltfDiagnosticLevel.Warning,
                            "gltf.light.local.runtime-limit",
                            $"Local lights exceed engine budget limit of {maxLocalLights}."));
                    }

                    compBuilder.Add(new GltfSpotLightComponent(
                        color,
                        light.Intensity,
                        light.Range ?? 0.0f,
                        light.InnerConeAngle,
                        light.OuterConeAngle));
                }
            }

            if (firstRoot && animationClipIds.Length > 0)
            {
                compBuilder.Add(new GltfAnimatorComponent(
                    animationClipIds,
                    animationClipIds[0],
                    PlayOnStart: true,
                    Loop: true,
                    Speed: 1.0f));
                firstRoot = false;
            }

            if (node.HasMesh && (uint)node.Mesh < (uint)model.MeshCount)
            {
                GltfRawModel.Mesh mesh = model.GetMesh(node.Mesh);
                string? skinId = (node.HasSkin && skinKeyMap.TryGetValue(node.Skin, out string? sKey)) ? sKey : null;
                ImmutableArray<string> primitiveKeys = meshKeysByMesh[node.Mesh];
                int primitiveCount = mesh.Primitives.Length;
                ImmutableArray<float> morphWeights = ResolveMorphWeights(model, node, mesh);

                if (primitiveCount == 1)
                {
                    GltfRawModel.Primitive primitive = model.GetPrimitive(mesh, 0);
                    string meshKey = primitiveKeys.Length > 0
                        ? primitiveKeys[0]
                        : GltfKeys.Mesh(node.Mesh, 0);
                    string? matKey = primitive.HasMaterial ? $"gltf/material/{primitive.Material}" : null;
                    if (matKey != null)
                    {
                        materialKeys.Add(matKey);
                    }

                    compBuilder.Add(new GltfMeshRendererComponent(
                        meshKey,
                        matKey,
                        Visible: true,
                        RenderOrder: 0,
                        PassId: "ForwardPBR",
                        ReceiveLighting: true,
                        skinId,
                        GltfRawModel.GetMorphTargetCount(primitive))
                    {
                        MorphWeights = morphWeights,
                    });
                }
                else
                {
                    for (int p = 0; p < primitiveCount; p++)
                    {
                        GltfRawModel.Primitive primitive = model.GetPrimitive(mesh, p);
                        string childActorId = $"{nodeId}/primitive/{p}";
                        string meshKey = p < primitiveKeys.Length
                            ? primitiveKeys[p]
                            : GltfKeys.Mesh(node.Mesh, p);
                        string? matKey = primitive.HasMaterial ? $"gltf/material/{primitive.Material}" : null;
                        if (matKey != null)
                        {
                            materialKeys.Add(matKey);
                        }

                        var childComps = ImmutableArray.Create<GltfComponentSnapshot>(
                            new GltfTransformComponent(Vec3.Zero, Quat.Identity, Vec3.One),
                            new GltfMeshRendererComponent(
                                meshKey,
                                matKey,
                                Visible: true,
                                RenderOrder: 0,
                                PassId: "ForwardPBR",
                                ReceiveLighting: true,
                                skinId,
                                GltfRawModel.GetMorphTargetCount(primitive))
                            {
                                MorphWeights = morphWeights,
                            });

                        actorList.Add(new GltfActorSnapshot
                        {
                            NodeId = childActorId,
                            ParentNodeId = nodeId,
                            Name = $"{(node.Name.IsEmpty ? "Node" : nodeName)}_Primitive_{p}",
                            Components = childComps,
                        });
                        allNodeIds.Add(childActorId);
                    }
                }
            }

            actorList.Add(new GltfActorSnapshot
            {
                NodeId = nodeId,
                ParentNodeId = parentId,
                Name = node.Name.IsEmpty ? $"Node_{nodeIdx}" : nodeName,
                Components = compBuilder.ToImmutable(),
            });

            for (int c = GltfRawModel.GetChildCount(node) - 1; c >= 0; c--)
            {
                stack.Push((model.GetChild(node, c), nodeId));
            }
        }

        int meshKeyCount = 0;
        for (int i = 0; i < meshKeysByMesh.Length; i++)
        {
            meshKeyCount += meshKeysByMesh[i].Length;
        }

        var prefabMeshKeys = ImmutableArray.CreateBuilder<string>(meshKeyCount);
        for (int i = 0; i < meshKeysByMesh.Length; i++)
        {
            ImmutableArray<string> keys = meshKeysByMesh[i];
            for (int k = 0; k < keys.Length; k++)
            {
                prefabMeshKeys.Add(keys[k]);
            }
        }

        return new GltfPrefabAsset
        {
            Id = prefabId,
            SceneIndex = sceneIndex,
            Definition = new GltfPrefabDefinition { Actors = actorList.ToImmutableArray() },
            RootNodeIds = rootNodeIds.ToImmutableArray(),
            NodeIds = allNodeIds.ToImmutableArray(),
            MeshKeys = prefabMeshKeys.MoveToImmutable(),
            SkinKeys = skinKeyMap.Values.ToImmutableArray(),
            AnimationKeys = animationClipIds,
            MaterialKeys = materialKeys.ToImmutableArray(),
            AnimationController = animationClipIds.Length > 0 ? new GltfAnimationControllerMetadata { Clips = animationClipIds } : null,
        };
    }

    private static ImmutableArray<float> ResolveMorphWeights(
        GltfRawModel model,
        in GltfRawModel.Node node,
        in GltfRawModel.Mesh mesh)
    {
        int count = GltfRawModel.GetWeightCount(node);
        if (count > 0)
        {
            var nodeWeights = ImmutableArray.CreateBuilder<float>(count);
            for (int i = 0; i < count; i++)
            {
                nodeWeights.Add(model.GetWeight(in node, i));
            }

            return nodeWeights.MoveToImmutable();
        }

        count = GltfRawModel.GetWeightCount(mesh);
        if (count == 0)
        {
            return ImmutableArray<float>.Empty;
        }

        var meshWeights = ImmutableArray.CreateBuilder<float>(count);
        for (int i = 0; i < count; i++)
        {
            meshWeights.Add(model.GetWeight(in mesh, i));
        }

        return meshWeights.MoveToImmutable();
    }
}
