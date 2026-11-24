namespace Axrone.Scene;

/// <summary>
/// Callback invoked during hierarchy traversal. The visitor is a generic type
/// parameter at the call site, so traversal closes over the callback type
/// rather than a delegate instance. <typeparamref name="TContext"/> may be a
/// <see langword="ref"/> struct, which lets callers accumulate into stack-only
/// state without boxing.
/// </summary>
/// <typeparam name="TContext">Traversal state.</typeparam>
public interface ISceneHierarchyVisitor<TContext>
    where TContext : allows ref struct
{
    /// <summary>Visits one entity.</summary>
    /// <param name="entity">Visited entity.</param>
    /// <param name="depth">Hierarchy depth of the entity.</param>
    /// <param name="context">Traversal state.</param>
    /// <returns><see langword="true"/> to continue; <see langword="false"/> to stop early.</returns>
    bool Visit(SceneEntity entity, int depth, scoped ref TContext context);
}

/// <summary>Receives structural hierarchy notifications from <see cref="SceneHierarchy"/>.</summary>
internal interface ISceneHierarchyObserver
{
    void BeforeStructuralChange(string operation);

    void OnParentChanged(in SceneEntity child, in SceneEntity oldParent, in SceneEntity newParent);

    void OnActiveInHierarchyChanged(in SceneEntity entity, bool active);
}

/// <summary>
/// Allocation-free view over the entity hierarchy: parent/child links, depth
/// and active-in-hierarchy propagation. Structural methods are expected to run
/// outside frame iteration.
/// </summary>
public sealed class SceneHierarchy
{
    private readonly SceneEntityTable _entities;
    private readonly ISceneHierarchyObserver? _observer;

    internal SceneHierarchy(SceneEntityTable entities, ISceneHierarchyObserver? observer)
    {
        ArgumentNullException.ThrowIfNull(entities);
        _entities = entities;
        _observer = observer;
    }

    /// <summary>Parent of an entity, or <see cref="SceneEntity.Null"/> for a root.</summary>
    public SceneEntity ParentOf(SceneEntity entity)
    {
        int slot = _entities.Resolve(entity);
        int parent = _entities.RecordAt(slot).Parent;
        return parent < 0 ? SceneEntity.Null : SceneEntity.FromEntity(_entities.RecordAt(parent).Entity);
    }

    /// <summary>Whether the entity has a parent.</summary>
    public bool HasParent(SceneEntity entity) => _entities.RecordAt(_entities.Resolve(entity)).Parent >= 0;

    /// <summary>Root ancestor of an entity, including the entity itself when it has no parent.</summary>
    public SceneEntity RootOf(SceneEntity entity)
    {
        int slot = _entities.Resolve(entity);
        while (true)
        {
            int parent = _entities.RecordAt(slot).Parent;
            if (parent < 0)
            {
                return SceneEntity.FromEntity(_entities.RecordAt(slot).Entity);
            }

            slot = parent;
        }
    }

    /// <summary>Zero-based depth of an entity; roots are depth zero.</summary>
    public int DepthOf(SceneEntity entity) => _entities.RecordAt(_entities.Resolve(entity)).Meta.Depth;

    /// <summary>Number of direct children.</summary>
    public int ChildCount(SceneEntity entity)
    {
        int slot = _entities.Resolve(entity);
        int count = 0;
        for (int child = _entities.RecordAt(slot).FirstChild; child >= 0; child = _entities.RecordAt(child).NextSibling)
        {
            count++;
        }

        return count;
    }

    /// <summary>Whether the entity has at least one child.</summary>
    public bool HasChildren(SceneEntity entity) => _entities.RecordAt(_entities.Resolve(entity)).FirstChild >= 0;

    /// <summary>Whether <paramref name="ancestor"/> is on the parent chain of <paramref name="descendant"/>.</summary>
    public bool IsAncestorOf(SceneEntity ancestor, SceneEntity descendant)
    {
        int ancestorSlot = _entities.Resolve(ancestor);
        int current = _entities.Resolve(descendant);

        while (current >= 0)
        {
            if (current == ancestorSlot)
            {
                return true;
            }

            current = _entities.RecordAt(current).Parent;
        }

        return false;
    }

