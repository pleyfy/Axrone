namespace Axrone.Ui.Controls;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>
/// Retained control runtime: owns the mutable node tree, per-control state, layout,
/// style, hit testing, focus and input routing for the built-in control catalog.
/// </summary>
/// <remarks>
/// <para>Single-threaded. Structural operations (create, mount, destroy, layout
/// style changes, text changes) may allocate; steady-state state updates, input
/// dispatch and catalog lookups do not.</para>
/// <para>Every control has one primary node; dropdowns add one popup node and
/// radio groups add one node per option. Controls added to a scroll view are
/// offset in the layout sink, so scrolling re-arranges instead of mutating styles.</para>
/// </remarks>
public sealed class UiControlRuntime : IDisposable
{
    private const int InitialEntries = 16;
    private const int MaxAncestorDepth = 512;
    private const ushort TabKeyCode = ControlKeys.Tab;
    private const float DefaultToastSeconds = 3.0f;

    private readonly ControlNodeTree _tree;
    private readonly UiTextContentMeasurer? _textContent;
    private readonly IUiTextMeasurer? _measurer;
    private readonly IUiImageMetrics? _images;
    private readonly IUiControlEventSink? _events;
    private readonly UiControlTheme _tokens;
    private readonly UiWidgetRegistry? _widgets;
    private readonly UiTextStyle _defaultTextStyle;
    private readonly ControlStyleContext _styleContext;
    private readonly UiLayoutStyleTable _layoutStyles = new();
    private readonly UiLayoutTree _layoutTree;
    private readonly UiLayoutEngine _layoutEngine = new();
    private readonly UiDirtyTracker _dirty = new();
    private readonly ControlLayoutSink _sink;
    private readonly UiLayoutRunner _runner;
    private readonly UiStyleSource _styles;
    private readonly UiHitTestIndex _hitIndex;
    private readonly ControlBoundsView _boundsView;
    private readonly UiFocusManager _focus;
    private readonly UiPointerCapture _capture;
    private readonly ControlReceiverResolver _resolver;
    private readonly Dictionary<UiNodeId, ControlInputReceiver> _receivers = new();
    private readonly Dictionary<UiNodeId, Rect> _bounds = new();
    private readonly UiInputRouter _router;
    private readonly List<UiNodeId> _scratch = [];
    private ControlEntry[] _entries = new ControlEntry[InitialEntries];
    private uint[] _generations = new uint[InitialEntries];
    private bool[] _live = new bool[InitialEntries];
    private int[] _freeEntries = new int[InitialEntries];
    private int _entryCount;
    private int _freeEntryCount;
    private bool _hitSyncDirty = true;
    private bool _disposed;

