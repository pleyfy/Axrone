namespace Axrone.Reactive.Ecs.Tests;

using Axrone.Ecs;
using Axrone.Reactive;
using FluentAssertions;
using Xunit;

public sealed class EcsObservablesTests
{
    [Fact]
    public void FiltersLifecycleByNameTagAndLayer()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        var names = new Dictionary<Entity, string>();
        var tags = new Dictionary<Entity, string>();
        var layers = new Dictionary<Entity, int>();
        using var observables = new EcsObservables(
            bridge,
            (_, entity) => names.TryGetValue(entity, out string? name) ? name : null,
            (_, entity) => tags.TryGetValue(entity, out string? tag) ? tag : null,
            (_, entity) => layers.TryGetValue(entity, out int layer) ? layer : -1);

        var byName = new RecordingObserver<EntityLifecycleEvent>();
        var byTag = new RecordingObserver<EntityLifecycleEvent>();
        var byLayer = new RecordingObserver<EntityLifecycleEvent>();
        using var nameSubscription = observables.ByName("hero").Subscribe(byName);
        using var tagSubscription = observables.ByTag("enemy").Subscribe(byTag);
        using var layerSubscription = observables.ByLayer(2).Subscribe(byLayer);

        Entity hero = world.BeginEntity().With(new BridgePosition(1, 2)).Commit();
        Entity enemy = world.BeginEntity().With(new BridgePosition(3, 4)).Commit();
        names[hero] = "hero";
        names[enemy] = "enemy";
        tags[enemy] = "enemy";
        layers[enemy] = 2;
        bridge.Poll();

        byName.Values.Should().ContainSingle();
        byName.Values[0].Entity.Should().Be(hero);
        byTag.Values.Should().ContainSingle();
        byTag.Values[0].Entity.Should().Be(enemy);
        byLayer.Values.Should().ContainSingle();
        byLayer.Values[0].Entity.Should().Be(enemy);

        world.DestroyEntity(hero);
        world.DestroyEntity(enemy);
        bridge.Poll();
        byName.Values.Should().HaveCount(2);
        byName.Values[1].Kind.Should().Be(EntityLifecycleKind.Destroyed);
        byTag.Values.Should().HaveCount(2);
        byLayer.Values.Should().HaveCount(2);
    }

    [Fact]
    public void QueryObservableIsSharedAndRefreshesOnPoll()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().With(new BridgePosition(1, 0)).Commit();
        _ = world.BeginEntity().With(new BridgePosition(2, 0)).Commit();
        using var bridge = new EcsReactiveBridge(world);
        using var observables = new EcsObservables(bridge);

        BehaviorSubject<Entity[]> query = observables.GetQueryObservable<BridgePosition>("positions");
        query.Value.Should().HaveCount(2);
        observables.GetQueryObservable<BridgePosition>("positions").Should().BeSameAs(query);
        var observer = new RecordingObserver<Entity[]>();
        using var subscription = query.Subscribe(observer);
        observer.Values.Should().ContainSingle();
        observer.Values[0].Should().HaveCount(2);

        _ = world.BeginEntity().With(new BridgePosition(3, 0)).Commit();
        bridge.Poll();

        query.Value.Should().HaveCount(3);
        observer.Values.Should().HaveCount(2);
        observer.Values[1].Should().HaveCount(3);
    }

    [Fact]
    public void QueryObservableSupportsCustomQueriesAndDispose()
    {
        using var world = new World(workerCount: 1);
        Entity entity = world.BeginEntity().Commit();
        using var bridge = new EcsReactiveBridge(world);
        using var observables = new EcsObservables(bridge);
        BehaviorSubject<Entity[]> query = observables.GetQueryObservable("custom", _ => [entity]);
        query.Value.Should().HaveCount(1);
        observables.RefreshQueries();
        query.Value.Should().HaveCount(1);
        observables.Dispose();
        FluentActions.Invoking(() => observables.GetQueryObservable("after", _ => [])).Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void FilteredFormsRequireSelectors()
    {
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        using var observables = new EcsObservables(bridge);
        FluentActions.Invoking(() => observables.ByName("x")).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => observables.ByTag("x")).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => observables.ByLayer(1)).Should().Throw<InvalidOperationException>();
    }
}
