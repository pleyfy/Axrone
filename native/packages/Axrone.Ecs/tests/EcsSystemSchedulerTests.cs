namespace Axrone.Ecs.Tests;

internal static class SystemLog
{
    private static readonly Lock Gate = new();
    private static readonly List<string> Buffer = new();

    public static IReadOnlyList<string> Entries
    {
        get
        {
            lock (Gate)
            {
                return [.. Buffer];
            }
        }
    }

    public static void Add(string entry)
    {
        lock (Gate)
        {
            Buffer.Add(entry);
        }
    }

    public static void Reset()
    {
        lock (Gate)
        {
            Buffer.Clear();
        }
    }
}

internal static class ConcurrencyProbe
{
    public static CountdownEvent? Barrier;
    public static int Active;
    public static int MaxActive;

    public static void Reset()
    {
        Barrier?.Dispose();
        Barrier = null;
        Active = 0;
        MaxActive = 0;
    }

    public static void Enter()
    {
        int active = Interlocked.Increment(ref Active);
        int observed = Volatile.Read(ref MaxActive);
        while (active > observed)
        {
            int previous = Interlocked.CompareExchange(ref MaxActive, active, observed);
            if (previous == observed)
            {
                break;
            }

            observed = previous;
        }
    }

    public static void Exit() => Interlocked.Decrement(ref Active);

    public static void AwaitPair()
    {
        Barrier?.Signal();
        if (Barrier is not null && !Barrier.Wait(2000))
        {
            throw new TimeoutException("Systems did not overlap; the scheduler serialized independent systems.");
        }
    }
}

internal struct HighPrioritySystem : ISystemPolicy<HighPrioritySystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(1),
        SystemPhase.Update,
        10,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        SystemLog.Add("H");
    }
}

internal struct LowPrioritySystem : ISystemPolicy<LowPrioritySystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(2),
        SystemPhase.Update,
        5,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        SystemLog.Add("L");
    }
}

internal struct AfterHighSystem : ISystemPolicy<AfterHighSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(3),
        SystemPhase.Update,
        100,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        SystemLog.Add("A");
    }
}

internal struct MissingDependencySystem : ISystemPolicy<MissingDependencySystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(20),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct CycleA : ISystemPolicy<CycleA>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(30),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct CycleB : ISystemPolicy<CycleB>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(31),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct LatePhaseSystem : ISystemPolicy<LatePhaseSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(40),
        SystemPhase.PreUpdate,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct RenderPhaseSystem : ISystemPolicy<RenderPhaseSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(41),
        SystemPhase.Render,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct ProbePositionSystem : ISystemPolicy<ProbePositionSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(50),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentType<EcsTestPosition>.Mask);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        ConcurrencyProbe.Enter();
        try
        {
            ConcurrencyProbe.AwaitPair();
            Thread.Sleep(10);
        }
        finally
        {
            ConcurrencyProbe.Exit();
        }
    }
}

internal struct ProbeVelocitySystem : ISystemPolicy<ProbeVelocitySystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(51),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentType<EcsTestVelocity>.Mask);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        ConcurrencyProbe.Enter();
        try
        {
            ConcurrencyProbe.AwaitPair();
            Thread.Sleep(10);
        }
        finally
        {
            ConcurrencyProbe.Exit();
        }
    }
}

internal struct ConflictingA : ISystemPolicy<ConflictingA>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(60),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentType<EcsTestPosition>.Mask);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        ConcurrencyProbe.Enter();
        try
        {
            Thread.Sleep(10);
        }
        finally
        {
            ConcurrencyProbe.Exit();
        }
    }
}

internal struct ConflictingB : ISystemPolicy<ConflictingB>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(61),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentType<EcsTestPosition>.Mask);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        ConcurrencyProbe.Enter();
        try
        {
            Thread.Sleep(10);
        }
        finally
        {
            ConcurrencyProbe.Exit();
        }
    }
}

