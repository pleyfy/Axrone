namespace Axrone.Audio;

/// <summary>
/// Decoded clip with loop points and duration. Ownership is reference counted:
/// the store holds one reference and every live voice retains its own, so a
/// replacement or eviction frees the native buffer only when the last reader
/// releases it.
/// </summary>
public sealed class AudioClipRecord : IDisposable
{
    private int _refCount = 1;
    private int _disposed;

    /// <summary>Clip identity.</summary>
    public AudioClipId Id { get; }

    /// <summary>Decoded buffer.</summary>
    public NativeAudioMemory Buffer { get; }

    /// <summary>Duration in seconds.</summary>
    public float DurationSeconds { get; }

    /// <summary>Sample rate in Hz.</summary>
    public int SampleRate => Buffer.SampleRate;

    /// <summary>Channel count.</summary>
    public int ChannelCount => Buffer.ChannelCount;

    /// <summary>Loop start in seconds.</summary>
    public float LoopStartSeconds { get; }

    /// <summary>Loop end in seconds.</summary>
    public float LoopEndSeconds { get; }

    /// <summary>Opaque metadata.</summary>
    public object? Metadata { get; }

    /// <summary>Creates a record.</summary>
    public AudioClipRecord(
        AudioClipId id,
        NativeAudioMemory buffer,
        float loopStart = 0.0f,
        float? loopEnd = null,
        object? metadata = null)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        Id = id;
        Buffer = buffer;
        DurationSeconds = (float)(buffer.SampleCount / buffer.ChannelCount) / buffer.SampleRate;
        LoopStartSeconds = loopStart;
        LoopEndSeconds = loopEnd ?? DurationSeconds;
        Metadata = metadata;
    }

    /// <summary>References currently held by the store and live voices.</summary>
    public int ReferenceCount => Volatile.Read(ref _refCount);

    /// <summary>
    /// Adds a reference. A caller that keeps the record beyond the call that
    /// returned it must retain it; the buffer stays alive until every reference
    /// is released.
    /// </summary>
    public AudioClipRecord Retain()
    {
        while (true)
        {
            int current = Volatile.Read(ref _refCount);
            ObjectDisposedException.ThrowIf(current <= 0, this);

            if (Interlocked.CompareExchange(ref _refCount, current + 1, current) == current)
            {
                return this;
            }
        }
    }

    /// <summary>Drops one reference; the last release frees the native buffer.</summary>
    public void Release()
    {
        if (Interlocked.Decrement(ref _refCount) == 0)
        {
            Buffer.Dispose();
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            Release();
        }
    }
}