    /// <summary>Creates a runtime with a root container filling the viewport.</summary>
    public UiControlRuntime(in UiControlRuntimeOptions options)
    {
        _events = options.Events;
        _images = options.Images;
        _measurer = options.TextMeasurer;
        _tokens = options.ThemeTokens ?? UiControlTheme.Default;
        _widgets = options.Widgets;
        _defaultTextStyle = options.DefaultTextStyle;
        _styleContext = new ControlStyleContext(options.Theme, in _tokens);
        _tree = new ControlNodeTree();
        _textContent = options.TextMeasurer is null
            ? null
            : options.AutoSizing is null
                ? new UiTextContentMeasurer(options.TextMeasurer)
                : new UiTextContentMeasurer(options.TextMeasurer, options.AutoSizing);
        _sink = new ControlLayoutSink(this);
        _layoutTree = new UiLayoutTree(_tree, _layoutStyles, new ControlContentMeasurer(this));
        _runner = new UiLayoutRunner(_tree, _layoutTree, _layoutEngine, _sink, _dirty);
        _styles = new UiStyleSource(_tree, options.Theme);
        _boundsView = new ControlBoundsView(this);
        _hitIndex = new UiHitTestIndex(32, new UiTreeClipResolver(_tree, _boundsView));
        _focus = new UiFocusManager(_tree, _boundsView, new ControlFocusSink(this), _dirty);
        _capture = new UiPointerCapture(8, null, _focus);
        _resolver = new ControlReceiverResolver(this);
        _router = new UiInputRouter(new UiTreeRouteGraph(_tree), _hitIndex, _focus, _capture, _resolver);
        _layoutEngine.Viewport = options.Viewport;
        _layoutStyles.Set(
            _tree.Root,
            new UiLayoutStyle
            {
                Display = UiDisplayMode.Stack,
                Direction = UiAxis.Column,
                Width = UiLength.Stretch(1.0f),
                Height = UiLength.Stretch(1.0f),
                AlignItems = UiAlign.Stretch,
            });
        _dirty.Invalidate(new UiInvalidation(_tree.Root, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
    }

    /// <summary>Gets the live node tree, including the root container.</summary>
    public IUiNodeTree Nodes => _tree;

    /// <summary>Gets the root container node.</summary>
    public UiNodeId Root => _tree.Root;

    /// <summary>Gets the theme token map in use.</summary>
    internal UiControlTheme ThemeTokens => _tokens;

    /// <summary>Gets the control owning a node, when the node belongs to one.</summary>
    public bool TryGetControl(UiNodeId node, out UiControl control)
    {
        if (_tree.TryGetBinding(node, out ControlNodeBinding binding) &&
            TryResolveEntry(binding.Control, out int index))
        {
            control = CreateHandle(index, in _entries[index]);
            return true;
        }

        control = UiControl.Invalid;
        return false;
    }

    /// <summary>Creates a detached control; mount it to make it part of the tree.</summary>
    public UiControl CreateControl(ControlKind kind, in UiControlDefinition definition = default)
    {
        EnsureActive();
        if (!ControlCatalog.TryGet(kind, out ControlBehavior behavior))
        {
            ControlThrowHelper.ThrowInvalidKind(kind);
        }

        return CreateControlCore(kind, behavior, UiWidgetHandle.Invalid, in definition);
    }

    /// <summary>Creates a detached control for a widget registered in this runtime's registry.</summary>
    /// <param name="handle">Widget handle returned by <see cref="UiWidgetRegistry.Register"/>.</param>
    /// <param name="definition">Creation inputs consumed by the widget behavior.</param>
    /// <exception cref="InvalidOperationException">The runtime has no widget registry.</exception>
    /// <exception cref="ArgumentException"><paramref name="handle"/> is stale or foreign.</exception>
    public UiControl CreateControl(UiWidgetHandle handle, in UiControlDefinition definition = default)
    {
        EnsureActive();
        if (_widgets is null)
        {
            ControlThrowHelper.ThrowNoWidgetRegistry();
        }

        if (!_widgets.TryGetHandle(handle, out ControlBehavior behavior))
        {
            ControlThrowHelper.ThrowInvalidWidgetHandle();
        }

        return CreateControlCore(ControlKind.Custom, behavior, handle, in definition);
    }

    /// <summary>Creates and mounts a control for a registered widget under a parent control, or under the root.</summary>
    /// <param name="handle">Widget handle returned by <see cref="UiWidgetRegistry.Register"/>.</param>
    /// <param name="definition">Creation inputs consumed by the widget behavior.</param>
    /// <param name="parent">Parent control; the default mounts under the root.</param>
    public UiControl CreateControl(UiWidgetHandle handle, in UiControlDefinition definition, UiControl parent)
    {
        UiControl created = CreateControl(handle, in definition);
        if (!Mount(created, parent))
        {
            _ = DestroyControl(created);
            ControlThrowHelper.ThrowInvalidHandle();
        }

        return created;
    }

    private UiControl CreateControlCore(ControlKind kind, ControlBehavior behavior, UiWidgetHandle widget, in UiControlDefinition definition)
    {
        int index = AllocateEntry();
        _generations[index]++;
        bool startsHidden = kind is ControlKind.Tooltip or ControlKind.Toast or ControlKind.Dialog or ControlKind.Popup;
        UiNodeFlags flags =
            (startsHidden ? UiNodeFlags.None : UiNodeFlags.Visible) |
            UiNodeFlags.Enabled |
            (behavior.Interactive ? UiNodeFlags.Interactive : UiNodeFlags.None) |
            (behavior.Focusable ? UiNodeFlags.Focusable : UiNodeFlags.None) |
            (kind is ControlKind.ScrollView or ControlKind.PageView ? UiNodeFlags.Clip : UiNodeFlags.None);
        UiNodeId node = _tree.CreateNode(MapNodeKind(kind), flags, new ControlNodeBinding(index, ControlPart.Primary, 0));
        _receivers.Add(node, new ControlInputReceiver(this, node));

        ref ControlEntry entry = ref _entries[index];
        entry = default;
        entry.Kind = kind;
        entry.Node = node;
        entry.Status = ControlStatus.Created;
        entry.Generation = _generations[index];
        entry.Visible = !startsHidden;
        entry.WidgetSlot = widget.Slot;
        entry.WidgetGeneration = widget.Generation;
        entry.Variant = definition.Variant;
        entry.Text = definition.Text ?? string.Empty;
        UiTextStyle textStyle = definition.TextStyle.Face.IsValid ? definition.TextStyle : _defaultTextStyle;
        if (textStyle.Size <= 0.0f)
        {
            textStyle = textStyle with { Size = _styleContext.Number(_tokens.FontSize, 15.0f) };
        }

        entry.TextStyle = textStyle;
        entry.Image = definition.Image;
        entry.MinValue = definition.MinValue;
        entry.MaxValue = MathF.Max(definition.MinValue, definition.MaxValue);
        entry.Step = MathF.Max(0.0001f, definition.Step);
        entry.Value = ClampValue(in definition, definition.Value);
        entry.Checked = definition.Checked;
        entry.Index = definition.SelectedIndex;
        entry.Items = definition.Items;
        entry.Tree = definition.Tree;
        entry.Grid = definition.Grid;

        _layoutStyles.Set(node, behavior.CreateLayoutStyle(in _styleContext));
        behavior.Initialize(this, index, in definition);
        RefreshVisual(index);
        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        return CreateHandle(index, in _entries[index]);
    }

    /// <summary>Creates and mounts a control under a parent control, or under the root.</summary>
    public UiControl CreateControl(ControlKind kind, in UiControlDefinition definition, UiControl parent)
    {
        UiControl created = CreateControl(kind, in definition);
        if (!Mount(created, parent))
        {
            _ = DestroyControl(created);
            ControlThrowHelper.ThrowInvalidHandle();
        }

        return created;
    }

    /// <summary>Attaches a detached control under a parent control, or under the root.</summary>
    public bool Mount(UiControl control, UiControl parent = default)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        UiNodeId parentNode = _tree.Root;
        int mountedUnder = -1;
        if (parent.IsValid)
        {
            if (!TryGetEntry(parent, out int parentIndex))
            {
                return false;
            }

            parentNode = _entries[parentIndex].Node;
            mountedUnder = parentIndex;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Status != ControlStatus.Created || !_tree.AppendChild(parentNode, entry.Node))
        {
            return false;
        }

        entry.Status = ControlStatus.Mounted;
        _dirty.Invalidate(new UiInvalidation(entry.Node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        _focus.MarkOrderDirty();
        _hitSyncDirty = true;
        if (mountedUnder >= 0)
        {
            BehaviorOf(_entries[mountedUnder]).RefreshSecondary(this, mountedUnder);
        }

        return true;
    }

    /// <summary>Destroys a control and every node it owns.</summary>
    public bool DestroyControl(UiControl control)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        UiNodeId node = _entries[index].Node;
        _capture.ReleaseNode(node);
        CollectSubtree(node);
        for (int i = 0; i < _scratch.Count; i++)
        {
            UiNodeId descendant = _scratch[i];
            _receivers.Remove(descendant);
            _bounds.Remove(descendant);
            _layoutStyles.Remove(descendant);
            _styles.RemovePatch(descendant);
            _textContent?.Remove(descendant);
            _hitIndex.Remove(descendant);
        }

        for (int i = 0; i < _scratch.Count; i++)
        {
            UiNodeId descendant = _scratch[i];
            if (descendant == node ||
                !_tree.TryGetBinding(descendant, out ControlNodeBinding binding) ||
                binding.Part != ControlPart.Primary ||
                !TryResolveEntry(binding.Control, out int childIndex) ||
                childIndex == index)
            {
                continue;
            }

            _capture.ReleaseNode(_entries[childIndex].Node);
            DisposeEntry(childIndex);
        }

        _ = _tree.RemoveNode(node);
        _focus.ValidateFocus();
        _focus.MarkOrderDirty();
        _entries[index] = default;
        _live[index] = false;
        if (_freeEntryCount == _freeEntries.Length)
        {
            Array.Resize(ref _freeEntries, _freeEntries.Length * 2);
        }

        _freeEntries[_freeEntryCount++] = index;
        _hitSyncDirty = true;
        return true;
    }

    /// <summary>Enables or disables interaction with a control.</summary>
    public bool SetEnabled(UiControl control, bool enabled)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Disabled == !enabled)
        {
            return true;
        }

        entry.Disabled = !enabled;
        UiNodeFlags flags = _tree.GetFlags(entry.Node);
        flags = enabled ? flags | UiNodeFlags.Enabled : flags & ~UiNodeFlags.Enabled;
        _tree.SetFlags(entry.Node, flags);
        if (!enabled)
        {
            entry.PointerInside = false;
            entry.Pressed = false;
        }

        _focus.ValidateFocus();
        _hitSyncDirty = true;
        RefreshVisual(index);
        return true;
    }

