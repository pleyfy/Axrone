namespace Axrone.Scene.Rendering;

using System.Buffers.Binary;
using Axrone.Scene.Assets;

/// <summary>
/// CPU morph-target deformation over the interleaved vertex layout. The result
/// stays in the mesh's own layout, so it can be uploaded to a private vertex
/// buffer by a renderer without changing materials or shaders.
/// </summary>
public static class SceneMorphDeformer
{
    /// <summary>
    /// Writes <c>base + sum(weight[i] * delta[i])</c> for the position, normal
    /// and tangent attributes present in the layout.
    /// </summary>
    /// <param name="mesh">Mesh with optional morph targets.</param>
    /// <param name="weights">Per-target weights; extra entries are ignored.</param>
    /// <param name="destination">Destination vertex bytes, at least the base vertex size.</param>
    public static void Apply(SceneMeshDefinition mesh, ReadOnlySpan<float> weights, Span<byte> destination)
    {
        ArgumentNullException.ThrowIfNull(mesh);
        if (destination.Length < mesh.Vertices.Length)
        {
            throw new ArgumentException(
                $"Morph destination holds {destination.Length} bytes but mesh '{mesh.Id}' needs {mesh.Vertices.Length}.",
                nameof(destination));
        }

        mesh.Vertices.Span.CopyTo(destination);
        if (weights.IsEmpty || mesh.MorphTargets.Count == 0)
        {
            return;
        }

        int targetCount = Math.Min(weights.Length, mesh.MorphTargets.Count);
        for (int targetIndex = 0; targetIndex < targetCount; targetIndex++)
        {
            float weight = weights[targetIndex];
            if (!float.IsFinite(weight) || weight == 0.0f)
            {
                continue;
            }

            SceneMorphTargetDefinition target = mesh.MorphTargets[targetIndex];
            SceneMeshSemantic semantic = target.Semantic switch
            {
                SceneMorphTargetSemantic.Normal => SceneMeshSemantic.Normal,
                SceneMorphTargetSemantic.Tangent => SceneMeshSemantic.Tangent,
                _ => SceneMeshSemantic.Position,
            };

            int attributeOffset = -1;
            int attributeComponents = 0;
            for (int i = 0; i < mesh.Attributes.Count; i++)
            {
                SceneVertexAttribute attribute = mesh.Attributes[i];
                if (attribute.Semantic != semantic ||
                    attribute.Integer ||
                    attribute.ComponentSize != sizeof(float))
                {
                    continue;
                }

                attributeOffset = attribute.Offset;
                attributeComponents = attribute.ComponentCount;
                break;
            }

            if (attributeOffset < 0)
            {
                continue;
            }

            int components = Math.Min(target.ComponentCount, attributeComponents);
            if (components <= 0)
            {
                continue;
            }

            ReadOnlySpan<byte> deltas = target.DeltaBuffer.Span;
            int vertexStride = mesh.VertexStride;
            int deltaStride = target.Stride;
            for (int vertex = 0; vertex < mesh.VertexCount; vertex++)
            {
                int baseOffset = (vertex * vertexStride) + attributeOffset;
                int deltaOffset = vertex * deltaStride;
                for (int component = 0; component < components; component++)
                {
                    int baseComponent = baseOffset + (component * sizeof(float));
                    int deltaComponent = deltaOffset + (component * sizeof(float));
                    float value = BinaryPrimitives.ReadSingleLittleEndian(destination.Slice(baseComponent, sizeof(float)));
                    float delta = BinaryPrimitives.ReadSingleLittleEndian(deltas.Slice(deltaComponent, sizeof(float)));
                    BinaryPrimitives.WriteSingleLittleEndian(
                        destination.Slice(baseComponent, sizeof(float)),
                        value + (delta * weight));
                }
            }
        }
    }
}
