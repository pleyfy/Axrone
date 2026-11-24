namespace Axrone.Ecs;

/// <summary>
/// Interned actor name identity used by the world actor registry.
/// </summary>
/// <param name="Value">Symbol table slot.</param>
public readonly record struct EcsActorName(int Value)
{
    /// <summary>Unresolved sentinel.</summary>
    public static readonly EcsActorName Empty;

    private const string EmptySymbolText = "<empty>";

    /// <inheritdoc/>
    public override string ToString() => Value >= 1 ? EcsActorNames.Table.GetName(Value) : EmptySymbolText;
}

/// <summary>
/// Interned actor tag identity used by the world actor registry; slot zero means
/// the actor carries no tag.
/// </summary>
/// <param name="Value">Symbol table slot.</param>
public readonly record struct EcsActorTag(int Value)
{
    /// <summary>Unresolved sentinel: an actor without a tag.</summary>
    public static readonly EcsActorTag Empty;

    private const string EmptySymbolText = "<empty>";

    /// <inheritdoc/>
    public override string ToString() => Value >= 1 ? EcsActorTags.Table.GetName(Value) : EmptySymbolText;
}

/// <summary>
/// Interned actor names. Interning is a setup-time operation: the hot path uses
/// <see cref="EcsActorName"/> slots and never hashes a string.
/// </summary>
public static class EcsActorNames
{
    internal static readonly EcsSymbolTable Table = new("actor-name");

    /// <summary>Interns an actor name.</summary>
    /// <param name="name">Non-empty ordinal name.</param>
    public static EcsActorName Intern(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return new EcsActorName(Table.Intern(name));
    }

    /// <summary>Interns an actor name from a view.</summary>
    /// <param name="name">Non-empty ordinal name.</param>
    public static EcsActorName Intern(ReadOnlySpan<char> name)
    {
        if (name.IsEmpty || char.IsWhiteSpace(name[0]))
        {
            EcsThrowHelper.ThrowEmptySymbol("actor-name");
        }

        return new EcsActorName(Table.Intern(name));
    }

    /// <summary>Resolves the text of an interned actor name.</summary>
    /// <param name="name">Slot handle.</param>
    public static string GetName(in EcsActorName name) => Table.GetName(name.Value);
}

/// <summary>
/// Interned actor tags; see <see cref="EcsActorName"/> for the slot contract.
/// </summary>
public static class EcsActorTags
{
    internal static readonly EcsSymbolTable Table = new("actor-tag");

    /// <summary>Interns an actor tag.</summary>
    /// <param name="tag">Non-empty ordinal tag.</param>
    public static EcsActorTag Intern(string tag)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        return new EcsActorTag(Table.Intern(tag));
    }

    /// <summary>Interns an actor tag from a view.</summary>
    /// <param name="tag">Non-empty ordinal tag.</param>
    public static EcsActorTag Intern(ReadOnlySpan<char> tag)
    {
        if (tag.IsEmpty || char.IsWhiteSpace(tag[0]))
        {
            EcsThrowHelper.ThrowEmptySymbol("actor-tag");
        }

        return new EcsActorTag(Table.Intern(tag));
    }

    /// <summary>Resolves the text of an interned tag.</summary>
    /// <param name="tag">Slot handle.</param>
    public static string GetName(in EcsActorTag tag) => Table.GetName(tag.Value);
}

/// <summary>
/// Ordinal symbol interning table: string identity is resolved once, lookups on
/// the hot path use integer slots. Growing is guarded by a lock and happens at
/// setup time only.
/// </summary>
internal sealed class EcsSymbolTable(string kind)
{
    /// <summary>Slot ceiling shared by every symbol family.</summary>
    internal const int MaxSymbols = 4096;

    private readonly Dictionary<string, int> _index = new(StringComparer.Ordinal);
    private readonly Lock _gate = new();
    private string?[] _names = new string?[64];

    internal int Intern(ReadOnlySpan<char> symbol)
    {
        string key = symbol.ToString();
        lock (_gate)
        {
            if (_index.TryGetValue(key, out int existing))
            {
                return existing;
            }

            if (_index.Count >= MaxSymbols)
            {
                EcsThrowHelper.ThrowSymbolLimitExceeded(kind, MaxSymbols);
            }

            int slot = _index.Count + 1;
            if (slot == _names.Length)
            {
                Array.Resize(ref _names, _names.Length * 2);
            }

            _names[slot] = key;
            _index.Add(key, slot);
            return slot;
        }
    }

    internal string GetName(int slot)
    {
        if ((uint)slot >= (uint)_names.Length || _names[slot] is not string text)
        {
            EcsThrowHelper.ThrowUnknownSymbol(kind, slot);
            return string.Empty;
        }

        return text;
    }
}
