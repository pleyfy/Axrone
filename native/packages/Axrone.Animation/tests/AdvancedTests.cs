namespace Axrone.Animation.Tests;

public class AdvancedTests
{
    [Fact]
    public void MotionMatching_PicksNearestWithFacing()
    {
        MotionMatchCandidate[] candidates =
        [
            new(0, 0.0f, new Vec3(10.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f), new HashSet<string> { "run" }),
            new(1, 0.5f, new Vec3(1.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f), new HashSet<string> { "run" }),
            new(2, 0.0f, new Vec3(1.0f, 0.0f, 0.0f), new Vec3(-1.0f, 0.0f, 0.0f), new HashSet<string> { "run" }),
        ];
        var query = new MotionMatchQuery(new Vec3(1.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f));

        int best = MotionMatching.Search(query, candidates, out float score);
        best.Should().Be(1);
        score.Should().BeApproximately(0.0f, 1e-6f);
    }

    [Fact]
    public void MotionMatching_RespectsTagFilters()
    {
        MotionMatchCandidate[] candidates =
        [
            new(0, 0.0f, new Vec3(0.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f), new HashSet<string> { "jump" }),
            new(1, 0.0f, new Vec3(100.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f), new HashSet<string> { "run" }),
        ];
        var required = new MotionMatchQuery(
            new Vec3(0.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f),
            RequiredTags: new HashSet<string> { "run" });

        MotionMatching.Search(required, candidates, out _).Should().Be(1);

        var excluded = new MotionMatchQuery(
            new Vec3(0.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f),
            ExcludedTags: new HashSet<string> { "jump", "run" });

        MotionMatching.Search(excluded, candidates, out float score).Should().Be(-1);
        score.Should().Be(float.MaxValue);
    }

    [Fact]
    public void Grounding_AveragesContactOffsets()
    {
        FootContact[] contacts =
        [
            new(0.0f, 1.0f, 0),
            new(0.0f, 1.0f, 1),
        ];
        float[] heights = [0.1f, 0.3f];

        float offset = GroundingSystem.ComputeRootYOffset(contacts, heights, 0.0f, 0.5f);
        offset.Should().BeApproximately(-0.2f, 1e-5f);

        GroundingSystem.ComputeRootYOffset(contacts, heights, 0.0f, 5.0f).Should().Be(0.0f);
    }

    [Fact]
    public void MotionMatching_ContinuityBiasOnlyAppliesToTheCurrentClip()
    {
        MotionMatchCandidate[] candidates =
        [
            new MotionMatchCandidate(0, 0.0f, Vec3.Zero, Vec3.UnitZ, null),
            new MotionMatchCandidate(1, 0.0f, Vec3.Zero, Vec3.UnitZ, null),
        ];

        var unbiased = new MotionMatchQuery(Vec3.Zero, Vec3.UnitZ);
        MotionMatching.Search(unbiased, candidates, out _).Should().Be(0);

        var continuity = new MotionMatchQuery(
            Vec3.Zero,
            Vec3.UnitZ,
            ContinuityBias: 1.0f,
            ContinuityClipIndex: 1);
        MotionMatching.Search(continuity, candidates, out _).Should().Be(1);
    }

