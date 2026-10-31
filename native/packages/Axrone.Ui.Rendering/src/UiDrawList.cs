namespace Axrone.Ui.Rendering;

/// <summary>
/// Growable draw list. The backing array is retained across frames, so after the
/// first frame that reaches the steady-state command count recording performs no
/// heap allocation at all. Commands are normalized against the active clip stack
/// on insertion; a command fully outside the clip is dropped.
/// </summary>
/// <remarks>
/// Clip state is a stack of intersected rectangles, not a tree of nodes. Pushing
/// an empty intersection keeps the entry so that matching pops stay balanced;
/// every command recorded under it is culled.
/// </remarks>
public sealed class UiDrawList : IUiDrawList
{
    private const int DefaultCapacity = 128;
    private const int DefaultClipCapacity = 16;

    private UiRenderCommand[] _commands;
    private UiRenderCommand[] _sortScratch;
    private Rect[] _clips;
    private int _count;
    private int _clipDepth;

    /// <summary>Initializes a draw list with the given command capacity.</summary>
    /// <param name="initialCapacity">Initial command capacity; must be positive.</param>
    public UiDrawList(int initialCapacity = DefaultCapacity)
    {
        if (initialCapacity <= 0)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(initialCapacity), initialCapacity, "Capacity must be positive.");
        }

        _commands = new UiRenderCommand[initialCapacity];
        _sortScratch = new UiRenderCommand[initialCapacity];
        _clips = new Rect[DefaultClipCapacity];
        _count = 0;
        _clipDepth = 0;
    }

    /// <inheritdoc/>
    public int Count => _count;

    /// <inheritdoc/>
    public ReadOnlySpan<UiRenderCommand> Commands =>
        new(_commands, 0, _count);

    /// <summary>Gets the current clip depth.</summary>
    public int ClipDepth => _clipDepth;

    /// <summary>Gets whether a clip rectangle is currently active.</summary>
    public bool HasClip => _clipDepth != 0;

    /// <summary>Gets the innermost active clip rectangle, or the default rect when unclipped.</summary>
    public Rect ActiveClip => _clipDepth == 0 ? default : _clips[_clipDepth - 1];

    /// <inheritdoc/>
    /// <remarks>
    /// When a clip is active the command is intersected with it. Commands that
    /// fall entirely outside are rejected so the backend never sees a zero-area
    /// draw. The stored command always has <see cref="UiRenderFlags.Clip"/> set
    /// while a clip is active, so the batch key is self-describing.
    /// </remarks>
    public void Add(in UiRenderCommand command)
    {
        UiRenderCommand normalized = command;

        if (_clipDepth != 0)
        {
            Rect clip = _clips[_clipDepth - 1];
            if ((command.Flags & UiRenderFlags.Clip) != 0)
            {
                if (!clip.Intersects(command.Clip, out Rect merged))
                {
                    return;
                }

                clip = merged;
            }

            normalized = command.WithClip(clip);

            if (IsBounded(command.Kind) && !clip.Intersects(command.Bounds))
            {
                return;
            }
        }

        if (_count == _commands.Length)
        {
            GrowCommands();
        }

        _commands[_count++] = normalized;
    }

    /// <summary>Intersects <paramref name="clip"/> with the current clip and pushes it.</summary>
    /// <param name="clip">Clip rectangle in frame pixels.</param>
    public void PushClip(in Rect clip)
    {
        Rect next = clip;
        if (_clipDepth != 0)
        {
            if (!_clips[_clipDepth - 1].Intersects(clip, out next))
            {
                next = default;
            }
        }

        if (_clipDepth == _clips.Length)
        {
            GrowClips();
        }

        _clips[_clipDepth++] = next;
    }

    /// <summary>Pops the innermost clip.</summary>
    /// <returns><see langword="true"/> when a clip was popped; <see langword="false"/> when the stack was empty.</returns>
    public bool PopClip()
    {
        if (_clipDepth == 0)
        {
            return false;
        }

        _clipDepth--;
        return true;
    }

    /// <inheritdoc/>
    public void Clear()
    {
        _count = 0;
        _clipDepth = 0;
    }

    /// <summary>
    /// Stable sort by ascending <see cref="UiRenderCommand.ZIndex"/>. Equal z
    /// values keep their record order, which makes frame output deterministic
    /// regardless of sort implementation. The scratch array is reused, so a
    /// warm buffer sorts without allocating.
    /// </summary>
    public void SortByZIndex()
    {
        int n = _count;
        if (n < 2)
        {
            return;
        }

        if (_sortScratch.Length < n)
        {
            _sortScratch = new UiRenderCommand[Math.Max(n, _commands.Length)];
        }

        UiRenderCommand[] source = _commands;
        UiRenderCommand[] target = _sortScratch;

        for (int width = 1; width < n; width <<= 1)
        {
            for (int left = 0; left < n; left += width << 1)
            {
                int mid = Math.Min(left + width, n);
                int right = Math.Min(left + (width << 1), n);
                MergeRun(source, target, left, mid, right);
            }

            (source, target) = (target, source);
        }

        if (!ReferenceEquals(source, _commands))
        {
            Array.Copy(source, _commands, n);
        }
    }

    /// <summary>Counts commands by kind for frame metrics.</summary>
    /// <param name="layoutPasses">Layout passes attributed to this frame.</param>
    /// <param name="widgetCount">Widgets visited while building the frame.</param>
    /// <param name="visibleWidgetCount">Widgets that produced commands.</param>
    /// <param name="glyphCount">Shaped glyphs emitted by the text layouts referenced by this frame.</param>
    /// <returns>The computed metrics.</returns>
    public UiFrameMetrics ComputeMetrics(
        int layoutPasses = 0,
        int widgetCount = 0,
        int visibleWidgetCount = 0,
        int glyphCount = 0)
    {
        int custom = 0;
        int images = 0;
        int text = 0;
        int strokes = 0;

        ReadOnlySpan<UiRenderCommand> commands = Commands;
        for (int i = 0; i < commands.Length; i++)
        {
            switch (commands[i].Kind)
            {
                case UiRenderCommandKind.Image:
                    images++;
                    break;
                case UiRenderCommandKind.Text:
                    text++;
                    break;
                case UiRenderCommandKind.Stroke:
                    strokes++;
                    break;
                case UiRenderCommandKind.Custom:
                    custom++;
                    break;
                default:
                    break;
            }
        }

        return new UiFrameMetrics(
            widgetCount,
            visibleWidgetCount,
            _count,
            custom,
            images,
            text,
            strokes,
            glyphCount,
            layoutPasses);
    }

    /// <summary>
    /// Rebinds <paramref name="target"/> to this list's current contents. The
    /// frame borrows the array and stays valid until this list is mutated again.
    /// </summary>
    /// <param name="target">Frame instance to rebind.</param>
    /// <param name="viewport">Viewport the frame was built for.</param>
    /// <param name="metrics">Precomputed frame metrics.</param>
    public void Build(UiFrame target, in UiViewport viewport, in UiFrameMetrics metrics)
    {
        ArgumentNullException.ThrowIfNull(target);
        target.Rebind(_commands, _count, viewport, metrics);
    }

    /// <summary>Creates a frame that borrows this list's current contents.</summary>
    /// <param name="viewport">Viewport the frame was built for.</param>
    /// <param name="metrics">Precomputed frame metrics.</param>
    /// <returns>The borrowed frame view.</returns>
    public UiFrame Build(in UiViewport viewport, in UiFrameMetrics metrics) =>
        new(_commands, _count, viewport, metrics);

    private static bool IsBounded(UiRenderCommandKind kind) =>
        kind is UiRenderCommandKind.Quad or UiRenderCommandKind.Image or UiRenderCommandKind.Text;

    private static void MergeRun(UiRenderCommand[] source, UiRenderCommand[] target, int left, int mid, int right)
    {
        int i = left;
        int j = mid;
        int k = left;

        while (i < mid && j < right)
        {
            // <= keeps the left run first for equal z, preserving input order.
            if (source[i].ZIndex <= source[j].ZIndex)
            {
                target[k++] = source[i++];
            }
            else
            {
                target[k++] = source[j++];
            }
        }

        while (i < mid)
        {
            target[k++] = source[i++];
        }

        while (j < right)
        {
            target[k++] = source[j++];
        }
    }

    private void GrowCommands()
    {
        int capacity = _commands.Length * 2;
        Array.Resize(ref _commands, capacity);
        if (_sortScratch.Length < capacity)
        {
            Array.Resize(ref _sortScratch, capacity);
        }
    }

    private void GrowClips()
    {
        Array.Resize(ref _clips, _clips.Length * 2);
    }
}

