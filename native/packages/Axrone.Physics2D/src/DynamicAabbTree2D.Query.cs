namespace Axrone.Physics2D;

using System.Buffers;

/// <summary>
/// Structural quality of a built tree: the height of the root, the largest
/// single-side imbalance anywhere, and the ratio of internal-node area to
/// leaf area — the figure of merit Box2D's validation pass reports. A tight,
/// balanced tree keeps query traversals shallow.
/// </summary>
/// <param name="Height">Depth of the root subtree; zero for a single leaf, -1 for an empty tree.</param>
/// <param name="MaxBalance">Largest <c>height(right) − height(left)</c> over internal nodes.</param>
/// <param name="Quality">Summed internal proxy areas divided by summed leaf areas; 1 is perfect.</param>
public readonly record struct TreeMetrics(int Height, int MaxBalance, float Quality)
{
    /// <summary>An empty tree: no height, no imbalance, unit-quality baseline.</summary>
    public static TreeMetrics Empty => new(-1, 0, 1.0f);
}

/// <summary>
/// Query half of the 2D dynamic AABB tree: overlap scans, ray casts, pair
/// enumeration and k-nearest search. All traversals are allocation-free
/// (stack-sized explicit stacks) and report through caller-provided spans or
/// monomorphic visitors, with traversal metrics pushed to
/// <typeparamref name="TMetrics"/>.
/// </summary>
public sealed partial class DynamicAabbTree2D<TUserData, TStrategy, TMetrics>
    where TStrategy : struct, ISpatialPartitionStrategy2D
    where TMetrics : struct, ISpatialMetricsSink
{
    /// <summary>
    /// Writes the identities overlapping <paramref name="box"/> into
    /// <paramref name="results"/>; excess hits are dropped once the span is full.
    /// </summary>
    /// <param name="box">World bounds to test against the stored fat boxes.</param>
    /// <param name="results">Destination span for the overlapping identities.</param>
    /// <returns>Number of identities written.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int QueryOverlaps(in Aabb2D box, Span<SpatialItemId> results)
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull)
            {
                return 0;
            }

            Span<NodeIndex> stack = stackalloc NodeIndex[128];
            int stackPtr = 0;
            stack[stackPtr++] = _rootIndex;

            int count = 0;
            int maxResults = results.Length;

            while (stackPtr > 0)
            {
                NodeIndex nodeIndex = stack[--stackPtr];
                if (nodeIndex.IsNull)
                {
                    continue;
                }

                ref Node2D node = ref GetNodeRef(nodeIndex);
                TMetrics.OnNodeVisited();

                if (node.Box.Overlaps(in box))
                {
                    TMetrics.OnIntersectionTested(true);
                    if (node.IsLeaf())
                    {
                        if ((uint)count < (uint)maxResults)
                        {
                            results[count++] = node.ItemId;
                        }
                        else
                        {
                            return count;
                        }
                    }
                    else
                    {
                        stack[stackPtr++] = node.LeftChild;
                        stack[stackPtr++] = node.RightChild;
                    }
                }
                else
                {
                    TMetrics.OnIntersectionTested(false);
                }
            }

            return count;
        }
        finally
        {
            ExitOperation();
        }
    }

    /// <summary>
    /// Reports every item overlapping <paramref name="box"/> to a visitor;
    /// a <see langword="false"/> verdict stops the traversal early.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int QueryOverlaps<TVisitor, TContext>(in Aabb2D box, ref TVisitor visitor, ref TContext context)
        where TVisitor : struct, ISpatialVisitor2D<TUserData, TContext>
        where TContext : allows ref struct
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull)
            {
                return 0;
            }

            Span<NodeIndex> stack = stackalloc NodeIndex[128];
            int stackPtr = 0;
            stack[stackPtr++] = _rootIndex;

            int hitCount = 0;

            while (stackPtr > 0)
            {
                NodeIndex nodeIndex = stack[--stackPtr];
                if (nodeIndex.IsNull)
                {
                    continue;
                }

                ref Node2D node = ref GetNodeRef(nodeIndex);
                TMetrics.OnNodeVisited();

                if (node.Box.Overlaps(in box))
                {
                    TMetrics.OnIntersectionTested(true);
                    if (node.IsLeaf())
                    {
                        hitCount++;
                        TUserData data = PayloadOf(node.ItemId)!;
                        if (!visitor.OnOverlap(node.ItemId, data, in node.Box, ref context))
                        {
                            break;
                        }
                    }
                    else
                    {
                        stack[stackPtr++] = node.LeftChild;
                        stack[stackPtr++] = node.RightChild;
                    }
                }
                else
                {
                    TMetrics.OnIntersectionTested(false);
                }
            }

            return hitCount;
        }
        finally
        {
            ExitOperation();
        }
    }

    /// <summary>
    /// Casts <paramref name="ray"/> against the tree and writes one hit per
    /// intersected leaf; excess hits are dropped once the span is full.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int RayCast(in Ray2D ray, Span<RayHit> results, float maxDistance = float.PositiveInfinity)
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull)
            {
                return 0;
            }

            Span<NodeIndex> stack = stackalloc NodeIndex[128];
            int stackPtr = 0;
            stack[stackPtr++] = _rootIndex;

            int count = 0;
            int maxResults = results.Length;

            while (stackPtr > 0)
            {
                NodeIndex nodeIndex = stack[--stackPtr];
                if (nodeIndex.IsNull)
                {
                    continue;
                }

                ref Node2D node = ref GetNodeRef(nodeIndex);
                TMetrics.OnNodeVisited();

                if (node.Box.Intersects(in ray, maxDistance, out float dist))
                {
                    TMetrics.OnIntersectionTested(true);
                    if (node.IsLeaf())
                    {
                        if ((uint)count < (uint)maxResults)
                        {
                            results[count++] = new RayHit(node.ItemId, dist);
                        }
                        else
                        {
                            return count;
                        }
                    }
                    else
                    {
                        stack[stackPtr++] = node.LeftChild;
                        stack[stackPtr++] = node.RightChild;
                    }
                }
                else
                {
                    TMetrics.OnIntersectionTested(false);
                }
            }

            return count;
        }
        finally
        {
            ExitOperation();
        }
    }

    /// <summary>
    /// Casts <paramref name="ray"/> against the tree, letting the visitor shrink
    /// <paramref name="maxDistance"/> to prune farther subtrees as hits arrive.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void RayCast<TVisitor, TContext>(in Ray2D ray, float maxDistance, ref TVisitor visitor, ref TContext context)
        where TVisitor : struct, IRayHitVisitor2D<TUserData, TContext>
        where TContext : allows ref struct
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull)
            {
                return;
            }

            Span<NodeIndex> stack = stackalloc NodeIndex[128];
            int stackPtr = 0;
            stack[stackPtr++] = _rootIndex;
            float currentMaxDist = maxDistance;

            while (stackPtr > 0)
            {
                NodeIndex nodeIndex = stack[--stackPtr];
                if (nodeIndex.IsNull)
                {
                    continue;
                }

                ref Node2D node = ref GetNodeRef(nodeIndex);

                if (!node.Box.Intersects(in ray, currentMaxDist, out _))
                {
                    continue;
                }

                if (node.IsLeaf())
                {
                    TUserData data = PayloadOf(node.ItemId)!;
                    if (!visitor.OnHit(node.ItemId, data, in ray, ref currentMaxDist, ref context))
                    {
                        return;
                    }
                }
                else
                {
                    stack[stackPtr++] = node.LeftChild;
                    stack[stackPtr++] = node.RightChild;
                }
            }
        }
        finally
        {
            ExitOperation();
        }
    }

    /// <summary>
    /// Reports each pair of overlapping items once, descending the larger
    /// subtree first so the traversal stays balanced.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void FindPairs<TPairVisitor, TContext>(ref TPairVisitor visitor, ref TContext context)
        where TPairVisitor : struct, IPairVisitor<TUserData, TContext>
        where TContext : allows ref struct
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull || GetNodeRef(_rootIndex).IsLeaf())
            {
                return;
            }

            Span<NodePair> stack = stackalloc NodePair[256];
            int stackCount = 0;
            stack[stackCount++] = new NodePair(_rootIndex, _rootIndex);

            while (stackCount > 0)
            {
                NodePair pair = stack[--stackCount];

                if (pair.A == pair.B)
                {
                    ref Node2D self = ref GetNodeRef(pair.A);
                    if (!self.IsLeaf())
                    {
                        stack[stackCount++] = new NodePair(self.LeftChild, self.LeftChild);
                        stack[stackCount++] = new NodePair(self.RightChild, self.RightChild);
                        stack[stackCount++] = new NodePair(self.LeftChild, self.RightChild);
                    }
                    continue;
                }

                ref Node2D nodeA = ref GetNodeRef(pair.A);
                ref Node2D nodeB = ref GetNodeRef(pair.B);

                if (!nodeA.Box.Overlaps(in nodeB.Box))
                {
                    continue;
                }

                if (nodeA.IsLeaf() && nodeB.IsLeaf())
                {
                    TUserData dataA = PayloadOf(nodeA.ItemId)!;
                    TUserData dataB = PayloadOf(nodeB.ItemId)!;
                    if (!visitor.OnPair(nodeA.ItemId, dataA, nodeB.ItemId, dataB, ref context))
                    {
                        return;
                    }
                }
                else if (nodeA.IsLeaf())
                {
                    stack[stackCount++] = new NodePair(pair.A, nodeB.LeftChild);
                    stack[stackCount++] = new NodePair(pair.A, nodeB.RightChild);
                }
                else if (nodeB.IsLeaf())
                {
                    stack[stackCount++] = new NodePair(nodeA.LeftChild, pair.B);
                    stack[stackCount++] = new NodePair(nodeA.RightChild, pair.B);
                }
                else
                {
                    if (nodeA.Box.Area > nodeB.Box.Area)
                    {
                        stack[stackCount++] = new NodePair(nodeA.LeftChild, pair.B);
                        stack[stackCount++] = new NodePair(nodeA.RightChild, pair.B);
                    }
                    else
                    {
                        stack[stackCount++] = new NodePair(pair.A, nodeB.LeftChild);
                        stack[stackCount++] = new NodePair(pair.A, nodeB.RightChild);
                    }
                }
            }
        }
        finally
        {
            ExitOperation();
        }
    }

    /// <summary>
    /// Writes up to <paramref name="results"/>.Length nearest items to
    /// <paramref name="point"/> in ascending squared-distance order.
    /// </summary>
    /// <param name="point">The query point.</param>
    /// <param name="results">Destination span; a short span yields the nearest subset.</param>
    /// <param name="maxDistance">Neighbors past this distance are ignored.</param>
    /// <returns>Number of neighbors written.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int QueryKNearest(Vec2 point, Span<KnnResult<TUserData>> results, float maxDistance = float.PositiveInfinity)
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull || results.IsEmpty)
            {
                return 0;
            }

            float maxDistSq = float.IsPositiveInfinity(maxDistance) ? float.PositiveInfinity : maxDistance * maxDistance;
            int heapCount = 0;

            Span<NodeIndex> stack = stackalloc NodeIndex[128];
            int stackPtr = 0;
            stack[stackPtr++] = _rootIndex;

            while (stackPtr > 0)
            {
                NodeIndex nodeIndex = stack[--stackPtr];
                if (nodeIndex.IsNull)
                {
                    continue;
                }

                ref Node2D node = ref GetNodeRef(nodeIndex);
                float nodeDistSq = node.Box.DistanceSquared(point);

                if (nodeDistSq > maxDistSq)
                {
                    continue;
                }

                if (node.IsLeaf())
                {
                    TUserData data = PayloadOf(node.ItemId)!;
                    KnnResult<TUserData> item = new(node.ItemId, data, new Geometry.DistanceSquared(nodeDistSq));

                    if (heapCount < results.Length)
                    {
                        PushMaxHeap(results, ref heapCount, in item);
                        if (heapCount == results.Length)
                        {
                            maxDistSq = results[0].DistanceSq.Value;
                        }
                    }
                    else if (nodeDistSq < results[0].DistanceSq.Value)
                    {
                        results[0] = item;
                        HeapifyDown(results, heapCount, 0);
                        maxDistSq = results[0].DistanceSq.Value;
                    }
                }
                else
                {
                    float dist1 = GetNodeRef(node.LeftChild).Box.DistanceSquared(point);
                    float dist2 = GetNodeRef(node.RightChild).Box.DistanceSquared(point);

                    NodeIndex closeChild = dist1 < dist2 ? node.LeftChild : node.RightChild;
                    NodeIndex farChild = dist1 < dist2 ? node.RightChild : node.LeftChild;

                    stack[stackPtr++] = farChild;
                    stack[stackPtr++] = closeChild;
                }
            }

            SortMaxHeapToAscending(results, heapCount);
            return heapCount;
        }
        finally
        {
            ExitOperation();
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void PushMaxHeap(Span<KnnResult<TUserData>> heap, ref int count, in KnnResult<TUserData> item)
    {
        int i = count++;
        heap[i] = item;

        while (i > 0)
        {
            int parent = (i - 1) >> 1;
            if (heap[i].DistanceSq <= heap[parent].DistanceSq)
            {
                break;
            }

            (heap[i], heap[parent]) = (heap[parent], heap[i]);
            i = parent;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void HeapifyDown(Span<KnnResult<TUserData>> heap, int count, int index)
    {
        while (true)
        {
            int largest = index;
            int left = (index << 1) + 1;
            int right = left + 1;

            if (left < count && heap[left].DistanceSq > heap[largest].DistanceSq)
            {
                largest = left;
            }

            if (right < count && heap[right].DistanceSq > heap[largest].DistanceSq)
            {
                largest = right;
            }

            if (largest == index)
            {
                break;
            }

            (heap[index], heap[largest]) = (heap[largest], heap[index]);
            index = largest;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void SortMaxHeapToAscending(Span<KnnResult<TUserData>> heap, int count)
    {
        for (int i = count - 1; i > 0; i--)
        {
            (heap[0], heap[i]) = (heap[i], heap[0]);
            HeapifyDown(heap, i, 0);
        }
    }

    /// <summary>
    /// Walks the stored structure under the operation gate and reports height,
    /// worst imbalance and proxy-area quality. Diagnostic path: it holds the
    /// gate for a full traversal and rents its stack from the shared pool, so
    /// call it outside the simulation step.
    /// </summary>
    /// <returns>The structural metrics of the current tree shape.</returns>
    public TreeMetrics ComputeMetrics()
    {
        EnterOperation();
        try
        {
            if (_rootIndex.IsNull)
            {
                return TreeMetrics.Empty;
            }

            int height = 0;
            int maxBalance = 0;
            float leafArea = 0.0f;
            float internalArea = 0.0f;
            NodeIndex[] rented = ArrayPool<NodeIndex>.Shared.Rent(_nodes.Length);
            try
            {
                Span<NodeIndex> stack = rented.AsSpan(0, _nodes.Length);
                int stackPtr = 0;
                stack[stackPtr++] = _rootIndex;

                while (stackPtr > 0)
                {
                    NodeIndex nodeIndex = stack[--stackPtr];
                    ref Node2D node = ref GetNodeRef(nodeIndex);
                    if (node.IsLeaf())
                    {
                        leafArea += node.Box.Area;
                        continue;
                    }

                    internalArea += node.Box.Area;
                    ref Node2D left = ref GetNodeRef(node.LeftChild);
                    ref Node2D right = ref GetNodeRef(node.RightChild);
                    int balance = Math.Abs(right.Height - left.Height);
                    if (balance > maxBalance)
                    {
                        maxBalance = balance;
                    }

                    stack[stackPtr++] = node.LeftChild;
                    stack[stackPtr++] = node.RightChild;

                    if (node.Height > height)
                    {
                        height = node.Height;
                    }
                }
            }
            finally
            {
                ArrayPool<NodeIndex>.Shared.Return(rented);
            }

            float quality = leafArea > 0.0f ? internalArea / leafArea : 1.0f;
            return new TreeMetrics(height, maxBalance, quality);
        }
        finally
        {
            ExitOperation();
        }
    }
}
