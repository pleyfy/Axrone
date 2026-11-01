namespace Axrone.Ui;

/// <summary>
/// Immutable document snapshot produced by <see cref="UiDocumentBuilder.Build"/>.
/// Node records live in pinned arrays; the child arena is contiguous, so
/// <see cref="IUiNodeTree.GetChildren"/> is a span view with no allocation.
/// </summary>
public sealed class UiDocument : IUiDocument
{
    private readonly UiNodeTree _nodes;

    internal UiDocument(
        in UiDocumentInfo info,
        UiNodeRecord[] records,
        int[] childStart,
        int[] childCount,
        UiNodeId[] children,
        UiNodeId root,
        int count)
    {
        Info = info;
        _nodes = new UiNodeTree(records, childStart, childCount, children, root, count);
    }

    /// <inheritdoc/>
    public UiDocumentInfo Info { get; }

    /// <inheritdoc/>
    public IUiNodeTree Nodes => _nodes;
}

/// <summary>Pinned, generation-checked node tree behind a document snapshot.</summary>
internal sealed class UiNodeTree : IUiNodeTree
{
    private readonly UiNodeRecord[] _records;
    private readonly int[] _childStart;
    private readonly int[] _childCount;
    private readonly UiNodeId[] _children;

    public UiNodeTree(
        UiNodeRecord[] records,
        int[] childStart,
        int[] childCount,
        UiNodeId[] children,
        UiNodeId root,
        int count)
    {
        _records = records;
        _childStart = childStart;
        _childCount = childCount;
        _children = children;
        Root = root;
        Count = count;
    }

    public int Count { get; }

    public UiNodeId Root { get; }

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        int slot = UiNodeIdCodec.GetIndex(id);
        if (id.IsValid && (uint)slot < (uint)_records.Length)
        {
            UiNodeRecord candidate = _records[slot];
            if (candidate.Id == id)
            {
                record = candidate;
                return true;
            }
        }

        record = default;
        return false;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id)
    {
        int slot = UiNodeIdCodec.GetIndex(id);
        if (!id.IsValid || (uint)slot >= (uint)_records.Length || _records[slot].Id != id)
        {
            return ReadOnlySpan<UiNodeId>.Empty;
        }

        int start = _childStart[slot];
        return start < 0
            ? ReadOnlySpan<UiNodeId>.Empty
            : _children.AsSpan(start, _childCount[slot]);
    }
}
