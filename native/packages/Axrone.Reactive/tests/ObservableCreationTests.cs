namespace Axrone.Reactive.Tests;

using FluentAssertions;
using Xunit;

public sealed class ObservableCreationTests
{
    [Fact]
    public void CreationFactoriesProduceDeterministicSequences()
    {
        var observer = new TestObserver<int>();
        using (Observable.FromEnumerable([1, 2, 3]).Subscribe(observer))
        {
        }

        observer.Values.Should().Equal(1, 2, 3);
        observer.Completed.Should().BeTrue();

        var ranged = new TestObserver<int>();
        using (Observable.Range(4, 3).Subscribe(ranged))
        {
        }

        ranged.Values.Should().Equal(4, 5, 6);

        int factoryCalls = 0;
        IObservable<int> deferred = Observable.Defer(() =>
        {
            factoryCalls++;
            return Observable.Return(7);
        });
        var first = new TestObserver<int>();
        var second = new TestObserver<int>();
        using (deferred.Subscribe(first))
        {
        }

        using (deferred.Subscribe(second))
        {
        }

        factoryCalls.Should().Be(2);
        first.Values.Should().Equal(7);
        second.Values.Should().Equal(7);
    }

    [Fact]
    public void FromEventHonorsDisposeAndWeakReference()
    {
        Action<int>? handler = null;
        int unsubscribed = 0;
        IObservable<int> source = Observable.FromEvent<int>(
            callback => handler = callback,
            _ => unsubscribed++,
            weakReference: true);
        var observer = new TestObserver<int>();
        IDisposable subscription = source.Subscribe(observer);
        handler!.Invoke(5);
        observer.Values.Should().Equal(5);
        subscription.Dispose();
        unsubscribed.Should().Be(1);
    }

    [Fact]
    public void TimerAndIntervalValidateAndFire()
    {
        var time = new ManualTimeProvider();
        var observer = new TestObserver<long>();
        using (Observable.Timer(TimeSpan.FromMilliseconds(10), null, time).Subscribe(observer))
        {
            time.Advance(9);
            observer.Values.Should().BeEmpty();
            time.Advance(1);
        }

        observer.Values.Should().Equal(0);
        observer.Completed.Should().BeTrue();

        FluentActions.Invoking(() => Observable.Interval(TimeSpan.Zero)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => Observable.Timer(TimeSpan.FromMilliseconds(-1))).Should().Throw<ArgumentOutOfRangeException>();
        IObservable<long> interval = Observable.Interval(TimeSpan.FromMilliseconds(10), time);
        using IDisposable intervalSubscription = interval.Subscribe(new TestObserver<long>());
    }

    [Fact]
    public void StartWithConcatAndZipComposeSequences()
    {
        var start = new TestObserver<int>();
        using (Observable.Range(1, 2).StartWith(0).Subscribe(start))
        {
        }

        start.Values.Should().Equal(0, 1, 2);

        var concatenated = new TestObserver<int>();
        using (Observable.Return(1).Concat(Observable.Return(2)).Subscribe(concatenated))
        {
        }

        concatenated.Values.Should().Equal(1, 2);

        var zipped = new TestObserver<string>();
        using (Observable.Return(3).Zip(Observable.Return("x"), (number, text) => $"{text}{number}").Subscribe(zipped))
        {
        }

        zipped.Values.Should().Equal("x3");
        zipped.Completed.Should().BeTrue();
    }

}

public sealed class ObservableSequenceOperatorTests
{
    [Fact]
    public void TakeSkipFirstAndLastFollowCountSemantics()
    {
        var take = new TestObserver<int>();
        using (Observable.Range(0, 5).Take(2).Subscribe(take))
        {
        }

        take.Values.Should().Equal(0, 1);
        take.Completed.Should().BeTrue();

        var skip = new TestObserver<int>();
        using (Observable.Range(0, 4).Skip(2).Subscribe(skip))
        {
        }

        skip.Values.Should().Equal(2, 3);

        var first = new TestObserver<int>();
        using (Observable.Range(3, 2).First().Subscribe(first))
        {
        }

        first.Values.Should().Equal(3);
        first.Completed.Should().BeTrue();

        var last = new TestObserver<int>();
        using (Observable.Range(3, 2).Last().Subscribe(last))
        {
        }

        last.Values.Should().Equal(4);
        last.Completed.Should().BeTrue();

        var emptyFirst = new TestObserver<int>();
        using (Observable.Empty<int>().First().Subscribe(emptyFirst))
        {
        }

        emptyFirst.Error.Should().BeOfType<InvalidOperationException>();
        var emptyLast = new TestObserver<int>();
        using (Observable.Empty<int>().Last().Subscribe(emptyLast))
        {
        }

        emptyLast.Error.Should().BeOfType<InvalidOperationException>();
    }

    [Fact]
    public void BufferWindowAndGroupByProduceOrderedBatches()
    {
        var buffered = new TestObserver<int[]>();
        using (Observable.Range(0, 5).Buffer(2).Subscribe(buffered))
        {
        }

        buffered.Values.Should().HaveCount(3);
        buffered.Values[0].Should().Equal(0, 1);
        buffered.Values[1].Should().Equal(2, 3);
        buffered.Values[2].Should().Equal(4);

        var windows = new List<List<int>>();
        var windowObserver = new WindowObserver(windows);
        using (Observable.Range(1, 3).Window(2).Subscribe(windowObserver))
        {
        }

        windows.Should().HaveCount(2);
        windows[0].Should().Equal(1, 2);
        windows[1].Should().Equal(3);

        var groups = new Dictionary<int, List<string>>();
        var groupObserver = new GroupObserver(groups);
        using (Observable.FromEnumerable(["a", "bb", "c"]).GroupBy(value => value.Length).Subscribe(groupObserver))
        {
        }

        groups[1].Should().Equal("a", "c");
        groups[2].Should().Equal("bb");
    }

    [Fact]
    public void OperatorsRejectInvalidArguments()
    {
        FluentActions.Invoking(() => Observable.Return(1).Take(-1)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => Observable.Return(1).Skip(-1)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => Observable.Return(1).Buffer(0)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => Observable.Return(1).Window(0)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => Observable.Return(1).GroupBy<int, int>(null!)).Should().Throw<ArgumentNullException>();
    }

    private sealed class WindowObserver : IObserver<IObservable<int>>
    {
        private readonly List<List<int>> _windows;

        public WindowObserver(List<List<int>> windows) => _windows = windows;

        public void OnNext(IObservable<int> value)
        {
            var values = new List<int>();
            _windows.Add(values);
            value.Subscribe(new ValueObserver(values));
        }

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }

    private sealed class ValueObserver : IObserver<int>
    {
        private readonly List<int> _values;

        public ValueObserver(List<int> values) => _values = values;

        public void OnNext(int value) => _values.Add(value);

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }

    private sealed class GroupObserver : IObserver<IObservableGroup<int, string>>
    {
        private readonly Dictionary<int, List<string>> _groups;

        public GroupObserver(Dictionary<int, List<string>> groups) => _groups = groups;

        public void OnNext(IObservableGroup<int, string> value)
        {
            var values = new List<string>();
            _groups[value.Key] = values;
            value.Subscribe(new StringObserver(values));
        }

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }

    private sealed class StringObserver : IObserver<string>
    {
        private readonly List<string> _values;

        public StringObserver(List<string> values) => _values = values;

        public void OnNext(string value) => _values.Add(value);

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }
}
