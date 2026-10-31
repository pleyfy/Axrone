namespace Axrone.Ui.Input;

using Axrone.Input;
using Axrone.Ui;

/// <summary>Routing phase of one event pass.</summary>
public enum UiRoutingPhase
{
    /// <summary>Root-to-target capture phase.</summary>
    Tunnel,

    /// <summary>Target-only phase.</summary>
    Target,

    /// <summary>Target-to-root bubble phase.</summary>
    Bubble,
}

/// <summary>Outcome of one routed input event.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiInputDispatchResult(
    bool Handled,
    UiNodeId Target,
    UiRoutingPhase Phase,
    bool Canceled);

/// <summary>Parent lookup used by routing traversal.</summary>
public interface IUiRouteGraph
{
    /// <summary>Gets the parent of a node.</summary>
    bool TryGetParent(UiNodeId node, out UiNodeId parent);
}

/// <summary>Synchronous UI event router contract.</summary>
public interface IUiInputRouter
{
    /// <summary>Routes one pointer event.</summary>
    UiInputDispatchResult Route(in UiPointerEvent args);

    /// <summary>Routes one key event.</summary>
    UiInputDispatchResult Route(in UiKeyEvent args);

    /// <summary>Routes one text/IME event.</summary>
    UiInputDispatchResult Route(in UiTextInputEvent args);

    /// <summary>Routes one widget focus event.</summary>
    UiInputDispatchResult Route(in UiFocusChangeEvent args);
}

/// <summary>Maps raw engine input events into UI events.</summary>
public interface IUiInputAdapter
{
    /// <summary>Maps a raw event to a pointer event.</summary>
    bool TryMapPointer(in RawInputEvent raw, out UiPointerEvent args);

    /// <summary>Maps a raw event to a key event.</summary>
    bool TryMapKey(in RawInputEvent raw, out UiKeyEvent args);

    /// <summary>Maps a raw event to a text/IME event.</summary>
    bool TryMapText(in RawInputEvent raw, out UiTextInputEvent args);
}
