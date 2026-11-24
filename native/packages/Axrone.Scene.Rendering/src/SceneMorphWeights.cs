namespace Axrone.Scene.Rendering;

/// <summary>Publishes per-actor morph weights from animation to the render layer.</summary>
public interface ISceneMorphWeightSink
{
    /// <summary>Copies one actor's current weights; the span is only valid for the call.</summary>
    void ApplyMorphWeights(SceneActor actor, ReadOnlySpan<float> weights);
}

/// <summary>Reads the latest per-actor morph weights.</summary>
public interface ISceneMorphWeightSource
{
    /// <summary>Monotonic revision incremented on every weight write.</summary>
    long Revision { get; }

    /// <summary>Looks up an actor's current weights.</summary>
    bool TryGetMorphWeights(SceneActor actor, out ReadOnlySpan<float> weights);
}

/// <summary>
/// Actor-keyed morph weights shared by the animator bridge and the renderer.
/// Weights are copied into owned buffers, so callers can reuse their spans.
/// </summary>
public sealed class SceneMorphWeightStore : ISceneMorphWeightSink, ISceneMorphWeightSource
{
    private readonly Dictionary<SceneActor, float[]> _weights = new();
    private readonly Lock _gate = new();
    private long _revision;

    /// <summary>Number of actors with resident weights.</summary>
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
    public void ApplyMorphWeights(SceneActor actor, ReadOnlySpan<float> weights)
    {
        if (!actor.IsValid)
        {
            return;
        }

        lock (_gate)
        {
            if (weights.IsEmpty)
            {
                _ = _weights.Remove(actor);
                _revision++;
                return;
            }

            if (!_weights.TryGetValue(actor, out float[]? values) || values.Length != weights.Length)
            {
                values = new float[weights.Length];
                _weights[actor] = values;
            }

            weights.CopyTo(values);
            _revision++;
        }
    }

    /// <inheritdoc/>
    public bool TryGetMorphWeights(SceneActor actor, out ReadOnlySpan<float> weights)
    {
        lock (_gate)
        {
            if (actor.IsValid && _weights.TryGetValue(actor, out float[]? values))
            {
                weights = values;
                return true;
            }
        }

        weights = default;
        return false;
    }

    /// <summary>Removes one actor's weights.</summary>
    public bool Remove(SceneActor actor)
    {
        lock (_gate)
        {
            if (!_weights.Remove(actor))
            {
                return false;
            }

            _revision++;
            return true;
        }
    }

    /// <summary>Removes every actor's weights.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _weights.Clear();
            _revision++;
        }
    }
}
