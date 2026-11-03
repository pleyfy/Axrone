namespace Axrone.Particles;

public struct CollisionSurface
{
    public uint ColliderId;

    public float Bounce;

    public float Dampen;

    public CollisionSurface(uint colliderId, float bounce, float dampen)
    {
        ColliderId = colliderId;
        Bounce = bounce;
        Dampen = dampen;
    }

    public CollisionSurface()
    {
        ColliderId = 0u;
        Bounce = 0.5f;
        Dampen = 0.1f;
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PlaneCollider
{
    public Vec3 Point;

    public Vec3 Normal;

    public CollisionSurface Surface;

    public PlaneCollider()
    {
        Point = Vec3.Zero;
        Normal = Vec3.UnitY;
        Surface = new CollisionSurface();
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SphereCollider
{
    public Vec3 Center;

    public float Radius;

    public CollisionSurface Surface;

    public SphereCollider()
    {
        Surface = new CollisionSurface();
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct BoxCollider
{
    public Vec3 Center;

    public Vec3 HalfExtents;

    public Quat Orientation;

    public CollisionSurface Surface;

    public BoxCollider()
    {
        Orientation = Quat.Identity;
        Surface = new CollisionSurface();
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct CylinderCollider
{
    public Vec3 Center;

    public float Radius;

    public float HalfHeight;

    public Vec3 Axis;

    public CollisionSurface Surface;

    public CylinderCollider()
    {
        Axis = Vec3.UnitY;
        Surface = new CollisionSurface();
    }
}

public sealed unsafe class ParticleMeshCollider : IDisposable
{
    public const int MaxTriangles = 2048;
    public const int GridDivisions = 8;
    public const int MaxCells = GridDivisions * GridDivisions * GridDivisions;
    public const int MaxTrianglesPerCell = 64;
    public const int MaxCellsPerQuery = 256;

    private const float Skin = 1e-3f;

    private Triangle* _triangles;
    private int* _cellStart;
    private int* _cellEntries;
    private int _divisionsX = 1;
    private int _divisionsY = 1;
    private int _divisionsZ = 1;
    private Aabb3D _bounds;
    private Vec3 _gridMin;
    private Vec3 _invCellSize;
    private CollisionSurface _surface;
    private bool _disposed;

    public Aabb3D Bounds => _bounds;

    public CollisionSurface Surface => _surface;

    public static ParticleMeshCollider Create(ReadOnlySpan<Triangle3> triangles, CollisionSurface surface)
    {
        if (triangles.IsEmpty)
        {
            ParticleThrowHelper.InvalidConfiguration("A mesh collider needs at least one triangle.");
        }

        if (triangles.Length > MaxTriangles)
        {
            ParticleThrowHelper.CapacityExceeded(MaxTriangles);
        }

        Aabb3D bounds = Aabb3D.Empty;
        for (int i = 0; i < triangles.Length; i++)
        {
            bounds = Aabb3D.CreateMerged(bounds, triangles[i].GetBounds());
        }

        Vec3 size = bounds.Size;
        Vec3 margin = new(Skin);
        Vec3 gridMin = bounds.Min - margin;
        Vec3 span = size + margin + margin;
        float maxSpan = MathF.Max(span.X, MathF.Max(span.Y, span.Z));

        int divisionsX = AxisDivisions(span.X, maxSpan);
        int divisionsY = AxisDivisions(span.Y, maxSpan);
        int divisionsZ = AxisDivisions(span.Z, maxSpan);
        Vec3 cellSize = new(span.X / divisionsX, span.Y / divisionsY, span.Z / divisionsZ);
        Vec3 invCellSize = new(1.0f / cellSize.X, 1.0f / cellSize.Y, 1.0f / cellSize.Z);
        int cellCount = divisionsX * divisionsY * divisionsZ;

        int* counts = (int*)NativeMemory.AlignedAlloc((nuint)(MaxCells * sizeof(int)), 64);
        NativeMemory.Clear(counts, (nuint)(MaxCells * sizeof(int)));
        int* cursors = (int*)NativeMemory.AlignedAlloc((nuint)(MaxCells * sizeof(int)), 64);
        NativeMemory.Clear(cursors, (nuint)(MaxCells * sizeof(int)));

        Grid grid = new(divisionsX, divisionsY, divisionsZ, gridMin, invCellSize);
        int* entries = null;
        int totalBinned = 0;
        bool adopted = false;
        Triangle* triangleBlock = null;
        int* cellStart = null;

        try
        {
            for (int i = 0; i < triangles.Length; i++)
            {
                CellBlock block = grid.BlockOf(triangles[i].GetBounds());
                for (int ix = block.MinX; ix <= block.MaxX; ix++)
                {
                    for (int iy = block.MinY; iy <= block.MaxY; iy++)
                    {
                        for (int iz = block.MinZ; iz <= block.MaxZ; iz++)
                        {
                            int cell = (ix * divisionsY + iy) * divisionsZ + iz;
                            if (++counts[cell] > MaxTrianglesPerCell)
                            {
                                ParticleThrowHelper.CapacityExceeded(MaxTrianglesPerCell);
                            }
                        }
                    }
                }
            }

            int total = 0;
            for (int cell = 0; cell < cellCount; cell++)
            {
                total += counts[cell];
            }

            totalBinned = total;

            triangleBlock = (Triangle*)NativeMemory.AlignedAlloc((nuint)(triangles.Length * sizeof(Triangle)), 64);
            cellStart = (int*)NativeMemory.AlignedAlloc((nuint)((MaxCells + 1) * sizeof(int)), 64);
            NativeMemory.Clear(cellStart, (nuint)((MaxCells + 1) * sizeof(int)));
            entries = (int*)NativeMemory.AlignedAlloc((nuint)(Math.Max(1, totalBinned) * sizeof(int)), 64);

            int running = 0;
            for (int cell = 0; cell < cellCount; cell++)
            {
                cellStart[cell] = running;
                cursors[cell] = running;
                running += counts[cell];
            }

            cellStart[cellCount] = running;

            for (int i = 0; i < triangles.Length; i++)
            {
                Triangle3 source = triangles[i];
                triangleBlock[i] = new Triangle(source.A, source.B, source.C, i);
                CellBlock block = grid.BlockOf(source.GetBounds());
                for (int ix = block.MinX; ix <= block.MaxX; ix++)
                {
                    for (int iy = block.MinY; iy <= block.MaxY; iy++)
                    {
                        for (int iz = block.MinZ; iz <= block.MaxZ; iz++)
                        {
                            int cell = (ix * divisionsY + iy) * divisionsZ + iz;
                            entries[cursors[cell]++] = i;
                        }
                    }
                }
            }

            ParticleMeshCollider collider = new()
            {
                _triangles = triangleBlock,
                _cellStart = cellStart,
                _cellEntries = entries,
                _divisionsX = divisionsX,
                _divisionsY = divisionsY,
                _divisionsZ = divisionsZ,
                _bounds = bounds,
                _gridMin = gridMin,
                _invCellSize = invCellSize,
                _surface = surface,
            };
            adopted = true;
            return collider;
        }
        finally
        {
            NativeMemory.AlignedFree(counts);
            NativeMemory.AlignedFree(cursors);
            if (!adopted)
            {
                if (triangleBlock != null)
                {
                    NativeMemory.AlignedFree(triangleBlock);
                }

                if (cellStart != null)
                {
                    NativeMemory.AlignedFree(cellStart);
                }

                if (entries != null)
                {
                    NativeMemory.AlignedFree(entries);
                }
            }
        }
    }

    public bool TryCast(in Vec3 from, in Vec3 to, out PrimitiveHit hit)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        hit = PrimitiveHit.None;

        Vec3 delta = to - from;
        float lengthSq = delta.LengthSquared();
        if (lengthSq <= Skin * Skin)
        {
            return false;
        }

        Vec3 min = Vec3.Min(from, to);
        Vec3 max = Vec3.Max(from, to);
        Aabb3D sweep = new(min - new Vec3(Skin), max + new Vec3(Skin));
        if (!_bounds.Overlaps(sweep))
        {
            return false;
        }

        Grid grid = new(_divisionsX, _divisionsY, _divisionsZ, _gridMin, _invCellSize);
        CellBlock block = grid.BlockOf(sweep);
        int cells = (block.MaxX - block.MinX + 1) * (block.MaxY - block.MinY + 1) * (block.MaxZ - block.MinZ + 1);
        if (cells > MaxCellsPerQuery)
        {
            ParticleThrowHelper.CapacityExceeded(MaxCellsPerQuery);
        }

        float length = MathF.Sqrt(lengthSq);
        Vec3 direction = delta * (1.0f / length);
        Ray ray = new(from, direction, new Distance(0f), new Distance(length + Skin));

        float bestDistance = float.PositiveInfinity;
        bool found = false;
        for (int ix = block.MinX; ix <= block.MaxX; ix++)
        {
            for (int iy = block.MinY; iy <= block.MaxY; iy++)
            {
                for (int iz = block.MinZ; iz <= block.MaxZ; iz++)
                {
                    int cell = (ix * _divisionsY + iy) * _divisionsZ + iz;
                    int start = _cellStart[cell];
                    int end = _cellStart[cell + 1];
                    for (int slot = start; slot < end; slot++)
                    {
                        Triangle candidate = _triangles[_cellEntries[slot]];
                        if (Triangle.TryIntersect(ray, candidate, out PrimitiveHit candidateHit) &&
                            candidateHit.Distance.Value < bestDistance)
                        {
                            bestDistance = candidateHit.Distance.Value;
                            hit = candidateHit;
                            found = true;
                        }
                    }
                }
            }
        }

        return found;
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    private void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (_triangles != null)
        {
            NativeMemory.AlignedFree(_triangles);
        }

        if (_cellStart != null)
        {
            NativeMemory.AlignedFree(_cellStart);
        }

        if (_cellEntries != null)
        {
            NativeMemory.AlignedFree(_cellEntries);
        }

        _triangles = null;
        _cellStart = null;
        _cellEntries = null;
        _disposed = true;
    }

    ~ParticleMeshCollider() => Dispose(false);

    private static int AxisDivisions(float span, float maxSpan) => span > maxSpan * 0.01f ? GridDivisions : 1;

    private readonly struct CellBlock
    {
        public readonly int MinX;
        public readonly int MaxX;
        public readonly int MinY;
        public readonly int MaxY;
        public readonly int MinZ;
        public readonly int MaxZ;

        public CellBlock(int minX, int maxX, int minY, int maxY, int minZ, int maxZ)
        {
            MinX = minX;
            MaxX = maxX;
            MinY = minY;
            MaxY = maxY;
            MinZ = minZ;
            MaxZ = maxZ;
        }
    }

    private readonly struct Grid
    {
        private readonly int _divisionsX;
        private readonly int _divisionsY;
        private readonly int _divisionsZ;
        private readonly Vec3 _min;
        private readonly Vec3 _invCellSize;

        public Grid(int divisionsX, int divisionsY, int divisionsZ, in Vec3 min, in Vec3 invCellSize)
        {
            _divisionsX = divisionsX;
            _divisionsY = divisionsY;
            _divisionsZ = divisionsZ;
            _min = min;
            _invCellSize = invCellSize;
        }

        public readonly CellBlock BlockOf(in Aabb3D box)
        {
            Vec3 lo = (box.Min - _min) * _invCellSize;
            Vec3 hi = (box.Max - _min) * _invCellSize;
            return new CellBlock(
                ClampCell(MathF.Floor(lo.X), _divisionsX),
                ClampCell(MathF.Ceiling(hi.X), _divisionsX),
                ClampCell(MathF.Floor(lo.Y), _divisionsY),
                ClampCell(MathF.Ceiling(hi.Y), _divisionsY),
                ClampCell(MathF.Floor(lo.Z), _divisionsZ),
                ClampCell(MathF.Ceiling(hi.Z), _divisionsZ));
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static int ClampCell(float value, int divisions)
        {
            if (float.IsNaN(value))
            {
                return 0;
            }

            int cell = (int)value;
            return cell < 0 ? 0 : (cell >= divisions ? divisions - 1 : cell);
        }
    }
}
