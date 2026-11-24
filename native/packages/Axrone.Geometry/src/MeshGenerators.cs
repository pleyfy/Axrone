namespace Axrone.Geometry;

/// <summary>
/// Hardened procedural mesh generators: zero heap allocation in steady state,
/// generic over the sink, vertex and index types.
/// </summary>
public static partial class ProceduralPrimitives
{
    /// <summary>Emits a UV sphere.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitSphere<TSink, TVertex, TIndex>(ref TSink sink, in SphereConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint widthSegments = Math.Max(3, config.WidthSegments.Value);
        uint heightSegments = Math.Max(2, config.HeightSegments.Value);
        float radius = config.Radius.Value;
        float phiStart = config.PhiStart.Value;
        float phiLength = config.PhiLength.Value;
        float thetaStart = config.ThetaStart.Value;
        float thetaLength = config.ThetaLength.Value;

        uint startVertex = sink.CurrentVertexCount;

        for (uint iy = 0; iy <= heightSegments; iy++)
        {
            float v = (float)iy / heightSegments;
            float theta = thetaStart + v * thetaLength;
            float sinTheta = MathF.Sin(theta);
            float cosTheta = MathF.Cos(theta);

            for (uint ix = 0; ix <= widthSegments; ix++)
            {
                float u = (float)ix / widthSegments;
                float phi = phiStart + u * phiLength;
                float sinPhi = MathF.Sin(phi);
                float cosPhi = MathF.Cos(phi);

                float x = -radius * cosPhi * sinTheta;
                float y = radius * cosTheta;
                float z = radius * sinPhi * sinTheta;

                Vec3 pos = new(x, y, z);
                Normal3D norm = Normal3D.FromVec3(pos);

                // Pole rows collapse to a point; squeeze their U range toward
                // the center texel so the seam does not smear across the cap.
                bool isPoleRow = iy == 0 || iy == heightSegments;
                float poleU = u * (isPoleRow ? 0.5f : 1.0f) + (isPoleRow ? 0.5f / widthSegments : 0.0f);
                TexCoord uv = new(poleU, 1.0f - v);

                sink.AppendVertex(TVertex.Create(new Position3D(x, y, z), norm, uv, Tangent4D.Default));
            }
        }

