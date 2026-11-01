namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Directional focus navigation request.</summary>
public enum UiFocusMoveDirection
{
    /// <summary>Next in tab order.</summary>
    Forward,

    /// <summary>Previous in tab order.</summary>
    Backward,

    /// <summary>Left.</summary>
    Left,

    /// <summary>Right.</summary>
    Right,

    /// <summary>Up.</summary>
    Up,

    /// <summary>Down.</summary>
    Down,
}

/// <summary>Focus ownership and navigation contract.</summary>
public interface IUiFocusManager
{
    /// <summary>Gets the focused node, or <see cref="UiNodeId.Invalid"/>.</summary>
    UiNodeId Focused { get; }

    /// <summary>Focuses a node.</summary>
    bool TryFocus(UiNodeId node, UiFocusReason reason);

    /// <summary>Moves focus in a direction.</summary>
    bool TryMoveFocus(UiFocusMoveDirection direction);

    /// <summary>Clears focus.</summary>
    void ClearFocus(UiFocusReason reason);
}

/// <summary>Per-pointer capture ownership contract.</summary>
public interface IUiPointerCapture
{
    /// <summary>Gets the node holding capture for a pointer, or <see cref="UiNodeId.Invalid"/>.</summary>
    UiNodeId GetCaptured(int pointerId);

    /// <summary>Captures a pointer to a node.</summary>
    bool TryCapture(int pointerId, UiNodeId node);

    /// <summary>Releases capture for a pointer.</summary>
    bool Release(int pointerId);

    /// <summary>Releases every captured pointer.</summary>
    void ReleaseAll();
}
