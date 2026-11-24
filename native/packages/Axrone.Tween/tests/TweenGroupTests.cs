namespace Axrone.Tween.Tests;

public sealed class TweenGroupTests
{
    private static (TweenEngine Engine, ManualTweenClock Clock) Create()
    {
        var clock = new ManualTweenClock();
        return (new TweenEngine(16, clock), clock);
    }

    private static TweenSpec Quick() =>
        new TweenBuilder().From(0f).To(1f).DurationSeconds(1f).Build();

    private static void Step((TweenEngine Engine, ManualTweenClock Clock) ctx, float seconds)
    {
        ctx.Clock.Advance(DurationNs.FromSeconds(seconds));
        ctx.Engine.Update();
    }

    [Fact]
    public void Play_AddsMemberAndKeepsMembershipAfterItSettles()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle handle = group.Play(Quick());

        group.Count.Should().Be(1);
        group.Contains(handle.Id).Should().BeTrue();

        Step(ctx, 1f);

        engine.QueryState(handle.Id).Should().Be(TweenState.Inactive, "a settled tween frees its slot");
        group.Count.Should().Be(1, "membership outlives the slot so the member stays replayable");
        group.Contains(handle.Id).Should().BeTrue();
    }

    [Fact]
    public void Stop_CancelsEveryLiveMemberAndClearsPauseBookkeeping()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle first = group.Play(Quick());
        TweenHandle second = group.Play(Quick());

        group.Pause();
        group.Stop();

        engine.QueryState(first.Id).Should().Be(TweenState.Inactive, "a cancelled tween releases its slot");
        engine.QueryState(second.Id).Should().Be(TweenState.Inactive);
        engine.ActiveCount.Should().Be(0);
        group.Count.Should().Be(2);

        group.Resume();
        engine.QueryState(first.Id).Should().Be(TweenState.Inactive, "a stopped member has nothing to resume");
    }

    [Fact]
    public void Start_ReplaysRetiredMembersFromTheirSpec()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle handle = group.Play(Quick());
        Step(ctx, 1f);
        engine.ActiveCount.Should().Be(0);

        group.Start();

        group.Count.Should().Be(1);
        engine.ActiveCount.Should().Be(1, "the retired member is re-scheduled from its stored spec");
        Step(ctx, 0.5f);
        engine.QueryState(handle.Id).Should().Be(TweenState.Inactive, "the stale identity stays stale after a replay");
    }

    [Fact]
    public void Start_SeeksLiveMembersToTheRequestedPosition()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle handle = group.Play(Quick());
        Step(ctx, 0.75f);

        group.Start(DurationNs.Zero);
        Step(ctx, 0.25f);

        engine.QueryState(handle.Id).Should().Be(TweenState.Playing, "rewinding to zero leaves half the tween still to run");
    }

    [Fact]
    public void Resume_ReopensOnlyTheMembersTheGroupPaused()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle mine = group.Play(Quick());
        TweenHandle theirs = group.Play(Quick());

        engine.Pause(theirs.Id);
        group.Pause();
        group.Resume();

        engine.QueryState(mine.Id).Should().Be(TweenState.Playing);
        engine.QueryState(theirs.Id).Should().Be(TweenState.Paused, "a caller-owned pause must survive a group resume");
    }

    [Fact]
    public void Pause_TwiceIsIdempotentAndResumesOnce()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);
        TweenHandle handle = group.Play(Quick());

        group.Pause();
        group.Pause();
        group.Resume();

        engine.QueryState(handle.Id).Should().Be(TweenState.Playing);
    }

    [Fact]
    public void Add_RejectsForeignHandlesAndDuplicateMembers()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var other = Create().Engine;
        using var group = new TweenGroup(engine);

        using (var foreignGroup = new TweenGroup(other))
        {
            TweenHandle foreign = foreignGroup.Play(Quick());
            group.Add(foreign).Should().BeFalse("a handle from another engine has no slot here");
        }

        TweenHandle local = engine.Play(Quick());
        group.Add(local).Should().BeTrue();
        group.Add(local).Should().BeFalse("the member is already held");
        group.Count.Should().Be(1);
    }

    [Fact]
    public void Remove_DropsMembershipWithoutCancellingTheTween()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        TweenHandle handle = group.Play(Quick());

        group.Remove(handle.Id).Should().BeTrue();
        group.Remove(handle.Id).Should().BeFalse();
        group.Count.Should().Be(0);
        engine.QueryState(handle.Id).Should().Be(TweenState.Playing);

        group.Stop();
        engine.QueryState(handle.Id).Should().Be(TweenState.Playing, "a removed member is no longer the group's to stop");
    }

    [Fact]
    public void Clear_DropsMembersAndStartPlaysNothing()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine);

        group.Play(Quick());
        group.Stop();
        group.Clear();

        group.Count.Should().Be(0);
        group.Start();
        engine.ActiveCount.Should().Be(0);
    }

    [Fact]
    public void MembershipGrowsPastItsInitialCapacity()
    {
        var ctx = Create();
        using var engine = ctx.Engine;
        using var group = new TweenGroup(engine, capacity: 1);

        for (int i = 0; i < 12; i++)
        {
            group.Play(Quick());
        }

        group.Count.Should().Be(12);
        group.Pause();
        group.Resume();
        engine.ActiveCount.Should().Be(12);
    }

    [Fact]
    public void Constructor_RejectsNullEngineAndEmptyCapacity()
    {
        var ctx = Create();
        using var engine = ctx.Engine;

        Action nullCtor = () => _ = new TweenGroup(null!);
        nullCtor.Should().Throw<ArgumentNullException>();

        Action smallCtor = () => _ = new TweenGroup(engine, 0);
        smallCtor.Should().Throw<ArgumentOutOfRangeException>();
    }
}
