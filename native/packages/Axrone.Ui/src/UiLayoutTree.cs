namespace Axrone.Ui;

/// <summary>Per-node layout style lookup consumed by <see cref="UiLayoutTree"/>.</summary>
public interface IUiLayoutStyleSource
{
    /// <summary>Looks up the resolved layout style of one node.</summary>
    bool TryGetLayoutStyle(UiNodeId node, out UiLayoutStyle style);
}

/// <summary>
/// Leaf content measurement for text/image/custom nodes. The layout engine
/// calls this only for childless nodes, passing the content-box constraints.
/// </summary>
public interface IUiContentMeasurer
{
    /// <summary>Measures the content of one leaf node.</summary>
    bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size);
}

/// <summary>Mutable layout-style table; missing nodes fall back to the neutral style.</summary>
public sealed class UiLayoutStyleTable : IUiLayoutStyleSource
{
    private readonly Dictionary<UiNodeId, UiLayoutStyle> _styles = new();

    /// <summary>Gets the number of explicit style entries.</summary>
    public int Count => _styles.Count;

    /// <summary>Sets the style of one node.</summary>
    public void Set(UiNodeId node, in UiLayoutStyle style) => _styles[node] = style;

    /// <summary>Removes the style of one node.</summary>
    public bool Remove(UiNodeId node) => _styles.Remove(node);

    /// <summary>Removes every explicit style.</summary>
    public void Clear() => _styles.Clear();

    /// <inheritdoc/>
    public bool TryGetLayoutStyle(UiNodeId node, out UiLayoutStyle style) => _styles.TryGetValue(node, out style);
}

/// <summary>
/// Adapts a document node tree, a style source and an optional content measurer
/// into the <see cref="IUiLayoutTree"/> surface the engine consumes. Node
/// adapters are cached once per identity, so repeated passes allocate nothing.
/// </summary>
public sealed class UiLayoutTree : IUiLayoutTree
{
    private readonly IUiNodeTree _nodes;
    private readonly IUiLayoutStyleSource _styles;
    private readonly IUiContentMeasurer? _content;
    private readonly Dictionary<UiNodeId, UiLayoutNode> _adapters = new();

    /// <summary>Creates a layout tree view.</summary>
    /// <param name="nodes">Document node tree.</param>
    /// <param name="styles">Per-node layout style source.</param>
    /// <param name="content">Optional leaf content measurer.</param>
    public UiLayoutTree(IUiNodeTree nodes, IUiLayoutStyleSource styles, IUiContentMeasurer? content = null)
    {
        ArgumentNullException.ThrowIfNull(nodes);
        ArgumentNullException.ThrowIfNull(styles);
        _nodes = nodes;
        _styles = styles;
        _content = content;
    }

    /// <summary>Gets the underlying document node tree.</summary>
    public IUiNodeTree Nodes => _nodes;

    /// <inheritdoc/>
    public bool TryGetNode(UiNodeId id, out IUiLayoutNode? node)
    {
        if (!_nodes.TryGetNode(id, out _))
        {
            node = null;
            return false;
        }

        if (!_adapters.TryGetValue(id, out UiLayoutNode? adapter))
        {
            adapter = new UiLayoutNode(this, id);
            _adapters.Add(id, adapter);
        }

        node = adapter;
        return true;
    }

    internal UiLayoutStyle GetStyle(UiNodeId id) =>
        _styles.TryGetLayoutStyle(id, out UiLayoutStyle style) ? style : UiLayoutStyle.Default;

    internal ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id) => _nodes.GetChildren(id);

    internal UiSize MeasureContent(UiNodeId id, in UiMeasureConstraints constraints)
    {
        if (_content is not null && _content.TryMeasureContent(id, in constraints, out UiSize size))
        {
            return size;
        }

        return default;
    }
}

/// <summary>Cached adapter from a document node to the layout node contract.</summary>
internal sealed class UiLayoutNode : IUiLayoutNode
{
    private readonly UiLayoutTree _owner;

    public UiLayoutNode(UiLayoutTree owner, UiNodeId id)
    {
        _owner = owner;
        Id = id;
    }

    public UiNodeId Id { get; }

    public UiLayoutStyle Style => _owner.GetStyle(Id);

    public ReadOnlySpan<UiNodeId> Children => _owner.GetChildren(Id);

    public UiSize MeasureContent(in UiMeasureConstraints constraints) => _owner.MeasureContent(Id, in constraints);
}
