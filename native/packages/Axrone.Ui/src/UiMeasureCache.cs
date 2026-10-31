namespace Axrone.Ui;

/// <summary>
/// Open-addressing measure cache keyed by node identity. Entries survive across
/// a measure pass so arrange can read child sizes; a new pass clears the table
/// in place, which keeps the steady-state layout loop allocation-free.
/// </summary>
internal sealed class UiMeasureCache
{
    private struct Entry
    {
        public uint Key;
        public UiSize Size;
        public float Baseline;
        public bool HasBaseline;
        public bool Complete;
    }

    private const int InitialCapacity = 64;
    private const uint HashMultiplier = 2654435761U;

    private Entry[] _entries = new Entry[InitialCapacity];
    private int _count;

    public int Count => _count;

    public void Clear()
    {
        Array.Clear(_entries, 0, _entries.Length);
        _count = 0;
    }

    public bool TryGetInProgress(uint key)
    {
        int index = Find(key);
        ref Entry entry = ref _entries[index];
        return entry.Key == key && !entry.Complete;
    }

    public bool TryGetComplete(uint key, out UiMeasureResult result)
    {
        int index = Find(key);
        ref Entry entry = ref _entries[index];
        if (entry.Key == key && entry.Complete)
        {
            result = new UiMeasureResult(entry.Size, entry.Baseline, entry.HasBaseline);
            return true;
        }

        result = default;
        return false;
    }

    public void SetInProgress(uint key)
    {
        int index = Find(key);
        ref Entry entry = ref _entries[index];
        if (entry.Key == key)
        {
            return;
        }

        entry.Key = key;
        entry.Complete = false;
        _count++;
        GrowIfNeeded();
    }

    public void Store(uint key, in UiMeasureResult result)
    {
        int index = Find(key);
        ref Entry entry = ref _entries[index];
        if (entry.Key != key)
        {
            entry.Key = key;
            _count++;
            GrowIfNeeded();
            index = Find(key);
            entry = ref _entries[index];
        }

        entry.Size = result.Size;
        entry.Baseline = result.Baseline;
        entry.HasBaseline = result.HasBaseline;
        entry.Complete = true;
    }

    private int Find(uint key)
    {
        uint mask = (uint)(_entries.Length - 1);
        uint index = (key * HashMultiplier) & mask;
        while (true)
        {
            if (_entries[index].Key == 0 || _entries[index].Key == key)
            {
                return (int)index;
            }

            index = (index + 1) & mask;
        }
    }

    private void GrowIfNeeded()
    {
        if (_count * 2 < _entries.Length)
        {
            return;
        }

        Entry[] previous = _entries;
        Entry[] next = new Entry[previous.Length * 2];
        uint mask = (uint)(next.Length - 1);
        for (int i = 0; i < previous.Length; i++)
        {
            Entry entry = previous[i];
            if (entry.Key == 0)
            {
                continue;
            }

            uint index = (entry.Key * HashMultiplier) & mask;
            while (next[index].Key != 0)
            {
                index = (index + 1) & mask;
            }

            next[index] = entry;
        }

        _entries = next;
    }
}
