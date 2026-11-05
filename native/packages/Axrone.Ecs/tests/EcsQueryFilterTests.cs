namespace Axrone.Ecs.Tests;

internal struct EcsTestHealth
{
    public float Hp;

    public EcsTestHealth(float hp) => Hp = hp;
}

internal struct EcsTestArmor
{
    public float Value;

    public EcsTestArmor(float value) => Value = value;
}

internal struct EcsTestMana
{
    public float Value;

    public EcsTestMana(float value) => Value = value;
}

public sealed class EcsQueryFilterTests : IDisposable
{
    private readonly World _world;
    private readonly List<Entity> _positioned = new();
    private readonly List<Entity> _healthOnly = new();
    private readonly Entity _velocityOnly;

    public EcsQueryFilterTests()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        ComponentRegistry.Register<EcsTestHealth>();
        ComponentRegistry.Register<EcsTestArmor>();
        ComponentRegistry.Register<EcsTestMana>();
        _world = new World();

        for (int i = 0; i < 5; i++)
        {
            Entity entity = _world.BeginEntity()
                .With(new EcsTestPosition(i, 0.0f))
                .With(new EcsTestVelocity(1.0f))
                .With(new EcsTestHealth(10.0f))
                .Commit();
            _positioned.Add(entity);
        }

        for (int i = 0; i < 2; i++)
        {
            Entity entity = _world.BeginEntity()
                .With(new EcsTestPosition(10.0f + i, 0.0f))
                .With(new EcsTestHealth(20.0f))
                .Commit();
            _healthOnly.Add(entity);
        }

        _velocityOnly = _world.BeginEntity().With(new EcsTestVelocity(3.0f)).Commit();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Query3_ReturnsEveryRequiredComponentRow()
    {
        int rows = 0;
        float positionSum = 0.0f;
        float healthSum = 0.0f;
        foreach (Chunk3<EcsTestPosition, EcsTestVelocity, EcsTestHealth> chunk in
                 _world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>())
        {
            rows += chunk.Length;
            for (int i = 0; i < chunk.Length; i++)
            {
                positionSum += chunk.Column1[i].X;
                healthSum += chunk.Column3[i].Hp;
            }
        }

        rows.Should().Be(5);
        positionSum.Should().BeApproximately(10.0f, 1e-4f);
        healthSum.Should().BeApproximately(50.0f, 1e-4f);
    }

