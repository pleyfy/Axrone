namespace Axrone.Memory.Arena;

public sealed unsafe class RingBatchCoordinator<T, TBackoff> : IBatchReservable<T>
    where T : unmanaged
    where TBackoff : struct, ISpinBackoff
{
    private readonly RingCore<T, TBackoff> _core;

    internal RingBatchCoordinator(RingCore<T, TBackoff> core) => _core = core;

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool TryReserveWrite(int count, out BatchWriteReservation<T> reservation)
    {
        if ((nuint)count > _core.Capacity.Value)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(count), "Reservation count exceeds buffer capacity.");
        }

        _core.Lifecycle.AcquireLease();

        nuint mask = _core.Capacity.Mask;
        while (true)
        {
            long currentTail = _core.TailCommitted.Value;
            long currentHead = _core.HeadReserved.Value;

            if ((ulong)(currentHead + count - currentTail) > _core.Capacity.Value)
            {
                _core.Lifecycle.ReleaseLease();
                Unsafe.SkipInit(out reservation);
                return false;
            }

            if (_core.HeadReserved.CompareExchange(currentHead + count, currentHead))
            {
                nuint startIndex = (nuint)currentHead & mask;
                nuint firstLen = Math.Min((nuint)count, _core.Capacity.Value - startIndex);
                nuint secondLen = (nuint)count - firstLen;

                Span<T> firstSpan = new(_core.Storage.BasePointer + startIndex, (int)firstLen);
                Span<T> secondSpan = secondLen > 0 ? new(_core.Storage.BasePointer, (int)secondLen) : Span<T>.Empty;

                reservation = new BatchWriteReservation<T>(_core, (ulong)currentHead, count, firstSpan, secondSpan);
                return true;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool TryReserveRead(int count, out BatchReadReservation<T> reservation)
    {
        if ((nuint)count > _core.Capacity.Value)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(count), "Reservation count exceeds buffer capacity.");
        }

        _core.Lifecycle.AcquireLease();

        nuint mask = _core.Capacity.Mask;
        while (true)
        {
            long currentTail = _core.TailReserved.Value;
            long currentHead = _core.HeadCommitted.Value;

            if (currentTail + count > currentHead)
            {
                _core.Lifecycle.ReleaseLease();
                Unsafe.SkipInit(out reservation);
                return false;
            }

            if (_core.TailReserved.CompareExchange(currentTail + count, currentTail))
            {
                nuint startIndex = (nuint)currentTail & mask;
                nuint firstLen = Math.Min((nuint)count, _core.Capacity.Value - startIndex);
                nuint secondLen = (nuint)count - firstLen;

                ReadOnlySpan<T> firstSpan = new(_core.Storage.BasePointer + startIndex, (int)firstLen);
                ReadOnlySpan<T> secondSpan = secondLen > 0 ? new(_core.Storage.BasePointer, (int)secondLen) : ReadOnlySpan<T>.Empty;

                reservation = new BatchReadReservation<T>(_core, (ulong)currentTail, count, firstSpan, secondSpan);
                return true;
            }
        }
    }

    /// <summary>
    /// Returns the committed-but-unconsumed runs without claiming anything.
    /// Snapshot semantics: concurrent producers may extend past the view, but
    /// the view itself never changes and a later read still finds the data.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public RingPeekView<T> PeekAvailable()
    {
        nuint mask = _core.Capacity.Mask;
        long tail = _core.TailCommitted.Value;
        long head = _core.HeadCommitted.Value;

        if (head <= tail)
        {
            return default;
        }

        nuint startIndex = (nuint)tail & mask;
        nuint available = (nuint)(head - tail);
        nuint firstLen = Math.Min(available, _core.Capacity.Value - startIndex);
        nuint secondLen = available - firstLen;

        ReadOnlySpan<T> firstSpan = new(_core.Storage.BasePointer + startIndex, (int)firstLen);
        ReadOnlySpan<T> secondSpan = secondLen > 0 ? new(_core.Storage.BasePointer, (int)secondLen) : ReadOnlySpan<T>.Empty;

        return new RingPeekView<T>(firstSpan, secondSpan);
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public bool TryConsumeWithVisitor<TVisitor, TContext>(int count, TVisitor visitor, ref TContext context) where TVisitor : struct, IBatchVisitor<T, TContext>
        where TContext : allows ref struct
    {
        if (!TryReserveRead(count, out var reservation))
        {
            return false;
        }

        try
        {
            visitor.ProcessBatch(reservation.FirstSegment, reservation.SecondSegment, ref context);
            reservation.Commit();
            return true;
        }
        finally
        {
            reservation.Dispose();
        }
    }
}
