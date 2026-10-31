namespace Axrone.Ui;

/// <summary>Invalidation channels tracked per node.</summary>
[Flags]
public enum UiInvalidationFlags
{
    /// <summary>Nothing dirty.</summary>
    None = 0,

    /// <summary>Measure/arrange must run.</summary>
    Layout = 1 << 0,

    /// <summary>Resolved style must be refreshed.</summary>
    Style = 1 << 1,

    /// <summary>Text/image content changed.</summary>
    Content = 1 << 2,

    /// <summary>Draw list must be rebuilt.</summary>
    Render = 1 << 3,

    /// <summary>Tree structure changed.</summary>
    Structure = 1 << 4,

    /// <summary>Focus order/state changed.</summary>
    Focus = 1 << 5,

    /// <summary>Every channel.</summary>
    All = Layout | Style | Content | Render | Structure | Focus,
}

/// <summary>One invalidation notification.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiInvalidation(UiNodeId Node, UiInvalidationFlags Flags);

/// <summary>Receives invalidation notifications from content, style and input layers.</summary>
public interface IUiInvalidationSink
{
    /// <summary>Marks a node dirty for the given channels.</summary>
    void Invalidate(in UiInvalidation invalidation);
}

/// <summary>Read-only dirty-state contract consumed by frame orchestration.</summary>
public interface IUiDirtyState
{
    /// <summary>Gets whether any layout channel is dirty.</summary>
    bool LayoutDirty { get; }

    /// <summary>Gets whether the tree structure is dirty.</summary>
    bool StructureDirty { get; }

    /// <summary>Gets the number of dirty nodes.</summary>
    int DirtyNodeCount { get; }

    /// <summary>Gets whether a node is dirty for any requested channel.</summary>
    bool IsDirty(UiNodeId node, UiInvalidationFlags flags);

    /// <summary>Clears all dirty state after a completed frame.</summary>
    void Clear();
}
