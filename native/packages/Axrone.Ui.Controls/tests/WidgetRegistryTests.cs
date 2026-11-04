namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

/// <summary>Example third-party widget: clickable counter with a hit-testable badge child.</summary>
internal sealed class CounterWidget : IUiWidgetBehavior
{
    public const string Name = "test.counter";

    public bool IsInteractive => true;

    public bool IsFocusable => true;

    public UiLayoutStyle CreateLayoutStyle(in UiWidgetThemeContext theme) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(theme.Number(theme.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 12.0f, 4.0f, 12.0f),
            AlignItems = UiAlign.Center,
            JustifyContent = UiJustify.Center,
        };

    public UiStylePatch CreateStylePatch(in UiWidgetVisualContext context)
    {
        UiWidgetThemeContext theme = context.Theme;
        UiColor background = context.State switch
        {
            UiControlState.Disabled => theme.Color(theme.Tokens.BackgroundDisabled, new UiColor(0.07f, 0.12f, 0.20f, 0.6f)),
            UiControlState.Pressed => theme.Color(theme.Tokens.BackgroundPressed, new UiColor(0.06f, 0.10f, 0.17f, 1.0f)),
            UiControlState.Hover => theme.Color(theme.Tokens.BackgroundHover, new UiColor(0.11f, 0.17f, 0.27f, 1.0f)),
            _ => theme.Color(theme.Tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f)),
        };
        return new UiStylePatch
        {
            Visible = true,
            Background = background,
            BorderColor = context.Focused
                ? theme.Color(theme.Tokens.BorderFocused, new UiColor(0.38f, 0.65f, 0.98f, 1.0f))
                : theme.Color(theme.Tokens.Border, new UiColor(0.85f, 0.90f, 1.00f, 0.15f)),
            BorderWidth = 1.0f,
            TextColor = context.State == UiControlState.Disabled
                ? theme.Color(theme.Tokens.TextColorDisabled, new UiColor(0.55f, 0.62f, 0.72f, 1.0f))
                : theme.Color(theme.Tokens.TextColor, UiColor.White),
        };
    }

    public void OnInitialize(UiWidgetSession session, in UiControlDefinition definition)
    {
        session.SetText(definition.Text ?? "0");
        UiNodeId badge = session.AddChildNode(0);
        session.SetChildLayoutStyle(badge, UiLayoutStyle.Default with { Width = UiLength.Auto, Height = UiLength.Auto });
        session.SetChildStyle(badge, new UiStylePatch
        {
            Visible = true,
            Background = session.Runtime.TryResolveThemeColor(new UiThemeTokenId(9), out UiColor accent)
                ? accent
                : new UiColor(1.0f, 0.0f, 0.0f, 1.0f),
        });
        session.SetChildText(badge, "*");
    }

    public bool OnPointer(UiWidgetSession session, in UiWidgetPointerHit hit, in UiPointerEvent args, UiRoutingPhase phase)
    {
        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                _ = session.SetPointerInside(true);
                return false;
            case UiPointerPhase.Leave:
                _ = session.SetPointerInside(false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0)
                {
                    return false;
                }

                _ = session.SetPressed(true);
                return true;
            case UiPointerPhase.Cancel:
                _ = session.SetPressed(false);
                return true;
            case UiPointerPhase.Up:
                if (!hit.IsPrimary)
                {
                    session.Emit(UiControlEventKind.SelectionChanged, 0.0f, false, hit.ChildIndex, null);
                    return true;
                }

                bool activated = session.TryGetSnapshot(out UiControlSnapshot snapshot) &&
                    snapshot.State == UiControlState.Pressed;
                _ = session.SetPressed(false);
                if (activated)
                {
                    _ = session.SetValue(snapshot.Value + 0.5f);
                    session.Emit(UiControlEventKind.Click, 0.0f, false, 0, null);
                }

                return true;
            default:
                return false;
        }
    }

    public bool IsChildHitTestable(in UiWidgetVisualContext context, int childIndex) => childIndex == 0;
}