internal struct TickRecordingSystem : ISystemPolicy<TickRecordingSystem>
{
    public static readonly List<(int Tick, int SinceTick)> Recorded = new();

    public static SystemDescriptor Descriptor => new(
        new SystemId(70),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        lock (Recorded)
        {
            Recorded.Add((context.Tick, context.SinceTick));
        }
    }
}

internal struct IncrementPositionJob : IJobPolicy<EcsTestPosition>
{
    public static void Execute(Entity entity, ref EcsTestPosition c1)
    {
        _ = entity;
        c1.X += 1.0f;
    }
}

internal struct PositionChunkSystem : IChunkSystemPolicy<PositionChunkSystem, EcsTestPosition>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(80),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(Entity entity, ref EcsTestPosition c1, ref EntityCommandBuffer commands)
    {
        c1.X += 1.0f;
        commands.EnqueueAdd(entity, new EcsTestVelocity(1.0f));
    }
}

internal struct VelocityCommandJob : ICommandJobPolicy<EcsTestPosition>
{
    public static void Execute(Entity entity, ref EcsTestPosition c1, ref EntityCommandBuffer commands)
    {
        c1.X += 1.0f;
        commands.EnqueueAdd(entity, new EcsTestVelocity(1.0f));
    }
}

public sealed class EcsSystemSchedulerTests
{
    [Fact]
    public void DependenciesAndPrioritiesProduceDeterministicOrder()
    {
        SystemLog.Reset();
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<HighPrioritySystem>();
        scheduler.Add<LowPrioritySystem>();
        scheduler.Add<AfterHighSystem>([new SystemId(1)]);

        scheduler.Run();

        SystemLog.Entries.Should().Equal("H", "L", "A");
        scheduler.GetOrder(SystemPhase.Update).ToArray().Should().Equal(
            new SystemId(1),
            new SystemId(2),
            new SystemId(3));
    }

    [Fact]
    public void MissingDependencyThrows()
    {
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<MissingDependencySystem>([new SystemId(999)]);

        Action run = () => scheduler.Run();
        run.Should().Throw<EcsConfigurationException>().WithMessage("*unregistered*");
    }

    [Fact]
    public void DependencyCycleThrows()
    {
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<CycleA>([new SystemId(31)]);
        scheduler.Add<CycleB>([new SystemId(30)]);

        Action run = () => scheduler.Run();
        run.Should().Throw<EcsConfigurationException>().WithMessage("*cycle*");
    }

    [Fact]
    public void DependencyOnLaterPhaseThrows()
    {
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<RenderPhaseSystem>();
        scheduler.Add<LatePhaseSystem>([new SystemId(41)]);

        Action run = () => scheduler.Run();
        run.Should().Throw<EcsConfigurationException>().WithMessage("*later phase*");
    }

    [Fact]
    public void IndependentSystemsRunInParallel()
    {
        ConcurrencyProbe.Reset();
        ConcurrencyProbe.Barrier = new CountdownEvent(2);
        try
        {
            using var world = new World(workerCount: 4);
            using var scheduler = new SystemScheduler(world);
            scheduler.Add<ProbePositionSystem>();
            scheduler.Add<ProbeVelocitySystem>();

            scheduler.Run();

            ConcurrencyProbe.MaxActive.Should().BeGreaterThanOrEqualTo(2);
        }
        finally
        {
            ConcurrencyProbe.Reset();
        }
    }

    [Fact]
    public void ConflictingWritesAreSerialized()
    {
        ConcurrencyProbe.Reset();
        using var world = new World(workerCount: 4);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<ConflictingA>();
        scheduler.Add<ConflictingB>();

        scheduler.Run();

        ConcurrencyProbe.MaxActive.Should().Be(1);
    }

    [Fact]
    public void ContextCarriesTickAndSystemCheckpoint()
    {
        lock (TickRecordingSystem.Recorded)
        {
            TickRecordingSystem.Recorded.Clear();
        }

        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        scheduler.Add<TickRecordingSystem>();

        scheduler.Run(0.016f);
        scheduler.Run(0.016f);

        lock (TickRecordingSystem.Recorded)
        {
            TickRecordingSystem.Recorded.Should().HaveCount(2);
            TickRecordingSystem.Recorded[0].Should().Be((1, -1));
            TickRecordingSystem.Recorded[1].Should().Be((2, 1));
        }
    }