    /// <summary>Shows or hides a control.</summary>
    public bool SetVisible(UiControl control, bool visible)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        entry.Visible = visible;
        UiNodeFlags flags = _tree.GetFlags(entry.Node);
        flags = visible ? flags | UiNodeFlags.Visible : flags & ~UiNodeFlags.Visible;
        _tree.SetFlags(entry.Node, flags);
        _hitSyncDirty = true;
        RefreshVisual(index);
        return true;
    }

    /// <summary>Sets the value of a value-bearing control and emits a change event.</summary>
    public bool SetValue(UiControl control, float value)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        bool supported = entry.Kind is ControlKind.Slider or ControlKind.ProgressBar or
            ControlKind.SplitPane or ControlKind.Stepper or ControlKind.Rating or ControlKind.Custom;
        if (!supported)
        {
            return false;
        }

        float clamped = entry.Kind switch
        {
            ControlKind.Slider or ControlKind.Stepper => Math.Clamp(value, entry.MinValue, entry.MaxValue),
            ControlKind.Rating => Math.Clamp(value, 0.0f, entry.MaxValue),
            ControlKind.SplitPane => Math.Clamp(value, 0.15f, 0.85f),
            ControlKind.Custom => Math.Clamp(value, entry.MinValue, entry.MaxValue),
            _ => Math.Clamp(value, 0.0f, 1.0f),
        };
        if (clamped == entry.Value)
        {
            return true;
        }

        entry.Value = clamped;
        Emit(index, UiControlEventKind.ValueChanged, clamped, entry.Checked, entry.Index, null);
        _dirty.Invalidate(new UiInvalidation(entry.Node, UiInvalidationFlags.Render));
        BehaviorOf(in entry).OnValueApplied(this, index);
        return true;
    }

    /// <summary>Sets the checked flag of a checkbox or toggle.</summary>
    public bool SetChecked(UiControl control, bool value)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Kind is not (ControlKind.Checkbox or ControlKind.Toggle or ControlKind.Custom))
        {
            return false;
        }

        if (entry.Checked == value)
        {
            return true;
        }

        entry.Checked = value;
        RefreshVisual(index);
        Emit(index, UiControlEventKind.CheckedChanged, entry.Value, value, entry.Index, null);
        return true;
    }

    /// <summary>Sets the selection of a dropdown or radio group.</summary>
    public bool SetSelectedIndex(UiControl control, int index)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int indexOfControl))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[indexOfControl];
        if (entry.Kind is not (ControlKind.Dropdown or ControlKind.RadioGroup or ControlKind.TabView or
            ControlKind.PageStack or ControlKind.PageView or ControlKind.MenuBar or ControlKind.Breadcrumb or
            ControlKind.Custom))
        {
            return false;
        }

        int maximum = Math.Max(Math.Max(entry.Options?.Length ?? 0, entry.OptionNodes?.Length ?? 0), entry.PageCount) - 1;
        int clamped = maximum < 0 ? 0 : Math.Clamp(index, 0, maximum);
        if (clamped == entry.Index)
        {
            return true;
        }

        entry.Index = clamped;
        ApplySelection(indexOfControl);
        return true;
    }

    /// <summary>Replaces the text of a text-bearing control.</summary>
    public bool SetText(UiControl control, string text)
    {
        EnsureActive();
        ArgumentNullException.ThrowIfNull(text);
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Text == text)
        {
            return true;
        }

        entry.Text = text;
        entry.Caret = Math.Min(entry.Caret, text.Length);
        ApplyText(index);
        Emit(index, UiControlEventKind.TextChanged, entry.Value, entry.Checked, entry.Index, text);
        return true;
    }

    /// <summary>Replaces the layout style of a control's primary node.</summary>
    public bool SetLayoutStyle(UiControl control, in UiLayoutStyle style)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        UiNodeId node = _entries[index].Node;
        _layoutStyles.Set(node, in style);
        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        return true;
    }

    /// <summary>Re-runs the control's style projection and refreshes dependent nodes.</summary>
    /// <param name="control">Live control handle.</param>
    /// <returns>Whether the control is live.</returns>
    public bool RefreshControl(UiControl control)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        RefreshVisual(index);
        return true;
    }

    /// <summary>Marks whether the pointer is inside the control; drives hover styling for widget state machines.</summary>
    /// <param name="control">Live control handle.</param>
    /// <param name="inside">Whether the pointer is inside.</param>
    /// <returns>Whether the control is live.</returns>
    public bool SetPointerInside(UiControl control, bool inside)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        SetPointerInside(index, inside);
        return true;
    }

    /// <summary>Marks whether the control is pressed; drives press styling for widget state machines.</summary>
    /// <param name="control">Live control handle.</param>
    /// <param name="pressed">Whether the control is pressed.</param>
    /// <returns>Whether the control is live.</returns>
    public bool SetPressed(UiControl control, bool pressed)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            return false;
        }

        _ = SetPressed(index, pressed);
        return true;
    }

    /// <summary>Adds a hit-testable child node owned by a control at the given child index.</summary>
    /// <param name="control">Live control handle; typically a registered widget.</param>
    /// <param name="childIndex">Child index bound into the node identity for pointer routing.</param>
    /// <returns>The new node id.</returns>
    /// <exception cref="ArgumentException"><paramref name="control"/> is stale or invalid.</exception>
    public UiNodeId AddControlChildNode(UiControl control, int childIndex)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index))
        {
            ControlThrowHelper.ThrowInvalidHandle();
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Kind != ControlKind.Custom)
        {
            ControlThrowHelper.ThrowWidgetOnlyChildNode();
        }

        UiNodeId[] nodes = EnsureOptionCapacity(ref entry, childIndex);
        UiNodeId existing = nodes[childIndex];
        if (existing.IsValid)
        {
            DetachOwnedNode(index, existing);
        }

        UiNodeId node = CreateChildNode(
            index,
            UiNodeKind.Custom,
            UiNodeFlags.Visible | UiNodeFlags.Enabled | UiNodeFlags.Interactive | UiNodeFlags.Focusable,
            ControlPart.Option,
            childIndex);
        nodes[childIndex] = node;
        _dirty.Invalidate(new UiInvalidation(entry.Node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        return node;
    }

    /// <summary>Removes a child node previously added to the control.</summary>
    /// <param name="control">Live control handle owning the node.</param>
    /// <param name="node">Child node to remove.</param>
    /// <returns>Whether the node was owned by the control and removed.</returns>
    public bool RemoveControlChildNode(UiControl control, UiNodeId node)
    {
        EnsureActive();
        if (!TryGetEntry(control, out int index) ||
            _entries[index].Kind != ControlKind.Custom ||
            !_tree.TryGetBinding(node, out ControlNodeBinding binding) ||
            binding.Control != index ||
            binding.Part != ControlPart.Option ||
            !holdsOptionNode(index, binding.Option, node))
        {
            return false;
        }

        _entries[index].OptionNodes![binding.Option] = UiNodeId.Invalid;
        DetachOwnedNode(index, node);
        _dirty.Invalidate(new UiInvalidation(_entries[index].Node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        return true;
    }

    /// <summary>Replaces the layout style of a control-owned node.</summary>
    /// <param name="control">Live control handle owning the node.</param>
    /// <param name="node">Primary or child node of the control.</param>
    /// <param name="style">New layout style.</param>
    /// <returns>Whether the node is owned by the control and was updated.</returns>
    public bool SetControlNodeLayoutStyle(UiControl control, UiNodeId node, in UiLayoutStyle style)
    {
        EnsureActive();
        if (!TryGetOwnedNode(control, node, out _))
        {
            return false;
        }

        SetNodeLayoutStyle(node, in style);
        return true;
    }

    /// <summary>Replaces the style patch of a control-owned node.</summary>
    /// <param name="control">Live control handle owning the node.</param>
    /// <param name="node">Primary or child node of the control.</param>
    /// <param name="patch">New style patch consumed by the render list.</param>
    /// <returns>Whether the node is owned by the control and was updated.</returns>
    public bool SetControlNodeStyle(UiControl control, UiNodeId node, in UiStylePatch patch)
    {
        EnsureActive();
        if (!TryGetOwnedNode(control, node, out _))
        {
            return false;
        }

        SetNodePatch(node, in patch);
        return true;
    }

    /// <summary>Registers text on a control-owned node for measurement and rendering.</summary>
    /// <param name="control">Live control handle owning the node.</param>
    /// <param name="node">Primary or child node of the control.</param>
    /// <param name="text">Text content; empty text removes the node from measurement.</param>
    /// <returns>Whether the node is owned by the control and was updated.</returns>
    public bool SetControlNodeText(UiControl control, UiNodeId node, string text)
    {
        EnsureActive();
        ArgumentNullException.ThrowIfNull(text);
        if (!TryGetOwnedNode(control, node, out int index))
        {
            return false;
        }

        if (node == _entries[index].Node)
        {
            SetText(control, text);
            return true;
        }

        SetNodeText(node, text, in _entries[index].TextStyle);
        return true;
    }

    /// <summary>Emits an observable outcome attributed to a control.</summary>
    /// <param name="control">Live control handle.</param>
    /// <param name="kind">Outcome kind.</param>
    /// <param name="value">Value payload.</param>
    /// <param name="checkedFlag">Checked payload.</param>
    /// <param name="index">Selection payload.</param>
    /// <param name="text">Text payload.</param>
    public void EmitControlEvent(UiControl control, UiControlEventKind kind, float value, bool checkedFlag, int index, string? text)
    {
        EnsureActive();
        if (TryGetEntry(control, out int entryIndex))
        {
            Emit(entryIndex, kind, value, checkedFlag, index, text);
        }
    }

    /// <summary>Resolves a theme color token for widget styling.</summary>
    /// <param name="token">Theme token identity.</param>
    /// <param name="color">Resolved color, when the token exists.</param>
    /// <returns>Whether the token resolved.</returns>
    public bool TryResolveThemeColor(UiThemeTokenId token, out UiColor color)
    {
        if (_styleContext.Theme is IUiTheme theme)
        {
            return theme.TryGetColor(token, out color);
        }

        color = default;
        return false;
    }

    /// <summary>Resolves a theme number token for widget styling.</summary>
    /// <param name="token">Theme token identity.</param>
    /// <param name="value">Resolved number, when the token exists.</param>
    /// <returns>Whether the token resolved.</returns>
    public bool TryResolveThemeNumber(UiThemeTokenId token, out float value)
    {
        if (_styleContext.Theme is IUiTheme theme)
        {
            return theme.TryGetNumber(token, out value);
        }

        value = default;
        return false;
    }

    /// <summary>Reads the current state of a control.</summary>
    public bool TryGetSnapshot(UiControl control, out UiControlSnapshot snapshot)
    {
        if (!TryGetEntry(control, out int index))
        {
            snapshot = default;
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        snapshot = new UiControlSnapshot(
            entry.Kind,
            ResolveState(in entry),
            entry.Focused,
            entry.Checked,
            entry.Open,
            entry.Value,
            entry.Index,
            entry.ScrollOffset,
            entry.Text)
        {
            Column = entry.CrossIndex,
            HorizontalOffset = entry.CrossOffset,
        };
        return true;
    }

    /// <summary>Gets the arranged border box of a node.</summary>
    public bool TryGetBounds(UiNodeId node, out Rect bounds) => _bounds.TryGetValue(node, out bounds);

    /// <summary>Gets the resolved widget style of a node for rendering.</summary>
    public bool TryGetStyle(UiNodeId node, out UiWidgetStyle style) => _styles.TryGetStyle(node, out style);

    /// <summary>Gets the control that currently owns focus, when it is a control node.</summary>
    public bool TryGetFocusedControl(out UiControl control) => TryGetControl(_focus.Focused, out control);

    public bool SetOpen(UiControl control, bool open)
    {
        EnsureActive();
        return TryGetEntry(control, out int index) && SetOpenByIndex(index, open);
    }

    internal bool SetOpenByIndex(int index, bool open)
    {
        ref ControlEntry entry = ref _entries[index];
        if (entry.Kind is not (ControlKind.Menu or ControlKind.Tooltip or ControlKind.Dialog or ControlKind.Toast or
            ControlKind.Popup or ControlKind.Spinner or ControlKind.Custom) ||
            entry.Open == open)
        {
            return entry.Open == open;
        }

        bool wasOpen = entry.Open;
        entry.Open = open;
        if (entry.Kind is ControlKind.Tooltip or ControlKind.Toast or ControlKind.Dialog or ControlKind.Popup)
        {
            entry.Visible = open;
            UiNodeFlags nodeFlags = _tree.GetFlags(entry.Node);
            nodeFlags = open ? nodeFlags | UiNodeFlags.Visible : nodeFlags & ~UiNodeFlags.Visible;
            _tree.SetFlags(entry.Node, nodeFlags);
        }
        if (open && entry.Kind == ControlKind.Toast && entry.Value <= 0.0f)
        {
            entry.Value = DefaultToastSeconds;
        }

        _hitSyncDirty = true;
        if (entry.Kind == ControlKind.Dialog && wasOpen != open)
        {
            if (open)
            {
                _ = _focus.TryFocus(entry.Node, UiFocusReason.Api);
            }
            else if (TryGetFocusedControl(out UiControl focused) && focused.Index == index)
            {
                _focus.ClearFocus(UiFocusReason.Api);
            }
        }

        RefreshVisual(index);
        Emit(index, UiControlEventKind.OpenChanged, entry.Value, open, entry.Index, null);
        return true;
    }

    public int Update(float deltaSeconds)
    {
        EnsureActive();
        if (!(deltaSeconds > 0.0f))
        {
            return 0;
        }

        int expired = 0;
        for (int i = 0; i < _entryCount; i++)
        {
            if (!_live[i])
            {
                continue;
            }

            ref ControlEntry entry = ref _entries[i];
            if (entry.Kind == ControlKind.Spinner)
            {
                if (entry.Open)
                {
                    entry.Value += deltaSeconds;
                    if (entry.Value >= 1.0f)
                    {
                        entry.Value -= MathF.Floor(entry.Value);
                    }

                    InvalidateVisual(i);
                }

                continue;
            }

            if (entry.Kind != ControlKind.Toast || !entry.Open)
            {
                continue;
            }

            entry.Value -= deltaSeconds;
            if (entry.Value > 0.0f)
            {
                InvalidateVisual(i);
                continue;
            }

            entry.Value = 0.0f;
            entry.Open = false;
            _hitSyncDirty = true;
            Emit(i, UiControlEventKind.OpenChanged, 0.0f, false, entry.Index, null);
            expired++;
        }

        return expired;
    }

    public bool TryGetVirtualRange(UiControl control, out int first, out int last)
    {
        first = 0;
        last = -1;
        if (!TryGetEntry(control, out int index) || !_bounds.TryGetValue(_entries[index].Node, out Rect box))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        int count = VirtualCount(in entry);
        if (count == 0)
        {
            return false;
        }

        float rowHeight = RowHeight();
        if (rowHeight <= 0.0f)
        {
            return false;
        }

        first = Math.Clamp((int)MathF.Floor(entry.ScrollOffset / rowHeight), 0, count - 1);
        last = Math.Clamp((int)MathF.Floor((entry.ScrollOffset + MathF.Max(0.0f, box.Height)) / rowHeight), first, count - 1);
        return true;
    }

    public bool AddPage(UiControl tab, UiControl page)
    {
        EnsureActive();
        if (!TryGetEntry(tab, out int index) ||
            _entries[index].Kind is not (ControlKind.TabView or ControlKind.PageStack or ControlKind.PageView) ||
            !TryGetEntry(page, out _))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        entry.Pages ??= new UiControl[4];
        if (entry.PageCount == entry.Pages.Length)
        {
            Array.Resize(ref entry.Pages, Math.Max(entry.PageCount + 1, entry.PageCount * 2));
        }

        entry.Pages![entry.PageCount++] = page;
        _ = SetVisible(page, entry.PageCount - 1 == entry.Index);
        return true;
    }

    /// <summary>Reports the inclusive visible column window of a data grid. O(log c) binary search.</summary>
    public bool TryGetVirtualColumnRange(UiControl control, out int first, out int last)
    {
        first = 0;
        last = -1;
        if (!TryGetEntry(control, out int index) || _entries[index].Kind != ControlKind.DataGrid ||
            !_bounds.TryGetValue(_entries[index].Node, out Rect box))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Metrics is not { Length: > 1 } metrics)
        {
            return false;
        }

        int columns = metrics.Length - 1;
        first = FindColumn(metrics, entry.CrossOffset);
        last = FindColumn(metrics, entry.CrossOffset + MathF.Max(0.0f, box.Width));
        last = Math.Clamp(last, first, columns - 1);
        return true;
    }

    /// <summary>Pushes a page onto a page stack or page view and shows it.</summary>
    public bool PushPage(UiControl stack, UiControl page)
    {
        EnsureActive();
        if (!TryGetEntry(stack, out int index) ||
            _entries[index].Kind is not (ControlKind.PageStack or ControlKind.PageView) ||
            !TryGetEntry(page, out _))
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        entry.Pages ??= new UiControl[4];
        if (entry.PageCount == entry.Pages.Length)
        {
            Array.Resize(ref entry.Pages, Math.Max(entry.PageCount + 1, entry.PageCount * 2));
        }

        if (entry.Kind == ControlKind.PageStack && entry.PageCount > 0)
        {
            entry.History ??= new int[4];
            if (entry.HistoryCount == entry.History.Length)
            {
                Array.Resize(ref entry.History, Math.Max(entry.HistoryCount + 1, entry.HistoryCount * 2));
            }

            entry.History[entry.HistoryCount++] = entry.Index;
        }

        entry.Pages![entry.PageCount++] = page;
        entry.Index = entry.PageCount - 1;
        ApplyPageVisibility(index);
        RefreshVisual(index);
        Emit(index, UiControlEventKind.SelectionChanged, entry.Value, entry.Checked, entry.Index, null);
        return true;
    }

    /// <summary>Pops the current page of a page stack back to the previous one.</summary>
    public bool PopPage(UiControl stack)
    {
        EnsureActive();
        return TryGetEntry(stack, out int index) && PopPageByIndex(index);
    }

    internal bool PopPageByIndex(int index)
    {
        if (_entries[index].Kind != ControlKind.PageStack)
        {
            return false;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.HistoryCount == 0)
        {
            return false;
        }

        entry.Index = Math.Clamp(entry.History![--entry.HistoryCount], 0, Math.Max(0, entry.PageCount - 1));
        ApplyPageVisibility(index);
        RefreshVisual(index);
        Emit(index, UiControlEventKind.Back, entry.Value, entry.Checked, entry.Index, null);
        Emit(index, UiControlEventKind.SelectionChanged, entry.Value, entry.Checked, entry.Index, null);
        return true;
    }

    private void ApplyPageVisibility(int index)
    {
        ref ControlEntry entry = ref _entries[index];
        if (entry.Pages is not UiControl[] pages)
        {
            return;
        }

        for (int i = 0; i < entry.PageCount; i++)
        {
            if (pages[i].IsValid)
            {
                _ = SetVisible(pages[i], i == entry.Index);
            }
        }
    }

    private static int FindColumn(float[] cumulative, float x)
    {
        int low = 0;
        int high = cumulative.Length - 2;
        while (low <= high)
        {
            int mid = low + ((high - low) >> 1);
            if (x < cumulative[mid])
            {
                high = mid - 1;
            }
            else if (x >= cumulative[mid + 1])
            {
                low = mid + 1;
            }
            else
            {
                return mid;
            }
        }

        return Math.Clamp(low, 0, cumulative.Length - 2);
    }

    /// <summary>Runs layout for dirty subtrees and synchronizes the hit-test index.</summary>
    public int UpdateLayout(in UiViewport viewport)
    {
        EnsureActive();
        _layoutEngine.Viewport = viewport;
        int processed = _runner.Run(in viewport);
        if (processed > 0 || _hitSyncDirty)
        {
            SyncHitTest();
            _hitSyncDirty = false;
        }

        return processed;
    }

    /// <summary>Routes one pointer event through the control tree.</summary>
    public bool DispatchPointer(in UiPointerEvent args)
    {
        UiInputDispatchResult result = _router.Route(in args);
        if (args.Phase == UiPointerPhase.Down)
        {
            ClosePopupsOutside(result.Target);
        }

        return result.Handled;
    }

    private void ClosePopupsOutside(UiNodeId target)
    {
        for (int i = 0; i < _entryCount; i++)
        {
            if (!_live[i])
            {
                continue;
            }

            ref ControlEntry entry = ref _entries[i];
            if (entry.Kind == ControlKind.Popup && entry.Open &&
                (!target.IsValid || !IsWithin(target, entry.Node)))
            {
                _ = SetOpenByIndex(i, false);
            }
        }
    }

    /// <summary>Routes one key event; Tab moves focus when no control consumes it.</summary>
    public bool DispatchKey(in UiKeyEvent args)
    {
        UiInputDispatchResult result = _router.Route(in args);
        if (result.Handled || args.Phase != UiKeyPhase.Down || args.KeyCode != TabKeyCode)
        {
            return result.Handled;
        }

        bool backward = (args.Modifiers & UiKeyModifiers.Shift) != 0;
        return _focus.TryMoveFocus(backward ? UiFocusMoveDirection.Backward : UiFocusMoveDirection.Forward);
    }

    /// <summary>Routes committed text to the focused control.</summary>
    public bool DispatchText(in UiTextInputEvent args) => _router.Route(in args).Handled;

    /// <summary>Handles OS window focus loss: cancels interaction state and clears focus.</summary>
    public bool DispatchWindowFocus(in UiWindowFocusEvent args)
    {
        UiInputDispatchResult result = _router.HandleWindowFocus(in args);
        if (!args.Focused)
        {
            for (int i = 0; i < _entryCount; i++)
            {
                if (_live[i] && (_entries[i].PointerInside || _entries[i].Pressed))
                {
                    _entries[i].PointerInside = false;
                    _entries[i].Pressed = false;
                    RefreshVisual(i);
                }
            }
        }

        return result.Canceled;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _capture.ReleaseAll();
        _focus.ClearFocus(UiFocusReason.Window);
        _receivers.Clear();
        _bounds.Clear();
        _disposed = true;
    }

    internal ref ControlEntry Entry(int index) => ref _entries[index];

    internal UiTextContentMeasurer? TextContentMeasurer => _textContent;

    internal ControlStyleContext Style => _styleContext;

    internal ControlNodeTree Tree => _tree;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ControlBehavior BehaviorOf(in ControlEntry entry) =>
        entry.Kind == ControlKind.Custom
            ? _widgets is not null
                ? _widgets.ResolveForDispatch(entry.WidgetSlot, entry.WidgetGeneration)
                : InertWidgetBehavior.Instance
            : ControlCatalog.Get(entry.Kind);

    internal UiWidgetSession Session(int index) => new(this, CreateHandle(index, in _entries[index]));

    private bool TryGetOwnedNode(UiControl control, UiNodeId node, out int index)
    {
        index = -1;
        if (!TryGetEntry(control, out int entryIndex))
        {
            return false;
        }

        // Widget-owned node authoring is reserved for registered widgets; built-in
        // secondary nodes stay under their catalog behavior's exclusive control.
        if (_entries[entryIndex].Kind != ControlKind.Custom ||
            !_tree.TryGetBinding(node, out ControlNodeBinding binding) ||
            binding.Control != entryIndex)
        {
            return false;
        }

        index = entryIndex;
        return true;
    }

    private bool holdsOptionNode(int index, int option, UiNodeId node)
    {
        UiNodeId[]? nodes = _entries[index].OptionNodes;
        return nodes is not null && (uint)option < (uint)nodes.Length && nodes[option] == node;
    }

    private static UiNodeId[] EnsureOptionCapacity(ref ControlEntry entry, int childIndex)
    {
        if (childIndex < 0)
        {
            ControlThrowHelper.ThrowInvalidHandle();
        }

        if (entry.OptionNodes is null)
        {
            entry.OptionNodes = new UiNodeId[Math.Max(4, childIndex + 1)];
            return entry.OptionNodes;
        }

        if ((uint)childIndex >= (uint)entry.OptionNodes.Length)
        {
            Array.Resize(ref entry.OptionNodes, Math.Max(entry.OptionNodes.Length * 2, childIndex + 1));
        }

        return entry.OptionNodes;
    }

    private void DetachOwnedNode(int index, UiNodeId node)
    {
        _capture.ReleaseNode(node);
        _ = _receivers.Remove(node);
        _ = _bounds.Remove(node);
        _layoutStyles.Remove(node);
        _ = _styles.RemovePatch(node);
        _ = _textContent?.Remove(node);
        _hitIndex.Remove(node);
        _ = _tree.RemoveNode(node);
        _hitSyncDirty = true;
    }

    internal bool TryGetEntryIndex(UiNodeId node, out int index)
    {
        if (_tree.TryGetBinding(node, out ControlNodeBinding binding) && TryResolveEntry(binding.Control, out index))
        {
            return true;
        }

        index = -1;
        return false;
    }

    internal UiNodeId CreateChildNode(int index, UiNodeKind kind, UiNodeFlags flags, ControlPart part, int option)
    {
        UiNodeId parent = _entries[index].Node;
        UiNodeId node = _tree.CreateNode(kind, flags, new ControlNodeBinding(index, part, option));
        _ = _tree.AppendChild(parent, node);
        _receivers.Add(node, new ControlInputReceiver(this, node));
        _hitSyncDirty = true;
        return node;
    }

    internal void SetNodeFlags(UiNodeId node, UiNodeFlags flags)
    {
        _tree.SetFlags(node, flags);
        _hitSyncDirty = true;
    }

    internal void SetNodeLayoutStyle(UiNodeId node, in UiLayoutStyle style)
    {
        _layoutStyles.Set(node, in style);
        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
    }

    internal void SetNodeText(UiNodeId node, string text, in UiTextStyle style)
    {
        if (_textContent is null)
        {
            return;
        }

        if (text.Length == 0)
        {
            _ = _textContent.Remove(node);
        }
        else
        {
            _textContent.SetText(node, text, in style);
        }

        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Content | UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
    }

    internal void SetNodePatch(UiNodeId node, in UiStylePatch patch)
    {
        _styles.SetPatch(node, in patch);
        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Style | UiInvalidationFlags.Render));
    }

    internal void SetPointerInside(int index, bool inside)
    {
        ref ControlEntry entry = ref _entries[index];
        if (entry.Disabled || entry.PointerInside == inside)
        {
            return;
        }

        entry.PointerInside = inside;
        RefreshVisual(index);
    }

    internal bool SetPressed(int index, bool pressed)
    {
        ref ControlEntry entry = ref _entries[index];
        bool previous = entry.Pressed;
        if (entry.Disabled || previous == pressed)
        {
            return previous;
        }

        entry.Pressed = pressed;
        RefreshVisual(index);
        return previous;
    }

    internal void Emit(
        int index,
        UiControlEventKind kind,
        float value,
        bool isChecked,
        int selection,
        string? text)
    {
        if (_events is null)
        {
            return;
        }

        ref ControlEntry entry = ref _entries[index];
        var args = new UiControlEvent(entry.Node, entry.Kind, kind, value, isChecked, selection, text);
        _events.OnControlEvent(in args);
    }

    internal void RefreshVisual(int index)
    {
        ref ControlEntry entry = ref _entries[index];
        ControlBehavior behavior = BehaviorOf(in entry);
        UiStylePatch patch = behavior.CreateStylePatch(in _styleContext, in entry);
        _styles.SetPatch(entry.Node, in patch);
        _dirty.Invalidate(new UiInvalidation(entry.Node, UiInvalidationFlags.Style | UiInvalidationFlags.Render));
        behavior.RefreshSecondary(this, index);
    }

    internal void ApplyText(int index)
    {
        ref ControlEntry entry = ref _entries[index];
        SetNodeText(entry.Node, entry.Text, in entry.TextStyle);
    }

    internal void ApplySelection(int index)
    {
        ref ControlEntry entry = ref _entries[index];
        if (entry.Kind == ControlKind.Dropdown)
        {
            entry.Text = OptionLabel(in entry, entry.Index);
            ApplyText(index);
        }

        RefreshVisual(index);
        BehaviorOf(in entry).OnSelectionApplied(this, index);
        Emit(index, UiControlEventKind.SelectionChanged, entry.Value, entry.Checked, entry.Index, null);
    }

    internal void InvalidateVisual(int index)
    {
        _dirty.Invalidate(new UiInvalidation(_entries[index].Node, UiInvalidationFlags.Render));
    }

    internal void RequestHitSync() => _hitSyncDirty = true;

    internal float MeasureTextWidth(ReadOnlySpan<char> text, in UiTextStyle style) =>
        _measurer is null ? 0.0f : _measurer.Measure(text, in style, UiMeasureConstraints.Unbounded).Width;

    internal static float TextLineHeight(in UiTextStyle style) =>
        style.LineHeight > 0.0f ? style.LineHeight : style.Size > 0.0f ? style.Size * 1.2f : 16.0f;

    internal float RowHeight() => _styleContext.Number(_tokens.RowHeight, 28.0f);

    internal static int VirtualCount(in ControlEntry entry) => entry.Kind switch
    {
        ControlKind.ListView => entry.Items?.Count ?? 0,
        ControlKind.TreeView => entry.VisibleRows?.Length ?? 0,
        ControlKind.DataGrid => entry.Grid?.RowCount ?? 0,
        _ => 0,
    };

    internal void RebuildVisibleRows(int index, int selectedNode)
    {
        ref ControlEntry entry = ref _entries[index];
        if (entry.Tree is not IUiTreeSource tree)
        {
            return;
        }

        entry.VisibleRows ??= new int[16];
        int count = 0;
        for (int root = 0; root < tree.RootCount; root++)
        {
            AppendVisibleRow(ref entry, tree, tree.GetRoot(root), ref count);
        }

        if (count != entry.VisibleRows!.Length)
        {
            Array.Resize(ref entry.VisibleRows, count);
        }

        int selection = 0;
        for (int i = 0; i < count; i++)
        {
            if (entry.VisibleRows[i] == selectedNode)
            {
                selection = i;
                break;
            }
        }

        entry.Index = count == 0 ? 0 : Math.Clamp(selection, 0, count - 1);
    }

    private static void AppendVisibleRow(ref ControlEntry entry, IUiTreeSource tree, int node, ref int count)
    {
        if (count == entry.VisibleRows!.Length)
        {
            Array.Resize(ref entry.VisibleRows, entry.VisibleRows.Length * 2);
        }

        entry.VisibleRows[count++] = node;
        if (entry.Expanded is null || (uint)node >= (uint)entry.Expanded.Length || !entry.Expanded[node])
        {
            return;
        }

        int children = tree.GetChildCount(node);
        for (int child = 0; child < children; child++)
        {
            AppendVisibleRow(ref entry, tree, tree.GetChild(node, child), ref count);
        }
    }

    internal void InvalidateLayout(UiNodeId node)
    {
        _dirty.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Render));
        _hitSyncDirty = true;
    }

    internal static string OptionLabel(in ControlEntry entry, int index) =>
        entry.Options is { Length: > 0 } options && (uint)index < (uint)options.Length ? options[index] : string.Empty;

    internal UiSize MeasureImage(in ControlEntry entry, in UiMeasureConstraints constraints)
    {
        if (_images is null || !_images.TryGetSize(entry.Image, out UiSize intrinsic))
        {
            return default;
        }

        float width = MathF.Max(0.0f, intrinsic.Width);
        float height = MathF.Max(0.0f, intrinsic.Height);
        float maxWidth = constraints.MaxWidth;
        float maxHeight = constraints.MaxHeight;
        if (float.IsFinite(maxWidth) || float.IsFinite(maxHeight))
        {
            float scale = 1.0f;
            if (float.IsFinite(maxWidth) && width > maxWidth)
            {
                scale = MathF.Min(scale, maxWidth / width);
            }

            if (float.IsFinite(maxHeight) && height > maxHeight)
            {
                scale = MathF.Min(scale, maxHeight / height);
            }

            width *= scale;
            height *= scale;
        }

        return new UiSize(width, height);
    }

    private void SyncHitTest()
    {
        UiNodeId modal = FindModalNode();
        for (int i = 0; i < _entryCount; i++)
        {
            if (!_live[i])
            {
                continue;
            }

            ref ControlEntry entry = ref _entries[i];
            ControlBehavior behavior = BehaviorOf(in entry);
            bool enabled = !entry.Disabled;
            bool reachable = !modal.IsValid || IsWithin(entry.Node, modal);
            bool layered = entry.Kind is ControlKind.Dropdown or ControlKind.Menu;
            int extraRows = layered && entry.Open ? entry.Options?.Length ?? 0 : 0;
            SyncNode(entry.Node, reachable && entry.Visible && enabled && behavior.Interactive, entry.Kind == ControlKind.ScrollView, extraRows);

            if (entry.OptionNodes is UiNodeId[] options)
            {
                for (int option = 0; option < options.Length; option++)
                {
                    if (!options[option].IsValid)
                    {
                        continue;
                    }

                    bool hit = reachable && entry.Visible && enabled &&
                        behavior.IsSecondaryHitTestable(in _styleContext, in entry, ControlPart.Option, option);
                    SyncNode(options[option], hit, false);
                }
            }
        }
    }

    private UiNodeId FindModalNode()
    {
        UiNodeId modal = UiNodeId.Invalid;
        for (int i = 0; i < _entryCount; i++)
        {
            if (_live[i] && _entries[i].Kind == ControlKind.Dialog && _entries[i].Open)
            {
                modal = _entries[i].Node;
            }
        }

        return modal;
    }

    private bool IsWithin(UiNodeId node, UiNodeId ancestor)
    {
        UiNodeId cursor = node;
        for (int depth = 0; depth < MaxAncestorDepth; depth++)
        {
            if (cursor == ancestor)
            {
                return true;
            }

            if (!_tree.TryGetParent(cursor, out UiNodeId parent))
            {
                return false;
            }

            cursor = parent;
        }

        return false;
    }

    private void SyncNode(UiNodeId node, bool enabled, bool clips, int extraRows = 0)
    {
        if (!enabled || !_bounds.TryGetValue(node, out Rect box))
        {
            _hitIndex.Remove(node);
            return;
        }

        if (extraRows > 0)
        {
            float rowHeight = _styleContext.Number(_tokens.RowHeight, 28.0f);
            box = new Rect(box.X, box.Y, box.Width, box.Height + (rowHeight * extraRows));
        }

        int zIndex = 0;
        if (_layoutStyles.TryGetLayoutStyle(node, out UiLayoutStyle style))
        {
            zIndex = style.ZIndex;
        }

        var bounds = new Aabb2D(box.X, box.Y, box.X + box.Width, box.Y + box.Height);
        _hitIndex.Insert(node, in bounds, zIndex, clips);
    }

    private void OnBox(UiNodeId node, in Rect bounds)
    {
        if (!_bounds.TryGetValue(node, out Rect previous))
        {
            _bounds.Add(node, bounds);
            return;
        }

        if (previous != bounds)
        {
            _hitSyncDirty = true;
        }

        _bounds[node] = bounds;
    }

    private float ScrollOffsetFor(UiNodeId node)
    {
        float offset = 0.0f;
        UiNodeId cursor = node;
        for (int depth = 0; depth < MaxAncestorDepth; depth++)
        {
            if (!_tree.TryGetParent(cursor, out UiNodeId parent))
            {
                break;
            }

            cursor = parent;
            if (_tree.TryGetBinding(cursor, out ControlNodeBinding binding) &&
                binding.Part == ControlPart.Primary &&
                TryResolveEntry(binding.Control, out int index) &&
                _entries[index].Kind == ControlKind.ScrollView)
            {
                offset += _entries[index].ScrollOffset;
            }
        }

        return offset;
    }

    private void OnFocusChanged(in UiFocusChangeEvent args)
    {
        if (!TryGetEntryIndex(args.Target, out int index))
        {
            return;
        }

        ref ControlEntry entry = ref _entries[index];
        if (entry.Focused == args.Focused)
        {
            return;
        }

        entry.Focused = args.Focused;
        if (!args.Focused)
        {
            entry.PointerInside = false;
            entry.Pressed = false;
        }

        RefreshVisual(index);
        BehaviorOf(in entry).OnFocusChanged(this, index, args.Focused);
        Emit(index, UiControlEventKind.FocusChanged, entry.Value, entry.Checked, entry.Index, null);
    }

    private void CollectSubtree(UiNodeId node)
    {
        _scratch.Clear();
        int count = 0;
        _scratch.Add(node);
        while (count < _scratch.Count)
        {
            UiNodeId current = _scratch[count++];
            ReadOnlySpan<UiNodeId> children = _tree.GetChildren(current);
            for (int i = 0; i < children.Length; i++)
            {
                _scratch.Add(children[i]);
            }
        }
    }

    private int AllocateEntry()
    {
        if (_freeEntryCount > 0)
        {
            int recycled = _freeEntries[--_freeEntryCount];
            _live[recycled] = true;
            return recycled;
        }

        if (_entryCount == _entries.Length)
        {
            int capacity = _entries.Length * 2;
            Array.Resize(ref _entries, capacity);
            Array.Resize(ref _generations, capacity);
            Array.Resize(ref _live, capacity);
        }

        int index = _entryCount++;
        _live[index] = true;
        return index;
    }

    private bool TryResolveEntry(int index, out int resolved)
    {
        if ((uint)index < (uint)_entryCount && _live[index])
        {
            resolved = index;
            return true;
        }

        resolved = -1;
        return false;
    }

    private bool TryGetEntry(UiControl control, out int index)
    {
        if (control.IsValid &&
            (uint)control.Index < (uint)_entryCount &&
            _live[control.Index] &&
            _entries[control.Index].Generation == control.Generation &&
            _entries[control.Index].Node == control.Node)
        {
            index = control.Index;
            return true;
        }

        index = -1;
        return false;
    }

    private bool TryGetReceiver(UiNodeId node, out IUiInputReceiver receiver)
    {
        if (_receivers.TryGetValue(node, out ControlInputReceiver? found))
        {
            receiver = found;
            return true;
        }

        receiver = null!;
        return false;
    }

    private bool TryGetNodeBounds(UiNodeId node, out Rect bounds) => _bounds.TryGetValue(node, out bounds);

    private void EnsureActive()
    {
        if (_disposed)
        {
            ControlThrowHelper.ThrowDisposed();
        }
    }

    private void DisposeEntry(int index)
    {
        _entries[index] = default;
        _live[index] = false;
        if (_freeEntryCount == _freeEntries.Length)
        {
            Array.Resize(ref _freeEntries, _freeEntries.Length * 2);
        }

        _freeEntries[_freeEntryCount++] = index;
    }

    private static UiControl CreateHandle(int index, in ControlEntry entry) =>
        new(index, entry.Generation, entry.Node);

    private static ControlKind KindOf(in ControlEntry entry) => entry.Kind;

    private static UiControlState ResolveState(in ControlEntry entry) =>
        entry.Disabled
            ? UiControlState.Disabled
            : entry.Pressed
                ? UiControlState.Pressed
                : entry.PointerInside
                    ? UiControlState.Hover
                    : UiControlState.Normal;

    private static float ClampValue(in UiControlDefinition definition, float value) =>
        Math.Clamp(value, definition.MinValue, MathF.Max(definition.MinValue, definition.MaxValue));

    private static UiNodeKind MapNodeKind(ControlKind kind) => kind switch
    {
        ControlKind.Label => UiNodeKind.Text,
        ControlKind.Image => UiNodeKind.Image,
        ControlKind.Button => UiNodeKind.Button,
        ControlKind.TextInput => UiNodeKind.Input,
        ControlKind.Panel or ControlKind.ScrollView or ControlKind.RadioGroup or ControlKind.TabView or
            ControlKind.Dialog or ControlKind.SplitPane or ControlKind.Popup or ControlKind.PageStack or
            ControlKind.PageView or ControlKind.Accordion => UiNodeKind.Container,
        ControlKind.TextArea => UiNodeKind.Input,
        ControlKind.ImageFace => UiNodeKind.Image,
        _ => UiNodeKind.Custom,
    };

    private sealed class ControlLayoutSink(UiControlRuntime owner) : IUiLayoutSink
    {
        public void SetBox(UiNodeId node, in Rect bounds, in Rect content)
        {
            float offset = owner.ScrollOffsetFor(node);
            if (offset == 0.0f)
            {
                owner.OnBox(node, in bounds);
                return;
            }

            var shifted = new Rect(bounds.X, bounds.Y - offset, bounds.Width, bounds.Height);
            owner.OnBox(node, in shifted);
        }
    }

    private sealed class ControlBoundsView(UiControlRuntime owner) : IUiNodeBounds
    {
        public bool TryGetBounds(UiNodeId node, out Aabb2D bounds)
        {
            if (owner.TryGetNodeBounds(node, out Rect box))
            {
                bounds = new Aabb2D(box.X, box.Y, box.X + box.Width, box.Y + box.Height);
                return true;
            }

            bounds = default;
            return false;
        }
    }

    private sealed class ControlContentMeasurer(UiControlRuntime owner) : IUiContentMeasurer
    {
        public bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size)
        {
            if (owner._textContent is not null && owner._textContent.TryMeasureContent(node, in constraints, out size))
            {
                return true;
            }

            if (owner._tree.TryGetBinding(node, out ControlNodeBinding binding) &&
                owner.TryResolveEntry(binding.Control, out int index) &&
                KindOf(in owner._entries[index]) is ControlKind.Image or ControlKind.ImageFace)
            {
                size = owner.MeasureImage(in owner._entries[index], in constraints);
                return true;
            }

            size = default;
            return false;
        }
    }

    private sealed class ControlFocusSink(UiControlRuntime owner) : IUiFocusEventSink
    {
        public void OnFocusChanged(in UiFocusChangeEvent args) => owner.OnFocusChanged(in args);
    }

    private sealed class ControlReceiverResolver(UiControlRuntime owner) : IUiInputReceiverResolver
    {
        public bool TryResolve(UiNodeId node, out IUiInputReceiver receiver) => owner.TryGetReceiver(node, out receiver);
    }
}

