namespace Axrone.Reactive.Tests;

public class SubjectTests
{
    private sealed class Recorder : IObserver<string>
    {
        private readonly object _gate = new();
        private readonly List<string> _values = new();
        private bool _completed;

        public void OnNext(string value)
        {
            lock (_gate)
            {
                _values.Add(value);
            }
        }

        public void OnError(Exception error) => throw new NotSupportedException();

        public void OnCompleted()
        {
            lock (_gate)
            {
                _completed = true;
            }
        }

        public string[] Values()
        {
            lock (_gate)
            {
                return _values.ToArray();
            }
        }

        public bool Completed()
        {
            lock (_gate)
            {
                return _completed;
            }
        }
    }

    [Fact]
    public void Broadcast_ReachesAllSubscribers()
    {
        using var subject = new Subject<string>();
        var first = new Recorder();
        var second = new Recorder();
        using var subA = subject.Subscribe(first);
        using var subB = subject.Subscribe(second);

        subject.OnNext("a");
        subject.OnNext("b");

        first.Values().Should().Equal("a", "b");
        second.Values().Should().Equal("a", "b");
    }

    [Fact]
    public void LateSubscriber_SeesOnlyFutureValues()
    {
        using var subject = new Subject<string>();
        var early = new Recorder();
        using var subA = subject.Subscribe(early);

        subject.OnNext("past");

        var late = new Recorder();
        using var subB = subject.Subscribe(late);
        subject.OnNext("future");

        early.Values().Should().Equal("past", "future");
        late.Values().Should().Equal("future");
    }

    [Fact]
    public void SlotCapacityFollowsSubscriberBoundWithoutCliff()
    {
        using var standard = new Subject<int>();
        standard.SlotCapacity.Should().Be(128);

        using var small = new Subject<int>(new SubjectOptions(maxObservers: 2));
        small.SlotCapacity.Should().Be(2);

        using var aboveOldCliff = new Subject<int>(new SubjectOptions(maxObservers: 16_385));
        aboveOldCliff.SlotCapacity.Should().Be(32_768);
    }

    [Fact]
    public void Dispose_CompletesSubscribers()
    {
        var subject = new Subject<string>();
        var recorder = new Recorder();
        using var sub = subject.Subscribe(recorder);

        subject.Dispose();

        recorder.Completed().Should().BeTrue();
    }
}
