namespace Axrone.Ui.Scene;

using Axrone.Scene;

/// <summary>Profile and codec registration helpers for scene UI hosts.</summary>
public static class SceneUiHostRegistration
{
    /// <summary>Registers the UI host component on a scene profile builder.</summary>
    public static SceneProfileBuilder AddUiHosts(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneUiHost>(
            "SceneUiHost",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable | SceneComponentTraits.EditorVisible,
            priority: 130);

        return builder;
    }

    /// <summary>
    /// Registers the host codec when the component is present. Explicit by
    /// design: Scene.Runtime never references this package.
    /// </summary>
    public static void RegisterCodecs(SceneCodecRegistry codecs, SceneComponentRegistry components)
    {
        ArgumentNullException.ThrowIfNull(codecs);
        ArgumentNullException.ThrowIfNull(components);

        if (components.TryGetDataByType(typeof(SceneUiHost), out _))
        {
            codecs.Register(new SceneUiHostCodec());
        }
    }

    /// <summary>Whether a component registry exposes the host component.</summary>
    public static bool IsRegistered(SceneComponentRegistry components)
    {
        ArgumentNullException.ThrowIfNull(components);
        return components.TryGetDataByType(typeof(SceneUiHost), out _);
    }
}

/// <summary>Resolves a UI asset symbol to its UTF-8 JSON payload.</summary>
public interface IUiHostAssetSource
{
    /// <summary>Reads the payload of one asset; the memory must stay valid until the next call.</summary>
    bool TryRead(SceneStringId assetId, out ReadOnlyMemory<byte> utf8Json);
}

/// <summary>In-memory asset table keyed by <see cref="SceneStringId"/>.</summary>
public sealed class UiHostAssetTable : IUiHostAssetSource
{
    private readonly Dictionary<SceneStringId, byte[]> _assets = new();

    /// <summary>Gets the number of stored assets.</summary>
    public int Count => _assets.Count;

    /// <summary>Stores or replaces one payload.</summary>
    public void Add(string assetId, ReadOnlySpan<byte> utf8Json)
    {
        ArgumentException.ThrowIfNullOrEmpty(assetId);
        _assets[SceneStringId.FromName(assetId)] = utf8Json.ToArray();
    }

    /// <summary>Stores or replaces one payload under a symbol.</summary>
    public void Add(SceneStringId assetId, ReadOnlySpan<byte> utf8Json)
    {
        if (!assetId.IsValid)
        {
            throw new ArgumentException("An asset symbol must be valid.", nameof(assetId));
        }

        _assets[assetId] = utf8Json.ToArray();
    }

    /// <summary>Removes one asset.</summary>
    public bool Remove(string assetId) => _assets.Remove(SceneStringId.FromName(assetId));

    /// <summary>Removes every asset.</summary>
    public void Clear() => _assets.Clear();

    /// <inheritdoc/>
    public bool TryRead(SceneStringId assetId, out ReadOnlyMemory<byte> utf8Json)
    {
        if (_assets.TryGetValue(assetId, out byte[]? payload))
        {
            utf8Json = payload;
            return true;
        }

        utf8Json = default;
        return false;
    }
}
