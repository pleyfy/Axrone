namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Route graph backed by the parent links of a UI node tree.</summary>
public sealed class UiTreeRouteGraph : IUiRouteGraph
{
    private readonly IUiNodeTree _tree;

    /// <summary>Creates a route graph over a node tree.</summary>
    public UiTreeRouteGraph(IUiNodeTree tree)
    {
        ArgumentNullException.ThrowIfNull(tree);
        _tree = tree;
    }

    /// <inheritdoc/>
    public bool TryGetParent(UiNodeId node, out UiNodeId parent)
    {
        if (node.IsValid && _tree.TryGetNode(node, out UiNodeRecord record) && record.Parent.IsValid)
        {
            parent = record.Parent;
            return true;
        }

        parent = UiNodeId.Invalid;
        return false;
    }
}
