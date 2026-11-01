namespace Axrone.Ui.Rendering;

/// <summary>
/// Builds batch identities from commands. A batch key is the complete set of
/// backend state a run of commands shares; two commands may only ride one draw
/// call when every component is bit-identical.
/// </summary>
public static class UiBatchKeyFactory
{
    /// <summary>Creates the batch key for one command.</summary>
    /// <param name="command">Source command.</param>
    /// <param name="blend">Blend mode selected by the host for this command family.</param>
    /// <returns>The batch identity.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static UiBatchKey Create(in UiRenderCommand command, UiBlendMode blend = UiBlendMode.Alpha)
    {
        UiImageSampling sampling = command.Kind == UiRenderCommandKind.Image
            ? command.Sampling
            : UiImageSampling.Linear;

        bool hasClip = (command.Flags & UiRenderFlags.Clip) != 0;
        Rect clip = hasClip ? command.Clip : default;

        return new UiBatchKey(
            command.Kind,
            command.Resource,
            UiGlyphAtlasPageId.Invalid,
            blend,
            sampling,
            hasClip,
            clip);
    }
}

/// <summary>
/// Streaming batch grouper. Commands are grouped into maximal runs of adjacent
/// equal keys; record order is preserved because UI compositing depends on
/// back-to-front submission. Runs are never reordered or coalesced across an
/// intervening key, so the produced batch sequence is a pure function of the
/// command span.
/// </summary>
public ref struct UiBatchGrouper
{
    private readonly ReadOnlySpan<UiRenderCommand> _commands;
    private int _index;
    private readonly UiBlendMode _blend;

    /// <summary>Initializes a grouper over a command span.</summary>
    /// <param name="commands">Borrowed command span; must outlive the grouper.</param>
    /// <param name="blend">Blend mode applied to every produced key.</param>
    public UiBatchGrouper(ReadOnlySpan<UiRenderCommand> commands, UiBlendMode blend = UiBlendMode.Alpha)
    {
        _commands = commands;
        _index = 0;
        _blend = blend;
    }

    /// <summary>Gets the number of commands not yet produced.</summary>
    public readonly int Remaining => _commands.Length - _index;

    /// <summary>Produces the next contiguous run.</summary>
    /// <param name="key">Run identity.</param>
    /// <param name="commands">Borrowed run span.</param>
    /// <returns><see langword="false"/> when the span is exhausted.</returns>
    public bool TryNext(out UiBatchKey key, out ReadOnlySpan<UiRenderCommand> commands)
    {
        if (_index >= _commands.Length)
        {
            key = default;
            commands = default;
            return false;
        }

        int start = _index;
        UiBatchKey current = UiBatchKeyFactory.Create(in _commands[start], _blend);
        int end = start + 1;

        while (end < _commands.Length)
        {
            ref readonly UiRenderCommand candidate = ref _commands[end];
            if (!UiBatchKeyFactory.Create(in candidate, _blend).Equals(current))
            {
                break;
            }

            end++;
        }

        _index = end;
        key = current;
        commands = _commands.Slice(start, end - start);
        return true;
    }
}