    [Fact]
    public void Query3_WithAndWithout_AreApplied()
    {
        _world.AddComponent(_positioned[0], new EcsTestArmor(4.0f));

        int withArmor = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>().With<EcsTestArmor>());
        int withoutArmor = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>().Without<EcsTestArmor>());

        withArmor.Should().Be(1);
        withoutArmor.Should().Be(4);

        int contradictory = CountChunks(
            _world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>().Without<EcsTestHealth>());
        contradictory.Should().Be(0);
    }

    [Fact]
    public void Query2_WithoutExcludesTheComponent()
    {
        int all = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>());
        int withoutHealth = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>().Without<EcsTestHealth>());
        all.Should().Be(5);
        withoutHealth.Should().Be(0);

        _ = _world.BeginEntity()
            .With(new EcsTestPosition(100.0f, 0.0f))
            .With(new EcsTestVelocity(2.0f))
            .Commit();

        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>()).Should().Be(6);
        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>().Without<EcsTestHealth>()).Should().Be(1);
    }

    [Fact]
    public void Query4_ReturnsTheSingleFullyEquippedEntity()
    {
        _world.AddComponent(_positioned[2], new EcsTestArmor(7.0f));
        _world.AddComponent(_positioned[2], new EcsTestMana(9.0f));

        int rows = 0;
        foreach (Chunk4<EcsTestPosition, EcsTestVelocity, EcsTestHealth, EcsTestArmor> chunk in
                 _world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth, EcsTestArmor>())
        {
            rows += chunk.Length;
            chunk.Column4[0].Value.Should().BeApproximately(7.0f, 1e-4f);
        }

        rows.Should().Be(1);
        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth, EcsTestMana>())
            .Should().Be(1);
    }

    [Fact]
    public void Query1_IncludeExcludeCombination()
    {
        int rows = CountChunks(_world.Query<EcsTestPosition>().With<EcsTestHealth>().Without<EcsTestVelocity>());
        rows.Should().Be(2);
    }

    [Fact]
    public void QueryCacheInvalidatesWhenANewArchetypeAppears()
    {
        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>()).Should().Be(5);

        _world.AddComponent(_positioned[0], new EcsTestArmor(1.0f));

        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity>()).Should().Be(5);
        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestArmor>()).Should().Be(1);
        CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>()).Should().Be(5);
    }

    [Fact]
    public void QueryEntities_SupportsExcludedMasks()
    {
        var found = new List<Entity>();
        _world.QueryEntities<CollectEntities, List<Entity>>(
            ComponentType<EcsTestHealth>.Mask,
            ComponentType<EcsTestVelocity>.Mask,
            ref found);

        found.Should().BeEquivalentTo(_healthOnly);
        found.Should().NotContain(_velocityOnly);
    }

    [Fact]
    public void Query3_IsDeterministicAcrossEnumerations()
    {
        var first = new List<Entity>();
        foreach (Chunk3<EcsTestPosition, EcsTestVelocity, EcsTestHealth> chunk in
                 _world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>())
        {
            for (int i = 0; i < chunk.Length; i++)
            {
                first.Add(chunk.Entities[i]);
            }
        }

        var second = new List<Entity>();
        foreach (Chunk3<EcsTestPosition, EcsTestVelocity, EcsTestHealth> chunk in
                 _world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>())
        {
            for (int i = 0; i < chunk.Length; i++)
            {
                second.Add(chunk.Entities[i]);
            }
        }

        second.Should().Equal(first);
    }

    [Fact]
    public void CachedQueryEnumerationDoesNotAllocate()
    {
        var rows = 0;

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int iteration = 0; iteration < 1_000; iteration++)
                {
                    rows = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>());
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "cached query enumeration",
            [
                new EcsGatePhase(
                    "resolve",
                    () => _ = _world.QueryCache.Resolve(
                        ComponentType<EcsTestPosition>.Mask | ComponentType<EcsTestVelocity>.Mask | ComponentType<EcsTestHealth>.Mask,
                        ComponentMask.Empty,
                        _world.Archetypes)),
                new EcsGatePhase(
                    "enumerate-1",
                    () => _ = CountChunks(_world.Query<EcsTestPosition, EcsTestVelocity, EcsTestHealth>())),
            ]);

        rows.Should().Be(5);
        outcome.MeasuredWindows.Should().Be(EcsAllocationHarness.Windows);
    }

    private static int CountChunks<T1>(Query1<T1> query) where T1 : unmanaged
    {
        int rows = 0;
        foreach (Chunk1<T1> chunk in query)
        {
            rows += chunk.Length;
        }

        return rows;
    }

    private static int CountChunks<T1, T2>(Query2<T1, T2> query)
        where T1 : unmanaged
        where T2 : unmanaged
    {
        int rows = 0;
        foreach (Chunk2<T1, T2> chunk in query)
        {
            rows += chunk.Length;
        }

        return rows;
    }

    private static int CountChunks<T1, T2, T3>(Query3<T1, T2, T3> query)
        where T1 : unmanaged
        where T2 : unmanaged
        where T3 : unmanaged
    {
        int rows = 0;
        foreach (Chunk3<T1, T2, T3> chunk in query)
        {
            rows += chunk.Length;
        }

        return rows;
    }

    private static int CountChunks<T1, T2, T3, T4>(Query4<T1, T2, T3, T4> query)
        where T1 : unmanaged
        where T2 : unmanaged
        where T3 : unmanaged
        where T4 : unmanaged
    {
        int rows = 0;
        foreach (Chunk4<T1, T2, T3, T4> chunk in query)
        {
            rows += chunk.Length;
        }

        return rows;
    }
}
