namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Per-node input receiver invoked once per routing phase.</summary>
public interface IUiInputReceiver
{
    /// <summary>Handles a pointer event in one phase; <see langword="true"/> consumes it.</summary>
    bool OnPointer(in UiPointerEvent args, UiRoutingPhase phase);

    /// <summary>Handles a key event in one phase; <see langword="true"/> consumes it.</summary>
    bool OnKey(in UiKeyEvent args, UiRoutingPhase phase);

    /// <summary>Handles a text event; <see langword="true"/> consumes it.</summary>
    bool OnText(in UiTextInputEvent args, UiRoutingPhase phase);

    /// <summary>Handles a focus transition; <see langword="true"/> consumes it.</summary>
    bool OnFocus(in UiFocusChangeEvent args, UiRoutingPhase phase);
}

/// <summary>Resolves the input receiver of a node.</summary>
public interface IUiInputReceiverResolver
{
    /// <summary>Gets the receiver of a node, or <see langword="false"/> when it has none.</summary>
    bool TryResolve(UiNodeId node, out IUiInputReceiver receiver);
}
