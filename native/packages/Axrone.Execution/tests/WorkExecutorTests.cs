namespace Axrone.Execution.Tests;

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using Axrone.Execution;
using Axrone.Utility.Backoff.SpinPolicies;
using FluentAssertions;
using Xunit;

/// <summary>
/// Behavioural tests for <see cref="WorkExecutor{TCommand, TContext, TProcessor, TBackoff, TTelemetry}"/>:
/// a ring that owns a dedicated worker thread, so the interesting contract is the
/// lifecycle (Running -> Draining -> Stopped, or Faulted) plus the exact-once
/// execution of queued commands.
/// </summary>
/// <remarks>
/// Every test owns its executor, uses tiny capacities, and synchronises with the
/// worker through manual events rather than sleeps, so no assertion depends on
/// wall-clock timing. No test asserts that pinning actually happened: affinity is
/// best effort by contract.
/// </remarks>
public class WorkExecutorTests
{
    /// <summary>
    /// Upper bound for every wait in this class, so a wedged worker fails the
    /// test instead of hanging the suite.
    /// </summary>
    private const int WaitTimeoutMs = 5000;

    private static ManualResetEventSlim? s_rendezvous;
    private static int s_pending;
    private static ManualResetEventSlim? s_gateEntered;
    private static ManualResetEventSlim? s_gateRelease;

    /// <summary>
    /// Worker-owned context. The executor constructs it, so each test reads the
    /// live instance back through <see cref="Latest"/> once the rendezvous has
    /// published the worker's writes.
    /// </summary>
    private sealed class OrderContext
    {
        public static OrderContext? Latest;

        public readonly int[] Sink = new int[64];
        public int Count;

        public OrderContext() => Volatile.Write(ref Latest, this);
    }

    private readonly struct OrderProcessor : ICommandProcessor<int, OrderContext>
    {
        public static void Process(ref int command, ref OrderContext context)
        {
            context.Sink[context.Count] = command;
            context.Count++;
            Signal();
        }
    }

    private sealed class SumContext
    {
        public static SumContext? Latest;

        public long Total;

        public SumContext() => Volatile.Write(ref Latest, this);
    }

    private readonly struct SumProcessor : ICommandProcessor<int, SumContext>
    {
        public static void Process(ref int command, ref SumContext context)
        {
            Interlocked.Add(ref context.Total, command);
            Signal();
        }
    }

    /// <summary>
    /// Context for processors that need no state of their own. Paired with the
    /// gate/retiring processors, which let a test hold the worker inside
    /// <c>Process</c> and observe the ring while its consumer tail is frozen.
    /// </summary>
    private sealed class GateContext
    {
        public static GateContext? Latest;

        public int Processed;

        public GateContext() => Volatile.Write(ref Latest, this);
    }

    private readonly struct GateProcessor : ICommandProcessor<int, GateContext>
    {
        public static void Process(ref int command, ref GateContext context)
        {
            Interlocked.Increment(ref context.Processed);
            Volatile.Read(ref s_gateEntered)?.Set();
            Volatile.Read(ref s_gateRelease)?.Wait(WaitTimeoutMs);
        }
    }

    private readonly struct FaultProcessor : ICommandProcessor<int, GateContext>
    {
        public static void Process(ref int command, ref GateContext context) => ThrowFault();

        [MethodImpl(MethodImplOptions.NoInlining)]
        public static void ThrowFault() => throw new InvalidOperationException("work executor fault");
    }

    /// <summary>
    /// Parks the worker inside the first command until the test releases it, then
    /// throws. The throw retires the worker thread while the ring still holds
    /// every command, because a faulting command never advances the consumer
    /// tail. That is what makes an inline drain deterministic: a live worker
    /// always wins the ring's single-consumer lease back.
    /// </summary>
    private readonly struct RetiringProcessor : ICommandProcessor<int, GateContext>
    {
        public static void Process(ref int command, ref GateContext context)
        {
            Interlocked.Increment(ref context.Processed);
            Volatile.Read(ref s_gateEntered)?.Set();
            Volatile.Read(ref s_gateRelease)?.Wait(WaitTimeoutMs);
            throw new InvalidOperationException("worker retired");
        }
    }

