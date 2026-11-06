namespace Axrone.Ui.Assets;

/// <summary>
/// Mutable document builder implementing the frozen <see cref="IUiDocumentBuilder"/>
/// contract plus the authored payload setters. Builds copy the tree into a new
/// independent document; the builder stays reusable.
/// </summary>
public sealed class UiAssetDocumentBuilder : IUiDocumentBuilder
{
    private const int MinimumCapacity = 4;

    private UiNodeKind[] _kinds = new UiNodeKind[MinimumCapacity];
    private UiNodeFlags[] _flags = new UiNodeFlags[MinimumCapacity];
    private bool[] _alive = new bool[MinimumCapacity];
    private int[] _parent = new int[MinimumCapacity];
    private int[] _firstChild = new int[MinimumCapacity];
    private int[] _nextSibling = new int[MinimumCapacity];
    private int[] _lastChild = new int[MinimumCapacity];
    private UiLayoutStyle[] _layouts = new UiLayoutStyle[MinimumCapacity];
    private UiWidgetStyle[] _styles = new UiWidgetStyle[MinimumCapacity];
    private UiNodeText[] _texts = new UiNodeText[MinimumCapacity];
    private UiNodeImage[] _images = new UiNodeImage[MinimumCapacity];
    private UiNodeFocus[] _focuses = new UiNodeFocus[MinimumCapacity];
    private string?[] _materials = new string?[MinimumCapacity];
    private string?[] _roles = new string?[MinimumCapacity];
    private string?[] _controllers = new string?[MinimumCapacity];
    private UiBindingKey[] _keys = new UiBindingKey[MinimumCapacity];
    private UiNodePresence[] _presence = new UiNodePresence[MinimumCapacity];
    private int[] _map = new int[MinimumCapacity];

    private readonly Queue<int> _queue = new();
    private readonly Stack<int> _deadStack = new();
    private int _count;

    /// <summary>Gets the number of live nodes.</summary>
    public int NodeCount
    {
        get
        {
            int live = 0;
            for (int i = 0; i < _count; i++)
            {
                if (_alive[i])
                {
                    live++;
                }
            }

            return live;
        }
    }

    /// <summary>Gets the binding builder staged for the next build.</summary>
    public UiBindingTableBuilder Bindings { get; } = new();

    /// <summary>Gets or sets the asset identifier carried by the next build.</summary>
    public string AssetId { get; set; } = string.Empty;

    /// <summary>Creates a node and returns its document-local identity.</summary>
    public UiNodeId CreateNode(UiNodeKind kind, UiNodeFlags flags)
    {
        EnsureCapacity(_count + 1);
        int index = _count;
        _count++;
        _kinds[index] = kind;
        _flags[index] = flags;
        _alive[index] = true;
        _parent[index] = -1;
        _firstChild[index] = -1;
        _nextSibling[index] = -1;
        _lastChild[index] = -1;
        _layouts[index] = UiLayoutStyle.Default;
        _styles[index] = UiWidgetStyle.Default;
        _texts[index] = UiNodeText.Default;
        _images[index] = UiNodeImage.Default;
        _focuses[index] = UiNodeFocus.Default;
        _materials[index] = null;
        _roles[index] = null;
        _controllers[index] = null;
        _keys[index] = UiBindingKey.None;
        _presence[index] = UiNodePresence.None;
        return new UiNodeId((uint)(index + 1));
    }

    /// <summary>Appends a child to a parent.</summary>
    public bool TryAppendChild(UiNodeId parent, UiNodeId child)
    {
        int p = (int)parent.Value - 1;
        int c = (int)child.Value - 1;
        if (!IsLive(p) || !IsLive(c) || p == c || _parent[c] >= 0)
        {
            return false;
        }

        for (int ancestor = p; ancestor >= 0; ancestor = _parent[ancestor])
        {
            if (ancestor == c)
            {
                return false;
            }
        }

        _parent[c] = p;
        if (_firstChild[p] < 0)
        {
            _firstChild[p] = c;
        }
        else
        {
            _nextSibling[_lastChild[p]] = c;
        }

        _lastChild[p] = c;
        return true;
    }