    /// <summary>Whether <paramref name="descendant"/> is below <paramref name="ancestor"/>.</summary>
    public bool IsDescendantOf(SceneEntity descendant, SceneEntity ancestor) =>
        IsAncestorOf(ancestor, descendant);

    /// <summary>Attaches <paramref name="child"/> under <paramref name="parent"/>.</summary>
    /// <param name="child">Entity to reparent.</param>
    /// <param name="parent">New parent, or <see cref="SceneEntity.Null"/> to detach.</param>
    /// <exception cref="SceneValidationException">The operation would create a cycle or exceed the depth budget.</exception>
    public void SetParent(SceneEntity child, SceneEntity parent)
    {
        _observer?.BeforeStructuralChange(nameof(SetParent));

        int childSlot = _entities.Resolve(child);
        int parentSlot = parent.IsValid ? _entities.Resolve(parent) : -1;

        if (parentSlot == childSlot)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"{child} cannot be parented to itself.");
        }

        if (parentSlot >= 0 && IsAncestorOf(child, parent))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Parenting {child} under {parent} would create a cycle.");
        }

        ref SceneEntityRecord childRecord = ref _entities.RecordAt(childSlot);
        int oldParentSlot = childRecord.Parent;
        if (oldParentSlot == parentSlot)
        {
            return;
        }

        int parentDepth = parentSlot < 0 ? -1 : _entities.RecordAt(parentSlot).Meta.Depth;
        if (parentDepth + 1 + SubtreeHeight(childSlot) > byte.MaxValue)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Parenting {child} under {parent} would exceed the maximum hierarchy depth of {byte.MaxValue}.");
        }

        SceneEntity oldParent = oldParentSlot < 0
            ? SceneEntity.Null
            : SceneEntity.FromEntity(_entities.RecordAt(oldParentSlot).Entity);

        if (oldParentSlot >= 0)
        {
            DetachFromParent(childSlot, oldParentSlot);
        }

        if (parentSlot >= 0)
        {
            AttachToParent(childSlot, parentSlot);
        }

        bool parentActive = parentSlot < 0 ||
            (_entities.RecordAt(parentSlot).Meta.Flags & SceneEntityFlags.ActiveInHierarchy) != 0;
        UpdateSubtreeState(childSlot, parentActive, parentDepth + 1);

        BumpVersion(childSlot);
        if (oldParentSlot >= 0)
        {
            BumpVersion(oldParentSlot);
        }

        if (parentSlot >= 0)
        {
            BumpVersion(parentSlot);
        }

        if (oldParent != parent)
        {
            _observer?.OnParentChanged(in child, in oldParent, in parent);
        }
    }

    /// <summary>Sets the local active flag and propagates active-in-hierarchy to descendants.</summary>
    public void SetActiveSelf(SceneEntity entity, bool active)
    {
        _observer?.BeforeStructuralChange(nameof(SetActiveSelf));

        int slot = _entities.Resolve(entity);
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);
        bool wasActive = (record.Meta.Flags & SceneEntityFlags.ActiveSelf) != 0;
        if (wasActive == active)
        {
            return;
        }

        record.Meta.Flags = active
            ? record.Meta.Flags | SceneEntityFlags.ActiveSelf
            : record.Meta.Flags & ~SceneEntityFlags.ActiveSelf;

        bool parentActive = record.Parent < 0 ||
            (_entities.RecordAt(record.Parent).Meta.Flags & SceneEntityFlags.ActiveInHierarchy) != 0;
        UpdateSubtreeState(slot, parentActive, record.Meta.Depth);
        BumpVersion(slot);
    }

    /// <summary>Whether the entity is active locally.</summary>
    public bool IsActiveSelf(SceneEntity entity) =>
        (_entities.RecordAt(_entities.Resolve(entity)).Meta.Flags & SceneEntityFlags.ActiveSelf) != 0;

    /// <summary>Whether the entity is active after its ancestor chain is applied.</summary>
    public bool IsActiveInHierarchy(SceneEntity entity) =>
        (_entities.RecordAt(_entities.Resolve(entity)).Meta.Flags & SceneEntityFlags.ActiveInHierarchy) != 0;

    /// <summary>Enumerates direct children in sibling order.</summary>
    public SceneChildEnumerable Children(SceneEntity entity)
    {
        int slot = _entities.Resolve(entity);
        return new SceneChildEnumerable(_entities, _entities.RecordAt(slot).FirstChild);
    }

    /// <summary>Enumerates ancestors from nearest parent to root.</summary>
    public SceneAncestorEnumerable Ancestors(SceneEntity entity)
    {
        int slot = _entities.Resolve(entity);
        return new SceneAncestorEnumerable(_entities, _entities.RecordAt(slot).Parent);
    }

    /// <summary>Visits direct children in sibling order.</summary>
    public bool VisitChildren<TVisitor, TContext>(SceneEntity entity, scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneHierarchyVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        int slot = _entities.Resolve(entity);
        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(child);
            int next = record.NextSibling;
            if (!visitor.Visit(SceneEntity.FromEntity(record.Entity), record.Meta.Depth, ref context))
            {
                return false;
            }

            child = next;
        }

        return true;
    }

    /// <summary>Visits ancestors from nearest parent to root.</summary>
    public bool VisitAncestors<TVisitor, TContext>(SceneEntity entity, scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneHierarchyVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        int current = _entities.RecordAt(_entities.Resolve(entity)).Parent;
        while (current >= 0)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(current);
            int next = record.Parent;
            if (!visitor.Visit(SceneEntity.FromEntity(record.Entity), record.Meta.Depth, ref context))
            {
                return false;
            }

            current = next;
        }

        return true;
    }

    /// <summary>Visits descendants in pre-order using parent links only; no stack allocation.</summary>
    public bool VisitDescendants<TVisitor, TContext>(SceneEntity entity, scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneHierarchyVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        int start = _entities.Resolve(entity);
        int current = start;

        while (true)
        {
            int child = _entities.RecordAt(current).FirstChild;
            if (child >= 0)
            {
                current = child;
                ref SceneEntityRecord childRecord = ref _entities.RecordAt(current);
                if (!visitor.Visit(SceneEntity.FromEntity(childRecord.Entity), childRecord.Meta.Depth, ref context))
                {
                    return false;
                }

                continue;
            }

            while (current != start && _entities.RecordAt(current).NextSibling < 0)
            {
                current = _entities.RecordAt(current).Parent;
            }

            if (current == start)
            {
                return true;
            }

            current = _entities.RecordAt(current).NextSibling;
            ref SceneEntityRecord nextRecord = ref _entities.RecordAt(current);
            if (!visitor.Visit(SceneEntity.FromEntity(nextRecord.Entity), nextRecord.Meta.Depth, ref context))
            {
                return false;
            }
        }
    }

    /// <summary>Visits the entity and every descendant in pre-order.</summary>
    public bool VisitSubtree<TVisitor, TContext>(SceneEntity entity, scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneHierarchyVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        int slot = _entities.Resolve(entity);
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);
        if (!visitor.Visit(SceneEntity.FromEntity(record.Entity), record.Meta.Depth, ref context))
        {
            return false;
        }

        return VisitDescendants(entity, ref visitor, ref context);
    }

    private int SubtreeHeight(int slot)
    {
        int height = 0;
        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            int childHeight = 1 + SubtreeHeight(child);
            if (childHeight > height)
            {
                height = childHeight;
            }

            child = _entities.RecordAt(child).NextSibling;
        }

        return height;
    }

    private void DetachFromParent(int childSlot, int parentSlot)
    {
        ref SceneEntityRecord child = ref _entities.RecordAt(childSlot);
        ref SceneEntityRecord parent = ref _entities.RecordAt(parentSlot);
        int prev = child.PrevSibling;
        int next = child.NextSibling;

        if (prev < 0)
        {
            parent.FirstChild = next;
        }
        else
        {
            _entities.RecordAt(prev).NextSibling = next;
        }

        if (next >= 0)
        {
            _entities.RecordAt(next).PrevSibling = prev;
        }

        child.Parent = -1;
        child.PrevSibling = -1;
        child.NextSibling = -1;
    }

    private void AttachToParent(int childSlot, int parentSlot)
    {
        ref SceneEntityRecord child = ref _entities.RecordAt(childSlot);
        ref SceneEntityRecord parent = ref _entities.RecordAt(parentSlot);
        int first = parent.FirstChild;

        child.Parent = parentSlot;
        child.PrevSibling = -1;
        child.NextSibling = first;

        if (first >= 0)
        {
            _entities.RecordAt(first).PrevSibling = childSlot;
        }

        parent.FirstChild = childSlot;
    }

    private void UpdateSubtreeState(int slot, bool parentActive, int depth)
    {
        if (depth > byte.MaxValue)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Hierarchy depth {depth} exceeds the maximum of {byte.MaxValue}.");
        }

        ref SceneEntityRecord record = ref _entities.RecordAt(slot);
        record.Meta.Depth = (byte)depth;
        bool active = parentActive && (record.Meta.Flags & SceneEntityFlags.ActiveSelf) != 0;
        bool wasActive = (record.Meta.Flags & SceneEntityFlags.ActiveInHierarchy) != 0;

        record.Meta.Flags = active
            ? record.Meta.Flags | SceneEntityFlags.ActiveInHierarchy
            : record.Meta.Flags & ~SceneEntityFlags.ActiveInHierarchy;

        if (wasActive != active)
        {
            BumpVersion(slot);
            SceneEntity entity = SceneEntity.FromEntity(record.Entity);
            _observer?.OnActiveInHierarchyChanged(in entity, active);
        }

        int child = record.FirstChild;
        while (child >= 0)
        {
            int next = _entities.RecordAt(child).NextSibling;
            UpdateSubtreeState(child, active, depth + 1);
            child = next;
        }
    }

    private void BumpVersion(int slot) => _entities.RecordAt(slot).HierarchyVersion++;
}