    private sealed class PacketContext
    {
        public static PacketContext? Latest;

        public PacketContext() => Volatile.Write(ref Latest, this);
    }

    private readonly struct PacketProcessor : ICommandProcessor<WorkPacket, PacketContext>
    {
        public static void Process(ref WorkPacket command, ref PacketContext context) => command.Invoke();
    }

    private ref struct DirectContext
    {
        public readonly Span<int> Values;
        public int Count;
        public int ThreadId;

        public DirectContext(Span<int> values)
        {
            Values = values;
            Count = 0;
            ThreadId = 0;
        }
    }

    private readonly struct CountingDirectProcessor : ICommandProcessor<int, DirectContext>
    {
        public static void Process(ref int command, ref DirectContext context)
        {
            context.Values[context.Count] = command;
            context.Count++;
            context.ThreadId = Environment.CurrentManagedThreadId;
        }
    }

    /// <summary>
    /// Records the executor's cold-path signals. Static because
    /// <see cref="IExecutorTelemetry"/> is a static-abstract contract; xunit runs
    /// the methods of a single test class sequentially, so the counters are
    /// exclusive to the running test.
    /// </summary>
    private readonly struct RecordingTelemetry : IExecutorTelemetry
    {
        public static long Enqueued;
        public static long Dequeued;
        public static long Saturated;
        public static long Contentions;
        public static long Faults;
        public static Exception? LastFault;

        public static void Reset()
        {
            Interlocked.Exchange(ref Enqueued, 0);
            Interlocked.Exchange(ref Dequeued, 0);
            Interlocked.Exchange(ref Saturated, 0);
            Interlocked.Exchange(ref Contentions, 0);
            Interlocked.Exchange(ref Faults, 0);
            Volatile.Write(ref LastFault, null);
        }

        public static void ItemEnqueued() => Interlocked.Increment(ref Enqueued);
        public static void ItemDequeued() => Interlocked.Increment(ref Dequeued);
        public static void QueueSaturated() => Interlocked.Increment(ref Saturated);
        public static void ContentionDetected() => Interlocked.Increment(ref Contentions);

        public static void FaultEncountered(Exception exception)
        {
            Volatile.Write(ref LastFault, exception);
            Interlocked.Increment(ref Faults);
        }
    }

    /// <summary>Clears cross-test rendezvous state so every test is hermetic.</summary>
    private static void ResetRendezvous()
    {
        Volatile.Write(ref s_rendezvous, null);
        Volatile.Write(ref s_pending, 0);
        Volatile.Write(ref s_gateEntered, null);
        Volatile.Write(ref s_gateRelease, null);
    }

    /// <summary>
    /// Arms the "expected number of items processed" gate. Declared before the
    /// executor in every test, so the reverse-order <c>using</c> teardown joins
    /// the worker before the event is disposed.
    /// </summary>
    private static void SetRendezvous(ManualResetEventSlim gate, int expected)
    {
        Volatile.Write(ref s_pending, expected);
        Volatile.Write(ref s_rendezvous, gate);
    }

    private static void SetGate(ManualResetEventSlim? entered, ManualResetEventSlim? release)
    {
        Volatile.Write(ref s_gateEntered, entered);
        Volatile.Write(ref s_gateRelease, release);
    }

    /// <summary>
    /// Countdown hook called from the worker. Idempotent once satisfied, so an
    /// extra processed item can never turn into an unhandled worker-thread
    /// exception.
    /// </summary>
    private static void Signal()
    {
        if (Interlocked.Decrement(ref s_pending) <= 0)
            Volatile.Read(ref s_rendezvous)?.Set();
    }

    /// <summary>
    /// The executor constructs its consumer context itself; this keeps the shared
    /// context types provably constructible through the same constraint. Must be
    /// called before the executor, so the published instance is the worker's.
    /// </summary>
    private static TContext RequireConstructibleContext<TContext>() where TContext : class, new()
    {
        TContext context = new();
        context.Should().NotBeNull();
        return context;
    }

