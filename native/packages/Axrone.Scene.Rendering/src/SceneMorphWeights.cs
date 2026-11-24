namespace Axrone.Scene.Rendering;

/// <summary>Publishes per-entity morph weights from animation to the render layer.</summary>
public interface ISceneMorphWeightSink
{
    /// <summary>Copies one entity's current weights; the span is only valid for the call.</summary>
    void ApplyMorphWeights(SceneEntity entity, ReadOnlySpan<float> weights);
}

/// <summary>Reads the latest per-entity morph weights.</summary>
public interface ISceneMorphWeightSource
{
    /// <summary>Monotonic revision incremented on every weight write.</summary>
    long Revision { get; }

    /// <summary>Looks up an entity's current weights.</summary>
    bool TryGetMorphWeights(SceneEntity entity, out ReadOnlySpan<float> weights);
}

/// <summary>
/// Entity-keyed morph weights shared by the animator bridge and the renderer.
/// Weights are copied into owned buffers, so callers can reuse their spans.
/// </summary>
public sealed class SceneMorphWeightStore : ISceneMorphWeightSink, ISceneMorphWeightSource
{
    private readonly Dictionary<SceneEntity, float[]> _weights = new();
    private readonly Lock _gate = new();
    private long _revision;

    /// <summary>Number of entities with resident weights.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _weights.Count;
            }
        }
    }

    /// <summary>Monotonic revision incremented on every weight write.</summary>
    public long Revision => Volatile.Read(ref _revision);

    /// <inheritdoc/>
    public void ApplyMorphWeights(SceneEntity entity, ReadOnlySpan<float> weights)
    {
        if (!entity.IsValid)
        {
            return;
        }

        lock (_gate)
        {
            if (weights.IsEmpty)
            {
                _ = _weights.Remove(entity);
                _revision++;
                return;
            }

            if (!_weights.TryGetValue(entity, out float[]? values) || values.Length != weights.Length)
            {
                values = new float[weights.Length];
                _weights[entity] = values;
            }

            weights.CopyTo(values);
            _revision++;
        }
    }

    /// <inheritdoc/>
    public bool TryGetMorphWeights(SceneEntity entity, out ReadOnlySpan<float> weights)
    {
        lock (_gate)
        {
            if (entity.IsValid && _weights.TryGetValue(entity, out float[]? values))
            {
                weights = values;
                return true;
            }
        }

        weights = default;
        return false;
    }

    /// <summary>Removes one entity's weights.</summary>
    public bool Remove(SceneEntity entity)
    {
        lock (_gate)
        {
            if (!_weights.Remove(entity))
            {
                return false;
            }

            _revision++;
            return true;
        }
    }

    /// <summary>Removes every entity's weights.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _weights.Clear();
            _revision++;
        }
    }
}
