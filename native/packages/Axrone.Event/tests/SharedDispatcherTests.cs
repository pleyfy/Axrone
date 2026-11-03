namespace Axrone.Event.Tests;

using Axrone.Event.Internal;
using FluentAssertions;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class DispatcherCollectionDefinition
{
    public const string Name = "Event.Dispatcher";

    private DispatcherCollectionDefinition()
    {
    }
}

[Collection(DispatcherCollectionDefinition.Name)]
public sealed class SharedDispatcherTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    private readonly struct T01 { }
    private readonly struct T02 { }
    private readonly struct T03 { }
    private readonly struct T04 { }
    private readonly struct T05 { }
    private readonly struct T06 { }
    private readonly struct T07 { }
    private readonly struct T08 { }
    private readonly struct T09 { }
    private readonly struct T10 { }
    private readonly struct T11 { }
    private readonly struct T12 { }
    private readonly struct T13 { }
    private readonly struct T14 { }
    private readonly struct T15 { }
    private readonly struct T16 { }
    private readonly struct T17 { }
    private readonly struct T18 { }
    private readonly struct T19 { }
    private readonly struct T20 { }
    private readonly struct T21 { }
    private readonly struct T22 { }
    private readonly struct T23 { }
    private readonly struct T24 { }
    private readonly struct T25 { }
    private readonly struct T26 { }
    private readonly struct T27 { }
    private readonly struct T28 { }
    private readonly struct T29 { }
    private readonly struct T30 { }
    private readonly struct T31 { }
    private readonly struct T32 { }
    private readonly struct T33 { }
    private readonly struct T34 { }
    private readonly struct T35 { }
    private readonly struct T36 { }
    private readonly struct T37 { }
    private readonly struct T38 { }
    private readonly struct T39 { }
    private readonly struct T40 { }
    private readonly struct T41 { }
    private readonly struct T42 { }
    private readonly struct T43 { }
    private readonly struct T44 { }
    private readonly struct T45 { }
    private readonly struct T46 { }
    private readonly struct T47 { }
    private readonly struct T48 { }
    private readonly struct T49 { }
    private readonly struct T50 { }

    [Fact]
    public void BusWithFiftyEventTypes_UsesOneDispatcherAndNoPerRouterThread()
    {
        int before = Process.GetCurrentProcess().Threads.Count;

        using var bus = new EventBus(new RouterOptionsBuilder().WithCapacity(64).Build());
        _ = bus.Router<T01>();
        _ = bus.Router<T02>();
        _ = bus.Router<T03>();
        _ = bus.Router<T04>();
        _ = bus.Router<T05>();
        _ = bus.Router<T06>();
        _ = bus.Router<T07>();
        _ = bus.Router<T08>();
        _ = bus.Router<T09>();
        _ = bus.Router<T10>();
        _ = bus.Router<T11>();
        _ = bus.Router<T12>();
        _ = bus.Router<T13>();
        _ = bus.Router<T14>();
        _ = bus.Router<T15>();
        _ = bus.Router<T16>();
        _ = bus.Router<T17>();
        _ = bus.Router<T18>();
        _ = bus.Router<T19>();
        _ = bus.Router<T20>();
        _ = bus.Router<T21>();
        _ = bus.Router<T22>();
        _ = bus.Router<T23>();
        _ = bus.Router<T24>();
        _ = bus.Router<T25>();
        _ = bus.Router<T26>();
        _ = bus.Router<T27>();
        _ = bus.Router<T28>();
        _ = bus.Router<T29>();
        _ = bus.Router<T30>();
        _ = bus.Router<T31>();
        _ = bus.Router<T32>();
        _ = bus.Router<T33>();
        _ = bus.Router<T34>();
        _ = bus.Router<T35>();
        _ = bus.Router<T36>();
        _ = bus.Router<T37>();
        _ = bus.Router<T38>();
        _ = bus.Router<T39>();
        _ = bus.Router<T40>();
        _ = bus.Router<T41>();
        _ = bus.Router<T42>();
        _ = bus.Router<T43>();
        _ = bus.Router<T44>();
        _ = bus.Router<T45>();
        _ = bus.Router<T46>();
        _ = bus.Router<T47>();
        _ = bus.Router<T48>();
        _ = bus.Router<T49>();
        _ = bus.Router<T50>();

        int after = Process.GetCurrentProcess().Threads.Count;

        bus.Dispatcher.RegisteredRouterCount.Should().Be(50);
        bus.Dispatcher.WorkerStartCount.Should().Be(1, "the bus owns exactly one dispatch worker");
        bus.Router<T01>().Dispatcher.Should().BeSameAs(bus.Dispatcher);
        bus.Router<T50>().Dispatcher.Should().BeSameAs(bus.Dispatcher);
        bus.Router<T01>().Should().BeSameAs(bus.Router<T01>());

        // The old model paid one dedicated thread per event type; the shared model grows by at
        // most the one worker thread (plus unrelated runtime noise).
        (after - before).Should().BeLessThan(10, "fifty routers must not create fifty threads");
    }

    [Fact]
    public void StandaloneRouters_ShareTheStandaloneDispatcher()
    {
        int registeredBefore = EventDispatcher.Shared.RegisteredRouterCount;
        int startsBefore = EventDispatcher.Shared.WorkerStartCount;
        int threadsBefore = Process.GetCurrentProcess().Threads.Count;

        var routers = new EventRouter<int>[50];
        for (int i = 0; i < routers.Length; i++)
        {
            routers[i] = new EventRouter<int>(64);
        }

        int threadsAfter = Process.GetCurrentProcess().Threads.Count;

        for (int i = 0; i < routers.Length; i++)
        {
            routers[i].Dispatcher.Should().BeSameAs(EventDispatcher.Shared);
        }

        EventDispatcher.Shared.WorkerStartCount.Should().Be(startsBefore);
        EventDispatcher.Shared.RegisteredRouterCount.Should().Be(registeredBefore + routers.Length);
        (threadsAfter - threadsBefore).Should().BeLessThan(10, "standalone routers share one worker");

        foreach (EventRouter<int> router in routers)
        {
            router.Dispose();
        }

        EventDispatcher.Shared.RegisteredRouterCount.Should().Be(registeredBefore);
    }

    [Fact]
    public async Task HotRouter_DoesNotStarveColdRouter()
    {
        using var bus = new EventBus(65536);
        int hot = 0;
        int cold = 0;
        using var hotSubscription = bus.Subscribe<int>((_, _) => Interlocked.Increment(ref hot));
        using var coldSubscription = bus.Subscribe<string>((_, _) => Interlocked.Increment(ref cold));
        using var stop = new CancellationTokenSource();

        Task hammer = Task.Run(() =>
        {
            try
            {
                while (!stop.IsCancellationRequested)
                {
                    bus.Publish(1);
                }
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        });

        SpinWait.SpinUntil(() => Volatile.Read(ref hot) >= 5_000, Wait).Should().BeTrue("the hot queue must be saturated");

        for (int i = 0; i < 20; i++)
        {
            bus.Publish("cold");
            SpinWait.SpinUntil(() => Volatile.Read(ref cold) >= i + 1, TimeSpan.FromSeconds(2))
                .Should().BeTrue($"cold publication {i} must not be starved by the hot queue");
        }

        stop.Cancel();
        await hammer.WaitAsync(Wait);
    }

    [Fact]
    public void IncompleteAsyncHandler_BlocksOtherTypesOnTheSameBus()
    {
        using var bus = new EventBus(1024);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var entered = new ManualResetEventSlim(false);
        using var slow = bus.SubscribeAsync<int>(async (_, _) =>
        {
            entered.Set();
            await gate.Task.ConfigureAwait(false);
        });
        int cold = 0;
        using var coldSubscription = bus.Subscribe<string>((_, _) => Interlocked.Increment(ref cold));

        bus.Publish(1);
        entered.Wait(Wait).Should().BeTrue("the async handler must start before the cold publish");

        bus.Publish("cold");
        Thread.Sleep(250);
        Volatile.Read(ref cold).Should().Be(0, "the shared dispatcher is blocked by the incomplete handler");

        gate.SetResult();
        SpinWait.SpinUntil(() => Volatile.Read(ref cold) == 1, Wait).Should().BeTrue();
    }

    [Fact]
    public async Task MultiProducer_NoLostWakeups()
    {
        using var bus = new EventBus(65536);
        const int producers = 4;
        const int perProducer = 2_000;
        int received = 0;
        using var subscription = bus.Subscribe<int>((_, _) => Interlocked.Increment(ref received));

        Task[] workers = new Task[producers];
        for (int p = 0; p < producers; p++)
        {
            workers[p] = Task.Run(() =>
            {
                for (int i = 0; i < perProducer; i++)
                {
                    bus.Publish(i);
                }
            });
        }

        await Task.WhenAll(workers).WaitAsync(Wait);
        SpinWait.SpinUntil(() => Volatile.Read(ref received) == producers * perProducer, Wait)
            .Should().BeTrue("a signal racing the park must never be lost");
    }

    [Fact]
    public async Task DisposeWhilePublishing_IsDeterministicAndRaceFree()
    {
        for (int iteration = 0; iteration < 25; iteration++)
        {
            var bus = new EventBus(1024);
            using var stop = new CancellationTokenSource();
            Task publisher = Task.Run(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    try
                    {
                        bus.Publish(1);
                    }
                    catch (ObjectDisposedException)
                    {
                        return;
                    }
                    catch (InvalidOperationException)
                    {
                        return;
                    }
                }
            });

            Thread.Sleep(1);
            var watch = Stopwatch.StartNew();
            bus.Dispose();
            bus.Dispose();
            watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5), "disposal must not deadlock or race the wake signal");

            stop.Cancel();
            await publisher.WaitAsync(Wait);
        }
    }
}
