namespace Axrone.Geometry;

/// <summary>Procedural generators, second half: capsule through grid plus shape dispatch.</summary>
public static partial class ProceduralPrimitives
{
    /// <summary>Emits a capsule.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitCapsule<TSink, TVertex, TIndex>(ref TSink sink, in CapsuleConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint capSegments = Math.Max(2, config.CapSegments.Value);
        uint radialSegments = Math.Max(3, config.RadialSegments.Value);
        float radius = config.Radius.Value;
        float halfLength = config.Length.Value * 0.5f;

        uint totalVerticalSegments = capSegments * 2 + 1;
        uint startVertex = sink.CurrentVertexCount;

        for (uint iy = 0; iy <= totalVerticalSegments; iy++)
        {
            float y, r, ny, nr;

            if (iy <= capSegments)
            {
                float phi = -MathF.PI * 0.5f + (float)iy / capSegments * (MathF.PI * 0.5f);
                y = -halfLength + radius * MathF.Sin(phi);
                r = radius * MathF.Cos(phi);
                ny = MathF.Sin(phi);
                nr = MathF.Cos(phi);
            }
            else if (iy <= capSegments + 1)
            {
                y = halfLength;
                r = radius;
                ny = 0.0f;
                nr = 1.0f;
            }
            else
            {
                float phi = (float)(iy - capSegments - 1) / capSegments * (MathF.PI * 0.5f);
                y = halfLength + radius * MathF.Sin(phi);
                r = radius * MathF.Cos(phi);
                ny = MathF.Sin(phi);
                nr = MathF.Cos(phi);
            }

            for (uint ix = 0; ix <= radialSegments; ix++)
            {
                float u = (float)ix / radialSegments;
                float theta = u * MathF.PI * 2.0f;
                float sinT = MathF.Sin(theta);
                float cosT = MathF.Cos(theta);

                Vec3 pos = new(r * sinT, y, r * cosT);
                Normal3D norm = Normal3D.FromVec3(new Vec3(nr * sinT, ny, nr * cosT));
                TexCoord uv = new(u, (float)iy / totalVerticalSegments);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, uv, Tangent4D.Default));
            }
        }

        for (uint iy = 0; iy < totalVerticalSegments; iy++)
        {
            for (uint ix = 0; ix < radialSegments; ix++)
            {
                uint a = startVertex + iy * (radialSegments + 1) + ix;
                uint b = startVertex + (iy + 1) * (radialSegments + 1) + ix;
                uint c = startVertex + (iy + 1) * (radialSegments + 1) + (ix + 1);
                uint d = startVertex + iy * (radialSegments + 1) + (ix + 1);

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

    /// <summary>Emits an XY plane facing +Z.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitPlane<TSink, TVertex, TIndex>(ref TSink sink, in PlaneConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        float width = config.Width.Value;
        float height = config.Height.Value;
        uint gridX = Math.Max(1, config.WidthSegments.Value);
        uint gridY = Math.Max(1, config.HeightSegments.Value);

        uint startVertex = sink.CurrentVertexCount;

        for (uint iy = 0; iy <= gridY; iy++)
        {
            float v = (float)iy / gridY;
            float py = (v - 0.5f) * height;

            for (uint ix = 0; ix <= gridX; ix++)
            {
                float u = (float)ix / gridX;
                float px = (u - 0.5f) * width;

                sink.AppendVertex(TVertex.Create(
                    new Position3D(px, py, 0.0f),
                    Normal3D.UnitZ,
                    new TexCoord(u, 1.0f - v),
                    Tangent4D.Default
                ));
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

    /// <summary>Emits a pill: a lathed profile fusing caps and body in one vertex grid.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitPill<TSink, TVertex, TIndex>(ref TSink sink, in CapsuleConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        float radius = config.Radius.Value;
        float length = config.Length.Value;
        uint radialSegments = Math.Max(3, config.RadialSegments.Value);
        uint capClamped = Math.Max(2, config.CapSegments.Value);
        float totalHeight = length + 2.0f * radius;
        float cylinderHeight = length;
        float halfCap = capClamped * 0.5f;
        uint rings = capClamped + 2;

        uint startVertex = sink.CurrentVertexCount;

        for (uint ring = 0; ring <= rings; ring++)
        {
            float y;
            float ringRadius;
            float v = (float)ring / rings;

            if ((float)ring <= halfCap)
            {
                float phi = ((float)ring / halfCap) * MathF.PI * 0.5f;
                y = totalHeight * 0.5f - radius + radius * MathF.Cos(phi);
                ringRadius = radius * MathF.Sin(phi);
            }
            else if ((float)ring <= (float)rings - halfCap)
            {
                float t = ((float)ring - halfCap) / ((float)rings - halfCap * 2.0f);
                y = cylinderHeight * 0.5f - t * cylinderHeight;
                ringRadius = radius;
            }
            else
            {
                float phi = (((float)ring - ((float)rings - halfCap)) / halfCap) * MathF.PI * 0.5f;
                y = -totalHeight * 0.5f + radius - radius * MathF.Cos(phi);
                ringRadius = radius * MathF.Sin(phi);
            }

            for (uint segment = 0; segment <= radialSegments; segment++)
            {
                float theta = (float)segment / radialSegments * MathF.PI * 2.0f;
                float x = ringRadius * MathF.Cos(theta);
                float z = ringRadius * MathF.Sin(theta);

                Vec3 pos = new(x, y, z);
                Normal3D norm;
                if ((float)ring <= halfCap || (float)ring > (float)rings - halfCap)
                {
                    float centerY = (float)ring <= halfCap ? cylinderHeight * 0.5f : -cylinderHeight * 0.5f;
                    norm = Normal3D.FromVec3(pos - new Vec3(0, centerY, 0));
                }
                else
                {
                    norm = Normal3D.FromVec3(new Vec3(x, 0, z));
                }
                TexCoord uv = new((float)segment / radialSegments, v);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, uv, Tangent4D.Default));
            }
        }

        for (uint ring = 0; ring < rings; ring++)
        {
            for (uint segment = 0; segment < radialSegments; segment++)
            {
                uint a = startVertex + ring * (radialSegments + 1) + segment;
                uint b = startVertex + ring * (radialSegments + 1) + segment + 1;
                uint c = startVertex + (ring + 1) * (radialSegments + 1) + segment + 1;
                uint d = startVertex + (ring + 1) * (radialSegments + 1) + segment;

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
    }

    /// <summary>Emits a torus.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitTorus<TSink, TVertex, TIndex>(ref TSink sink, in TorusConfig config)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint radialSegments = Math.Max(3, config.RadialSegments.Value);
        uint tubularSegments = Math.Max(3, config.TubularSegments.Value);
        float radius = config.Radius.Value;
        float tube = config.Tube.Value;
        float arc = config.Arc.Value;

        uint startVertex = sink.CurrentVertexCount;

        for (uint j = 0; j <= radialSegments; j++)
        {
            float v = (float)j / radialSegments * (MathF.PI * 2.0f);
            float cosV = MathF.Cos(v);
            float sinV = MathF.Sin(v);

            for (uint i = 0; i <= tubularSegments; i++)
            {
                float u = (float)i / tubularSegments * arc;
                float cosU = MathF.Cos(u);
                float sinU = MathF.Sin(u);

                Vec3 pos = new(
                    (radius + tube * cosV) * cosU,
                    (radius + tube * cosV) * sinU,
                    tube * sinV
                );

                Vec3 center = new(radius * cosU, radius * sinU, 0.0f);
                Normal3D norm = Normal3D.FromVec3(pos - center);
                TexCoord uv = new((float)i / tubularSegments, (float)j / radialSegments);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, uv, Tangent4D.Default));
            }
        }

        for (uint j = 0; j < radialSegments; j++)
        {
            for (uint i = 0; i < tubularSegments; i++)
            {
                uint a = startVertex + j * (tubularSegments + 1) + i;
                uint b = startVertex + (j + 1) * (tubularSegments + 1) + i;
                uint c = startVertex + (j + 1) * (tubularSegments + 1) + (i + 1);
                uint d = startVertex + j * (tubularSegments + 1) + (i + 1);

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

    /// <summary>Emits a hollow tube: outer wall, inner wall and both rims.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitTube<TSink, TVertex, TIndex>(
        ref TSink sink,
        Metric outerRadius,
        Metric innerRadius,
        Metric height,
        SegmentResolution radialSegments,
        SegmentResolution heightSegments)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint rSeg = Math.Max(3, radialSegments.Value);
        uint hSeg = Math.Max(1, heightSegments.Value);
        float h = height.Value;
        float halfH = h * 0.5f;
        float rOut = outerRadius.Value;
        float rIn = innerRadius.Value;

        CylinderConfig outerCfg = new()
        {
            RadiusTop = outerRadius,
            RadiusBottom = outerRadius,
            Height = height,
            RadialSegments = radialSegments,
            HeightSegments = heightSegments,
            OpenEnded = true
        };
        EmitCylinder<TSink, TVertex, TIndex>(ref sink, outerCfg);

        uint innerStart = sink.CurrentVertexCount;
        for (uint y = 0; y <= hSeg; y++)
        {
            float v = (float)y / hSeg;
            float py = halfH - v * h;

            for (uint x = 0; x <= rSeg; x++)
            {
                float u = (float)x / rSeg;
                float theta = u * MathF.PI * 2.0f;
                float sinT = MathF.Sin(theta);
                float cosT = MathF.Cos(theta);

                Vec3 pos = new(rIn * sinT, py, rIn * cosT);
                Normal3D norm = Normal3D.FromVec3(new Vec3(-sinT, 0, -cosT));
                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), norm, new TexCoord(u, 1.0f - v), Tangent4D.Default));
            }
        }

        for (uint y = 0; y < hSeg; y++)
        {
            for (uint x = 0; x < rSeg; x++)
            {
                uint a = innerStart + y * (rSeg + 1) + x;
                uint b = innerStart + (y + 1) * (rSeg + 1) + x;
                uint c = innerStart + (y + 1) * (rSeg + 1) + (x + 1);
                uint d = innerStart + y * (rSeg + 1) + (x + 1);

                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(d),
                    TIndex.CreateChecked(c)
                );
                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(c),
                    TIndex.CreateChecked(b)
                );
            }
        }

        uint topRimStart = sink.CurrentVertexCount;
        for (uint x = 0; x <= rSeg; x++)
        {
            float u = (float)x / rSeg;
            float theta = u * MathF.PI * 2.0f;
            float sinT = MathF.Sin(theta);
            float cosT = MathF.Cos(theta);

            sink.AppendVertex(TVertex.Create(new Position3D(rIn * sinT, halfH, rIn * cosT), Normal3D.UnitY, new TexCoord(u, 0.0f), Tangent4D.Default));
            sink.AppendVertex(TVertex.Create(new Position3D(rOut * sinT, halfH, rOut * cosT), Normal3D.UnitY, new TexCoord(u, 1.0f), Tangent4D.Default));
        }

        for (uint x = 0; x < rSeg; x++)
        {
            uint i0 = topRimStart + x * 2;
            uint o0 = topRimStart + x * 2 + 1;
            uint i1 = topRimStart + (x + 1) * 2;
            uint o1 = topRimStart + (x + 1) * 2 + 1;

            sink.AppendTriangle(TIndex.CreateChecked(i0), TIndex.CreateChecked(o0), TIndex.CreateChecked(i1));
            sink.AppendTriangle(TIndex.CreateChecked(i1), TIndex.CreateChecked(o0), TIndex.CreateChecked(o1));
        }

        uint botRimStart = sink.CurrentVertexCount;
        for (uint x = 0; x <= rSeg; x++)
        {
            float u = (float)x / rSeg;
            float theta = u * MathF.PI * 2.0f;
            float sinT = MathF.Sin(theta);
            float cosT = MathF.Cos(theta);

            sink.AppendVertex(TVertex.Create(new Position3D(rIn * sinT, -halfH, rIn * cosT), Normal3D.NegativeUnitY, new TexCoord(u, 0.0f), Tangent4D.Default));
            sink.AppendVertex(TVertex.Create(new Position3D(rOut * sinT, -halfH, rOut * cosT), Normal3D.NegativeUnitY, new TexCoord(u, 1.0f), Tangent4D.Default));
        }

        for (uint x = 0; x < rSeg; x++)
        {
            uint i0 = botRimStart + x * 2;
            uint o0 = botRimStart + x * 2 + 1;
            uint i1 = botRimStart + (x + 1) * 2;
            uint o1 = botRimStart + (x + 1) * 2 + 1;

            sink.AppendTriangle(TIndex.CreateChecked(o0), TIndex.CreateChecked(i1), TIndex.CreateChecked(o1));
            sink.AppendTriangle(TIndex.CreateChecked(o0), TIndex.CreateChecked(i0), TIndex.CreateChecked(i1));
        }
    }

    /// <summary>Emits a torus knot with parallel-transport frames.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitTorusKnot<TSink, TVertex, TIndex>(
        ref TSink sink,
        Metric radius,
        Metric tube,
        SegmentResolution tubularSegments,
        SegmentResolution radialSegments,
        uint p,
        uint q)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint tubSeg = Math.Max(3, tubularSegments.Value);
        uint radSeg = Math.Max(3, radialSegments.Value);
        float r = radius.Value;
        float t = tube.Value;
        uint startVertex = sink.CurrentVertexCount;

        for (uint i = 0; i <= tubSeg; i++)
        {
            float u = (float)i / tubSeg * (MathF.PI * 2.0f);
            Vec3 p1 = EvalTorusKnot(u, p, q, r);
            Vec3 p2 = EvalTorusKnot(u + 0.001f, p, q, r);
            Vec3 p0 = EvalTorusKnot(u - 0.001f, p, q, r);

            Vec3 tangent = Vec3.Normalize(p2 - p0);
            Vec3 d2 = p2 - 2.0f * p1 + p0;
            Vec3 n = d2 - tangent * Vec3.Dot(tangent, d2);
            if (n.LengthSquared() < 1e-6f)
            {
                n = MathF.Abs(tangent.Y) < 0.9f ? Vec3.Cross(tangent, Vec3.UnitY) : Vec3.Cross(tangent, Vec3.UnitX);
            }
            n = Vec3.Normalize(n);
            Vec3 b = Vec3.Normalize(Vec3.Cross(tangent, n));
            n = Vec3.Cross(b, tangent);

            for (uint j = 0; j <= radSeg; j++)
            {
                float v = (float)j / radSeg * (MathF.PI * 2.0f);
                float sinV = MathF.Sin(v);
                float cosV = MathF.Cos(v);

                Vec3 normal = Vec3.Normalize(cosV * n + sinV * b);
                Vec3 pos = p1 + t * normal;
                TexCoord uv = new((float)i / tubSeg, (float)j / radSeg);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), Normal3D.FromVec3(normal), uv, Tangent4D.Default));
            }
        }

        for (uint i = 0; i < tubSeg; i++)
        {
            for (uint j = 0; j < radSeg; j++)
            {
                uint a = startVertex + i * (radSeg + 1) + j;
                uint b = startVertex + (i + 1) * (radSeg + 1) + j;
                uint c = startVertex + (i + 1) * (radSeg + 1) + (j + 1);
                uint d = startVertex + i * (radSeg + 1) + (j + 1);

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

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec3 EvalTorusKnot(float u, uint p, uint q, float radius)
    {
        float cu = MathF.Cos(u * p);
        float su = MathF.Sin(u * p);
        float qu = u * q;
        float r = radius * (0.5f * (2.0f + MathF.Sin(qu)));
        return new Vec3(r * cu, r * su, radius * 0.5f * MathF.Cos(qu));
    }

    /// <summary>Emits a helix spring.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitSpring<TSink, TVertex, TIndex>(
        ref TSink sink,
        Metric radius,
        Metric tubeRadius,
        Metric length,
        uint turns,
        SegmentResolution tubularSegments,
        SegmentResolution radialSegments)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint tubSeg = Math.Max(8, tubularSegments.Value);
        uint radSeg = Math.Max(3, radialSegments.Value);
        float r = radius.Value;
        float tr = tubeRadius.Value;
        float len = length.Value;
        float totalAngle = turns * MathF.PI * 2.0f;
        uint startVertex = sink.CurrentVertexCount;

        for (uint i = 0; i <= tubSeg; i++)
        {
            float t = (float)i / tubSeg;
            float angle = t * totalAngle;
            float y = (t - 0.5f) * len;

            Vec3 center = new(r * MathF.Cos(angle), y, r * MathF.Sin(angle));
            Vec3 tangent = Vec3.Normalize(new Vec3(
                -r * totalAngle * MathF.Sin(angle),
                len,
                r * totalAngle * MathF.Cos(angle)
            ));

            Vec3 normal = Vec3.Normalize(new Vec3(-MathF.Cos(angle), 0, -MathF.Sin(angle)));
            Vec3 binormal = Vec3.Normalize(Vec3.Cross(tangent, normal));
            normal = Vec3.Normalize(Vec3.Cross(binormal, tangent));

            for (uint j = 0; j <= radSeg; j++)
            {
                float phi = (float)j / radSeg * (MathF.PI * 2.0f);
                float cosPhi = MathF.Cos(phi);
                float sinPhi = MathF.Sin(phi);

                Vec3 norm = Vec3.Normalize(cosPhi * normal + sinPhi * binormal);
                Vec3 pos = center + tr * norm;
                TexCoord uv = new(t, (float)j / radSeg);

                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), Normal3D.FromVec3(norm), uv, Tangent4D.Default));
            }
        }

        for (uint i = 0; i < tubSeg; i++)
        {
            for (uint j = 0; j < radSeg; j++)
            {
                uint a = startVertex + i * (radSeg + 1) + j;
                uint b = startVertex + (i + 1) * (radSeg + 1) + j;
                uint c = startVertex + (i + 1) * (radSeg + 1) + (j + 1);
                uint d = startVertex + i * (radSeg + 1) + (j + 1);

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

    /// <summary>Emits a flat disc in the XY plane.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitCircle<TSink, TVertex, TIndex>(ref TSink sink, Metric radius, SegmentResolution segments)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint seg = Math.Max(3, segments.Value);
        float r = radius.Value;
        uint centerVertex = sink.CurrentVertexCount;

        sink.AppendVertex(TVertex.Create(Position3D.Zero, Normal3D.UnitZ, TexCoord.Center, Tangent4D.Default));

        uint perimeterStart = sink.CurrentVertexCount;
        for (uint i = 0; i <= seg; i++)
        {
            float theta = (float)i / seg * (MathF.PI * 2.0f);
            float cos = MathF.Cos(theta);
            float sin = MathF.Sin(theta);

            Vec3 pos = new(r * cos, r * sin, 0.0f);
            TexCoord uv = new(cos * 0.5f + 0.5f, sin * 0.5f + 0.5f);
            sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), Normal3D.UnitZ, uv, Tangent4D.Default));
        }

        for (uint i = 0; i < seg; i++)
        {
            sink.AppendTriangle(
                TIndex.CreateChecked(centerVertex),
                TIndex.CreateChecked(perimeterStart + i),
                TIndex.CreateChecked(perimeterStart + i + 1)
            );
        }
    }

    /// <summary>Emits a flat ring in the XY plane.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitRing<TSink, TVertex, TIndex>(
        ref TSink sink,
        Metric innerRadius,
        Metric outerRadius,
        SegmentResolution thetaSegments,
        SegmentResolution phiSegments)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint tSeg = Math.Max(3, thetaSegments.Value);
        uint pSeg = Math.Max(1, phiSegments.Value);
        float rIn = innerRadius.Value;
        float rOut = outerRadius.Value;
        uint startVertex = sink.CurrentVertexCount;

        for (uint i = 0; i <= pSeg; i++)
        {
            float v = (float)i / pSeg;
            float r = rIn + v * (rOut - rIn);

            for (uint j = 0; j <= tSeg; j++)
            {
                float u = (float)j / tSeg;
                float theta = u * (MathF.PI * 2.0f);
                float cos = MathF.Cos(theta);
                float sin = MathF.Sin(theta);

                Vec3 pos = new(r * cos, r * sin, 0.0f);
                TexCoord uv = new(cos * 0.5f * (r / rOut) + 0.5f, sin * 0.5f * (r / rOut) + 0.5f);
                sink.AppendVertex(TVertex.Create(new Position3D(pos.X, pos.Y, pos.Z), Normal3D.UnitZ, uv, Tangent4D.Default));
            }
        }

        for (uint i = 0; i < pSeg; i++)
        {
            for (uint j = 0; j < tSeg; j++)
            {
                uint a = startVertex + i * (tSeg + 1) + j;
                uint b = startVertex + (i + 1) * (tSeg + 1) + j;
                uint c = startVertex + (i + 1) * (tSeg + 1) + (j + 1);
                uint d = startVertex + i * (tSeg + 1) + (j + 1);

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
    }

    /// <summary>Emits an XZ ground grid facing +Y.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitGrid<TSink, TVertex, TIndex>(
        ref TSink sink,
        Metric width,
        Metric height,
        SegmentResolution widthSegments,
        SegmentResolution heightSegments)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        uint ws = Math.Max(1, widthSegments.Value);
        uint hs = Math.Max(1, heightSegments.Value);
        float w = width.Value;
        float h = height.Value;
        uint startVertex = sink.CurrentVertexCount;

        for (uint iz = 0; iz <= hs; iz++)
        {
            float v = (float)iz / hs;
            float pz = (v - 0.5f) * h;

            for (uint ix = 0; ix <= ws; ix++)
            {
                float u = (float)ix / ws;
                float px = (u - 0.5f) * w;

                sink.AppendVertex(TVertex.Create(
                    new Position3D(px, 0.0f, pz),
                    Normal3D.UnitY,
                    new TexCoord(u, v),
                    Tangent4D.Default
                ));
            }
        }

        for (uint iz = 0; iz < hs; iz++)
        {
            for (uint ix = 0; ix < ws; ix++)
            {
                uint a = startVertex + iz * (ws + 1) + ix;
                uint b = startVertex + (iz + 1) * (ws + 1) + ix;
                uint c = startVertex + (iz + 1) * (ws + 1) + (ix + 1);
                uint d = startVertex + iz * (ws + 1) + (ix + 1);

                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(c),
                    TIndex.CreateChecked(d)
                );
                sink.AppendTriangle(
                    TIndex.CreateChecked(a),
                    TIndex.CreateChecked(b),
                    TIndex.CreateChecked(c)
                );
            }
        }
    }

    /// <summary>Dispatches one of the six configured shapes into <paramref name="sink"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void EmitShape<TSink, TVertex, TIndex>(ref TSink sink, in ShapeDescriptor descriptor)
        where TSink : IMeshSink<TVertex, TIndex>, allows ref struct
        where TVertex : unmanaged, IVertex<TVertex>
        where TIndex : unmanaged, System.Numerics.IBinaryInteger<TIndex>
    {
        switch (descriptor.Kind)
        {
            case ShapeKind.Sphere:
                EmitSphere<TSink, TVertex, TIndex>(ref sink, in descriptor.Sphere);
                break;
            case ShapeKind.Box:
                EmitBox<TSink, TVertex, TIndex>(ref sink, in descriptor.Box);
                break;
            case ShapeKind.Cylinder:
                EmitCylinder<TSink, TVertex, TIndex>(ref sink, in descriptor.Cylinder);
                break;
            case ShapeKind.Capsule:
                EmitCapsule<TSink, TVertex, TIndex>(ref sink, in descriptor.Capsule);
                break;
            case ShapeKind.Plane:
                EmitPlane<TSink, TVertex, TIndex>(ref sink, in descriptor.Plane);
                break;
            case ShapeKind.Torus:
                EmitTorus<TSink, TVertex, TIndex>(ref sink, in descriptor.Torus);
                break;
            default:
                ThrowHelper.ThrowInvalidOperation("Unsupported shape discriminant.");
                break;
        }
    }
}