    private static WorkExecutor<int, TContext, TProcessor, AggressiveSpinBackoff, NullExecutorTelemetry>
        CreateExecutor<TContext, TProcessor>(int capacity, int processorAffinity = -1)
        where TContext : class, new()
        where TProcessor : struct, ICommandProcessor<int, TContext> =>
        new(new ExecutorOptions
        {
            Capacity = capacity,
            ProcessorAffinity = processorAffinity,
            ThreadName = "Axrone-WorkExecutorTests",
        });

    [Fact]
    public async Task Enqueue_ProcessesItems_InOrder()
    {
        ResetRendezvous();
        RequireConstructibleContext<OrderContext>();

        using var processed = new ManualResetEventSlim();
        SetRendezvous(processed, 8);
        using var executor = CreateExecutor<OrderContext, OrderProcessor>(8);

        for (int i = 0; i < 8; i++)
            executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        processed.Wait(WaitTimeoutMs).Should().BeTrue(because: "the worker must process every queued command");
        executor.Complete();
        await executor.DrainAsync();

        OrderContext context = OrderContext.Latest!;
        context.Count.Should().Be(8);
        context.Sink.Take(8).Should().Equal(Enumerable.Range(0, 8), because: "the ring is FIFO");
    }

    [Fact]
    public async Task TryEnqueueBatch_IngestsAll()
    {
        ResetRendezvous();
        RequireConstructibleContext<SumContext>();

        using var processed = new ManualResetEventSlim();
        SetRendezvous(processed, 6);
        using var executor = CreateExecutor<SumContext, SumProcessor>(16);

        int[] items = [1, 2, 3, 4, 5, 6];
        executor.TryEnqueueBatch(items).Should().Be((nuint)6);

        processed.Wait(WaitTimeoutMs).Should().BeTrue(because: "the whole batch must be ingested and processed");
        executor.Complete();
        await executor.DrainAsync();

        SumContext.Latest!.Total.Should().Be(21);
        executor.Count.Should().Be((nuint)0);
    }

    [Fact]
    public async Task Complete_DrainAsync_Resolves()
    {
        ResetRendezvous();
        RequireConstructibleContext<OrderContext>();

        using var processed = new ManualResetEventSlim();
        SetRendezvous(processed, 3);
        using var executor = CreateExecutor<OrderContext, OrderProcessor>(8);

        executor.TryEnqueue(1).IsEnqueued.Should().BeTrue();
        executor.TryEnqueue(2).IsEnqueued.Should().BeTrue();
        executor.TryEnqueue(3).IsEnqueued.Should().BeTrue();

        executor.Complete();
        await executor.DrainAsync();

        processed.Wait(WaitTimeoutMs).Should().BeTrue();
        executor.State.Should().Be(PumpState.Stopped, because: "a clean drain parks the executor");
        OrderContext.Latest!.Count.Should().Be(3);
    }

    [Fact]
    public async Task FaultingProcessor_FaultsExecutor()
    {
        ResetRendezvous();
        RecordingTelemetry.Reset();
        RequireConstructibleContext<GateContext>();

        using var executor = new WorkExecutor<int, GateContext, FaultProcessor, AggressiveSpinBackoff, RecordingTelemetry>(
            new ExecutorOptions { Capacity = 8, ThreadName = "Axrone-WorkExecutorTests-Fault" });

        executor.TryEnqueue(1).IsEnqueued.Should().BeTrue();

        Func<Task> drain = async () => await executor.DrainAsync();
        InvalidOperationException caught = (await drain.Should().ThrowAsync<InvalidOperationException>()).Which;

        caught.Message.Should().Be("work executor fault");
        executor.State.Should().Be(PumpState.Faulted);
        executor.TryEnqueue(2).Status.Should().Be(EnqueueStatus.Closed, because: "a faulted executor refuses new work");
        RecordingTelemetry.Faults.Should().Be(1);
        RecordingTelemetry.LastFault.Should().BeSameAs(caught);
    }

    [Fact]
    public async Task Complete_WithFault_FaultsImmediately()
    {
        ResetRendezvous();
        RecordingTelemetry.Reset();
        RequireConstructibleContext<GateContext>();

        using var executor = new WorkExecutor<int, GateContext, FaultProcessor, AggressiveSpinBackoff, RecordingTelemetry>(
            new ExecutorOptions { Capacity = 8, ThreadName = "Axrone-WorkExecutorTests-HostFault" });
        var fault = new InvalidOperationException("host fault");

        executor.Complete(fault);

        executor.State.Should().Be(PumpState.Faulted);
        Func<Task> drain = async () => await executor.DrainAsync();
        (await drain.Should().ThrowAsync<InvalidOperationException>()).Which.Should().BeSameAs(fault);
        RecordingTelemetry.Faults.Should().Be(1);
        RecordingTelemetry.LastFault.Should().BeSameAs(fault);
    }