/// <summary>Adapter exposing a built-in catalog behavior through the open registry.</summary>
internal sealed class CatalogWidget(ControlBehavior behavior) : IUiWidgetBehavior
{
    public bool IsInteractive => behavior.Interactive;

    public bool IsFocusable => behavior.Focusable;

    public UiLayoutStyle CreateLayoutStyle(in UiWidgetThemeContext theme) =>
        behavior.CreateLayoutStyle(new ControlStyleContext(theme.Theme, theme.Tokens));

    public UiStylePatch CreateStylePatch(in UiWidgetVisualContext context) =>
        behavior.CreateStylePatch(ToInner(context.Theme), ToEntry(in context));

    public void OnInitialize(UiWidgetSession session, in UiControlDefinition definition) =>
        behavior.Initialize(session.Runtime, session.Control.Index, in definition);

    public bool OnPointer(UiWidgetSession session, in UiWidgetPointerHit hit, in UiPointerEvent args, UiRoutingPhase phase)
    {
        var binding = new ControlNodeBinding(
            session.Control.Index,
            hit.IsPrimary ? ControlPart.Primary : ControlPart.Option,
            hit.ChildIndex);
        return behavior.OnPointer(session.Runtime, session.Control.Index, in binding, in args, phase);
    }

    public bool OnKey(UiWidgetSession session, in UiKeyEvent args, UiRoutingPhase phase) =>
        behavior.OnKey(session.Runtime, session.Control.Index, in args, phase);

    public bool OnText(UiWidgetSession session, in UiTextInputEvent args, UiRoutingPhase phase) =>
        behavior.OnText(session.Runtime, session.Control.Index, in args, phase);

    public void OnFocusChanged(UiWidgetSession session, bool focused) =>
        behavior.OnFocusChanged(session.Runtime, session.Control.Index, focused);

    public bool IsChildHitTestable(in UiWidgetVisualContext context, int childIndex) =>
        behavior.IsSecondaryHitTestable(ToInner(context.Theme), ToEntry(in context), ControlPart.Option, childIndex);

    private static ControlStyleContext ToInner(UiWidgetThemeContext theme) => new(theme.Theme, theme.Tokens);

    private static ControlEntry ToEntry(in UiWidgetVisualContext context) => new()
    {
        Kind = ControlKind.Button,
        Text = context.Text,
        Disabled = context.State == UiControlState.Disabled,
        Pressed = context.State == UiControlState.Pressed,
        PointerInside = context.State is UiControlState.Hover or UiControlState.Pressed,
        Focused = context.Focused,
        Checked = context.Checked,
        Open = context.Open,
        Value = context.Value,
        Index = context.Index,
    };
}

public sealed class UiWidgetRegistryContractTests
{
    [Fact]
    public void RegisterResolveAndRemoveFollowRegistryContract()
    {
        var registry = new UiWidgetRegistry();
        var widget = new CounterWidget();

        UiWidgetHandle handle = registry.Register(CounterWidget.Name, widget);

        handle.IsValid.Should().BeTrue();
        registry.Count.Should().Be(1);
        registry.Contains(CounterWidget.Name).Should().BeTrue();
        registry.TryResolve(CounterWidget.Name, out UiWidgetHandle resolved).Should().BeTrue();
        resolved.Should().Be(handle);

        registry.Remove(CounterWidget.Name).Should().BeTrue();
        registry.Contains(CounterWidget.Name).Should().BeFalse();
        registry.Remove(CounterWidget.Name).Should().BeFalse();
        registry.Count.Should().Be(0);
    }