/// <summary>Allocation-free enumerable over direct children.</summary>
public readonly ref struct SceneChildEnumerable
{
    private readonly SceneEntityTable _entities;
    private readonly int _firstChild;

    internal SceneChildEnumerable(SceneEntityTable entities, int firstChild)
    {
        _entities = entities;
        _firstChild = firstChild;
    }

    /// <summary>Creates a child enumerator.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneChildEnumerator GetEnumerator() => new(_entities, _firstChild);
}

/// <summary>Allocation-free enumerator over direct children.</summary>
public ref struct SceneChildEnumerator
{
    private readonly SceneEntityTable _entities;
    private int _next;
    private SceneEntity _current;

    internal SceneChildEnumerator(SceneEntityTable entities, int firstChild)
    {
        _entities = entities;
        _next = firstChild;
        _current = SceneEntity.Null;
    }

    /// <summary>Current child.</summary>
    public SceneEntity Current
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _current;
    }

    /// <summary>Advances to the next child.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool MoveNext()
    {
        if (_next < 0)
        {
            return false;
        }

        ref SceneEntityRecord record = ref _entities.RecordAt(_next);
        if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0)
        {
            _next = -1;
            return false;
        }

        _current = SceneEntity.FromEntity(record.Entity);
        _next = record.NextSibling;
        return true;
    }
}

