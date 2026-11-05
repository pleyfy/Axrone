namespace Axrone.Ecs.Tests;

public sealed class EcsChangeDetectionTests : IDisposable
{
    private const int WindowIterations = 1_000;

    private readonly World _world;

    public EcsChangeDetectionTests()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        ComponentRegistry.Register<EcsTestHealth>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void AddedAndChangedTicksFollowStructuralAndValueWrites()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();
        _world.Tick.Should().Be(0);
        _world.FrameCount.Should().Be(0L);

        AssertTicks(entity, added: 0, changed: 0);
        _world.Step();
        _world.Tick.Should().Be(1);

        _world.AddComponent(entity, new EcsTestVelocity(2.0f));
        AssertVelocityTicks(entity, added: 1, changed: 1);
        AssertTicks(entity, added: 0, changed: 0);

        _world.SetComponent(entity, new EcsTestPosition(5.0f, 0.0f));
        AssertTicks(entity, added: 0, changed: 1);

        _world.Step();
        _world.SetComponent(entity, new EcsTestPosition(6.0f, 0.0f));
        AssertTicks(entity, added: 0, changed: 2);

        var changed = new ChangeCollector();
        _world.ForEachChanged<ChangeCollector, EcsTestPosition>(1, ref changed);
        changed.Count.Should().Be(1);
        changed.Sum.Should().BeApproximately(6.0f, 1e-4f);
        changed.LastTick.Should().Be(2);

        var noChange = new ChangeCollector();
        _world.ForEachChanged<ChangeCollector, EcsTestPosition>(2, ref noChange);
        noChange.Count.Should().Be(0);

        var added = new ChangeCollector();
        _world.ForEachAdded<ChangeCollector, EcsTestPosition>(-1, ref added);
        added.Count.Should().Be(1);
        added.LastTick.Should().Be(0);

