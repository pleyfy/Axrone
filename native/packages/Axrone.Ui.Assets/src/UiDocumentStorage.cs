namespace Axrone.Ui.Assets;

/// <summary>Presence bits for optional per-node payloads.</summary>
[Flags]
internal enum UiNodePresence : byte
{
    None = 0,
    Role = 1 << 0,
    Controller = 1 << 1,
    Key = 1 << 2,
    Text = 1 << 3,
    Image = 1 << 4,
    Focus = 1 << 5,
    Material = 1 << 6,
}

/// <summary>Interned UTF-8 slice into the owning document arena.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiStringRef(int Offset, int Length)
{
    public static UiStringRef Empty => new(0, 0);

    public bool IsEmpty => Length <= 0;
}

/// <summary>Internal text payload; strings stay in the arena as slices.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiNodeTextCore(
    UiStringRef Value,
    UiStringRef Family,
    float Size,
    float LineHeight,
    float LetterSpacing,
    UiFontWeight Weight,
    UiFontStyle FontStyle,
    UiTextWrap Wrap,
    UiTextOverflow Overflow,
    UiTextAlign Align,
    UiTextDirection Direction,
    int MaxLines);

/// <summary>Internal image payload; the resource stays in the arena as a slice.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiNodeImageCore(
    UiStringRef ResourceId,
    UiImageSourceKind SourceKind,
    UiImageFit Fit,
    UiColor Tint,
    UiEdgeInsets Border,
    UiUvRect UvRect,
    UiSize SourceSize,
    bool FillCenter,
    bool Bleed);

/// <summary>Internal key payload; string keys stay in the arena as slices.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
internal readonly record struct UiBindingKeyCore(UiKeyKind Kind, long Number, UiStringRef Text)
{
    public static UiBindingKeyCore None => default;
}

/// <summary>
/// Dense, reusable document storage: node records, side payload arrays, a
/// compact UTF-8 arena for every authored string, interned bindings and a
/// CSR child index. <see cref="Reset"/> invalidates every slice without
/// releasing buffers, which is what makes warm reads allocation-free.
/// </summary>
internal sealed class UiDocumentStorage : IUiNodeTree
{
    private const int MinimumNodeCapacity = 4;
    private const int MinimumUtf8Capacity = 256;

    private UiNodeRecord[] _records;
    private UiLayoutStyle[] _layouts;
    private UiWidgetStyle[] _styles;
    private UiNodeTextCore[] _texts;
    private UiNodeImageCore[] _images;
    private UiNodeFocus[] _focuses;
    private UiResourceId[] _materials;
    private UiStringRef[] _roles;
    private UiStringRef[] _controllers;
    private UiBindingKeyCore[] _keys;
    private UiNodePresence[] _presence;

    private int[] _childCount;
    private int[] _childStart;
    private int[] _childCursor;
    private int[] _lastChild;
    private UiNodeId[] _children;

    private UiStringRef[] _bindingNames;
    private UiBindingValue[] _bindingValues;
    private UiStringRef[] _bindingTexts;

    private byte[] _utf8;
    private int _utf8Used;
    private int _nodeCount;
    private int _bindingCount;
    private int _childTotal;
    private UiNodeId _root;

    public UiDocumentStorage(int nodeCapacity, int bindingCapacity, int utf8Capacity)
    {
        int nodes = Math.Max(nodeCapacity, MinimumNodeCapacity);
        int bindings = Math.Max(bindingCapacity, 1);
        int utf8 = Math.Max(utf8Capacity, MinimumUtf8Capacity);

        _records = new UiNodeRecord[nodes];
        _layouts = new UiLayoutStyle[nodes];
        _styles = new UiWidgetStyle[nodes];
        _texts = new UiNodeTextCore[nodes];
        _images = new UiNodeImageCore[nodes];
        _focuses = new UiNodeFocus[nodes];
        _materials = new UiResourceId[nodes];
        _roles = new UiStringRef[nodes];
        _controllers = new UiStringRef[nodes];
        _keys = new UiBindingKeyCore[nodes];
        _presence = new UiNodePresence[nodes];
        _childCount = new int[nodes];
        _childStart = new int[nodes + 1];
        _childCursor = new int[nodes];
        _lastChild = new int[nodes];
        _children = new UiNodeId[nodes];
        _bindingNames = new UiStringRef[bindings];
        _bindingValues = new UiBindingValue[bindings];
        _bindingTexts = new UiStringRef[bindings];
        _utf8 = new byte[utf8];

        _childStart[0] = 0;
        _root = UiNodeId.Invalid;
    }