/// <summary>Allocation-free enumerable over ancestors.</summary>
public readonly ref struct SceneAncestorEnumerable
{
    private readonly SceneEntityTable _entities;
    private readonly int _parent;

    internal SceneAncestorEnumerable(SceneEntityTable entities, int parent)
    {
        _entities = entities;
        _parent = parent;
    }

    /// <summary>Creates an ancestor enumerator.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneAncestorEnumerator GetEnumerator() => new(_entities, _parent);
}

/// <summary>Allocation-free enumerator over ancestors.</summary>
public ref struct SceneAncestorEnumerator
{
    private readonly SceneEntityTable _entities;
    private int _next;
    private SceneEntity _current;

    internal SceneAncestorEnumerator(SceneEntityTable entities, int parent)
    {
        _entities = entities;
        _next = parent;
        _current = SceneEntity.Null;
    }

    /// <summary>Current ancestor.</summary>
    public SceneEntity Current
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _current;
    }

    /// <summary>Advances to the next ancestor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool MoveNext()
    {
        if (_next < 0)
        {
            return false;
        }

        ref SceneEntityRecord record = ref _entities.RecordAt(_next);
        if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0)
        {
            _next = -1;
            return false;
        }

        _current = SceneEntity.FromEntity(record.Entity);
        _next = record.Parent;
        return true;
    }
}
