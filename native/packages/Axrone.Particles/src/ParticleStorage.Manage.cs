namespace Axrone.Particles;

/// <summary>Storage capacity management.</summary>
public sealed unsafe partial class NativeSoaParticleStorage : IDisposable
{
    /// <summary>Resizes capacity, preserving live particles. Never drops live particles.</summary>
    public bool TryResize(int newCapacity)
    {
        lock (_lock)
        {
            int aligned = Math.Max(32, (newCapacity + 15) & ~15);
            if (aligned == Capacity)
            {
                return true;
            }

            if (aligned < _counters.ActiveCount)
            {
                return false;
            }

            nuint streamFloats = (nuint)aligned * sizeof(float);
            nuint streamIds = (nuint)aligned * (nuint)sizeof(ParticleId);
            nuint newSizeBytes = (streamFloats * FloatStreamCount) + streamIds;
            void* newBlock = NativeMemory.AlignedAlloc(newSizeBytes, Alignment);
            if (newBlock == null)
            {
                ParticleThrowHelper.MemoryAllocationFailed(newSizeBytes);
            }

            HandleEntry* newHandles = (HandleEntry*)NativeMemory.AlignedAlloc((nuint)(aligned * sizeof(HandleEntry)), Alignment);
            int* newFree = (int*)NativeMemory.AlignedAlloc((nuint)(aligned * sizeof(int)), Alignment);
            if (newHandles == null || newFree == null)
            {
                if (newBlock != null)
                {
                    NativeMemory.AlignedFree(newBlock);
                }

                if (newHandles != null)
                {
                    NativeMemory.AlignedFree(newHandles);
                }

                if (newFree != null)
                {
                    NativeMemory.AlignedFree(newFree);
                }

                ParticleThrowHelper.MemoryAllocationFailed((nuint)(aligned * (sizeof(HandleEntry) + sizeof(int))));
            }

            NativeMemory.Clear(newBlock, newSizeBytes);

            int active = _counters.ActiveCount;

            byte* dst = (byte*)newBlock;
            byte* src = (byte*)_storageMemoryBlock;
            nuint oldStreamFloats = (nuint)Capacity * sizeof(float);
            nuint copyFloats = (nuint)active * sizeof(float);

            for (int s = 0; s < FloatStreamCount; s++)
            {
                Buffer.MemoryCopy(src + ((nuint)s * oldStreamFloats), dst + ((nuint)s * streamFloats), copyFloats, copyFloats);
            }

            ParticleId* newIds = (ParticleId*)(dst + (streamFloats * FloatStreamCount));
            ParticleId* oldIds = DenseToId;
            for (int i = 0; i < active; i++)
            {
                newIds[i] = oldIds[i];
            }

            for (int i = 0; i < aligned; i++)
            {
                newHandles[i] = new HandleEntry { DenseIndex = -1, Generation = 1 };
            }

            for (int d = 0; d < active; d++)
            {
                uint handleIdx = newIds[d].Index;
                newHandles[handleIdx].DenseIndex = d;
                newHandles[handleIdx].Generation = newIds[d].Generation;
            }

            int top = 0;
            for (int i = aligned - 1; i >= 0; i--)
            {
                if (newHandles[i].DenseIndex < 0)
                {
                    newFree[top++] = i;
                }
            }

            NativeMemory.AlignedFree(_storageMemoryBlock);
            NativeMemory.AlignedFree(_handles);
            NativeMemory.AlignedFree(_freeHandles);

            ReassignStreams((byte*)newBlock, streamFloats);
            DenseToId = newIds;
            _storageMemoryBlock = newBlock;
            _handles = newHandles;
            _freeHandles = newFree;
            _freeHandleTop = top;
            Capacity = aligned;
            return true;
        }
    }

    private void ReassignStreams(byte* basePtr, nuint streamFloats)
    {
        byte* ptr = basePtr;
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

        CollisionHits = (int*)ptr;
    }

    /// <summary>Verifies dense packing. Removal is always swap-back, so storage is
    /// densely packed by construction; provided for API parity.</summary>
    public int Compact()
    {
        lock (_lock)
        {
            return _counters.ActiveCount;
        }
    }

    /// <summary>Sorts dense rows by age (insertion sort, zero-alloc).</summary>
    public void SortByAge(bool ascending = true)
    {
        lock (_lock)
        {
            int count = _counters.ActiveCount;
            for (int i = 1; i < count; i++)
            {
                int j = i;
                while (j > 0 && ShouldPrecede(j, j - 1, ascending))
                {
                    SwapRows(j, j - 1);
                    j--;
                }
            }
        }
    }

    private bool ShouldPrecede(int a, int b, bool ascending)
    {
        return ascending ? Age[a] < Age[b] : Age[a] > Age[b];
    }

    private void SwapRows(int a, int b)
    {
        if (a == b)
        {
            return;
        }

        SwapStreams(PosX, a, b);
        SwapStreams(PosY, a, b);
        SwapStreams(PosZ, a, b);
        SwapStreams(VelX, a, b);
        SwapStreams(VelY, a, b);
        SwapStreams(VelZ, a, b);
        SwapStreams(AccX, a, b);
        SwapStreams(AccY, a, b);
        SwapStreams(AccZ, a, b);
        SwapStreams(ScaleX, a, b);
        SwapStreams(ScaleY, a, b);
        SwapStreams(ScaleZ, a, b);
        SwapStreams(RotX, a, b);
        SwapStreams(RotY, a, b);
        SwapStreams(RotZ, a, b);
        SwapStreams(AngVelX, a, b);
        SwapStreams(AngVelY, a, b);
        SwapStreams(AngVelZ, a, b);
        SwapStreams(ColR, a, b);
        SwapStreams(ColG, a, b);
        SwapStreams(ColB, a, b);
        SwapStreams(ColA, a, b);
        SwapStreams(Lifetime, a, b);
        SwapStreams(Age, a, b);
        SwapStreams(Custom0, a, b);
        SwapStreams(Custom1, a, b);
        SwapStreams(Custom2, a, b);
        SwapStreams(Custom3, a, b);
        SwapStreams(CollisionHits, a, b);

        ParticleId tmp = DenseToId[a];
        DenseToId[a] = DenseToId[b];
        DenseToId[b] = tmp;
        _handles[DenseToId[a].Index].DenseIndex = a;
        _handles[DenseToId[b].Index].DenseIndex = b;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void SwapStreams<T>(T* stream, int a, int b)
        where T : unmanaged
    {
        T tmp = stream[a];
        stream[a] = stream[b];
        stream[b] = tmp;
    }
}