        for (uint iy = 0; iy < heightSegments; iy++)
        {
            for (uint ix = 0; ix < widthSegments; ix++)
            {
                uint a = startVertex + iy * (widthSegments + 1) + ix;
                uint b = startVertex + (iy + 1) * (widthSegments + 1) + ix;
                uint c = startVertex + (iy + 1) * (widthSegments + 1) + (ix + 1);
                uint d = startVertex + iy * (widthSegments + 1) + (ix + 1);

                if (iy != 0 || thetaStart > 0.0f)
                {
                    sink.AppendTriangle(
                        TIndex.CreateChecked(a),
                        TIndex.CreateChecked(b),
                        TIndex.CreateChecked(d)
                    );
                }
                if (iy != heightSegments - 1 || (thetaStart + thetaLength) < MathF.PI)
                {
                    sink.AppendTriangle(
                        TIndex.CreateChecked(b),
                        TIndex.CreateChecked(c),
                        TIndex.CreateChecked(d)
                    );
                }
            }
        }
    }

    /// <summary>Emits a UV sphere with single-vertex poles and wrapped rings.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitUvSphere<TSink, TVertex, TIndex>(ref TSink sink, in SphereConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint widthSegments = Math.Max(3, config.WidthSegments.Value);
        uint heightSegments = Math.Max(2, config.HeightSegments.Value);
        float radius = config.Radius.Value;

        sink.AppendVertex(TVertex.Create(
            new Position3D(0, radius, 0), Normal3D.UnitY, new TexCoord(0.5f, 0.0f), Tangent4D.Default));

        for (uint lat = 1; lat < heightSegments; lat++)
        {
            float theta = (float)lat / heightSegments * MathF.PI;
            float sinTheta = MathF.Sin(theta);
            float cosTheta = MathF.Cos(theta);
            float y = radius * cosTheta;
            float ringRadius = radius * sinTheta;

            for (uint lon = 0; lon < widthSegments; lon++)
            {
                float phi = (float)lon / widthSegments * MathF.PI * 2.0f;
                float sinPhi = MathF.Sin(phi);
                float cosPhi = MathF.Cos(phi);

                Vec3 pos = new(ringRadius * cosPhi, y, ringRadius * sinPhi);
                Normal3D norm = Normal3D.FromVec3(pos);
                TexCoord uv = new((float)lon / widthSegments, (float)lat / heightSegments);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, uv, Tangent4D.Default));
            }
        }

        sink.AppendVertex(TVertex.Create(
            new Position3D(0, -radius, 0), Normal3D.NegativeUnitY, new TexCoord(0.5f, 1.0f), Tangent4D.Default));

        for (uint i = 0; i < widthSegments; i++)
        {
            uint next = (i + 1) % widthSegments;
            sink.AppendTriangle(
                TIndex.CreateChecked(0),
                TIndex.CreateChecked(i + 1),
                TIndex.CreateChecked(next + 1));
        }

        for (uint lat = 0; lat < heightSegments - 2; lat++)
        {
            for (uint lon = 0; lon < widthSegments; lon++)
            {
                uint current = lat * widthSegments + lon + 1;
                uint next = lat * widthSegments + ((lon + 1) % widthSegments) + 1;
                uint below = (lat + 1) * widthSegments + lon + 1;
                uint belowNext = (lat + 1) * widthSegments + ((lon + 1) % widthSegments) + 1;

                sink.AppendTriangle(
                    TIndex.CreateChecked(current),
                    TIndex.CreateChecked(next),
                    TIndex.CreateChecked(below));
                sink.AppendTriangle(
                    TIndex.CreateChecked(next),
                    TIndex.CreateChecked(belowNext),
                    TIndex.CreateChecked(below));
            }
        }

        uint bottomVertex = sink.CurrentVertexCount - 1;
        uint lastRingStart = (heightSegments - 2) * widthSegments + 1;

        for (uint i = 0; i < widthSegments; i++)
        {
            uint current = lastRingStart + i;
            uint next = lastRingStart + ((i + 1) % widthSegments);
            sink.AppendTriangle(
                TIndex.CreateChecked(bottomVertex),
                TIndex.CreateChecked(next),
                TIndex.CreateChecked(current));
        }
    }

    /// <summary>Emits a subdivided icosphere. Subdivisions clamp at 6 (327680 triangles).</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitIcosphere<TSink, TVertex, TIndex>(ref TSink sink, Metric radius, uint subdivisions)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint levels = Math.Min(subdivisions, 6);
        float r = radius.Value;
        float t = (1.0f + MathF.Sqrt(5.0f)) * 0.5f;

        ReadOnlySpan<Vec3> baseVertices =
        [
            Vec3.Normalize(new Vec3(-1, t, 0)) * r,
            Vec3.Normalize(new Vec3(1, t, 0)) * r,
            Vec3.Normalize(new Vec3(-1, -t, 0)) * r,
            Vec3.Normalize(new Vec3(1, -t, 0)) * r,
            Vec3.Normalize(new Vec3(0, -1, t)) * r,
            Vec3.Normalize(new Vec3(0, 1, t)) * r,
            Vec3.Normalize(new Vec3(0, -1, -t)) * r,
            Vec3.Normalize(new Vec3(0, 1, -t)) * r,
            Vec3.Normalize(new Vec3(t, 0, -1)) * r,
            Vec3.Normalize(new Vec3(t, 0, 1)) * r,
            Vec3.Normalize(new Vec3(-t, 0, -1)) * r,
            Vec3.Normalize(new Vec3(-t, 0, 1)) * r
        ];

        ReadOnlySpan<uint> baseIndices =
        [
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
        ];

        uint quads = 1u;
        for (uint s = 0; s < levels; s++)
        {
            quads *= 4u;
        }
        uint vertTotal = 10u * quads + 2u;
        uint indexTotal = 60u * quads;

        using var verts = new NativeBuffer<Vec3, AlignedNativeAllocator>(
            ElementCount.From(vertTotal), MemoryAlignment.CacheLine);
        using var inds = new NativeBuffer<uint, AlignedNativeAllocator>(
            ElementCount.From(indexTotal), MemoryAlignment.CacheLine);

        for (int i = 0; i < baseVertices.Length; i++) verts[BufferIndex.From((uint)i)] = baseVertices[i];
        for (int i = 0; i < baseIndices.Length; i++) inds[BufferIndex.From((uint)i)] = baseIndices[i];
        uint vertCount = 12;
        uint indexCount = 60;

        uint estimatedEdges = 30u * (1u << checked((int)(levels * 2 + 1)));
        UnmanagedEdgeTable edgeTable = new(estimatedEdges);

        try
        {
            for (uint s = 0; s < levels; s++)
            {
                uint nextCapacity = checked(indexCount * 4);
                using var nextIndices = new NativeBuffer<uint, AlignedNativeAllocator>(
                    ElementCount.From(nextCapacity), MemoryAlignment.CacheLine);
                uint written = 0;

                for (uint i = 0; i < indexCount; i += 3)
                {
                    uint i0 = inds[BufferIndex.From(i)];
                    uint i1 = inds[BufferIndex.From(i + 1)];
                    uint i2 = inds[BufferIndex.From(i + 2)];

                    uint im01 = GetOrCreateMidpoint(verts, ref vertCount, ref edgeTable, i0, i1, r);
                    uint im12 = GetOrCreateMidpoint(verts, ref vertCount, ref edgeTable, i1, i2, r);
                    uint im20 = GetOrCreateMidpoint(verts, ref vertCount, ref edgeTable, i2, i0, r);

                    nextIndices[BufferIndex.From(written++)] = i0;
                    nextIndices[BufferIndex.From(written++)] = im01;
                    nextIndices[BufferIndex.From(written++)] = im20;
                    nextIndices[BufferIndex.From(written++)] = i1;
                    nextIndices[BufferIndex.From(written++)] = im12;
                    nextIndices[BufferIndex.From(written++)] = im01;
                    nextIndices[BufferIndex.From(written++)] = i2;
                    nextIndices[BufferIndex.From(written++)] = im20;
                    nextIndices[BufferIndex.From(written++)] = im12;
                    nextIndices[BufferIndex.From(written++)] = im01;
                    nextIndices[BufferIndex.From(written++)] = im12;
                    nextIndices[BufferIndex.From(written++)] = im20;
                }

                Span<uint> nextSpan = nextIndices.Span;
                Span<uint> indsSpan = inds.Span;
                nextSpan.Slice(0, (int)written).CopyTo(indsSpan);
                indexCount = written;
            }

            uint startVertex = sink.CurrentVertexCount;
            for (uint i = 0; i < vertCount; i++)
            {
                Vec3 pos = verts[BufferIndex.From(i)];
                Normal3D norm = Normal3D.FromVec3(pos);
                float u = 0.5f + MathF.Atan2(norm.Z, norm.X) / (MathF.PI * 2.0f);
                float v = 0.5f - MathF.Asin(Math.Clamp(norm.Y, -1.0f, 1.0f)) / MathF.PI;

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, new TexCoord(u, v), Tangent4D.Default));
            }

            for (uint i = 0; i < indexCount; i += 3)
            {
                sink.AppendTriangle(
                    TIndex.CreateChecked(startVertex + inds[BufferIndex.From(i)]),
                    TIndex.CreateChecked(startVertex + inds[BufferIndex.From(i + 1)]),
                    TIndex.CreateChecked(startVertex + inds[BufferIndex.From(i + 2)])
                );
            }
        }
        finally
        {
            edgeTable.Dispose();
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint GetOrCreateMidpoint(
        NativeBuffer<Vec3, AlignedNativeAllocator> verts,
        ref uint vertCount,
        ref UnmanagedEdgeTable edgeTable,
        uint v0,
        uint v1,
        float radius)
    {
        uint nextIdx = vertCount;
        if (edgeTable.TryGetOrAdd(v0, v1, nextIdx, out uint existing))
        {
            return existing;
        }

        Vec3 p0 = verts[BufferIndex.From(v0)];
        Vec3 p1 = verts[BufferIndex.From(v1)];
        Vec3 mid = Vec3.Normalize((p0 + p1) * 0.5f) * radius;
        verts[BufferIndex.From(nextIdx)] = mid;
        vertCount++;
        return nextIdx;
    }

    /// <summary>Emits a box with per-face subdivisions.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitBox<TSink, TVertex, TIndex>(ref TSink sink, in BoxConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        float w = config.Width.Value;
        float h = config.Height.Value;
        float d = config.Depth.Value;
        uint ws = Math.Max(1, config.WidthSegments.Value);
        uint hs = Math.Max(1, config.HeightSegments.Value);
        uint ds = Math.Max(1, config.DepthSegments.Value);

        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1), w, h, d * 0.5f, ws, hs);
        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), w, h, d * 0.5f, ws, hs);
        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(0, 0, -1), new Vec3(0, 1, 0), new Vec3(1, 0, 0), d, h, w * 0.5f, ds, hs);
        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(0, 0, 1), new Vec3(0, 1, 0), new Vec3(-1, 0, 0), d, h, w * 0.5f, ds, hs);
        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 1, 0), w, d, h * 0.5f, ws, ds);
        EmitBoxFace<TSink, TVertex, TIndex>(ref sink, new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, -1, 0), w, d, h * 0.5f, ws, ds);
    }

    private static void EmitBoxFace<TSink, TVertex, TIndex>(
        ref TSink sink,
        Vec3 uDir,
        Vec3 vDir,
        Vec3 norm,
        float width,
        float height,
        float depthOffset,
        uint gridX,
        uint gridY)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint startVertex = sink.CurrentVertexCount;
        Normal3D n = Normal3D.FromVec3(norm);

        for (uint iy = 0; iy <= gridY; iy++)
        {
            float v = (float)iy / gridY;
            float py = (v - 0.5f) * height;

            for (uint ix = 0; ix <= gridX; ix++)
            {
                float u = (float)ix / gridX;
                float px = (u - 0.5f) * width;

                Vec3 pos = uDir * px + vDir * py + norm * depthOffset;
                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), n, new TexCoord(u, 1.0f - v), Tangent4D.Default));
            }
        }

        for (uint iy = 0; iy < gridY; iy++)
        {
            for (uint ix = 0; ix < gridX; ix++)
            {
                uint a = startVertex + iy * (gridX + 1) + ix;
                uint b = startVertex + (iy + 1) * (gridX + 1) + ix;
                uint c = startVertex + (iy + 1) * (gridX + 1) + (ix + 1);
                uint d = startVertex + iy * (gridX + 1) + (ix + 1);

                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(d),
                    TIndex.CreateChecked(b)
                );
                sink.AppendTriangle(
                    TIndex.CreateChecked(b),
                    TIndex.CreateChecked(d),
                    TIndex.CreateChecked(c)
                );
            }
        }
    }

    /// <summary>Emits a cylinder with optional caps.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitCylinder<TSink, TVertex, TIndex>(ref TSink sink, in CylinderConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint radialSegments = Math.Max(3, config.RadialSegments.Value);
        uint heightSegments = Math.Max(1, config.HeightSegments.Value);
        float radiusTop = config.RadiusTop.Value;
        float radiusBottom = config.RadiusBottom.Value;
        float height = config.Height.Value;
        float halfHeight = height * 0.5f;
        float thetaStart = config.ThetaStart.Value;
        float thetaLength = config.ThetaLength.Value;

        uint startVertex = sink.CurrentVertexCount;
        float slope = (radiusBottom - radiusTop) / height;

        for (uint y = 0; y <= heightSegments; y++)
        {
            float v = (float)y / heightSegments;
            float radius = v * (radiusBottom - radiusTop) + radiusTop;
            float py = halfHeight - v * height;

            for (uint x = 0; x <= radialSegments; x++)
            {
                float u = (float)x / radialSegments;
                float theta = thetaStart + u * thetaLength;
                float sinT = MathF.Sin(theta);
                float cosT = MathF.Cos(theta);

                Vec3 pos = new(radius * sinT, py, radius * cosT);
                Normal3D norm = Normal3D.FromVec3(new Vec3(sinT, slope, cosT));
                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, new TexCoord(u, 1.0f - v), Tangent4D.Default));
            }
        }

        for (uint y = 0; y < heightSegments; y++)
        {
            for (uint x = 0; x < radialSegments; x++)
            {
                uint a = startVertex + y * (radialSegments + 1) + x;
                uint b = startVertex + (y + 1) * (radialSegments + 1) + x;
                uint c = startVertex + (y + 1) * (radialSegments + 1) + (x + 1);
                uint d = startVertex + y * (radialSegments + 1) + (x + 1);

                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(b),
                    TIndex.CreateChecked(d)
                );
                sink.AppendTriangle(
                    TIndex.CreateChecked(b),
                    TIndex.CreateChecked(c),
                    TIndex.CreateChecked(d)
                );
            }
        }

        if (!config.OpenEnded)
        {
            if (radiusTop > 0.0f)
            {
                EmitCylinderCap<TSink, TVertex, TIndex>(ref sink, radiusTop, halfHeight, radialSegments, thetaStart, thetaLength, true);
            }
            if (radiusBottom > 0.0f)
            {
                EmitCylinderCap<TSink, TVertex, TIndex>(ref sink, radiusBottom, -halfHeight, radialSegments, thetaStart, thetaLength, false);
            }
        }
    }

    private static void EmitCylinderCap<TSink, TVertex, TIndex>(
        ref TSink sink,
        float radius,
        float yPos,
        uint radialSegments,
        float thetaStart,
        float thetaLength,
        bool isTop)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint centerVertex = sink.CurrentVertexCount;
        Normal3D norm = isTop ? Normal3D.UnitY : Normal3D.NegativeUnitY;
        sink.AppendVertex(TVertex.Create(new Position3D(0, yPos, 0), norm, TexCoord.Center, Tangent4D.Default));

        uint perimeterStart = sink.CurrentVertexCount;
        for (uint x = 0; x <= radialSegments; x++)
        {
            float u = (float)x / radialSegments;
            float theta = thetaStart + u * thetaLength;
            float cos = MathF.Cos(theta);
            float sin = MathF.Sin(theta);

            Vec3 pos = new(radius * sin, yPos, radius * cos);
            TexCoord uv = new(sin * 0.5f + 0.5f, cos * 0.5f + 0.5f);
            sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, uv, Tangent4D.Default));
        }

        for (uint x = 0; x < radialSegments; x++)
        {
            uint p1 = perimeterStart + x;
            uint p2 = perimeterStart + x + 1;

            if (isTop)
            {
                sink.AppendTriangle(
                    TIndex.CreateChecked(centerVertex),
                    TIndex.CreateChecked(p1),
                    TIndex.CreateChecked(p2)
                );
            }
            else
            {
                sink.AppendTriangle(
                    TIndex.CreateChecked(centerVertex),
                    TIndex.CreateChecked(p2),
                    TIndex.CreateChecked(p1)
                );
            }
        }
    }
}
