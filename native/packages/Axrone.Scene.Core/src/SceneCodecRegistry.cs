namespace Axrone.Scene;

using System.Text.Json;

/// <summary>
/// Type-erased data-component codec. Codecs operate directly on a world entity,
/// so snapshot and prefab paths never box component payloads or use reflection.
/// </summary>
public interface ISceneDataCodec
{
    /// <summary>Writes the component payload properties into the current JSON object.</summary>
    void Write(SceneWorld world, SceneEntity entity, Utf8JsonWriter writer);

    /// <summary>Reads the component payload object into the entity.</summary>
    void ReadInto(SceneWorld world, SceneEntity entity, JsonElement data);
}

/// <summary>
/// Strongly typed data-component codec. Implementations own the JSON property
/// layout; the base class bridges to the type-erased registration surface.
/// </summary>
/// <typeparam name="T">Unmanaged data component.</typeparam>
public abstract class SceneDataCodec<T> : ISceneDataCodec
    where T : unmanaged, ISceneDataComponent
{
    /// <inheritdoc/>
    public void Write(SceneWorld world, SceneEntity entity, Utf8JsonWriter writer)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(writer);
        Write(writer, world.GetData<T>(entity));
    }

    /// <inheritdoc/>
    public virtual void ReadInto(SceneWorld world, SceneEntity entity, JsonElement data)
    {
        ArgumentNullException.ThrowIfNull(world);
        T value = Read(data);
        if (world.HasData<T>(entity))
        {
            world.GetData<T>(entity) = value;
        }
        else
        {
            world.AddData(entity, value);
        }
    }

    /// <summary>Writes component payload properties.</summary>
    public abstract void Write(Utf8JsonWriter writer, in T value);

    /// <summary>Reads a component payload.</summary>
    public abstract T Read(JsonElement data);
}

/// <summary>One registered codec and the descriptor that owns its id and name.</summary>
public readonly record struct SceneCodecRegistration(
    SceneDataComponentDescriptor Descriptor,
    ISceneDataCodec Codec);

/// <summary>
/// Codec catalog keyed by descriptor id and name. Registration is cold and
/// serialized; id lookups are lock-free afterwards.
/// </summary>
public sealed class SceneCodecRegistry
{
    private readonly SceneComponentRegistry _components;
    private readonly Lock _gate = new();
    private readonly ISceneDataCodec?[] _byId = new ISceneDataCodec?[SceneComponentMask.Capacity];
    private readonly Dictionary<SceneStringId, ISceneDataCodec> _byName = new();
    private readonly List<SceneCodecRegistration> _registrations = new();

    /// <summary>Creates a codec registry over a component registry.</summary>
    public SceneCodecRegistry(SceneComponentRegistry components)
    {
        ArgumentNullException.ThrowIfNull(components);
        _components = components;
    }

    /// <summary>Number of registered codecs.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _registrations.Count;
            }
        }
    }

    /// <summary>Registered codecs in registration order.</summary>
    public ReadOnlySpan<SceneCodecRegistration> Registrations =>
        System.Runtime.InteropServices.CollectionsMarshal.AsSpan(_registrations);

    /// <summary>Registers a codec for a component type.</summary>
    public void Register<T>(SceneDataCodec<T> codec)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(codec);

        SceneDataComponentDescriptor descriptor = _components.GetDataByType(typeof(T));
        if (!descriptor.TypeId.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Data component '{descriptor.Name}' has no valid type id.");
        }

        int index = descriptor.TypeId.Value;
        if ((uint)index >= (uint)_byId.Length)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ComponentLimit,
                $"Data component id {index} exceeds the codec capacity.");
        }

        lock (_gate)
        {
            if (_byId[index] is not null)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ComponentDuplicate,
                    $"A codec is already registered for data component '{descriptor.Name}'.");
            }

            if (_byName.ContainsKey(descriptor.Name))
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ComponentDuplicate,
                    $"A codec is already registered for name '{descriptor.Name}'.");
            }

            _byId[index] = codec;
            _byName.Add(descriptor.Name, codec);
            _registrations.Add(new SceneCodecRegistration(descriptor, codec));
        }
    }

    /// <summary>Resolves a codec by data-component id.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGet(SceneComponentTypeId typeId, [NotNullWhen(true)] out ISceneDataCodec? codec)
    {
        if ((uint)typeId.Value >= (uint)_byId.Length)
        {
            codec = null;
            return false;
        }

        codec = _byId[typeId.Value];
        return codec is not null;
    }

    /// <summary>Resolves a codec by interned component name.</summary>
    public bool TryGet(SceneStringId name, [NotNullWhen(true)] out ISceneDataCodec? codec)
    {
        lock (_gate)
        {
            return _byName.TryGetValue(name, out codec);
        }
    }

    /// <summary>Resolves a codec by component name.</summary>
    public bool TryGet(string name, [NotNullWhen(true)] out ISceneDataCodec? codec)
    {
        ArgumentNullException.ThrowIfNull(name);

        lock (_gate)
        {
            return _byName.TryGetValue(SceneStringId.FromName(name), out codec);
        }
    }
}
