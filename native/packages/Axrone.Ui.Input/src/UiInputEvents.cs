namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Pointer event phase.</summary>
public enum UiPointerPhase
{
    /// <summary>Pointer moved.</summary>
    Move,

    /// <summary>Pointer button pressed.</summary>
    Down,

    /// <summary>Pointer button released.</summary>
    Up,

    /// <summary>Pointer entered a node.</summary>
    Enter,

    /// <summary>Pointer left a node.</summary>
    Leave,

    /// <summary>Wheel scrolled.</summary>
    Wheel,

    /// <summary>Pointer interaction cancelled.</summary>
    Cancel,
}

/// <summary>Pointer button mask.</summary>
[Flags]
public enum UiPointerButtons : uint
{
    /// <summary>No button.</summary>
    None = 0,

    /// <summary>Primary/left button.</summary>
    Left = 1u << 0,

    /// <summary>Secondary/right button.</summary>
    Right = 1u << 1,

    /// <summary>Middle button.</summary>
    Middle = 1u << 2,

    /// <summary>Extra button 1.</summary>
    Extra1 = 1u << 3,

    /// <summary>Extra button 2.</summary>
    Extra2 = 1u << 4,
}

/// <summary>Keyboard modifier mask.</summary>
[Flags]
public enum UiKeyModifiers : uint
{
    /// <summary>No modifier.</summary>
    None = 0,

    /// <summary>Alt.</summary>
    Alt = 1u << 0,

    /// <summary>Control.</summary>
    Control = 1u << 1,

    /// <summary>Shift.</summary>
    Shift = 1u << 2,

    /// <summary>Meta/logo.</summary>
    Meta = 1u << 3,
}

/// <summary>Pointer event routed to a UI node.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiPointerEvent(
    UiNodeId Target,
    UiPointerPhase Phase,
    Vec2 Position,
    Vec2 Delta,
    int PointerId,
    int Button,
    UiPointerButtons Buttons,
    UiKeyModifiers Modifiers,
    long Timestamp);

/// <summary>Key event phase.</summary>
public enum UiKeyPhase
{
    /// <summary>Key pressed.</summary>
    Down,

    /// <summary>Key released.</summary>
    Up,
}

/// <summary>Keyboard event routed to a UI node.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiKeyEvent(
    UiNodeId Target,
    UiKeyPhase Phase,
    ushort KeyCode,
    bool Repeat,
    UiKeyModifiers Modifiers,
    long Timestamp);

/// <summary>Text/IME input routed to a UI node.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextInputEvent(
    UiNodeId Target,
    string Text,
    bool Composing,
    string? Locale);

/// <summary>OS window focus transition.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly record struct UiWindowFocusEvent(bool Focused);

/// <summary>Reason a UI node gained or lost focus.</summary>
public enum UiFocusReason
{
    /// <summary>Set through the API.</summary>
    Api,

    /// <summary>Pointer interaction.</summary>
    PointerInput,

    /// <summary>Keyboard/tab navigation.</summary>
    Navigation,

    /// <summary>Window focus change.</summary>
    Window,
}

/// <summary>Widget focus transition.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFocusChangeEvent(
    UiNodeId Target,
    bool Focused,
    UiFocusReason Reason);