    /// <summary>Removes a node and its subtree.</summary>
    public bool TryRemoveNode(UiNodeId node)
    {
        int root = (int)node.Value - 1;
        if (!IsLive(root))
        {
            return false;
        }

        int parent = _parent[root];
        if (parent >= 0)
        {
            if (_firstChild[parent] == root)
            {
                _firstChild[parent] = _nextSibling[root];
            }
            else
            {
                int sibling = _firstChild[parent];
                while (sibling >= 0 && _nextSibling[sibling] != root)
                {
                    sibling = _nextSibling[sibling];
                }

                if (sibling >= 0)
                {
                    _nextSibling[sibling] = _nextSibling[root];
                }
            }

            if (_lastChild[parent] == root)
            {
                _lastChild[parent] = -1;
                int sibling = _firstChild[parent];
                while (sibling >= 0)
                {
                    _lastChild[parent] = sibling;
                    sibling = _nextSibling[sibling];
                }
            }
        }

        _deadStack.Push(root);
        while (_deadStack.Count > 0)
        {
            int current = _deadStack.Pop();
            _alive[current] = false;
            _presence[current] = UiNodePresence.None;
            _roles[current] = null;
            _controllers[current] = null;
            _texts[current] = UiNodeText.Default;
            _images[current] = UiNodeImage.Default;
            for (int child = _firstChild[current]; child >= 0; child = _nextSibling[child])
            {
                _deadStack.Push(child);
            }

            _firstChild[current] = -1;
            _nextSibling[current] = -1;
            _parent[current] = -1;
            _lastChild[current] = -1;
        }

        return true;
    }

    /// <summary>Builds an independent document over the current tree.</summary>
    public UiAssetDocument Build(in UiDocumentInfo info)
    {
        ArgumentException.ThrowIfNullOrEmpty(info.Name);
        if (info.Version <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(info), "Document version must be positive.");
        }

        int root = FindRoot();
        if (root < 0)
        {
            throw new InvalidOperationException("A document requires exactly one root node with no parent.");
        }

        var storage = new UiDocumentStorage(Math.Max(NodeCount, 1), Math.Max(Bindings.Count, 1), 256);
        _queue.Clear();
        _queue.Enqueue(root);
        UiNodeId newRoot = UiNodeId.Invalid;

        while (_queue.Count > 0)
        {
            int old = _queue.Dequeue();
            UiNodeId created = storage.AddNode(_kinds[old], _flags[old]);
            _map[old] = (int)created.Value;
            CopyPayload(old, created, storage);
            if (!newRoot.IsValid)
            {
                newRoot = created;
            }
            else
            {
                _ = storage.LinkChild(new UiNodeId((uint)_map[_parent[old]]), created);
            }

            for (int child = _firstChild[old]; child >= 0; child = _nextSibling[child])
            {
                _queue.Enqueue(child);
            }
        }

        if (!storage.Publish(newRoot))
        {
            throw new InvalidOperationException("The staged tree could not be published.");
        }

