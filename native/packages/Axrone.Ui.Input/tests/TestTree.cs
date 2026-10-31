namespace Axrone.Ui.Input.Tests;

using System.Runtime.InteropServices;
using Axrone.Geometry;
using Axrone.Ui;

internal sealed class TestTree : IUiNodeTree
{
    private readonly Dictionary<uint, Node> _nodes = new();
    private uint _nextId = 1;

    public TestTree()
        : this(autoCreateRoot: true)
    {
    }

    private TestTree(bool autoCreateRoot)
    {
        Root = autoCreateRoot ? Create(UiNodeId.Invalid, UiNodeKind.Root, UiNodeFlags.Visible) : UiNodeId.Invalid;
    }

    public int Count => _nodes.Count;

    public UiNodeId Root { get; }

    public UiNodeId Add(UiNodeId parent, UiNodeKind kind, UiNodeFlags flags)
    {
        UiNodeId id = Create(parent, kind, flags);
        _nodes[parent.Value].Children.Add(id);
        return id;
    }

    public void SetFlags(UiNodeId id, UiNodeFlags flags) =>
        _nodes[id.Value].Record = _nodes[id.Value].Record with { Flags = flags };

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        if (!id.IsValid || !_nodes.TryGetValue(id.Value, out Node? node))
        {
            record = default;
            return false;
        }

        UiNodeId first = node.Children.Count > 0 ? node.Children[0] : UiNodeId.Invalid;
        record = node.Record with { FirstChild = first, NextSibling = NextSiblingOf(node) };
        return true;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id) =>
        _nodes.TryGetValue(id.Value, out Node? node)
            ? CollectionsMarshal.AsSpan(node.Children)
            : ReadOnlySpan<UiNodeId>.Empty;

    private UiNodeId Create(UiNodeId parent, UiNodeKind kind, UiNodeFlags flags)
    {
        var id = new UiNodeId(_nextId++);
        _nodes[id.Value] = new Node(new UiNodeRecord(id, parent, UiNodeId.Invalid, UiNodeId.Invalid, kind, flags));
        return id;
    }

    private UiNodeId NextSiblingOf(Node node)
    {
        UiNodeId parent = node.Record.Parent;
        if (!parent.IsValid)
        {
            return UiNodeId.Invalid;
        }

        List<UiNodeId> siblings = _nodes[parent.Value].Children;
        int index = siblings.IndexOf(node.Record.Id);
        return index >= 0 && index + 1 < siblings.Count ? siblings[index + 1] : UiNodeId.Invalid;
    }

    private sealed class Node(UiNodeRecord record)
    {
        public UiNodeRecord Record { get; set; } = record;

        public List<UiNodeId> Children { get; } = [];
    }
}

internal sealed class TestBounds : IUiNodeBounds
{
    private readonly Dictionary<UiNodeId, Aabb2D> _boxes = new();

    public void Set(UiNodeId node, float minX, float minY, float maxX, float maxY) =>
        _boxes[node] = new Aabb2D(minX, minY, maxX, maxY);

    public bool TryGetBounds(UiNodeId node, out Aabb2D bounds) => _boxes.TryGetValue(node, out bounds);
}