        var lateAdded = new ChangeCollector();
        _world.ForEachAdded<ChangeCollector, EcsTestPosition>(0, ref lateAdded);
        lateAdded.Count.Should().Be(0);
    }

    [Fact]
    public void DirectReferenceWritesAreNotTrackedUntilSetComponent()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();
        _world.Step();

        _world.GetComponent<EcsTestPosition>(entity).X = 9.0f;

        var unscoped = new ChangeCollector();
        _world.ForEachChanged<ChangeCollector, EcsTestPosition>(0, ref unscoped);
        unscoped.Count.Should().Be(0);

        _world.SetComponent(entity, new EcsTestPosition(9.0f, 0.0f));
        var tracked = new ChangeCollector();
        _world.ForEachChanged<ChangeCollector, EcsTestPosition>(0, ref tracked);
        tracked.Count.Should().Be(1);
        tracked.Sum.Should().BeApproximately(9.0f, 1e-4f);
    }

    [Fact]
    public void TicksSurviveArchetypeMoves()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();
        _world.Step();
        _world.AddComponent(entity, new EcsTestVelocity(1.0f));
        _world.Step();
        _world.AddComponent(entity, new EcsTestHealth(10.0f));
        _world.Step();
        _world.RemoveComponent<EcsTestVelocity>(entity);

        AssertTicks(entity, added: 0, changed: 0);
        AssertHealthTicks(entity, added: 2, changed: 2);
        _world.HasComponent<EcsTestVelocity>(entity).Should().BeFalse();
    }

    [Fact]
    public void RemovalJournalTracksComponentRemovalAndDestruction()
    {
        Entity entity = _world.BeginEntity()
            .With(new EcsTestPosition(1.0f, 0.0f))
            .With(new EcsTestVelocity(1.0f))
            .Commit();

        _world.Step();
        _world.RemoveComponent<EcsTestVelocity>(entity);

        Span<Entity> removed = stackalloc Entity[4];
        _world.GetRemoved<EcsTestVelocity>(0, removed).Should().Be(1);
        removed[0].Should().Be(entity);
        _world.GetRemoved<EcsTestVelocity>(1, removed).Should().Be(0);
        _world.WasRemoved<EcsTestVelocity>(entity, 0).Should().BeTrue();
        _world.WasRemoved<EcsTestVelocity>(entity, 1).Should().BeFalse();
        _world.WasRemoved<EcsTestPosition>(entity, 0).Should().BeFalse();

        _world.Step();
        _world.DestroyEntity(entity);

        _world.GetRemoved<EcsTestPosition>(1, removed).Should().Be(1);
        removed[0].Should().Be(entity);
        _world.GetRemoved<EcsTestPosition>(2, removed).Should().Be(0);

        int before = _world.RemovalCount;
        _world.DestroyEntity(entity);
        _world.RemovalCount.Should().Be(before);
    }

    [Fact]
    public void RemovalJournalRingOverwritesOldestAndCountsDrops()
    {
        var journal = new RemovalJournal(4);
        for (int index = 1; index <= 6; index++)
        {
            journal.Record(new Entity(new EntityId(index), new EntityVersion(1)), ComponentType<EcsTestPosition>.Id, index);
        }

        journal.Count.Should().Be(4);
        journal.DroppedCount.Should().Be(2);

        Span<Entity> removed = stackalloc Entity[8];
        int count = journal.GetRemoved(ComponentType<EcsTestPosition>.Id, -1, removed);
        count.Should().Be(4);
        removed[0].Id.Value.Should().Be(3);
        removed[3].Id.Value.Should().Be(6);
        journal.WasRemoved(new Entity(new EntityId(2), new EntityVersion(1)), ComponentType<EcsTestPosition>.Id, -1)
            .Should().BeFalse();
        journal.WasRemoved(new Entity(new EntityId(6), new EntityVersion(1)), ComponentType<EcsTestPosition>.Id, -1)
            .Should().BeTrue();

        Action invalid = () => _ = new RemovalJournal(0);
        invalid.Should().Throw<EcsConfigurationException>();
    }

    [Fact]
    public void TickComparisonWrapsSafely()
    {
        EcsTick.IsNewer(int.MinValue, int.MaxValue).Should().BeTrue();
        EcsTick.IsNewer(int.MaxValue, int.MinValue).Should().BeFalse();
        EcsTick.IsNewer(5, 5).Should().BeFalse();
        EcsTick.IsNewer(6, 5).Should().BeTrue();
    }

    [Fact]
    public void ChunkTicksAlignWithEntities()
    {
        var entities = new List<Entity>();
        for (int index = 0; index < 3; index++)
        {
            entities.Add(_world.BeginEntity().With(new EcsTestPosition(index, 0.0f)).Commit());
        }

        _world.Step();
        foreach (Entity entity in entities)
        {
            _world.SetComponent(entity, new EcsTestPosition(100.0f, 0.0f));
        }

        int rows = 0;
        foreach (Chunk1<EcsTestPosition> chunk in _world.Query<EcsTestPosition>())
        {
            chunk.Added1.Length.Should().Be(chunk.Length);
            chunk.Changed1.Length.Should().Be(chunk.Length);
            for (int row = 0; row < chunk.Length; row++)
            {
                chunk.Added1[row].Should().Be(0);
                chunk.Changed1[row].Should().Be(1);
            }

            rows += chunk.Length;
        }

        rows.Should().Be(3);
    }

    [Fact]
    public void ChangeVisitorsDoNotAllocate()
    {
        for (int index = 0; index < 4; index++)
        {
            _ = _world.BeginEntity().With(new EcsTestPosition(index, 0.0f)).Commit();
        }

        _world.Step();
        var visitor = new CountingChangeVisitor();

        // Phases are measured only after a window already failed, so the next red names the
        // allocation site (cache resolve / archetype walk setup / row visit) instead of only
        // reporting a byte count.
        EcsGatePhase[] phases =
        [
            new("resolve", () => _ = _world.QueryCache.Resolve(
                ComponentType<EcsTestPosition>.Mask, ComponentMask.Empty, _world.Archetypes)),
            new("walk", () =>
            {
                Query1<EcsTestPosition> query = _world.Query<EcsTestPosition>();
                Query1<EcsTestPosition>.Enumerator enumerator = query.GetEnumerator();
                _ = enumerator.MoveNext();
                Chunk1<EcsTestPosition> chunk = enumerator.Current;
                _ = chunk.Length + chunk.Entities.Length + chunk.Column1.Length;
                _ = enumerator.MoveNext();
            }),
            new("visit", () => VisitChangedWindows(_world, ref visitor, 1)),
        ];

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () => VisitChangedWindows(_world, ref visitor, WindowIterations),
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "change-visitor traversal",
            phases);

        // The gate only means something if the traversals still visited every changed row.
        visitor.Count.Should().Be(4);
        outcome.MeasuredWindows.Should().Be(EcsAllocationHarness.Windows);
        outcome.PrimePasses.Should().BeGreaterThanOrEqualTo(EcsAllocationHarness.PrimePasses);
    }

    private static void VisitChangedWindows(World world, ref CountingChangeVisitor visitor, int iterations)
    {
        for (int iteration = 0; iteration < iterations; iteration++)
        {
            visitor.Reset();
            world.ForEachChanged<CountingChangeVisitor, EcsTestPosition>(-1, ref visitor);
        }
    }

    [Fact]
    public void SetComponentRejectsMissingState()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();

        Action missing = () => _world.SetComponent(entity, new EcsTestVelocity(1.0f));
        missing.Should().Throw<EcsComponentException>();

        var ghost = new Entity(new EntityId(9999), new EntityVersion(1));
        Action stale = () => _world.SetComponent(ghost, new EcsTestPosition(1.0f, 0.0f));
        stale.Should().Throw<EcsEntityException>();
    }

    private void AssertTicks(Entity entity, int added, int changed)
    {
        foreach (Chunk1<EcsTestPosition> chunk in _world.Query<EcsTestPosition>())
        {
            for (int row = 0; row < chunk.Length; row++)
            {
                if (chunk.Entities[row] == entity)
                {
                    chunk.Added1[row].Should().Be(added);
                    chunk.Changed1[row].Should().Be(changed);
                    return;
                }
            }
        }

        throw new InvalidOperationException("Entity was not found in the position query.");
    }

    private void AssertVelocityTicks(Entity entity, int added, int changed)
    {
        foreach (Chunk1<EcsTestVelocity> chunk in _world.Query<EcsTestVelocity>())
        {
            for (int row = 0; row < chunk.Length; row++)
            {
                if (chunk.Entities[row] == entity)
                {
                    chunk.Added1[row].Should().Be(added);
                    chunk.Changed1[row].Should().Be(changed);
                    return;
                }
            }
        }

        throw new InvalidOperationException("Entity was not found in the velocity query.");
    }

    private void AssertHealthTicks(Entity entity, int added, int changed)
    {
        foreach (Chunk1<EcsTestHealth> chunk in _world.Query<EcsTestHealth>())
        {
            for (int row = 0; row < chunk.Length; row++)
            {
                if (chunk.Entities[row] == entity)
                {
                    chunk.Added1[row].Should().Be(added);
                    chunk.Changed1[row].Should().Be(changed);
                    return;
                }
            }
        }

        throw new InvalidOperationException("Entity was not found in the health query.");
    }

    private struct ChangeCollector : IChangeVisitor<EcsTestPosition>
    {
        public int Count;
        public float Sum;
        public int LastTick;

        public void Visit(Entity entity, ref EcsTestPosition value, int tick)
        {
            _ = entity;
            Count++;
            Sum += value.X;
            LastTick = tick;
        }
    }

    private struct CountingChangeVisitor : IChangeVisitor<EcsTestPosition>
    {
        public int Count;

        public void Visit(Entity entity, ref EcsTestPosition value, int tick)
        {
            _ = entity;
            _ = value;
            _ = tick;
            Count++;
        }

        public void Reset() => Count = 0;
    }
}
