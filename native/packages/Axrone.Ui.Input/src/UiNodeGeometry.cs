namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>
/// Supplies the current UI-space box of a node. Hit testing and directional focus
/// navigation consume it without owning layout storage.
/// </summary>
public interface IUiNodeBounds
{
    /// <summary>Gets the box of a node, or <see langword="false"/> when the node has no box.</summary>
    bool TryGetBounds(UiNodeId node, out Aabb2D bounds);
}

/// <summary>
/// Supplies the effective clip region of a node: the intersection of every clipping
/// ancestor's box. A node's own clip does not clip itself.
/// </summary>
public interface IUiClipResolver
{
    /// <summary>Gets the effective clip of a node, or <see langword="false"/> when nothing clips it.</summary>
    bool TryGetClip(UiNodeId node, out Aabb2D clip);
}

/// <summary>
/// Clip resolver over a node tree and its box source. Walks the parent chain once per
/// query, intersecting every ancestor flagged <see cref="UiNodeFlags.Clip"/>; no allocation.
/// </summary>
public sealed class UiTreeClipResolver : IUiClipResolver
{
    private readonly IUiNodeTree _tree;
    private readonly IUiNodeBounds _bounds;

    /// <summary>Creates a resolver over a tree and its box source.</summary>
    public UiTreeClipResolver(IUiNodeTree tree, IUiNodeBounds bounds)
    {
        ArgumentNullException.ThrowIfNull(tree);
        ArgumentNullException.ThrowIfNull(bounds);
        _tree = tree;
        _bounds = bounds;
    }

    /// <inheritdoc/>
    public bool TryGetClip(UiNodeId node, out Aabb2D clip)
    {
        var min = new Vec2(float.NegativeInfinity);
        var max = new Vec2(float.PositiveInfinity);
        bool found = false;
        UiNodeId current = node;
        for (int depth = 0; depth < UiTreeQuery.MaxTreeDepth; depth++)
        {
            if (!_tree.TryGetNode(current, out UiNodeRecord record))
            {
                break;
            }

            UiNodeId parent = record.Parent;
            if (!parent.IsValid)
            {
                break;
            }

            if (_tree.TryGetNode(parent, out UiNodeRecord parentRecord) &&
                (parentRecord.Flags & UiNodeFlags.Clip) != 0 &&
                _bounds.TryGetBounds(parent, out Aabb2D box))
            {
                min = Vec2.Max(min, box.Min);
                max = Vec2.Min(max, box.Max);
                found = true;
            }

            current = parent;
        }

        if (found)
        {
            clip = new Aabb2D(min, max);
            return true;
        }

        clip = default;
        return false;
    }
}

/// <summary>Shared tree predicates used by input routing, hit testing and focus.</summary>
internal static class UiTreeQuery
{
    /// <summary>
    /// Maximum parent-chain length walked by tree queries. Bounds the walk so a corrupt
    /// or cyclic parent link terminates instead of spinning; deeper real hierarchies are
    /// treated as unestablished.
    /// </summary>
    internal const int MaxTreeDepth = 512;

    /// <summary>
    /// Whether a node and every ancestor carry <see cref="UiNodeFlags.Visible"/>.
    /// Returns <see langword="false"/> for unknown nodes and for chains deeper than
    /// <see cref="MaxTreeDepth"/>.
    /// </summary>
    internal static bool IsEffectivelyVisible(IUiNodeTree tree, UiNodeId node)
    {
        UiNodeId current = node;
        for (int depth = 0; depth < MaxTreeDepth; depth++)
        {
            if (!tree.TryGetNode(current, out UiNodeRecord record))
            {
                return false;
            }

            if ((record.Flags & UiNodeFlags.Visible) == 0)
            {
                return false;
            }

            if (!record.Parent.IsValid)
            {
                return true;
            }

            current = record.Parent;
        }

        return false;
    }

    /// <summary>Whether a node itself is enabled and interactive.</summary>
    internal static bool IsInteractive(UiNodeRecord record) =>
        (record.Flags & UiNodeFlags.Enabled) != 0 && (record.Flags & UiNodeFlags.Interactive) != 0;

    /// <summary>Whether a node itself is focusable and visible.</summary>
    internal static bool IsFocusable(IUiNodeTree tree, UiNodeId node) =>
        tree.TryGetNode(node, out UiNodeRecord record) &&
        (record.Flags & UiNodeFlags.Focusable) != 0 &&
        (record.Flags & UiNodeFlags.Enabled) != 0 &&
        IsEffectivelyVisible(tree, node);
}
