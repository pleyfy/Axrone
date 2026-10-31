namespace Axrone.Ui.Assets;

/// <summary>
/// Immutable, ordinally sorted binding table. Names and string values are
/// UTF-8 slices owned by the document; lookups take a UTF-16 span and never
/// allocate once the caller's stack buffer covers the name.
/// </summary>
public sealed class UiBindingTable
{
    private const int StackNameBytes = 256;

    private UiDocumentStorage _storage;

    internal UiBindingTable(UiDocumentStorage storage)
    {
        _storage = storage;
    }

    /// <summary>Gets the binding count.</summary>
    public int Count => _storage.BindingCount;

    internal void Attach(UiDocumentStorage storage) => _storage = storage;

    /// <summary>Looks up a scalar binding value by name.</summary>
    public bool TryGet(ReadOnlySpan<char> name, out UiBindingValue value)
    {
        if (name.IsEmpty)
        {
            value = UiBindingValue.Null;
            return false;
        }

        int byteCount = Encoding.UTF8.GetByteCount(name);
        if (byteCount == 0)
        {
            value = UiBindingValue.Null;
            return false;
        }

        if (byteCount <= StackNameBytes)
        {
            Span<byte> buffer = stackalloc byte[byteCount];
            _ = Encoding.UTF8.TryGetBytes(name, buffer, out int written);
            if (_storage.TryFindBinding(buffer[..written], out int index))
            {
                value = _storage.BindingValues[index];
                return true;
            }

            value = UiBindingValue.Null;
            return false;
        }

        byte[] rented = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            _ = Encoding.UTF8.TryGetBytes(name, rented, out int written);
            if (_storage.TryFindBinding(rented.AsSpan(0, written), out int index))
            {
                value = _storage.BindingValues[index];
                return true;
            }

            value = UiBindingValue.Null;
            return false;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    /// <summary>Looks up a string binding value by name.</summary>
    public bool TryGetString(ReadOnlySpan<char> name, out ReadOnlySpan<byte> utf8)
    {
        if (name.IsEmpty)
        {
            utf8 = ReadOnlySpan<byte>.Empty;
            return false;
        }

        int byteCount = Encoding.UTF8.GetByteCount(name);
        if (byteCount == 0)
        {
            utf8 = ReadOnlySpan<byte>.Empty;
            return false;
        }

        if (byteCount <= StackNameBytes)
        {
            Span<byte> buffer = stackalloc byte[byteCount];
            _ = Encoding.UTF8.TryGetBytes(name, buffer, out int written);
            return TryResolveString(buffer[..written], out utf8);
        }

        byte[] rented = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            _ = Encoding.UTF8.TryGetBytes(name, rented, out int written);
            return TryResolveString(rented.AsSpan(0, written), out utf8);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    /// <summary>Reads one entry by ordinal-sorted position.</summary>
    public bool TryGetAt(
        int index,
        out ReadOnlySpan<byte> name,
        out UiBindingValue value,
        out ReadOnlySpan<byte> valueText)
    {
        if ((uint)index >= (uint)_storage.BindingCount)
        {
            name = ReadOnlySpan<byte>.Empty;
            value = UiBindingValue.Null;
            valueText = ReadOnlySpan<byte>.Empty;
            return false;
        }

        name = _storage.GetUtf8(_storage.BindingNames[index]);
        value = _storage.BindingValues[index];
        valueText = value.Kind == UiBindingValueKind.Text
            ? _storage.GetUtf8(_storage.BindingTexts[index])
            : ReadOnlySpan<byte>.Empty;
        return true;
    }

    private bool TryResolveString(scoped ReadOnlySpan<byte> name, out ReadOnlySpan<byte> utf8)
    {
        if (_storage.TryFindBinding(name, out int index) &&
            _storage.BindingValues[index].Kind == UiBindingValueKind.Text)
        {
            utf8 = _storage.GetUtf8(_storage.BindingTexts[index]);
            return true;
        }

        utf8 = ReadOnlySpan<byte>.Empty;
        return false;
    }
}

/// <summary>Cold-path builder for <see cref="UiBindingTable"/>.</summary>
public sealed class UiBindingTableBuilder
{
    private readonly List<Entry> _entries = [];
    private readonly Dictionary<string, int> _indexByName = new(StringComparer.Ordinal);

    /// <summary>Gets the number of staged bindings.</summary>
    public int Count => _entries.Count;

    /// <summary>Adds or replaces a string binding.</summary>
    public void SetString(string name, string value)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentNullException.ThrowIfNull(value);
        Set(name, UiBindingValue.FromString(), value);
    }

    /// <summary>Adds or replaces a numeric binding.</summary>
    public void SetNumber(string name, double value)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        if (!double.IsFinite(value))
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Binding numbers must be finite.");
        }

        Set(name, UiBindingValue.FromNumber(value), null);
    }

    /// <summary>Adds or replaces a boolean binding.</summary>
    public void SetBoolean(string name, bool value)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        Set(name, UiBindingValue.FromBoolean(value), null);
    }

    /// <summary>Adds or replaces a null binding.</summary>
    public void SetNull(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        Set(name, UiBindingValue.Null, null);
    }

    /// <summary>Removes every staged binding.</summary>
    public void Clear()
    {
        _entries.Clear();
        _indexByName.Clear();
    }

    /// <summary>Builds an immutable table owning its own UTF-8 arena.</summary>
    public UiBindingTable Build()
    {
        var storage = new UiDocumentStorage(0, Math.Max(_entries.Count, 1), 256);
        if (_entries.Count > 0)
        {
            _entries.Sort(static (left, right) => string.CompareOrdinal(left.Name, right.Name));
            for (int i = 0; i < _entries.Count; i++)
            {
                Entry entry = _entries[i];
                _ = storage.TryAppendString(entry.Name.AsSpan(), out UiStringRef name);
                UiStringRef text = UiStringRef.Empty;
                if (entry.Value.Kind == UiBindingValueKind.Text)
                {
                    _ = storage.TryAppendString(entry.Text.AsSpan(), out text);
                }

                UiBindingValue staged = entry.Value;
                storage.AddBinding(name, in staged, text);
            }

            storage.SortBindings();
        }

        return new UiBindingTable(storage);
    }

    internal void CopyTo(UiDocumentStorage storage)
    {
        for (int i = 0; i < _entries.Count; i++)
        {
            Entry entry = _entries[i];
            _ = storage.TryAppendString(entry.Name.AsSpan(), out UiStringRef name);
            UiStringRef text = UiStringRef.Empty;
            if (entry.Value.Kind == UiBindingValueKind.Text)
            {
                _ = storage.TryAppendString(entry.Text.AsSpan(), out text);
            }

            UiBindingValue stagedValue = entry.Value;
            storage.AddBinding(name, in stagedValue, text);
        }

        storage.SortBindings();
    }

    private void Set(string name, in UiBindingValue value, string? text)
    {
        var entry = new Entry(name, value, text);
        if (_indexByName.TryGetValue(name, out int index))
        {
            _entries[index] = entry;
            return;
        }

        _indexByName.Add(name, _entries.Count);
        _entries.Add(entry);
    }

    private readonly record struct Entry(string Name, UiBindingValue Value, string? Text);
}