    [Fact]
    public void RegisterRejectsDuplicatesAndEmptyNames()
    {
        var registry = new UiWidgetRegistry();
        _ = registry.Register("a", new CounterWidget());

        Action duplicate = () => _ = registry.Register("a", new CounterWidget());
        duplicate.Should().Throw<InvalidOperationException>();

        Action empty = () => _ = registry.Register(string.Empty, new CounterWidget());
        empty.Should().Throw<ArgumentException>();

        Action nullName = () => _ = registry.Register(null!, new CounterWidget());
        nullName.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void ResolveUnknownOrEmptyNameFails()
    {
        var registry = new UiWidgetRegistry();
        registry.TryResolve("missing", out UiWidgetHandle handle).Should().BeFalse();
        handle.IsValid.Should().BeFalse();
        registry.TryResolve(string.Empty, out handle).Should().BeFalse();
        registry.TryResolve(null, out handle).Should().BeFalse();
    }

    [Fact]
    public void ReplaceKeepsNameButInvalidatesOlderHandles()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle first = registry.Register("a", new CounterWidget());
        UiWidgetHandle second = registry.Replace("a", new CounterWidget());

        second.Slot.Should().Be(first.Slot);
        second.Generation.Should().NotBe(first.Generation);
        registry.Count.Should().Be(1);
        registry.TryResolve("a", out UiWidgetHandle current).Should().BeTrue();
        current.Should().Be(second);
    }

    [Fact]
    public void ClearRemovesEverything()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register("a", new CounterWidget());
        _ = registry.Register("b", new CounterWidget());

        registry.Clear();

        registry.Count.Should().Be(0);
        registry.Contains("a").Should().BeFalse();
        handle.IsValid.Should().BeTrue();
        registry.TryResolve("a", out UiWidgetHandle resolved).Should().BeFalse();
    }

    [Fact]
    public void SlotReuseGivesFreshGenerationsToReusedIndices()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle first = registry.Register("a", new CounterWidget());
        _ = registry.Remove("a");
        UiWidgetHandle second = registry.Register("b", new CounterWidget());

        second.Slot.Should().Be(first.Slot);
        second.Generation.Should().NotBe(first.Generation);
    }
}

public sealed class CustomWidgetRuntimeTests
{
    [Fact]
    public void WidgetWithoutRegistryThrows()
    {
        var host = new ControlHost();
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register(CounterWidget.Name, new CounterWidget());

        Action act = () => _ = host.Runtime.CreateControl(handle);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void StaleWidgetHandleThrowsOnCreate()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register(CounterWidget.Name, new CounterWidget());
        _ = registry.Remove(CounterWidget.Name);
        var host = new ControlHost(widgets: registry);

        Action act = () => _ = host.Runtime.CreateControl(handle);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void WidgetControlParticipatesInLayoutHitTestAndDrawList()
    {
        var sink = new RecordingControlSink();
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register(CounterWidget.Name, new CounterWidget());
        var host = new ControlHost(sink, widgets: registry);

        UiControl counter = host.Runtime.CreateControl(handle, new UiControlDefinition(Text: "5", MaxValue: 99.0f));
        _ = host.Runtime.Mount(counter);
        host.Layout();

        // Layout integration: the widget box is placed and sized like a built-in control.
        host.TryGetBounds(counter, out Rect box).Should().BeTrue();
        box.Height.Should().Be(36.0f);
        box.Width.Should().BeGreaterThan(0.0f);

        // Draw-list integration: the theme-resolved accent appears as the resolved style.
        _ = host.Runtime.TryGetStyle(counter.Node, out UiWidgetStyle style);
        style.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));
        style.Visible.Should().BeTrue();