/// <summary>
/// Immutable frame view over a draw list's command array. The view is borrowed:
/// it remains valid until the owning <see cref="UiDrawList"/> mutates or is
/// cleared, which is why hosts flush within the tick that produced the frame.
/// </summary>
public sealed class UiFrame : IUiFrame
{
    private UiRenderCommand[] _commands;
    private int _count;
    private UiViewport _viewport;
    private UiFrameMetrics _metrics;

    /// <summary>Initializes an empty frame view.</summary>
    public UiFrame()
    {
        _commands = [];
        _count = 0;
        _viewport = default;
        _metrics = default;
    }

    internal UiFrame(UiRenderCommand[] commands, int count, in UiViewport viewport, in UiFrameMetrics metrics)
    {
        _commands = commands;
        _count = count;
        _viewport = viewport;
        _metrics = metrics;
    }

    /// <inheritdoc/>
    public UiViewport Viewport => _viewport;

    /// <inheritdoc/>
    public UiFrameMetrics Metrics => _metrics;

    /// <inheritdoc/>
    public ReadOnlySpan<UiRenderCommand> Commands => new(_commands, 0, _count);

    /// <summary>Gets whether this view currently carries any commands.</summary>
    public bool IsEmpty => _count == 0;

    internal void Rebind(UiRenderCommand[] commands, int count, in UiViewport viewport, in UiFrameMetrics metrics)
    {
        _commands = commands;
        _count = count;
        _viewport = viewport;
        _metrics = metrics;
    }
}