    public int Count => _nodeCount;

    public UiNodeId Root => _root;

    internal int BindingCount => _bindingCount;

    internal byte[] Utf8Buffer => _utf8;

    internal UiNodeRecord[] Records => _records;

    internal UiLayoutStyle[] Layouts => _layouts;

    internal UiWidgetStyle[] Styles => _styles;

    internal UiNodeTextCore[] Texts => _texts;

    internal UiNodeImageCore[] Images => _images;

    internal UiNodeFocus[] Focuses => _focuses;

    internal UiResourceId[] Materials => _materials;

    internal UiStringRef[] Roles => _roles;

    internal UiStringRef[] Controllers => _controllers;

    internal UiBindingKeyCore[] Keys => _keys;

    internal UiNodePresence[] Presence => _presence;

    internal UiStringRef[] BindingNames => _bindingNames;

    internal UiBindingValue[] BindingValues => _bindingValues;

    internal UiStringRef[] BindingTexts => _bindingTexts;

    internal bool HasPresence(UiNodeId id, UiNodePresence flag)
    {
        int index = (int)id.Value - 1;
        return (uint)index < (uint)_nodeCount && (_presence[index] & flag) != 0;
    }

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        int index = (int)id.Value - 1;
        if ((uint)index >= (uint)_nodeCount)
        {
            record = default;
            return false;
        }

