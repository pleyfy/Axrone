namespace Axrone.Ecs.Tests;

public sealed class EcsQueryCacheAllocationTests : IDisposable
{
    private const int ResolvesPerWindow = 2_000;

    private readonly World _world;
    private readonly Entity _positionOnly;
    private readonly Entity _both;

    public EcsQueryCacheAllocationTests()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        _world = new World();
        _positionOnly = _world.BeginEntity().With(new EcsTestPosition(1.0f, 2.0f)).Commit();
        _both = _world.BeginEntity()
            .With(new EcsTestPosition(3.0f, 4.0f))
            .With(new EcsTestVelocity(5.0f))
            .Commit();
        _world.Step();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Distinct_Mask_Pairs_Resolve_To_Their_Own_Archetypes()
    {
        int[] positionOnly = _world.QueryCache.Resolve(
            ComponentType<EcsTestPosition>.Mask, ComponentMask.Empty, _world.Archetypes);
        int[] excludeVelocity = _world.QueryCache.Resolve(
            ComponentType<EcsTestPosition>.Mask, ComponentType<EcsTestVelocity>.Mask, _world.Archetypes);
        int[] both = _world.QueryCache.Resolve(
            ComponentType<EcsTestPosition>.Mask | ComponentType<EcsTestVelocity>.Mask,
            ComponentMask.Empty,
            _world.Archetypes);

        positionOnly.Length.Should().Be(2);
        excludeVelocity.Length.Should().BeGreaterThanOrEqualTo(1);
        both.Length.Should().BeGreaterThanOrEqualTo(1);

        int counted = 0;
        foreach (int archetypeIndex in excludeVelocity)
        {
            Archetype archetype = _world.Archetypes.GetArchetype(new ArchetypeId(archetypeIndex));
            archetype.Mask.ContainsAll(ComponentType<EcsTestPosition>.Mask).Should().BeTrue();
            archetype.Mask.ContainsAny(ComponentType<EcsTestVelocity>.Mask).Should().BeFalse();
            counted += archetype.Count;
        }

        counted.Should().Be(1);
        _world.HasComponent<EcsTestVelocity>(_both).Should().BeTrue();
        _world.HasComponent<EcsTestVelocity>(_positionOnly).Should().BeFalse();
    }

    [Fact]
    public void RepeatResolve_SameKey_DoesNotAllocate()
    {
        ComponentMask all = ComponentType<EcsTestPosition>.Mask;
        ComponentMask none = ComponentType<EcsTestVelocity>.Mask;

        EcsGatePhase[] phases =
        [
            new EcsGatePhase(
                "resolve-one",
                () => _ = _world.QueryCache.Resolve(all, none, _world.Archetypes)),
        ];

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < ResolvesPerWindow; i++)
                {
                    _ = _world.QueryCache.Resolve(all, none, _world.Archetypes);
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "query cache resolve",
            phases);

        // The gate is only meaningful while the cached table still answers this mask pair.
        int[] matches = _world.QueryCache.Resolve(all, none, _world.Archetypes);
        matches.Length.Should().Be(1);
        outcome.MeasuredWindows.Should().Be(EcsAllocationHarness.Windows);
        Console.WriteLine(
            $"query cache resolve: {outcome.TotalInvocations} x {ResolvesPerWindow} hits, each gated window 0 B");
    }
}