/// <summary>Per-node input receiver: forwards only events addressed to its own node.</summary>
internal sealed class ControlInputReceiver(UiControlRuntime runtime, UiNodeId node) : IUiInputReceiver
{
    public bool OnPointer(in UiPointerEvent args, UiRoutingPhase phase) =>
        phase == UiRoutingPhase.Target && HandlePointer(in args, phase);

    public bool OnKey(in UiKeyEvent args, UiRoutingPhase phase) =>
        phase == UiRoutingPhase.Target && HandleKey(in args);

    public bool OnText(in UiTextInputEvent args, UiRoutingPhase phase) =>
        phase == UiRoutingPhase.Target && HandleText(in args);

    public bool OnFocus(in UiFocusChangeEvent args, UiRoutingPhase phase) => false;

    private bool HandlePointer(in UiPointerEvent args, UiRoutingPhase phase)
    {
        if (!runtime.Tree.TryGetBinding(node, out ControlNodeBinding binding) ||
            !runtime.TryGetEntryIndex(node, out int index))
        {
            return false;
        }

        return runtime.BehaviorOf(runtime.Entry(index)).OnPointer(runtime, index, in binding, in args, phase);
    }

    private bool HandleKey(in UiKeyEvent args)
    {
        if (!runtime.Tree.TryGetBinding(node, out _))
        {
            return false;
        }

        if (!runtime.TryGetEntryIndex(node, out int index))
        {
            return false;
        }

        return runtime.BehaviorOf(runtime.Entry(index)).OnKey(runtime, index, in args, UiRoutingPhase.Target);
    }

    private bool HandleText(in UiTextInputEvent args)
    {
        if (!runtime.Tree.TryGetBinding(node, out ControlNodeBinding binding) ||
            binding.Part != ControlPart.Primary)
        {
            return false;
        }

        if (!runtime.TryGetEntryIndex(node, out int index))
        {
            return false;
        }

        return runtime.BehaviorOf(runtime.Entry(index)).OnText(runtime, index, in args, UiRoutingPhase.Target);
    }
}
