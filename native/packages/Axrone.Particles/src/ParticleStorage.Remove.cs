namespace Axrone.Particles;

/// <summary>Native struct-of-arrays particle storage with generational handles.</summary>
public sealed unsafe partial class NativeSoaParticleStorage : IDisposable
{

    /// <summary>Allocates a particle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool TryAllocate(
        in Vec3 position,
        in Vec3 velocity,
        float lifetime,
        in Vec3 size,
        in Vec4 color,
        out ParticleId id)
    {
        lock (_lock)
        {
            if (_counters.ActiveCount >= Capacity || _freeHandleTop == 0)
            {
                id = ParticleId.Invalid;
                return false;
            }

            int denseIdx = _counters.ActiveCount++;
            int handleIdx = _freeHandles[--_freeHandleTop];

            uint gen = _handles[handleIdx].Generation;
            _handles[handleIdx].DenseIndex = denseIdx;

            id = ParticleId.Create((uint)handleIdx, gen);
            DenseToId[denseIdx] = id;

            PosX[denseIdx] = position.X;
            PosY[denseIdx] = position.Y;
            PosZ[denseIdx] = position.Z;

            VelX[denseIdx] = velocity.X;
            VelY[denseIdx] = velocity.Y;
            VelZ[denseIdx] = velocity.Z;

            AccX[denseIdx] = 0f;
            AccY[denseIdx] = 0f;
            AccZ[denseIdx] = 0f;

            ScaleX[denseIdx] = size.X;
            ScaleY[denseIdx] = size.Y;
            ScaleZ[denseIdx] = size.Z;

            RotX[denseIdx] = 0f;
            RotY[denseIdx] = 0f;
            RotZ[denseIdx] = 0f;

            AngVelX[denseIdx] = 0f;
            AngVelY[denseIdx] = 0f;
            AngVelZ[denseIdx] = 0f;

            ColR[denseIdx] = color.X;
            ColG[denseIdx] = color.Y;
            ColB[denseIdx] = color.Z;
            ColA[denseIdx] = color.W;

            Lifetime[denseIdx] = lifetime;
            Age[denseIdx] = 0f;

            Custom0[denseIdx] = 0f;
            Custom1[denseIdx] = 0f;
            Custom2[denseIdx] = 0f;
            Custom3[denseIdx] = 0f;

            CollisionHits[denseIdx] = 0;

            return true;
        }
    }

    /// <summary>Removes the particle at a dense index (swap-back).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool RemoveAtDense(int denseIndex)
    {
        lock (_lock)
        {
            int count = _counters.ActiveCount;
            if ((uint)denseIndex >= (uint)count)
            {
                return false;
            }

            ParticleId deadId = DenseToId[denseIndex];
            uint handleIdx = deadId.Index;

            if (handleIdx >= (uint)Capacity || _handles[handleIdx].Generation != deadId.Generation)
            {
                return false;
            }

            _handles[handleIdx].DenseIndex = -1;
            _handles[handleIdx].Generation = (_handles[handleIdx].Generation + 1) & 0x0FFF;
            if (_handles[handleIdx].Generation == 0)
            {
                _handles[handleIdx].Generation = 1;
            }

            _freeHandles[_freeHandleTop++] = (int)handleIdx;

            int lastIdx = count - 1;
            if (denseIndex != lastIdx)
            {
                PosX[denseIndex] = PosX[lastIdx];
                PosY[denseIndex] = PosY[lastIdx];
                PosZ[denseIndex] = PosZ[lastIdx];

                VelX[denseIndex] = VelX[lastIdx];
                VelY[denseIndex] = VelY[lastIdx];
                VelZ[denseIndex] = VelZ[lastIdx];

                AccX[denseIndex] = AccX[lastIdx];
                AccY[denseIndex] = AccY[lastIdx];
                AccZ[denseIndex] = AccZ[lastIdx];

                ScaleX[denseIndex] = ScaleX[lastIdx];
                ScaleY[denseIndex] = ScaleY[lastIdx];
                ScaleZ[denseIndex] = ScaleZ[lastIdx];

                RotX[denseIndex] = RotX[lastIdx];
                RotY[denseIndex] = RotY[lastIdx];
                RotZ[denseIndex] = RotZ[lastIdx];

                AngVelX[denseIndex] = AngVelX[lastIdx];
                AngVelY[denseIndex] = AngVelY[lastIdx];
                AngVelZ[denseIndex] = AngVelZ[lastIdx];

                ColR[denseIndex] = ColR[lastIdx];
                ColG[denseIndex] = ColG[lastIdx];
                ColB[denseIndex] = ColB[lastIdx];
                ColA[denseIndex] = ColA[lastIdx];

                Lifetime[denseIndex] = Lifetime[lastIdx];
                Age[denseIndex] = Age[lastIdx];

                Custom0[denseIndex] = Custom0[lastIdx];
                Custom1[denseIndex] = Custom1[lastIdx];
                Custom2[denseIndex] = Custom2[lastIdx];
                Custom3[denseIndex] = Custom3[lastIdx];

                CollisionHits[denseIndex] = CollisionHits[lastIdx];

                ParticleId swappedId = DenseToId[lastIdx];
                DenseToId[denseIndex] = swappedId;
                _handles[swappedId.Index].DenseIndex = denseIndex;
            }

            _counters.ActiveCount = lastIdx;
            return true;
        }
    }

    /// <summary>Resolves an identity to a dense index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool TryGetDenseIndex(ParticleId id, out int denseIndex)
    {
        uint handleIdx = id.Index;
        if (handleIdx < (uint)Capacity)
        {
            ref readonly HandleEntry handle = ref _handles[handleIdx];
            if (handle.Generation == id.Generation && handle.DenseIndex >= 0)
            {
                denseIndex = handle.DenseIndex;
                return true;
            }
        }

        denseIndex = -1;
        return false;
    }

    /// <summary>Whether an identity is alive.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool Contains(ParticleId id) => TryGetDenseIndex(id, out _);

    /// <summary>Clears all particles.</summary>
    public void Clear()
    {
        lock (_lock)
        {
            for (int i = 0; i < Capacity; i++)
            {
                _handles[i].DenseIndex = -1;
                _handles[i].Generation = (_handles[i].Generation + 1) & 0x0FFF;
                if (_handles[i].Generation == 0)
                {
                    _handles[i].Generation = 1;
                }

                _freeHandles[i] = Capacity - 1 - i;
            }

            _freeHandleTop = Capacity;
            _counters.ActiveCount = 0;
        }
    }
}
