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
        var names = new Dictionary<Entity, string>();
        var tags = new Dictionary<Entity, string>();
        var layers = new Dictionary<Entity, int>();
        using var bridge = new EcsReactiveBridge(
            world,
            (_, entity) => names.TryGetValue(entity, out string? name) ? name : null,
            (_, entity) => tags.TryGetValue(entity, out string? tag) ? tag : null,
            (_, entity) => layers.TryGetValue(entity, out int layer) ? layer : -1);

        var byName = new RecordingObserver<EntityLifecycleEvent>();
        var byTag = new RecordingObserver<EntityLifecycleEvent>();
        var byLayer = new RecordingObserver<EntityLifecycleEvent>();
        using var nameSubscription = bridge.Observables.ByName("hero").Subscribe(byName);
        using var tagSubscription = bridge.Observables.ByTag("enemy").Subscribe(byTag);
        using var layerSubscription = bridge.Observables.ByLayer(2).Subscribe(byLayer);

        Entity hero = world.BeginEntity().With(new BridgePosition(1, 2)).Commit();
        Entity enemy = world.BeginEntity().With(new BridgePosition(3, 4)).Commit();
        names[hero] = "hero";
        names[enemy] = "enemy";
        tags[enemy] = "enemy";
        layers[enemy] = 2;
        bridge.Pump();

        byName.Values.Should().ContainSingle();
        byName.Values[0].Entity.Should().Be(hero);
        byTag.Values.Should().ContainSingle();
        byTag.Values[0].Entity.Should().Be(enemy);
        byLayer.Values.Should().ContainSingle();
        byLayer.Values[0].Entity.Should().Be(enemy);

        world.DestroyEntity(hero);
        world.DestroyEntity(enemy);
        bridge.Pump();
        byName.Values.Should().HaveCount(2);
        byName.Values[1].Kind.Should().Be(EntityLifecycleKind.Destroyed);
        byTag.Values.Should().HaveCount(2);
        byLayer.Values.Should().HaveCount(2);
    }

    [Fact]
    public void QueryObservableIsSharedAndRefreshesOnPump()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().With(new BridgePosition(1, 0)).Commit();
        _ = world.BeginEntity().With(new BridgePosition(2, 0)).Commit();
        using var bridge = new EcsReactiveBridge(world);

        BehaviorSubject<Entity[]> query = bridge.Observables.GetQueryObservable<BridgePosition>("positions");
        query.Value.Should().HaveCount(2);
        bridge.Observables.GetQueryObservable<BridgePosition>("positions").Should().BeSameAs(query);
        var observer = new RecordingObserver<Entity[]>();
        using var subscription = query.Subscribe(observer);
        observer.Values.Should().ContainSingle();
        observer.Values[0].Should().HaveCount(2);

        _ = world.BeginEntity().With(new BridgePosition(3, 0)).Commit();
        bridge.Pump();

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
        BehaviorSubject<Entity[]> query = bridge.Observables.GetQueryObservable("custom", _ => [entity]);
        query.Value.Should().HaveCount(1);
        bridge.Observables.RefreshQueries();
        query.Value.Should().HaveCount(1);
        bridge.Dispose();
        query.IsTerminated.Should().BeTrue();
        FluentActions.Invoking(() => bridge.Observables.GetQueryObservable("after", _ => [])).Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void FilteredFormsRequireSelectors()
    {
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        FluentActions.Invoking(() => bridge.Observables.ByName("x")).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => bridge.Observables.ByTag("x")).Should().Throw<InvalidOperationException>();
        FluentActions.Invoking(() => bridge.Observables.ByLayer(1)).Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void QueriesRefreshInRegistrationOrder()
    {
        ComponentRegistry.Register<BridgePosition>();
        ComponentRegistry.Register<BridgeVelocity>();
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().With(new BridgePosition(1, 0)).With(new BridgeVelocity(1)).Commit();
        using var bridge = new EcsReactiveBridge(world);
        var order = new List<string>();
        BehaviorSubject<Entity[]> firstQuery = bridge.Observables.GetQueryObservable<BridgePosition>("positions");
        BehaviorSubject<Entity[]> secondQuery = bridge.Observables.GetQueryObservable<BridgeVelocity>("velocities");
        using var firstSubscription = firstQuery.Subscribe(new CallbackObserver<Entity[]>(_ => order.Add("first")));
        using var secondSubscription = secondQuery.Subscribe(new CallbackObserver<Entity[]>(_ => order.Add("second")));
        order.Clear();

        _ = world.BeginEntity().With(new BridgePosition(2, 0)).With(new BridgeVelocity(2)).Commit();
        bridge.Pump();

        order.Should().Equal("first", "second");
    }

    [Fact]
    public void QueryPublishesOnlyWhenTheResultChanges()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().With(new BridgePosition(1, 0)).Commit();
        using var bridge = new EcsReactiveBridge(world);
        BehaviorSubject<Entity[]> query = bridge.Observables.GetQueryObservable<BridgePosition>("positions");
        var observer = new RecordingObserver<Entity[]>();
        using var subscription = query.Subscribe(observer);
        observer.Values.Should().ContainSingle();

        bridge.Pump();
        bridge.Pump();
        observer.Values.Should().ContainSingle();

        _ = world.BeginEntity().With(new BridgePosition(2, 0)).Commit();
        bridge.Pump();
        observer.Values.Should().HaveCount(2);
        observer.Values[1].Should().HaveCount(2);
    }

    private sealed class CallbackObserver<T> : IObserver<T>
    {
        private readonly Action<T> _onNext;

        public CallbackObserver(Action<T> onNext) => _onNext = onNext;

        public void OnNext(T value) => _onNext(value);

        public void OnError(Exception error) => throw error;

        public void OnCompleted()
        {
        }
    }
}