    [Fact]
    public async Task Dispose_IsIdempotent_AndDisposeAsync_Drains()
    {
        ResetRendezvous();
        RequireConstructibleContext<OrderContext>();

        using (ManualResetEventSlim first = new())
        {
            SetRendezvous(first, 4);
            using var executor = CreateExecutor<OrderContext, OrderProcessor>(8);
            for (int i = 0; i < 4; i++)
                executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

            first.Wait(WaitTimeoutMs).Should().BeTrue();
            executor.Complete();
            await executor.DrainAsync();
            OrderContext.Latest!.Count.Should().Be(4);

            // Repeated teardown must be inert rather than a second native free.
            executor.Dispose();
            executor.Dispose();
            await executor.DisposeAsync();

            executor.State.Should().Be(PumpState.Disposed);
        }

        // DisposeAsync on its own drains whatever is still queued.
        using ManualResetEventSlim second = new();
        SetRendezvous(second, 4);
        using WorkExecutor<int, OrderContext, OrderProcessor, AggressiveSpinBackoff, NullExecutorTelemetry> draining =
            CreateExecutor<OrderContext, OrderProcessor>(8);
        for (int i = 0; i < 4; i++)
            draining.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        await draining.DisposeAsync();

        second.IsSet.Should().BeTrue(because: "DisposeAsync must drain the queued commands");
        OrderContext.Latest!.Count.Should().Be(4);
    }

    [Fact]
    public async Task WorkPacket_EndToEnd()
    {
        ResetRendezvous();
        RequireConstructibleContext<PacketContext>();

        using PacketRun run = CreatePacketRun();

        using var executor = new WorkExecutor<WorkPacket, PacketContext, PacketProcessor, AggressiveSpinBackoff, NullExecutorTelemetry>(
            new ExecutorOptions { Capacity = 8, ThreadName = "Axrone-WorkExecutorTests-Packet" });

        executor.TryEnqueue(run.Packet).IsEnqueued.Should().BeTrue();
        await executor.DrainAsync();

        run.Read().Should().Be(1, because: "the unmanaged callback must run exactly once");
    }

    /// <summary>
    /// Owns the unmanaged counter a <see cref="WorkPacket"/> points at, and hides
    /// the pointer from the async test body: a pointer local is illegal in a
    /// method that can <c>await</c>, so the allocation and the read live here
    /// instead and the address travels as a <see cref="nint"/>.
    /// </summary>
    private sealed class PacketRun : IDisposable
    {
        private readonly nint _address;

        public WorkPacket Packet { get; }

        public PacketRun(WorkPacket packet, nint address)
        {
            Packet = packet;
            _address = address;
        }

        public unsafe int Read() => *(int*)_address;

        public unsafe void Dispose() => NativeMemory.Free((void*)_address);
    }

    private static unsafe PacketRun CreatePacketRun()
    {
        int* counter = (int*)NativeMemory.Alloc(sizeof(int));
        *counter = 0;
        return new PacketRun(new WorkPacket(counter, &Increment), (nint)counter);
    }

