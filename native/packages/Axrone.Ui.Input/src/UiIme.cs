namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>IME composition sink contract for a focused text input node.</summary>
public interface IUiTextInputSink
{
    /// <summary>Starts a composition session for a node.</summary>
    bool BeginComposition(UiNodeId node);

    /// <summary>Updates the current composition text and caret.</summary>
    bool UpdateComposition(UiNodeId node, ReadOnlySpan<char> text, int caret);

    /// <summary>Commits composition text to the node.</summary>
    bool CommitComposition(UiNodeId node, ReadOnlySpan<char> text);

    /// <summary>Cancels the active composition.</summary>
    void CancelComposition();
}