        record = _records[index];
        return true;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id)
    {
        int index = (int)id.Value - 1;
        if ((uint)index >= (uint)_nodeCount)
        {
            return ReadOnlySpan<UiNodeId>.Empty;
        }

        int start = _childStart[index];
        int end = _childStart[index + 1];
        return new ReadOnlySpan<UiNodeId>(_children, start, end - start);
    }

    internal ReadOnlySpan<UiNodeId> ChildrenOf(int index)
    {
        int start = _childStart[index];
        int end = _childStart[index + 1];
        return new ReadOnlySpan<UiNodeId>(_children, start, end - start);
    }

    public void Reset()
    {
        _nodeCount = 0;
        _bindingCount = 0;
        _utf8Used = 0;
        _childTotal = 0;
        _root = UiNodeId.Invalid;
    }

    internal bool EnsureNodeCapacity(int required)
    {
        if (required <= _records.Length)
        {
            return true;
        }

        if (required > int.MaxValue / 2)
        {
            return false;
        }

        int capacity = _records.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        Array.Resize(ref _records, capacity);
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
        Array.Resize(ref _childCount, capacity);
        Array.Resize(ref _childStart, capacity + 1);
        Array.Resize(ref _childCursor, capacity);
        Array.Resize(ref _lastChild, capacity);
        Array.Resize(ref _children, capacity);
        return true;
    }

    internal UiNodeId AddNode(UiNodeKind kind, UiNodeFlags flags)
    {
        int index = _nodeCount;
        _nodeCount = index + 1;
        int id = index + 1;

        _records[index] = new UiNodeRecord(
            new UiNodeId((uint)id),
            UiNodeId.Invalid,
            UiNodeId.Invalid,
            UiNodeId.Invalid,
            kind,
            flags);
        _layouts[index] = UiLayoutStyle.Default;
        _styles[index] = UiWidgetStyle.Default;
        _texts[index] = default;
        _images[index] = default;
        _focuses[index] = UiNodeFocus.Default;
        _materials[index] = UiResourceId.Invalid;
        _roles[index] = UiStringRef.Empty;
        _controllers[index] = UiStringRef.Empty;
        _keys[index] = UiBindingKeyCore.None;
        _presence[index] = UiNodePresence.None;
        _childCount[index] = 0;
        _childStart[index] = 0;
        _lastChild[index] = -1;
        return new UiNodeId((uint)id);
    }

    internal void SetKind(UiNodeId id, UiNodeKind kind)
    {
        int index = (int)id.Value - 1;
        _records[index] = _records[index] with { Kind = kind };
    }

    internal void SetFlags(UiNodeId id, UiNodeFlags flags)
    {
        int index = (int)id.Value - 1;
        _records[index] = _records[index] with { Flags = flags };
    }

    internal void SetRole(UiNodeId id, UiStringRef role)
    {
        int index = (int)id.Value - 1;
        _roles[index] = role;
        _presence[index] |= UiNodePresence.Role;
    }

    internal void SetController(UiNodeId id, UiStringRef controller)
    {
        int index = (int)id.Value - 1;
        _controllers[index] = controller;
        _presence[index] |= UiNodePresence.Controller;
    }

    internal void SetKey(UiNodeId id, in UiBindingKeyCore key)
    {
        int index = (int)id.Value - 1;
        _keys[index] = key;
        _presence[index] |= UiNodePresence.Key;
    }

    internal void SetLayout(UiNodeId id, in UiLayoutStyle layout)
    {
        _layouts[(int)id.Value - 1] = layout;
    }

    internal void SetStyle(UiNodeId id, in UiWidgetStyle style)
    {
        _styles[(int)id.Value - 1] = style;
    }

    internal void SetText(UiNodeId id, in UiNodeTextCore text)
    {
        int index = (int)id.Value - 1;
        _texts[index] = text;
        _presence[index] |= UiNodePresence.Text;
    }

    internal void SetImage(UiNodeId id, in UiNodeImageCore image)
    {
        int index = (int)id.Value - 1;
        _images[index] = image;
        _presence[index] |= UiNodePresence.Image;
    }

    internal void SetFocus(UiNodeId id, in UiNodeFocus focus)
    {
        int index = (int)id.Value - 1;
        _focuses[index] = focus;
        _presence[index] |= UiNodePresence.Focus;
    }

    internal void SetMaterial(UiNodeId id, UiResourceId material)
    {
        int index = (int)id.Value - 1;
        _materials[index] = material;
        _presence[index] |= UiNodePresence.Material;
    }

    internal bool LinkChild(UiNodeId parent, UiNodeId child)
    {
        int p = (int)parent.Value - 1;
        int c = (int)child.Value - 1;
        if ((uint)p >= (uint)_nodeCount || (uint)c >= (uint)_nodeCount)
        {
            return false;
        }

        if (parent == child || _records[c].Parent.IsValid)
        {
            return false;
        }

        _records[c] = _records[c] with { Parent = parent };
        UiNodeRecord parentRecord = _records[p];
        if (!parentRecord.FirstChild.IsValid)
        {
            _records[p] = parentRecord with { FirstChild = child };
        }
        else
        {
            int last = _lastChild[p];
            _records[last] = _records[last] with { NextSibling = child };
        }

        _lastChild[p] = c;
        _childCount[p]++;
        _childTotal++;
        return true;
    }

    internal bool Publish(UiNodeId root)
    {
        if (!root.IsValid || root.Value > (uint)_nodeCount)
        {
            return false;
        }

        int rootIndex = (int)root.Value - 1;
        if (_records[rootIndex].Parent.IsValid)
        {
            return false;
        }

        _root = root;
        int capacity = _nodeCount + 1;
        if (_childStart.Length < capacity)
        {
            Array.Resize(ref _childStart, capacity);
        }

        _childStart[0] = 0;
        for (int i = 0; i < _nodeCount; i++)
        {
            _childStart[i + 1] = _childStart[i] + _childCount[i];
        }

        int total = _childStart[_nodeCount];
        if (_children.Length < total)
        {
            Array.Resize(ref _children, total);
        }

        for (int i = 0; i < _nodeCount; i++)
        {
            _childCursor[i] = _childStart[i];
        }

        for (int i = 0; i < _nodeCount; i++)
        {
            UiNodeId parent = _records[i].Parent;
            if (parent.IsValid)
            {
                int p = (int)parent.Value - 1;
                int slot = _childCursor[p]++;
                _children[slot] = new UiNodeId((uint)(i + 1));
            }
        }

        return true;
    }

    internal bool TryAppendUtf8(ReadOnlySpan<byte> utf8, out UiStringRef reference)
    {
        if (utf8.IsEmpty)
        {
            reference = UiStringRef.Empty;
            return true;
        }

        if (!EnsureUtf8Capacity(_utf8Used + utf8.Length))
        {
            reference = UiStringRef.Empty;
            return false;
        }

        utf8.CopyTo(_utf8.AsSpan(_utf8Used, utf8.Length));
        reference = new UiStringRef(_utf8Used, utf8.Length);
        _utf8Used += utf8.Length;
        return true;
    }

    internal bool TryAppendString(ReadOnlySpan<char> value, out UiStringRef reference)
    {
        if (value.IsEmpty)
        {
            reference = UiStringRef.Empty;
            return true;
        }

        int maxBytes = Encoding.UTF8.GetMaxByteCount(value.Length);
        if (!EnsureUtf8Capacity(_utf8Used + maxBytes))
        {
            reference = UiStringRef.Empty;
            return false;
        }

        if (!Encoding.UTF8.TryGetBytes(value, _utf8.AsSpan(_utf8Used), out int written))
        {
            reference = UiStringRef.Empty;
            return false;
        }

        reference = new UiStringRef(_utf8Used, written);
        _utf8Used += written;
        return true;
    }

    internal ReadOnlySpan<byte> GetUtf8(UiStringRef reference)
    {
        if (reference.IsEmpty)
        {
            return ReadOnlySpan<byte>.Empty;
        }

        return new ReadOnlySpan<byte>(_utf8, reference.Offset, reference.Length);
    }

    internal bool EnsureBindingCapacity(int required)
    {
        if (required <= _bindingNames.Length)
        {
            return true;
        }

        int capacity = _bindingNames.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        Array.Resize(ref _bindingNames, capacity);
        Array.Resize(ref _bindingValues, capacity);
        Array.Resize(ref _bindingTexts, capacity);
        return true;
    }

    internal void AddBinding(UiStringRef name, in UiBindingValue value, UiStringRef text)
    {
        int index = _bindingCount;
        _bindingNames[index] = name;
        _bindingValues[index] = value;
        _bindingTexts[index] = text;
        _bindingCount = index + 1;
    }

    internal bool TryFindBinding(ReadOnlySpan<byte> name, out int index)
    {
        int low = 0;
        int high = _bindingCount - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int order = GetUtf8(_bindingNames[middle]).SequenceCompareTo(name);
            if (order == 0)
            {
                index = middle;
                return true;
            }

            if (order < 0)
            {
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        index = -1;
        return false;
    }

    internal void SortBindings()
    {
        for (int i = 1; i < _bindingCount; i++)
        {
            UiStringRef name = _bindingNames[i];
            UiBindingValue value = _bindingValues[i];
            UiStringRef text = _bindingTexts[i];
            int j = i - 1;
            while (j >= 0 && GetUtf8(_bindingNames[j]).SequenceCompareTo(GetUtf8(name)) > 0)
            {
                _bindingNames[j + 1] = _bindingNames[j];
                _bindingValues[j + 1] = _bindingValues[j];
                _bindingTexts[j + 1] = _bindingTexts[j];
                j--;
            }

            _bindingNames[j + 1] = name;
            _bindingValues[j + 1] = value;
            _bindingTexts[j + 1] = text;
        }
    }

    private bool EnsureUtf8Capacity(int required)
    {
        if (required <= _utf8.Length)
        {
            return true;
        }

        if (required > int.MaxValue / 2)
        {
            return false;
        }

        int capacity = _utf8.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        Array.Resize(ref _utf8, capacity);
        return true;
    }
}