    [Fact]
    public async Task ProcessorAffinity_IsBestEffort()
    {
        ResetRendezvous();
        RequireConstructibleContext<OrderContext>();

        using var processed = new ManualResetEventSlim();
        SetRendezvous(processed, 4);
        using var executor = CreateExecutor<OrderContext, OrderProcessor>(8, processorAffinity: 0);

        for (int i = 0; i < 4; i++)
            executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        processed.Wait(WaitTimeoutMs).Should().BeTrue(because: "an unsupported affinity must not stop the worker");
        executor.Complete();
        await executor.DrainAsync();

        OrderContext.Latest!.Count.Should().Be(4);
        executor.State.Should().Be(PumpState.Stopped);

        // Affinity is a hint: the worker reports why it ended up unpinned instead of the
        // answer collapsing into one shared failure value. Core 0 is in range on every
        // supported platform, so the only honest answers are the OS accepting or refusing it.
        executor.WorkerAffinity.Should().NotBe(AffinityResult.NotAttempted);
        executor.WorkerAffinity.Should().NotBe(AffinityResult.AbiUnavailable);
        executor.WorkerAffinity.Should().NotBe(AffinityResult.UnsupportedPlatform);
        executor.WorkerAffinity.Should().BeOneOf(AffinityResult.Pinned, AffinityResult.DeclinedByOs);

        // Out-of-range requests are refused with their own code, never thrown.
        ThreadAffinityScope.PinCurrentThread(-1).Should().Be(AffinityResult.OutOfRange);
    }

    [Fact]
    public async Task WithoutProcessorAffinity_WorkerReportsNotAttempted()
    {
        ResetRendezvous();
        RequireConstructibleContext<OrderContext>();

        using var processed = new ManualResetEventSlim();
        SetRendezvous(processed, 4);
        using var executor = CreateExecutor<OrderContext, OrderProcessor>(8);

        for (int i = 0; i < 4; i++)
            executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        processed.Wait(WaitTimeoutMs).Should().BeTrue();
        executor.Complete();
        await executor.DrainAsync();

        executor.WorkerAffinity.Should().Be(AffinityResult.NotAttempted, "no pin was requested");
    }

    [Fact]
    public async Task ExecuteBatch_DrainsInline()
    {
        ResetRendezvous();
        RequireConstructibleContext<GateContext>();

        using ManualResetEventSlim entered = new();
        using ManualResetEventSlim release = new();
        SetGate(entered, release);
        using var executor = CreateExecutor<GateContext, RetiringProcessor>(8);

        // An empty ring has nothing for an inline drain, no matter who holds the lease.
        int[] emptySink = new int[4];
        var empty = new DirectContext(emptySink);
        executor.ExecuteBatch<DirectContext, CountingDirectProcessor>(ref empty, nuint.MaxValue).Should().Be((nuint)0);

        for (int i = 0; i < 4; i++)
            executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        // Park the worker on the first command so the rest of the ring is stable.
        entered.Wait(WaitTimeoutMs).Should().BeTrue(because: "the worker must reach its first command");
        release.Set();

        Func<Task> drain = async () => await executor.DrainAsync();
        await drain.Should().ThrowAsync<InvalidOperationException>(because: "the parked worker retires with a fault");

        // The worker is gone and no tail was ever advanced, so the calling thread
        // is the only consumer left and owns the whole batch.
        int[] sink = new int[4];
        var direct = new DirectContext(sink);
        nuint processed = executor.ExecuteBatch<DirectContext, CountingDirectProcessor>(ref direct, nuint.MaxValue);

        processed.Should().Be((nuint)4);
        direct.Count.Should().Be(4);
        direct.ThreadId.Should().Be(Environment.CurrentManagedThreadId, because: "ExecuteBatch runs on the calling thread");
        sink.Should().Equal(Enumerable.Range(0, 4), because: "the ring is FIFO");
    }

    [Fact]
    public async Task Capacity_And_Count()
    {
        ResetRendezvous();
        RequireConstructibleContext<GateContext>();

        using ManualResetEventSlim entered = new();
        using ManualResetEventSlim release = new();
        SetGate(entered, release);
        using var executor = CreateExecutor<GateContext, GateProcessor>(8);

        executor.Capacity.Should().Be((nuint)8, because: "Capacity echoes the configured option");

        for (int i = 0; i < 4; i++)
            executor.TryEnqueue(i).IsEnqueued.Should().BeTrue();

        // The worker is parked on the first command, so its tail never advances
        // and the three remaining commands are observably queued.
        entered.Wait(WaitTimeoutMs).Should().BeTrue();
        ((int)executor.Count).Should().Be(4);

        release.Set();
        executor.Complete();
        await executor.DrainAsync();

        executor.Count.Should().Be((nuint)0);
    }

    [UnmanagedCallersOnly]
    private static unsafe void Increment(void* state)
    {
        int* slot = (int*)state;
        *slot = *slot + 1;
    }
}
