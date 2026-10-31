namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>
/// IME composition session over an <see cref="IUiTextInputSink"/>. Enforces the
/// begin → update* → commit/cancel ordering and always cancels a dangling session on
/// dispose, so a sink never observes an interleaved composition.
/// </summary>
public sealed class UiTextComposition : IDisposable
{
    private readonly IUiTextInputSink _sink;
    private UiNodeId _active;

    /// <summary>Creates a session over a text input sink.</summary>
    public UiTextComposition(IUiTextInputSink sink)
    {
        ArgumentNullException.ThrowIfNull(sink);
        _sink = sink;
    }

    /// <summary>Gets the node owning the active composition, or <see cref="UiNodeId.Invalid"/>.</summary>
    public UiNodeId Active => _active;

    /// <summary>Starts (or retargets) a composition.</summary>
    public bool Begin(UiNodeId node)
    {
        if (!node.IsValid)
        {
            return false;
        }

        if (_active == node)
        {
            return true;
        }

        if (_active.IsValid)
        {
            _active = UiNodeId.Invalid;
            _sink.CancelComposition();
        }

        if (!_sink.BeginComposition(node))
        {
            return false;
        }

        _active = node;
        return true;
    }

    /// <summary>Updates the active composition text and caret.</summary>
    public bool Update(ReadOnlySpan<char> text, int caret)
    {
        if (!_active.IsValid)
        {
            return false;
        }

        return _sink.UpdateComposition(_active, text, Math.Clamp(caret, 0, text.Length));
    }

    /// <summary>Commits the active composition.</summary>
    public bool Commit(ReadOnlySpan<char> text)
    {
        if (!_active.IsValid)
        {
            return false;
        }

        UiNodeId node = _active;
        _active = UiNodeId.Invalid;
        return _sink.CommitComposition(node, text);
    }

    /// <summary>Cancels the active composition, if any.</summary>
    public void Cancel()
    {
        if (!_active.IsValid)
        {
            return;
        }

        _active = UiNodeId.Invalid;
        _sink.CancelComposition();
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Cancel();
        GC.SuppressFinalize(this);
    }
}
