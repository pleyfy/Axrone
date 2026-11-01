namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Resolved hit for a UI point query.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiHitResult(
    UiNodeId Node,
    Vec2 LocalPoint,
    int ZIndex,
    bool HasClip,
    Rect ClipBounds);

/// <summary>
/// Spatial hit-test index contract. Implementations may use Axrone.Geometry
/// (Aabb2D/QuadTree/raycast) behind this surface.
/// </summary>
public interface IUiHitTestIndex
{
    /// <summary>Gets the number of indexed nodes.</summary>
    int Count { get; }

    /// <summary>Adds a node with its bounds, draw order and clip behavior.</summary>
    void Insert(UiNodeId node, in Aabb2D bounds, int zIndex, bool clips);

    /// <summary>Updates the bounds of an indexed node.</summary>
    bool Update(UiNodeId node, in Aabb2D bounds);

    /// <summary>Removes a node.</summary>
    bool Remove(UiNodeId node);

    /// <summary>Removes every indexed node.</summary>
    void Clear();

    /// <summary>Finds the topmost node under a point.</summary>
    bool TryHitTest(Vec2 point, out UiHitResult result);
}