        // Child node joins layout and draw list too.
        UiNodeId badge = FindBadgeNode(host.Runtime, counter);
        host.Runtime.TryGetBounds(badge, out Rect badgeBox).Should().BeTrue();
        badgeBox.Width.Should().BeGreaterThan(0.0f);
        _ = host.Runtime.TryGetStyle(badge, out UiWidgetStyle badgeStyle);
        badgeStyle.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));

        // Hit-test integration: pointer over the primary node routes into the widget.
        host.Click(box.X + box.Width * 0.85f, box.Y + box.Height * 0.5f);
        sink.Count(UiControlEventKind.Click).Should().Be(1);
        host.Runtime.TryGetSnapshot(counter, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(0.5f);

        // Hit-test integration for children: the badge is hit-testable through the widget hook.
        _ = host.Runtime.TryGetBounds(badge, out badgeBox);
        host.Click(badgeBox.X + badgeBox.Width * 0.5f, badgeBox.Y + badgeBox.Height * 0.5f);
        sink.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
        sink.Last(UiControlEventKind.SelectionChanged).Index.Should().Be(0);
    }

    [Fact]
    public void HoverPressAndFocusStatesReachTheWidgetStylePatch()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register(CounterWidget.Name, new CounterWidget());
        var host = new ControlHost(widgets: registry);
        UiControl counter = host.Runtime.CreateControl(handle, new UiControlDefinition(Text: "1"));
        _ = host.Runtime.Mount(counter);
        host.Layout();
        _ = host.TryGetBounds(counter, out Rect box);
        float x = box.X + box.Width * 0.25f;
        float y = box.Y + box.Height * 0.5f;

        _ = host.Runtime.TryGetStyle(counter.Node, out UiWidgetStyle idle);
        idle.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Move, x, y);
        _ = host.Pointer(UiPointerPhase.Enter, x, y);
        _ = host.Runtime.TryGetStyle(counter.Node, out UiWidgetStyle hover);
        hover.Background.Should().Be(new UiColor(0.11f, 0.17f, 0.27f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Down, x, y);
        _ = host.Runtime.TryGetStyle(counter.Node, out UiWidgetStyle pressed);
        pressed.Background.Should().Be(new UiColor(0.06f, 0.10f, 0.17f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Up, x, y);
        _ = host.Runtime.TryGetSnapshot(counter, out UiControlSnapshot snapshot);
        snapshot.Focused.Should().BeTrue();
        _ = host.Runtime.TryGetStyle(counter.Node, out UiWidgetStyle focused);
        focused.BorderColor.Should().Be(new UiColor(0.38f, 0.65f, 0.98f, 1.0f));
    }

    [Fact]
    public void RemovedWidgetFallsBackToInertDispatchWithoutThrowing()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register(CounterWidget.Name, new CounterWidget());
        var host = new ControlHost(widgets: registry);
        UiControl counter = host.Runtime.CreateControl(handle, new UiControlDefinition(Text: "1"));
        _ = host.Runtime.Mount(counter);
        host.Layout();

        _ = registry.Remove(CounterWidget.Name);

        Action act = () => _ = host.Runtime.RefreshControl(counter);
        act.Should().NotThrow();
        host.Runtime.TryGetSnapshot(counter, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Kind.Should().Be(ControlKind.Custom);
    }

    private static UiNodeId FindBadgeNode(UiControlRuntime runtime, UiControl control)
    {
        // The widget created child index 0; resolve its node through the public surface.
        foreach (UiNodeId child in runtime.Nodes.GetChildren(control.Node))
        {
            return child;
        }

        return UiNodeId.Invalid;
    }
}