    [Fact]
    public void ParallelChunkJobIsDeterministic()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        using var world = new World(workerCount: 4);
        for (int index = 0; index < 200; index++)
        {
            _ = world.BeginEntity().With(new EcsTestPosition(0.0f, 0.0f)).Commit();
        }

        world.RunParallelChunks<IncrementPositionJob, EcsTestPosition>();
        float first = SumPositions(world);

        world.RunParallelChunks<IncrementPositionJob, EcsTestPosition>();
        float second = SumPositions(world);

        first.Should().BeApproximately(200.0f, 1e-4f);
        second.Should().BeApproximately(400.0f, 1e-4f);
    }

    [Fact]
    public void ParallelCommandsArePlayedInWorkerOrder()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        using var world = new World(workerCount: 4);
        for (int index = 0; index < 200; index++)
        {
            _ = world.BeginEntity().With(new EcsTestPosition(0.0f, 0.0f)).Commit();
        }

        var buffers = new EntityCommandBuffer[world.ParallelWorkerCount];
        for (int index = 0; index < buffers.Length; index++)
        {
            buffers[index] = new EntityCommandBuffer();
        }

        world.RunParallelCommands<VelocityCommandJob, EcsTestPosition>(buffers);

        int withVelocity = 0;
        foreach (Chunk1<EcsTestVelocity> chunk in world.Query<EcsTestVelocity>())
        {
            withVelocity += chunk.Length;
        }

        withVelocity.Should().Be(200);
        SumPositions(world).Should().BeApproximately(200.0f, 1e-4f);
        buffers.Should().OnlyContain(buffer => buffer.Count == 0);
    }

    [Fact]
    public void ChunkSystemRunsThroughSchedulerAndReplaysCommands()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        using var world = new World(workerCount: 4);
        for (int index = 0; index < 200; index++)
        {
            _ = world.BeginEntity().With(new EcsTestPosition(0.0f, 0.0f)).Commit();
        }

        using var scheduler = new SystemScheduler(world);
        scheduler.AddChunkSystem<PositionChunkSystem, EcsTestPosition>();
        scheduler.Run();

        SumPositions(world).Should().BeApproximately(200.0f, 1e-4f);
        int withVelocity = 0;
        foreach (Chunk1<EcsTestVelocity> chunk in world.Query<EcsTestVelocity>())
        {
            withVelocity += chunk.Length;
        }

        withVelocity.Should().Be(200);
    }

    [Fact]
    public void ParallelChunkDispatchDoesNotAllocateInSteadyState()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        using var world = new World(workerCount: 4);
        for (int index = 0; index < 100; index++)
        {
            _ = world.BeginEntity().With(new EcsTestPosition(0.0f, 0.0f)).Commit();
        }

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int iteration = 0; iteration < 100; iteration++)
                {
                    world.RunParallelChunks<IncrementPositionJob, EcsTestPosition>();
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "parallel chunk dispatch",
            []);

        outcome.MeasuredWindows.Should().Be(EcsAllocationHarness.Windows);
    }

    [Fact]
    public void DisposedSchedulerRejectsRegistration()
    {
        using var world = new World(workerCount: 1);
        var scheduler = new SystemScheduler(world);
        scheduler.Dispose();

        Action add = () => scheduler.Add<HighPrioritySystem>();
        add.Should().Throw<ObjectDisposedException>();
    }

    private static float SumPositions(World world)
    {
        float sum = 0.0f;
        foreach (Chunk1<EcsTestPosition> chunk in world.Query<EcsTestPosition>())
        {
            for (int index = 0; index < chunk.Length; index++)
            {
                sum += chunk.Column1[index].X;
            }
        }

        return sum;
    }
}
