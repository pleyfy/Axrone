namespace Axrone.Particles;

/// <summary>Generational slot map entry.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct HandleEntry
{
    /// <summary>Dense index (-1 when free).</summary>
    public int DenseIndex;

    /// <summary>Slot generation.</summary>
    public uint Generation;
}

/// <summary>Cache-padded storage counters.</summary>
[StructLayout(LayoutKind.Explicit, Size = 128)]
internal struct CachePaddedCounters
{
    [FieldOffset(0)]
    public int ActiveCount;

    [FieldOffset(64)]
    public uint NextParticleId;
}

/// <summary>Native struct-of-arrays particle storage with generational handles.</summary>
public sealed unsafe partial class NativeSoaParticleStorage : IDisposable
{
    private const nuint Alignment = 64;
    private const int FloatStreamCount = 29;

    /// <summary>Capacity.</summary>
    public int Capacity { get; private set; }

    /// <summary>Active count.</summary>
    public int ActiveCount => _counters.ActiveCount;

    private CachePaddedCounters _counters;

    private void* _storageMemoryBlock;
    private readonly nuint _storageSizeBytes;

    private HandleEntry* _handles;
    private int* _freeHandles;
    private int _freeHandleTop;

    /// <summary>Position X stream.</summary>
    public float* PosX;

    /// <summary>Position Y stream.</summary>
    public float* PosY;

    /// <summary>Position Z stream.</summary>
    public float* PosZ;

    /// <summary>Velocity X stream.</summary>
    public float* VelX;

    /// <summary>Velocity Y stream.</summary>
    public float* VelY;

    /// <summary>Velocity Z stream.</summary>
    public float* VelZ;

    /// <summary>Acceleration X stream.</summary>
    public float* AccX;

    /// <summary>Acceleration Y stream.</summary>
    public float* AccY;

    /// <summary>Acceleration Z stream.</summary>
    public float* AccZ;

    /// <summary>Scale X stream.</summary>
    public float* ScaleX;

    /// <summary>Scale Y stream.</summary>
    public float* ScaleY;

    /// <summary>Scale Z stream.</summary>
    public float* ScaleZ;

    /// <summary>Rotation X stream.</summary>
    public float* RotX;

    /// <summary>Rotation Y stream.</summary>
    public float* RotY;

    /// <summary>Rotation Z stream.</summary>
    public float* RotZ;

    /// <summary>Angular velocity X stream.</summary>
    public float* AngVelX;

    /// <summary>Angular velocity Y stream.</summary>
    public float* AngVelY;

    /// <summary>Angular velocity Z stream.</summary>
    public float* AngVelZ;

    /// <summary>Color R stream.</summary>
    public float* ColR;

    /// <summary>Color G stream.</summary>
    public float* ColG;

    /// <summary>Color B stream.</summary>
    public float* ColB;

    /// <summary>Color A stream.</summary>
    public float* ColA;

    /// <summary>Lifetime stream.</summary>
    public float* Lifetime;

    /// <summary>Age stream.</summary>
    public float* Age;

    /// <summary>Custom channel 0.</summary>
    public float* Custom0;

    /// <summary>Custom channel 1.</summary>
    public float* Custom1;

    /// <summary>Custom channel 2.</summary>
    public float* Custom2;

    /// <summary>Custom channel 3.</summary>
    public float* Custom3;

    /// <summary>Collision hit counts.</summary>
    public int* CollisionHits;

    /// <summary>Dense index to identity.</summary>
    public ParticleId* DenseToId;

    private readonly Lock _lock = new();
    private bool _disposed;

    /// <summary>Creates storage.</summary>
    public NativeSoaParticleStorage(ParticleCapacity capacity)
    {
        int cap = Math.Max(32, (int)capacity);
        cap = (cap + 15) & ~15;
        Capacity = cap;

        nuint streamFloats = (nuint)cap * sizeof(float);
        nuint streamIds = (nuint)cap * (nuint)sizeof(ParticleId);
        _storageSizeBytes = (streamFloats * FloatStreamCount) + streamIds;

        _storageMemoryBlock = NativeMemory.AlignedAlloc(_storageSizeBytes, Alignment);
        if (_storageMemoryBlock == null)
        {
            ParticleThrowHelper.MemoryAllocationFailed(_storageSizeBytes);
        }

        NativeMemory.Clear(_storageMemoryBlock, _storageSizeBytes);

        byte* ptr = (byte*)_storageMemoryBlock;
        PosX = (float*)ptr; ptr += streamFloats;
        PosY = (float*)ptr; ptr += streamFloats;
        PosZ = (float*)ptr; ptr += streamFloats;

        VelX = (float*)ptr; ptr += streamFloats;
        VelY = (float*)ptr; ptr += streamFloats;
        VelZ = (float*)ptr; ptr += streamFloats;

        AccX = (float*)ptr; ptr += streamFloats;
        AccY = (float*)ptr; ptr += streamFloats;
        AccZ = (float*)ptr; ptr += streamFloats;

        ScaleX = (float*)ptr; ptr += streamFloats;
        ScaleY = (float*)ptr; ptr += streamFloats;
        ScaleZ = (float*)ptr; ptr += streamFloats;

        RotX = (float*)ptr; ptr += streamFloats;
        RotY = (float*)ptr; ptr += streamFloats;
        RotZ = (float*)ptr; ptr += streamFloats;

        AngVelX = (float*)ptr; ptr += streamFloats;
        AngVelY = (float*)ptr; ptr += streamFloats;
        AngVelZ = (float*)ptr; ptr += streamFloats;

        ColR = (float*)ptr; ptr += streamFloats;
        ColG = (float*)ptr; ptr += streamFloats;
        ColB = (float*)ptr; ptr += streamFloats;
        ColA = (float*)ptr; ptr += streamFloats;

        Lifetime = (float*)ptr; ptr += streamFloats;
        Age = (float*)ptr; ptr += streamFloats;

        Custom0 = (float*)ptr; ptr += streamFloats;
        Custom1 = (float*)ptr; ptr += streamFloats;
        Custom2 = (float*)ptr; ptr += streamFloats;
        Custom3 = (float*)ptr; ptr += streamFloats;

        CollisionHits = (int*)ptr; ptr += streamFloats;

        DenseToId = (ParticleId*)ptr;

        _handles = (HandleEntry*)NativeMemory.AlignedAlloc((nuint)(cap * sizeof(HandleEntry)), Alignment);
        _freeHandles = (int*)NativeMemory.AlignedAlloc((nuint)(cap * sizeof(int)), Alignment);

        for (int i = 0; i < cap; i++)
        {
            _handles[i] = new HandleEntry { DenseIndex = -1, Generation = 1 };
            _freeHandles[i] = cap - 1 - i;
        }

        _freeHandleTop = cap;
        _counters.ActiveCount = 0;
        _counters.NextParticleId = 1;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    private void Dispose(bool disposing)
    {
        lock (_lock)
        {
            if (!_disposed)
            {
                if (_storageMemoryBlock != null)
                {
                    NativeMemory.AlignedFree(_storageMemoryBlock);
                }

                if (_handles != null)
                {
                    NativeMemory.AlignedFree(_handles);
                }

                if (_freeHandles != null)
                {
                    NativeMemory.AlignedFree(_freeHandles);
                }

                _disposed = true;
            }
        }
    }

    /// <summary>Finalizer.</summary>
    ~NativeSoaParticleStorage() => Dispose(false);
}
