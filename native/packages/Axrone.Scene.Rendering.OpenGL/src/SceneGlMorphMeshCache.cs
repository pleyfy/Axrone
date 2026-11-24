namespace Axrone.Scene.Rendering.OpenGL;

using System.Diagnostics.CodeAnalysis;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;

/// <summary>
/// Per-actor morph mesh variants. A shared mesh asset cannot carry different
/// weights per actor, so each morphed actor receives its own cloned GLMesh; the
/// animation layer publishes weights through <see cref="ISceneMorphWeightSource"/>.
/// </summary>
public sealed class SceneGlMorphMeshCache : IDisposable
{
    private readonly SceneGlAssetCache _assets;
    private readonly ISceneMorphWeightSource _weights;
    private readonly Dictionary<(SceneActor Actor, SceneAssetId<MeshAssetTag> Mesh), Entry> _entries = [];
    private bool _disposed;

    /// <summary>Creates a morph mesh cache over an uploaded asset cache.</summary>
    public SceneGlMorphMeshCache(SceneGlAssetCache assets, ISceneMorphWeightSource weights)
    {
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(weights);
        _assets = assets;
        _weights = weights;
    }

    /// <summary>Number of cloned meshes currently resident.</summary>
    public int Count => _entries.Count;

    /// <summary>
    /// Resolves the deformed mesh for an actor, creating or updating its private
    /// vertex buffer when weights changed. Returns false when the actor has no
    /// weights or the mesh has no morph targets, so the caller draws the shared mesh.
    /// </summary>
    public bool TryGetMesh(
        SceneActor actor,
        SceneAssetId<MeshAssetTag> meshId,
        [NotNullWhen(true)] out GLMesh? mesh)
    {
        ThrowIfDisposed();
        mesh = null;

        if (!_weights.TryGetMorphWeights(actor, out ReadOnlySpan<float> weights) || weights.IsEmpty)
        {
            return false;
        }

        if (!_assets.TryGetMeshDefinition(meshId, out SceneMeshDefinition? definition) ||
            definition.MorphTargets.Count == 0)
        {
            return false;
        }

        var key = (actor, meshId);
        if (!_entries.TryGetValue(key, out Entry? entry) ||
            !ReferenceEquals(entry.Definition, definition))
        {
            if (entry is not null)
            {
                entry.Mesh.Dispose();
            }

            entry = new Entry(definition, _assets.CreateMesh(definition), new byte[definition.Vertices.Length]);
            _entries[key] = entry;
        }

        if (entry.LastRevision != _weights.Revision)
        {
            SceneMorphDeformer.Apply(definition, weights, entry.Scratch);
            entry.Mesh.UpdateVertices(entry.Scratch);
            entry.LastRevision = _weights.Revision;
        }

        mesh = entry.Mesh;
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        foreach (Entry entry in _entries.Values)
        {
            entry.Mesh.Dispose();
        }

        _entries.Clear();
        _disposed = true;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlMorphMeshCache));
        }
    }

    private sealed class Entry
    {
        public Entry(SceneMeshDefinition definition, GLMesh mesh, byte[] scratch)
        {
            Definition = definition;
            Mesh = mesh;
            Scratch = scratch;
        }

        public SceneMeshDefinition Definition { get; }

        public GLMesh Mesh { get; }

        public byte[] Scratch { get; }

        public long LastRevision { get; set; } = -1;
    }
}
