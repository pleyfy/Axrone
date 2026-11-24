namespace Axrone.Ecs;

/// <summary>
/// Interned entity name identity used by the world entity registry.
/// </summary>
/// <param name="Value">Symbol table slot.</param>
public readonly record struct EcsEntityName(int Value)
{
    /// <summary>Unresolved sentinel.</summary>
    public static readonly EcsEntityName Empty;

    private const string EmptySymbolText = "<empty>";

    /// <inheritdoc/>
    public override string ToString() => Value >= 1 ? EcsEntityNames.Table.GetName(Value) : EmptySymbolText;
}

/// <summary>
/// Interned entity tag identity used by the world entity registry; slot zero means
/// the entity carries no tag.
/// </summary>
/// <param name="Value">Symbol table slot.</param>
public readonly record struct EcsEntityTag(int Value)
{
    /// <summary>Unresolved sentinel: an entity without a tag.</summary>
    public static readonly EcsEntityTag Empty;

    private const string EmptySymbolText = "<empty>";

    /// <inheritdoc/>
    public override string ToString() => Value >= 1 ? EcsEntityTags.Table.GetName(Value) : EmptySymbolText;
}

/// <summary>
/// Interned entity names. Interning is a setup-time operation: the hot path uses
/// <see cref="EcsEntityName"/> slots and never hashes a string.
/// </summary>
public static class EcsEntityNames
{
    internal static readonly EcsSymbolTable Table = new("entity-name");

    /// <summary>Interns an entity name.</summary>
    /// <param name="name">Non-empty ordinal name.</param>
    public static EcsEntityName Intern(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return new EcsEntityName(Table.Intern(name));
    }

    /// <summary>Interns an entity name from a view.</summary>
    /// <param name="name">Non-empty ordinal name.</param>
    public static EcsEntityName Intern(ReadOnlySpan<char> name)
    {
        if (name.IsEmpty || char.IsWhiteSpace(name[0]))
        {
            EcsThrowHelper.ThrowEmptySymbol("entity-name");
        }

        return new EcsEntityName(Table.Intern(name));
    }

    /// <summary>Resolves the text of an interned entity name.</summary>
    /// <param name="name">Slot handle.</param>
    public static string GetName(in EcsEntityName name) => Table.GetName(name.Value);
}

/// <summary>
/// Interned entity tags; see <see cref="EcsEntityName"/> for the slot contract.
/// </summary>
public static class EcsEntityTags
{
    internal static readonly EcsSymbolTable Table = new("entity-tag");

    /// <summary>Interns an entity tag.</summary>
    /// <param name="tag">Non-empty ordinal tag.</param>
    public static EcsEntityTag Intern(string tag)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        return new EcsEntityTag(Table.Intern(tag));
    }

    /// <summary>Interns an entity tag from a view.</summary>
    /// <param name="tag">Non-empty ordinal tag.</param>
    public static EcsEntityTag Intern(ReadOnlySpan<char> tag)
    {
        if (tag.IsEmpty || char.IsWhiteSpace(tag[0]))
        {
            EcsThrowHelper.ThrowEmptySymbol("entity-tag");
        }

        return new EcsEntityTag(Table.Intern(tag));
    }

    /// <summary>Resolves the text of an interned tag.</summary>
    /// <param name="tag">Slot handle.</param>
    public static string GetName(in EcsEntityTag tag) => Table.GetName(tag.Value);
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
