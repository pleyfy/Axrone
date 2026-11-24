namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Small-set Delaunay triangulation used by freeform two-parameter blends.
/// Bowyer-Watson over doubles keeps the construction deterministic and robust
/// for the handful of points an authored blend usually carries.
/// </summary>
internal static class DelaunayTriangulation
{
    private readonly record struct Triangle(int A, int B, int C);

    /// <summary>Builds a flat triangle index list; empty when fewer than three points.</summary>
    public static int[] Build(ReadOnlySpan<Vec2> points)
    {
        int count = points.Length;
        if (count < 3)
        {
            return [];
        }

        for (int i = 0; i < count; i++)
        {
            for (int j = i + 1; j < count; j++)
            {
                if (Vec2.DistanceSquared(points[i], points[j]) <= AnimationConstants.BlendDistanceEpsilonSq)
                {
                    AnimationThrowHelper.ThrowCompilation(
                        AnimationErrorCode.CompilationBlendDegenerate,
                        $"Freeform blend points {i} and {j} coincide.");
                }
            }
        }

        float minX = points[0].X;
        float maxX = minX;
        float minY = points[0].Y;
        float maxY = minY;
        for (int i = 1; i < count; i++)
        {
            minX = MathF.Min(minX, points[i].X);
            maxX = MathF.Max(maxX, points[i].X);
            minY = MathF.Min(minY, points[i].Y);
            maxY = MathF.Max(maxY, points[i].Y);
        }

        float centerX = (minX + maxX) * 0.5f;
        float centerY = (minY + maxY) * 0.5f;
        float radius = MathF.Max(maxX - minX, maxY - minY) + 2.0f;
        float span = radius * 32.0f;

        var vertices = new Vec2[count + 3];
        points.CopyTo(vertices);
        vertices[count] = new Vec2(centerX - span, centerY - radius);
        vertices[count + 1] = new Vec2(centerX, centerY + span);
        vertices[count + 2] = new Vec2(centerX + span, centerY - radius);

        var triangles = new List<Triangle>(count * 2) { new(count, count + 1, count + 2) };

        for (int p = 0; p < count; p++)
        {
            Vec2 point = points[p];
            var bad = new List<Triangle>();
            var edges = new Dictionary<(int A, int B), int>();

            for (int t = 0; t < triangles.Count; t++)
            {
                Triangle triangle = triangles[t];
                if (!InCircumcircle(point, vertices[triangle.A], vertices[triangle.B], vertices[triangle.C]))
                {
                    continue;
                }

                bad.Add(triangle);
                AddEdge(edges, triangle.A, triangle.B);
                AddEdge(edges, triangle.B, triangle.C);
                AddEdge(edges, triangle.C, triangle.A);
            }

            if (bad.Count == 0)
            {
                continue;
            }

            triangles.RemoveAll(bad.Contains);

            foreach (KeyValuePair<(int A, int B), int> edge in edges)
            {
                if (edge.Value == 1)
                {
                    triangles.Add(new Triangle(edge.Key.A, edge.Key.B, p));
                }
            }
        }

        var result = new List<int>(triangles.Count * 3);
        for (int t = 0; t < triangles.Count; t++)
        {
            Triangle triangle = triangles[t];
            if (triangle.A >= count || triangle.B >= count || triangle.C >= count)
            {
                continue;
            }

            double area = Cross(vertices[triangle.A], vertices[triangle.B], vertices[triangle.C]);
            if (Math.Abs(area) <= 1e-9)
            {
                continue;
            }

            result.Add(triangle.A);
            if (area > 0.0)
            {
                result.Add(triangle.B);
                result.Add(triangle.C);
            }
            else
            {
                result.Add(triangle.C);
                result.Add(triangle.B);
            }
        }

        return [.. result];
    }

    private static void AddEdge(Dictionary<(int A, int B), int> edges, int a, int b)
    {
        (int A, int B) key = a < b ? (a, b) : (b, a);
        edges.TryGetValue(key, out int count);
        edges[key] = count + 1;
    }

    private static bool InCircumcircle(Vec2 point, Vec2 a, Vec2 b, Vec2 c)
    {
        double ax = a.X - point.X;
        double ay = a.Y - point.Y;
        double bx = b.X - point.X;
        double by = b.Y - point.Y;
        double cx = c.X - point.X;
        double cy = c.Y - point.Y;

        double determinant =
            ((ax * ax) + (ay * ay)) * ((bx * cy) - (cx * by)) -
            ((bx * bx) + (by * by)) * ((ax * cy) - (cx * ay)) +
            ((cx * cx) + (cy * cy)) * ((ax * by) - (bx * ay));

        double orientation = ((double)b.X - a.X) * ((double)c.Y - a.Y) -
            ((double)b.Y - a.Y) * ((double)c.X - a.X);
        return orientation >= 0.0 ? determinant > 1e-12 : determinant < -1e-12;
    }

    private static double Cross(Vec2 a, Vec2 b, Vec2 c) =>
        ((double)b.X - a.X) * ((double)c.Y - a.Y) -
        ((double)b.Y - a.Y) * ((double)c.X - a.X);
}