public sealed class WidgetRegistryParityTests
{
    [Fact]
    public void RegistryDispatchedBuiltInMatchesCatalogControl()
    {
        var catalogSink = new RecordingControlSink();
        var registrySink = new RecordingControlSink();
        var catalogHost = new ControlHost(catalogSink);
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register("parity.button", new CatalogWidget(ControlCatalog.Get(ControlKind.Button)));
        var registryHost = new ControlHost(registrySink, widgets: registry);

        var definition = new UiControlDefinition(Text: "OK");
        UiControl catalogButton = catalogHost.Runtime.CreateControl(ControlKind.Button, in definition);
        UiControl registryButton = registryHost.Runtime.CreateControl(handle, in definition);
        _ = catalogHost.Runtime.Mount(catalogButton);
        _ = registryHost.Runtime.Mount(registryButton);

        for (int round = 0; round < 6; round++)
        {
            catalogHost.Layout();
            registryHost.Layout();

            _ = catalogHost.TryGetBounds(catalogButton, out Rect catalogBox);
            _ = registryHost.TryGetBounds(registryButton, out Rect registryBox);
            catalogBox.Width.Should().Be(registryBox.Width, "layout output must match at round {0}", round);
            catalogBox.Height.Should().Be(registryBox.Height);

            // Both hosts contain exactly one child of the root, so positions are identical.
            float x = catalogBox.X + catalogBox.Width * 0.5f;
            float y = catalogBox.Y + catalogBox.Height * 0.5f;

            // Same scripted interaction on both hosts.
            _ = catalogHost.Pointer(UiPointerPhase.Move, x, y);
            _ = registryHost.Pointer(UiPointerPhase.Move, x, y);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "hover");

            _ = catalogHost.Pointer(UiPointerPhase.Enter, x, y);
            _ = registryHost.Pointer(UiPointerPhase.Enter, x, y);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "enter");

            _ = catalogHost.Pointer(UiPointerPhase.Down, x, y);
            _ = registryHost.Pointer(UiPointerPhase.Down, x, y);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "pressed");

            _ = catalogHost.Pointer(UiPointerPhase.Up, x, y);
            _ = registryHost.Pointer(UiPointerPhase.Up, x, y);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "released");

            _ = catalogHost.Pointer(UiPointerPhase.Leave, x, y);
            _ = registryHost.Pointer(UiPointerPhase.Leave, x, y);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "leave");

            _ = catalogHost.Key(32);
            _ = registryHost.Key(32);
            AssertStylesEqual(catalogHost.Runtime, catalogButton, registryHost.Runtime, registryButton, "space");
        }

        catalogSink.Events.Count.Should().Be(registrySink.Events.Count);
        for (int i = 0; i < catalogSink.Events.Count; i++)
        {
            UiControlEvent left = catalogSink.Events[i];
            UiControlEvent right = registrySink.Events[i];
            left.EventKind.Should().Be(right.EventKind, "event {0}", i);
            left.Value.Should().Be(right.Value);
            left.Checked.Should().Be(right.Checked);
            left.Index.Should().Be(right.Index);
            left.Text.Should().Be(right.Text);
            right.Kind.Should().Be(ControlKind.Custom);
        }

        catalogSink.Events.Should().NotBeEmpty();
    }

    [Fact]
    public void RegistryDispatchMatchesCatalogForStateUpdatesWithoutAllocation()
    {
        var registry = new UiWidgetRegistry();
        UiWidgetHandle handle = registry.Register("perf.button", new CatalogWidget(ControlCatalog.Get(ControlKind.Button)));
        var sink = new CountingControlSink();
        var host = new ControlHost(sink, widgets: registry);
        UiControl button = host.Runtime.CreateControl(handle, new UiControlDefinition(Text: "OK"));
        _ = host.Runtime.Mount(button);
        host.Layout();

        for (int warmup = 0; warmup < 128; warmup++)
        {
            host.Click(10.0f, 10.0f);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int handled = 0;
        for (int round = 0; round < 500; round++)
        {
            if (host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f))
            {
                handled++;
            }

            if (host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f))
            {
                handled++;
            }

            if (host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f))
            {
                handled++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        handled.Should().Be(1000);
        sink.Clicks.Should().BeGreaterThanOrEqualTo(500);
    }

    private static void AssertStylesEqual(
        UiControlRuntime leftRuntime,
        UiControl left,
        UiControlRuntime rightRuntime,
        UiControl right,
        string stage)
    {
        leftRuntime.TryGetStyle(left.Node, out UiWidgetStyle leftStyle).Should().BeTrue();
        rightRuntime.TryGetStyle(right.Node, out UiWidgetStyle rightStyle).Should().BeTrue(stage);
        rightStyle.Should().Be(leftStyle, "resolved style must match at stage {0}", stage);
    }
}