/// <summary>
/// Bounded LRU clip cache: array-backed hash chains plus an intrusive
/// recency list. Eviction disposes the victim record.
/// </summary>
public sealed class AudioClipStore : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct CacheNode
    {
        public AudioClipId Key;
        public AudioClipRecord? Value;
        public int Prev;
        public int Next;
        public int HashNext;
    }

    private readonly CacheNode[] _pool;
    private readonly int[] _buckets;
    private readonly Lock _gate = new();
    private readonly int _capacity;
    private readonly uint _bucketMask;
    private int _head = -1;
    private int _tail = -1;
    private int _freeHead;
    private int _disposed;

    /// <summary>Creates a store.</summary>
    public AudioClipStore(int capacity = 512)
    {
        _capacity = capacity;
        int bucketCount = (int)BitOperations.RoundUpToPowerOf2((uint)capacity * 2U);
        _bucketMask = (uint)bucketCount - 1U;
        _buckets = new int[bucketCount];
        Array.Fill(_buckets, -1);

        _pool = new CacheNode[capacity];
        for (int i = 0; i < capacity - 1; i++)
        {
            _pool[i].Next = i + 1;
            _pool[i].HashNext = -1;
        }

        _pool[capacity - 1].Next = -1;
        _pool[capacity - 1].HashNext = -1;
        _freeHead = 0;
    }

    /// <summary>Registers or replaces a record.</summary>
    public AudioClipId Register(AudioClipRecord record)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            AudioThrowHelper.ThrowDisposed(nameof(AudioClipStore));
        }

        ArgumentNullException.ThrowIfNull(record);

        lock (_gate)
        {
            uint bucket = record.Id.Value & _bucketMask;
            int idx = _buckets[bucket];

            while (idx != -1)
            {
                if (_pool[idx].Key == record.Id)
                {
                    _pool[idx].Value?.Dispose();
                    _pool[idx].Value = record;
                    Promote(idx);
                    return record.Id;
                }

                idx = _pool[idx].HashNext;
            }

            if (_freeHead == -1)
            {
                EvictTail();
            }

            int allocated = _freeHead;
            _freeHead = _pool[allocated].Next;

            _pool[allocated].Key = record.Id;
            _pool[allocated].Value = record;
            _pool[allocated].Prev = -1;
            _pool[allocated].Next = _head;
            _pool[allocated].HashNext = _buckets[bucket];
            _buckets[bucket] = allocated;

            if (_head != -1)
            {
                _pool[_head].Prev = allocated;
            }

            _head = allocated;
            if (_tail == -1)
            {
                _tail = allocated;
            }

            return record.Id;
        }
    }

    /// <summary>Looks up a record, promoting it on hit. The returned reference is borrowed.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool TryGet(AudioClipId id, [NotNullWhen(true)] out AudioClipRecord? record)
    {
        lock (_gate)
        {
            return TryGetLocked(id, out record);
        }
    }

    /// <summary>
    /// Looks up a record and takes a reference under the store lock, so a
    /// concurrent replace or eviction cannot free the buffer before the caller
    /// owns it. The caller must <see cref="AudioClipRecord.Release"/> it.
    /// </summary>
    public bool TryRetain(AudioClipId id, [NotNullWhen(true)] out AudioClipRecord? record)
    {
        lock (_gate)
        {
            if (!TryGetLocked(id, out record))
            {
                return false;
            }

            record.Retain();
            return true;
        }
    }

    private bool TryGetLocked(AudioClipId id, [NotNullWhen(true)] out AudioClipRecord? record)
    {
        uint bucket = id.Value & _bucketMask;
        int idx = _buckets[bucket];
        while (idx != -1)
        {
            if (_pool[idx].Key == id)
            {
                Promote(idx);
                record = _pool[idx].Value!;
                return true;
            }

            idx = _pool[idx].HashNext;
        }

        record = null;
        return false;
    }

    /// <summary>Removes a record.</summary>
    public bool Unregister(AudioClipId id)
    {
        lock (_gate)
        {
            uint bucket = id.Value & _bucketMask;
            int prevHash = -1;
            int idx = _buckets[bucket];

            while (idx != -1)
            {
                if (_pool[idx].Key == id)
                {
                    if (prevHash == -1)
                    {
                        _buckets[bucket] = _pool[idx].HashNext;
                    }
                    else
                    {
                        _pool[prevHash].HashNext = _pool[idx].HashNext;
                    }

                    Unlink(idx);
                    _pool[idx].Value?.Dispose();
                    _pool[idx].Value = null;
                    _pool[idx].Next = _freeHead;
                    _pool[idx].HashNext = -1;
                    _freeHead = idx;
                    return true;
                }

                prevHash = idx;
                idx = _pool[idx].HashNext;
            }

            return false;
        }
    }

    /// <summary>Clears all records.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            for (int i = 0; i < _capacity; i++)
            {
                _pool[i].Value?.Dispose();
                _pool[i].Value = null;
                _pool[i].Next = i + 1;
                _pool[i].HashNext = -1;
                _pool[i].Prev = -1;
            }

            _pool[_capacity - 1].Next = -1;
            Array.Fill(_buckets, -1);
            _head = -1;
            _tail = -1;
            _freeHead = 0;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Clear();
    }

    private void Promote(int idx)
    {
        if (_head == idx)
        {
            return;
        }

        Unlink(idx);
        _pool[idx].Next = _head;
        _pool[idx].Prev = -1;
        if (_head != -1)
        {
            _pool[_head].Prev = idx;
        }

        _head = idx;
        if (_tail == -1)
        {
            _tail = idx;
        }
    }

    private void Unlink(int idx)
    {
        int p = _pool[idx].Prev;
        int n = _pool[idx].Next;
        if (p != -1)
        {
            _pool[p].Next = n;
        }

        if (n != -1)
        {
            _pool[n].Prev = p;
        }

        if (_head == idx)
        {
            _head = n;
        }

        if (_tail == idx)
        {
            _tail = p;
        }
    }

    private void EvictTail()
    {
        if (_tail == -1)
        {
            return;
        }

        int victim = _tail;
        uint bucket = _pool[victim].Key.Value & _bucketMask;
        int prevHash = -1;
        int idx = _buckets[bucket];

        while (idx != -1)
        {
            if (idx == victim)
            {
                if (prevHash == -1)
                {
                    _buckets[bucket] = _pool[victim].HashNext;
                }
                else
                {
                    _pool[prevHash].HashNext = _pool[victim].HashNext;
                }

                break;
            }

            prevHash = idx;
            idx = _pool[idx].HashNext;
        }

        Unlink(victim);
        _pool[victim].Value?.Dispose();
        _pool[victim].Value = null;
        _pool[victim].Next = _freeHead;
        _pool[victim].HashNext = -1;
        _freeHead = victim;
    }
}
