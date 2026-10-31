namespace Axrone.Ui.Input.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiInputRouterTests
{
    private const UiNodeFlags FocusableFlags = UiNodeFlags.Visible | UiNodeFlags.Interactive | UiNodeFlags.Enabled | UiNodeFlags.Focusable;
    private const UiNodeFlags InteractiveFlags = UiNodeFlags.Visible | UiNodeFlags.Interactive | UiNodeFlags.Enabled;

    private static UiPointerEvent Pointer(
        UiPointerPhase phase,
        float x = 5f,
        float y = 5f,
        int pointerId = 0,
        UiNodeId target = default) =>
        new(target, phase, new Vec2(x, y), Vec2.Zero, pointerId, 0, UiPointerButtons.Left, UiKeyModifiers.None, 0);

    private static UiKeyEvent Key(ushort code = 65) =>
        new(UiNodeId.Invalid, UiKeyPhase.Down, code, false, UiKeyModifiers.None, 0);

    private static UiTextInputEvent Text(string value, bool composing) =>
        new(UiNodeId.Invalid, value, composing, null);

    private static Harness Build(bool focusable = true, bool withComposition = false)
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId button = tree.Add(panel, UiNodeKind.Button, focusable ? FocusableFlags : InteractiveFlags);
        var index = new UiHitTestIndex();
        index.Insert(button, new Aabb2D(0f, 0f, 100f, 100f), zIndex: 0, clips: false);
        var harness = new Harness(tree, panel, button, index, withComposition);
        harness.Attach(tree.Root);
        harness.Attach(panel);
        harness.Attach(button);
        return harness;
    }

    [Fact]
    public void PointerDownRoutesTunnelThenTargetThenBubble()
    {
        Harness harness = Build();

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Down));

        result.Handled.Should().BeFalse();
        result.Target.Should().Be(harness.Button);
        harness.Log.PointerOrder().Should().Equal(
            $"{harness.Tree.Root.Value}|Tunnel|Down",
            $"{harness.Panel.Value}|Tunnel|Down",
            $"{harness.Button.Value}|Target|Down",
            $"{harness.Panel.Value}|Bubble|Down",
            $"{harness.Tree.Root.Value}|Bubble|Down");
    }

    [Fact]
    public void TunnelReceiverConsumesBeforeTargetAndStopsBubble()
    {
        Harness harness = Build();
        harness.Receivers.Resolve(harness.Panel)!.ConsumePointerPhase = UiRoutingPhase.Tunnel;

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Down));

        result.Handled.Should().BeTrue();
        result.Phase.Should().Be(UiRoutingPhase.Tunnel);
        harness.Log.PointerOrder().Should().Equal(
            $"{harness.Tree.Root.Value}|Tunnel|Down",
            $"{harness.Panel.Value}|Tunnel|Down");
    }

    [Fact]
    public void TargetReceiverConsumesAndSkipsBubble()
    {
        Harness harness = Build();
        harness.Receivers.Resolve(harness.Button)!.ConsumePointerPhase = UiRoutingPhase.Target;

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Down));

        result.Handled.Should().BeTrue();
        result.Phase.Should().Be(UiRoutingPhase.Target);
        harness.Log.PointerOrder().Should().HaveCount(3);
    }

    [Fact]
    public void BubbleReceiverConsumesAfterTarget()
    {
        Harness harness = Build();
        harness.Receivers.Resolve(harness.Panel)!.ConsumePointerPhase = UiRoutingPhase.Bubble;

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Down));

        result.Handled.Should().BeTrue();
        result.Phase.Should().Be(UiRoutingPhase.Bubble);
        harness.Log.PointerOrder().Should().Equal(
            $"{harness.Tree.Root.Value}|Tunnel|Down",
            $"{harness.Panel.Value}|Tunnel|Down",
            $"{harness.Button.Value}|Target|Down",
            $"{harness.Panel.Value}|Bubble|Down");
    }

    [Fact]
    public void PointerDownFocusesAndCapturesTopmostNode()
    {
        Harness harness = Build();
        UiNodeId overlay = harness.Tree.Add(harness.Panel, UiNodeKind.Button, FocusableFlags);
        harness.Index.Insert(overlay, new Aabb2D(0f, 0f, 50f, 50f), zIndex: 5, clips: false);
        harness.Attach(overlay);

        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));

        harness.Focus.Focused.Should().Be(overlay);
        harness.Capture.GetCaptured(0).Should().Be(overlay);
    }

    [Fact]
    public void PointerMoveFollowsCaptureOutsideItsBounds()
    {
        Harness harness = Build();
        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));
        harness.Log.Clear();

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Move, 900f, 900f));

        result.Target.Should().Be(harness.Button);
        harness.Log.PointerOrder().Should().Contain($"{harness.Button.Value}|Target|Move");
    }

    [Fact]
    public void PointerUpReleasesCaptureAndKeepsFocus()
    {
        Harness harness = Build();
        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Up, 10f, 10f));

        result.Handled.Should().BeFalse();
        harness.Capture.GetCaptured(0).Should().Be(UiNodeId.Invalid);
        harness.Focus.Focused.Should().Be(harness.Button);
    }

    [Fact]
    public void PointerDownOnNonFocusableNodeDoesNotMoveFocus()
    {
        Harness harness = Build(focusable: false);

        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));

        harness.Focus.Focused.Should().Be(UiNodeId.Invalid);
        harness.Capture.GetCaptured(0).Should().Be(harness.Button);
    }

    [Fact]
    public void PointerCancelReleasesCaptureAndReportsCanceled()
    {
        Harness harness = Build();
        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Cancel, 10f, 10f));

        result.Canceled.Should().BeTrue();
        harness.Capture.GetCaptured(0).Should().Be(UiNodeId.Invalid);
    }

    [Fact]
    public void PointerMoveAcrossSubtreesEmitsLeaveThenEnter()
    {
        var tree = new TestTree();
        UiNodeId panelA = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId a = tree.Add(panelA, UiNodeKind.Button, FocusableFlags);
        UiNodeId panelB = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId b = tree.Add(panelB, UiNodeKind.Button, FocusableFlags);
        var index = new UiHitTestIndex();
        index.Insert(a, new Aabb2D(0f, 0f, 40f, 40f), zIndex: 0, clips: false);
        index.Insert(b, new Aabb2D(60f, 60f, 100f, 100f), zIndex: 0, clips: false);
        var harness = new Harness(tree, panelA, a, index, withComposition: false);
        foreach (UiNodeId node in new[] { tree.Root, panelA, a, panelB, b })
        {
            harness.Attach(node);
        }

        harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
        harness.Log.Clear();

        harness.Router.Route(Pointer(UiPointerPhase.Move, 70f, 70f));

        harness.Log.PointerOrder().Take(4).Should().Equal(
            $"{a.Value}|Target|Leave",
            $"{panelA.Value}|Target|Leave",
            $"{panelB.Value}|Target|Enter",
            $"{b.Value}|Target|Enter");
    }

    [Fact]
    public void PointerMoveWithinSameNodeEmitsNoBoundaryEvents()
    {
        Harness harness = Build();
        harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
        harness.Log.Clear();

        harness.Router.Route(Pointer(UiPointerPhase.Move, 20f, 20f));

        harness.Log.Entries.Should().NotContain(call =>
            call.PointerPhase == UiPointerPhase.Enter || call.PointerPhase == UiPointerPhase.Leave);
    }

    [Fact]
    public void PointerMoveOffEveryNodeLeavesWholeChain()
    {
        Harness harness = Build();
        harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
        harness.Log.Clear();

        UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Move, 900f, 900f));

        result.Handled.Should().BeFalse();
        result.Target.Should().Be(UiNodeId.Invalid);
        harness.Log.PointerOrder().Should().Equal(
            $"{harness.Button.Value}|Target|Leave",
            $"{harness.Panel.Value}|Target|Leave",
            $"{harness.Tree.Root.Value}|Target|Leave");
    }

    [Fact]
    public void KeyRoutesFromFocusedNodeThroughAncestors()
    {
        Harness harness = Build();
        harness.Focus.TryFocus(harness.Button, UiFocusReason.Api);

        UiInputDispatchResult result = harness.Router.Route(Key());

        result.Handled.Should().BeFalse();
        result.Target.Should().Be(harness.Button);
        harness.Log.KeyOrder().Should().Equal(
            $"{harness.Tree.Root.Value}|Tunnel",
            $"{harness.Panel.Value}|Tunnel",
            $"{harness.Button.Value}|Target",
            $"{harness.Panel.Value}|Bubble",
            $"{harness.Tree.Root.Value}|Bubble");
    }

    [Fact]
    public void KeyWithoutFocusIsUnhandled()
    {
        Harness harness = Build();

        UiInputDispatchResult result = harness.Router.Route(Key());

        result.Handled.Should().BeFalse();
        result.Target.Should().Be(UiNodeId.Invalid);
        harness.Log.Entries.Should().BeEmpty();
    }

    [Fact]
    public void KeyConsumedOnTunnelStopsPropagation()
    {
        Harness harness = Build();
        harness.Focus.TryFocus(harness.Button, UiFocusReason.Api);
        harness.Receivers.Resolve(harness.Panel)!.ConsumeKeyPhase = UiRoutingPhase.Tunnel;

        UiInputDispatchResult result = harness.Router.Route(Key());

        result.Handled.Should().BeTrue();
        result.Phase.Should().Be(UiRoutingPhase.Tunnel);
    }

    [Fact]
    public void TextRoutesToFocusedNodeAndDrivesComposition()
    {
        Harness harness = Build(withComposition: true);
        harness.Focus.TryFocus(harness.Button, UiFocusReason.Api);

        harness.Router.Route(Text("a", composing: true));
        harness.Router.Route(Text("ab", composing: true));
        harness.Router.Route(Text("ab", composing: false));

        harness.Sink!.Calls.Should().Equal(
            $"begin:{harness.Button.Value}",
            $"update:{harness.Button.Value}:a:1",
            $"update:{harness.Button.Value}:ab:2",
            $"commit:{harness.Button.Value}:ab");
        harness.Log.TextOrder().Should().HaveCount(15);
    }

    [Fact]
    public void TextWithoutFocusDoesNotCompose()
    {
        Harness harness = Build(withComposition: true);

        UiInputDispatchResult result = harness.Router.Route(Text("a", composing: true));

        result.Target.Should().Be(UiNodeId.Invalid);
        harness.Sink!.Calls.Should().BeEmpty();
    }

    [Fact]
    public void FocusChangeRoutesToItsTargetOnly()
    {
        Harness harness = Build();

        UiInputDispatchResult result = harness.Router.Route(new UiFocusChangeEvent(harness.Button, true, UiFocusReason.Api));

        result.Handled.Should().BeFalse();
        result.Target.Should().Be(harness.Button);
        harness.Log.Entries.Should().ContainSingle();
        harness.Log.Entries[0].Node.Should().Be(harness.Button);
    }

    [Fact]
    public void WindowBlurCancelsCompositionReleasesCaptureAndClearsFocus()
    {
        Harness harness = Build(withComposition: true);
        harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));
        harness.Router.Route(Text("x", composing: true));

        UiInputDispatchResult result = harness.Router.HandleWindowFocus(new UiWindowFocusEvent(false));

        result.Canceled.Should().BeTrue();
        harness.Focus.Focused.Should().Be(UiNodeId.Invalid);
        harness.Capture.CapturedCount.Should().Be(0);
        harness.Sink!.Calls.Should().Contain("cancel");
    }

    [Fact]
    public void WindowFocusGainIsIgnored()
    {
        Harness harness = Build();
        harness.Focus.TryFocus(harness.Button, UiFocusReason.Api);

        UiInputDispatchResult result = harness.Router.HandleWindowFocus(new UiWindowFocusEvent(true));

        result.Canceled.Should().BeFalse();
        harness.Focus.Focused.Should().Be(harness.Button);
    }

    [Fact]
    public void PointerDispatchDoesNotAllocateAfterWarmup()
    {
        Harness harness = Build();
        harness.DetachAll();
        for (int warmup = 0; warmup < 128; warmup++)
        {
            harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        UiNodeId last = UiNodeId.Invalid;
        for (int query = 0; query < 2000; query++)
        {
            UiInputDispatchResult result = harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
            last = result.Target;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        last.Should().Be(harness.Button);
    }

    [Fact]
    public void RoutingIsDeterministicAcrossRouters()
    {
        Harness first = Build(withComposition: true);
        Harness second = Build(withComposition: true);
        foreach (Harness harness in new[] { first, second })
        {
            harness.Focus.TryFocus(harness.Button, UiFocusReason.Api);
            harness.Router.Route(Pointer(UiPointerPhase.Move, 10f, 10f));
            harness.Router.Route(Pointer(UiPointerPhase.Down, 10f, 10f));
            harness.Router.Route(Key());
            harness.Router.Route(Text("k", composing: true));
            harness.Router.Route(Pointer(UiPointerPhase.Up, 10f, 10f));
        }

        string[] firstLines = first.Log.Lines();
        firstLines.Should().Equal(second.Log.Lines());
        first.Sink!.Calls.Should().Equal(second.Sink!.Calls);
    }
}

internal sealed class Harness
{
    public Harness(TestTree tree, UiNodeId panel, UiNodeId button, UiHitTestIndex index, bool withComposition)
    {
        Tree = tree;
        Panel = panel;
        Button = button;
        Index = index;
        Focus = new UiFocusManager(tree);
        Sink = withComposition ? new RecordingTextSink() : null;
        Composition = withComposition ? new UiTextComposition(Sink!) : null;
        Router = new UiInputRouter(
            new UiTreeRouteGraph(tree),
            index,
            Focus,
            Capture,
            Receivers,
            Composition);
    }

    public TestTree Tree { get; }

    public UiNodeId Panel { get; }

    public UiNodeId Button { get; }

    public UiHitTestIndex Index { get; }

    public CallLog Log { get; } = new();

    public TestReceiverResolver Receivers { get; } = new();

    public UiFocusManager Focus { get; }

    public UiPointerCapture Capture { get; } = new(4);

    public UiTextComposition? Composition { get; }

    public RecordingTextSink? Sink { get; }

    public UiInputRouter Router { get; }

    public void Attach(UiNodeId node)
    {
        if (!Receivers.Has(node))
        {
            Receivers.Add(new TestReceiver(node, Log));
        }
    }

    public void DetachAll() => Receivers.Clear();
}

internal readonly record struct InputCall(UiNodeId Node, string Kind, UiRoutingPhase Phase, UiPointerPhase PointerPhase);

internal sealed class CallLog
{
    public List<InputCall> Entries { get; } = [];

    public void Add(in InputCall call) => Entries.Add(call);

    public void Clear() => Entries.Clear();

    public List<string> PointerOrder() => Entries
        .Where(static call => call.Kind == "pointer")
        .Select(static call => $"{call.Node.Value}|{call.Phase}|{call.PointerPhase}")
        .ToList();

    public List<string> KeyOrder() => Entries
        .Where(static call => call.Kind == "key")
        .Select(static call => $"{call.Node.Value}|{call.Phase}")
        .ToList();

    public List<string> TextOrder() => Entries
        .Where(static call => call.Kind == "text")
        .Select(static call => $"{call.Node.Value}|{call.Phase}")
        .ToList();

    public string[] Lines() => Entries
        .Select(static call => $"{call.Node.Value}|{call.Kind}|{call.Phase}|{call.PointerPhase}")
        .ToArray();
}

internal sealed class TestReceiver(UiNodeId node, CallLog log) : IUiInputReceiver
{
    public UiNodeId Node { get; } = node;

    public UiRoutingPhase? ConsumePointerPhase { get; set; }

    public UiRoutingPhase? ConsumeKeyPhase { get; set; }

    public bool ConsumeText { get; set; }

    public bool ConsumeFocus { get; set; }

    public bool OnPointer(in UiPointerEvent args, UiRoutingPhase phase)
    {
        log.Add(new InputCall(Node, "pointer", phase, args.Phase));
        return ConsumePointerPhase == phase;
    }

    public bool OnKey(in UiKeyEvent args, UiRoutingPhase phase)
    {
        log.Add(new InputCall(Node, "key", phase, UiPointerPhase.Move));
        return ConsumeKeyPhase == phase;
    }

    public bool OnText(in UiTextInputEvent args, UiRoutingPhase phase)
    {
        log.Add(new InputCall(Node, "text", phase, UiPointerPhase.Move));
        return ConsumeText;
    }

    public bool OnFocus(in UiFocusChangeEvent args, UiRoutingPhase phase)
    {
        log.Add(new InputCall(Node, "focus", phase, UiPointerPhase.Move));
        return ConsumeFocus;
    }
}

internal sealed class TestReceiverResolver : IUiInputReceiverResolver
{
    private readonly Dictionary<UiNodeId, TestReceiver> _receivers = new();

    public void Add(TestReceiver receiver) => _receivers[receiver.Node] = receiver;

    public bool Has(UiNodeId node) => _receivers.ContainsKey(node);

    public void Clear() => _receivers.Clear();

    public TestReceiver? Resolve(UiNodeId node) => _receivers.GetValueOrDefault(node);

    public bool TryResolve(UiNodeId node, out IUiInputReceiver receiver)
    {
        if (_receivers.TryGetValue(node, out TestReceiver? found))
        {
            receiver = found;
            return true;
        }

        receiver = null!;
        return false;
    }
}

internal sealed class RecordingTextSink : IUiTextInputSink
{
    public List<string> Calls { get; } = [];

    public bool BeginComposition(UiNodeId node)
    {
        Calls.Add($"begin:{node.Value}");
        return true;
    }

    public bool UpdateComposition(UiNodeId node, ReadOnlySpan<char> text, int caret)
    {
        Calls.Add($"update:{node.Value}:{text.ToString()}:{caret}");
        return true;
    }

    public bool CommitComposition(UiNodeId node, ReadOnlySpan<char> text)
    {
        Calls.Add($"commit:{node.Value}:{text.ToString()}");
        return true;
    }

    public void CancelComposition() => Calls.Add("cancel");
}