        Bindings.CopyTo(storage);
        return new UiAssetDocument(storage, in info, AssetId);
    }

    IUiDocument IUiDocumentBuilder.Build(in UiDocumentInfo info) => Build(in info);

    /// <summary>Sets the authored role of a node.</summary>
    public bool TrySetRole(UiNodeId node, ReadOnlySpan<char> role)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index) || role.IsEmpty)
        {
            return false;
        }

        _roles[index] = new string(role);
        _presence[index] |= UiNodePresence.Role;
        return true;
    }

    /// <summary>Sets the controller type of a node.</summary>
    public bool TrySetController(UiNodeId node, ReadOnlySpan<char> controller)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index) || controller.IsEmpty)
        {
            return false;
        }

        _controllers[index] = new string(controller);
        _presence[index] |= UiNodePresence.Controller;
        return true;
    }

    /// <summary>Sets the authored key of a node.</summary>
    public bool TrySetKey(UiNodeId node, in UiBindingKey key)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index) || key.Kind == UiKeyKind.None)
        {
            return false;
        }

        _keys[index] = key;
        _presence[index] |= UiNodePresence.Key;
        return true;
    }

    /// <summary>Sets the layout style of a node.</summary>
    public bool TrySetLayout(UiNodeId node, in UiLayoutStyle layout)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            return false;
        }

        _layouts[index] = layout;
        return true;
    }

    /// <summary>Sets the widget style of a node.</summary>
    public bool TrySetStyle(UiNodeId node, in UiWidgetStyle style)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            return false;
        }

        _styles[index] = style;
        return true;
    }

    /// <summary>Sets the text block of a node.</summary>
    public bool TrySetText(UiNodeId node, in UiNodeText text)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            return false;
        }

        _texts[index] = text;
        _presence[index] |= UiNodePresence.Text;
        return true;
    }

    /// <summary>Sets the image block of a node.</summary>
    public bool TrySetImage(UiNodeId node, in UiNodeImage image)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            return false;
        }

        _images[index] = image;
        _presence[index] |= UiNodePresence.Image;
        return true;
    }

    /// <summary>Sets the focus policy of a node.</summary>
    public bool TrySetFocus(UiNodeId node, in UiNodeFocus focus)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            return false;
        }

        _focuses[index] = focus;
        _presence[index] |= UiNodePresence.Focus;
        return true;
    }

    /// <summary>Sets the authored material identifier of a node.</summary>
    public bool TrySetMaterial(UiNodeId node, ReadOnlySpan<char> material)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index) || material.IsEmpty)
        {
            return false;
        }

        _materials[index] = new string(material);
        _presence[index] |= UiNodePresence.Material;
        return true;
    }

    /// <summary>Clears the builder for the next document.</summary>
    public void Reset()
    {
        _count = 0;
        _queue.Clear();
        _deadStack.Clear();
        Bindings.Clear();
        AssetId = string.Empty;
    }

    internal bool TryGetStagedLayout(UiNodeId node, out UiLayoutStyle layout)
    {
        int index = (int)node.Value - 1;
        if (!IsLive(index))
        {
            layout = UiLayoutStyle.Default;
            return false;
        }

        layout = _layouts[index];
        return true;
    }

    private void CopyPayload(int old, UiNodeId created, UiDocumentStorage storage)
    {
        if ((_presence[old] & UiNodePresence.Role) != 0)
        {
            _ = storage.TryAppendString(_roles[old].AsSpan(), out UiStringRef role);
            storage.SetRole(created, role);
        }

        if ((_presence[old] & UiNodePresence.Controller) != 0)
        {
            _ = storage.TryAppendString(_controllers[old].AsSpan(), out UiStringRef controller);
            storage.SetController(created, controller);
        }

        if ((_presence[old] & UiNodePresence.Key) != 0)
        {
            UiBindingKey key = _keys[old];
            UiStringRef text = UiStringRef.Empty;
            if (key.Kind == UiKeyKind.Text)
            {
                _ = storage.TryAppendString(key.Text.AsSpan(), out text);
            }

            storage.SetKey(created, new UiBindingKeyCore(key.Kind, key.Number, text));
        }

        storage.SetLayout(created, in _layouts[old]);
        storage.SetStyle(created, in _styles[old]);

        if ((_presence[old] & UiNodePresence.Text) != 0)
        {
            UiNodeText text = _texts[old];
            _ = storage.TryAppendString(text.Value.AsSpan(), out UiStringRef value);
            _ = storage.TryAppendString(text.Family.AsSpan(), out UiStringRef family);
            storage.SetText(
                created,
                new UiNodeTextCore(
                    value,
                    family,
                    text.Size,
                    text.LineHeight,
                    text.LetterSpacing,
                    text.Weight,
                    text.FontStyle,
                    text.Wrap,
                    text.Overflow,
                    text.Align,
                    text.Direction,
                    text.MaxLines,
                    text.AutoSize,
                    text.MinFontSize,
                    text.MaxFontSize));
        }

        if ((_presence[old] & UiNodePresence.Image) != 0)
        {
            UiNodeImage image = _images[old];
            _ = storage.TryAppendString(image.ResourceId.AsSpan(), out UiStringRef resourceId);
            storage.SetImage(
                created,
                new UiNodeImageCore(
                    resourceId,
                    image.SourceKind,
                    image.Fit,
                    image.Tint,
                    image.Border,
                    image.UvRect,
                    image.SourceSize,
                    image.FillCenter,
                    image.Bleed));
        }

        if ((_presence[old] & UiNodePresence.Focus) != 0)
        {
            storage.SetFocus(created, in _focuses[old]);
        }

        if ((_presence[old] & UiNodePresence.Material) != 0)
        {
            _ = storage.TryAppendString(_materials[old].AsSpan(), out UiStringRef material);
            storage.SetMaterial(created, material);
        }
    }

    private int FindRoot()
    {
        int root = -1;
        for (int i = 0; i < _count; i++)
        {
            if (!_alive[i] || _parent[i] >= 0)
            {
                continue;
            }

            if (root >= 0)
            {
                return -1;
            }

            root = i;
        }

        return root;
    }

    private bool IsLive(int index) => (uint)index < (uint)_count && _alive[index];

    private void EnsureCapacity(int required)
    {
        if (required <= _kinds.Length)
        {
            return;
        }

        int capacity = _kinds.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        Array.Resize(ref _kinds, capacity);
        Array.Resize(ref _flags, capacity);
        Array.Resize(ref _alive, capacity);
        Array.Resize(ref _parent, capacity);
        Array.Resize(ref _firstChild, capacity);
        Array.Resize(ref _nextSibling, capacity);
        Array.Resize(ref _lastChild, capacity);
        Array.Resize(ref _layouts, capacity);
        Array.Resize(ref _styles, capacity);
        Array.Resize(ref _texts, capacity);
        Array.Resize(ref _images, capacity);
        Array.Resize(ref _focuses, capacity);
        Array.Resize(ref _materials, capacity);
        Array.Resize(ref _roles, capacity);
        Array.Resize(ref _controllers, capacity);
        Array.Resize(ref _keys, capacity);
        Array.Resize(ref _presence, capacity);
        Array.Resize(ref _map, capacity);
    }
}