    [Fact]
    public void MotionMatchingDatabase_SamplesClipsAndTags()
    {
        Rig rig = new(new RigId("mm"), [new BoneInfo { Name = "root", ParentIndex = -1 }]);
        var walk = new AnimationClip(
            new ClipId("walk"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f])],
            tags: ["walk"]);
        var run = new AnimationClip(
            new ClipId("run"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 10.0f, 0.0f, 0.0f])],
            tags: ["run"]);

        MotionMatchingDatabase database = MotionMatchingDatabase.Build(rig, [walk, run], sampleInterval: 0.5f);

        database.Candidates.Length.Should().Be(6);
        database.Candidates[0].ClipIndex.Should().Be(0);
        database.Candidates[3].ClipIndex.Should().Be(1);
        database.Candidates[0].Tags.Should().Contain("walk");
        database.Candidates[3].Tags.Should().Contain("run");

        var query = new MotionMatchQuery(new Vec3(10.0f, 0.0f, 0.0f), Vec3.UnitZ);
        int best = MotionMatching.Search(query, database.Candidates, out _);
        database.Candidates[best].ClipIndex.Should().Be(1);
    }

    [Fact]
    public void MotionMatchingNode_SelectsAndSamplesTheNearestClip()
    {
        Rig rig = new(new RigId("mm-node"), [new BoneInfo { Name = "root", ParentIndex = -1 }]);
        var walk = new AnimationClip(
            new ClipId("walk"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f])]);
        var run = new AnimationClip(
            new ClipId("run"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 10.0f, 0.0f, 0.0f])]);
        MotionMatchingDatabase database = MotionMatchingDatabase.Build(rig, [walk, run], sampleInterval: 0.5f);
        var node = new MotionMatchingMotionNode(
            database,
            "tx",
            "tz",
            "fx",
            "fz",
            reselectIntervalSeconds: 0.0f,
            continuityBias: 0.0f);
        var parameters = new ParameterStore(new Dictionary<string, ParameterType>
        {
            ["tx"] = ParameterType.Float,
            ["tz"] = ParameterType.Float,
            ["fx"] = ParameterType.Float,
            ["fz"] = ParameterType.Float,
        });
        parameters.SetFloat("fx", 0.0f);
        parameters.SetFloat("fz", 1.0f);
        var frame = new AnimationFrame(1, new CurveLayout(new Dictionary<CurveId, int>()));
        var arena = new FrameArena(1, new CurveLayout(new Dictionary<CurveId, int>()), capacity: 4);

        parameters.SetFloat("tx", 10.0f);
        node.Evaluate(0.5f, frame, arena, rig, parameters, 0);
        node.SelectedClipIndex.Should().Be(1);
        frame.ReadTranslations()[0].X.Should().BeApproximately(5.0f, 1e-4f);

        parameters.SetFloat("tx", 0.0f);
        node.Evaluate(0.75f, frame, arena, rig, parameters, 0);
        node.SelectedClipIndex.Should().Be(0);
    }

    [Fact]
    public void MotionMatching_SearchKReturnsNearestInOrder()
    {
        MotionMatchCandidate[] candidates =
        [
            new MotionMatchCandidate(0, 0.0f, new Vec3(3.0f, 0.0f, 0.0f), Vec3.UnitZ, null),
            new MotionMatchCandidate(1, 0.0f, new Vec3(1.0f, 0.0f, 0.0f), Vec3.UnitZ, null),
            new MotionMatchCandidate(2, 0.0f, new Vec3(2.0f, 0.0f, 0.0f), Vec3.UnitZ, null),
        ];
        var query = new MotionMatchQuery(Vec3.Zero, Vec3.UnitZ);
        Span<int> indices = stackalloc int[2];
        Span<float> scores = stackalloc float[2];

        int count = MotionMatching.SearchK(query, candidates, indices, scores);

        count.Should().Be(2);
        indices[0].Should().Be(1);
        indices[1].Should().Be(2);
        scores[0].Should().BeApproximately(1.0f, 1e-5f);
        scores[1].Should().BeApproximately(4.0f, 1e-5f);
    }

    [Fact]
    public void Grounding_AxisLocksKeepDisabledAxesZero()
    {
        FootContact[] contacts =
        [
            new(0.0f, 1.0f, 0),
            new(0.0f, 1.0f, 1),
        ];
        Vec3[] positions =
        [
            new Vec3(1.0f, 1.0f, 0.0f),
            new Vec3(3.0f, 2.0f, 0.0f),
        ];

        Vec3 offset = GroundingSystem.ComputeRootOffset(
            contacts,
            positions,
            Vec3.Zero,
            0.5f,
            GroundingAxes.X | GroundingAxes.Y);

        offset.X.Should().BeApproximately(-2.0f, 1e-4f);
        offset.Y.Should().BeApproximately(-1.5f, 1e-4f);
        offset.Z.Should().Be(0.0f);

        Vec3 vertical = GroundingSystem.ComputeRootOffset(
            contacts,
            positions,
            Vec3.Zero,
            0.5f);
        vertical.X.Should().Be(0.0f);
        vertical.Y.Should().BeApproximately(-1.5f, 1e-4f);
        vertical.Z.Should().Be(0.0f);
    }
}
