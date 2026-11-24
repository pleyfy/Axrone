namespace Axrone.Animation.Tests;

using System.Collections.ObjectModel;
using System.Text.Json;

public class StreamingTests
{
    private static AnimationClip LinearClip() => new(
        new ClipId("walk"), 2.0f,
        [
            new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f, 2.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 2.0f, 0.0f, 0.0f]),
            new AnimationChannel(0, ChannelTarget.Rotation, InterpolationMode.Linear, [0.0f, 2.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f]),
        ],
        events: [new ClipEvent(1.0f, "step", "")],
        tags: ["locomotion"]);

    [Fact]
    public void Codec_RoundTripsAndValidates()
    {
        var payload = new ChunkPayloadDto
        {
            ClipId = "walk",
            StartTime = 0.0f,
            EndTime = 1.0f,
            Duration = 2.0f,
        };
        payload.Tracks.Add(new ChunkTrackDto
        {
            BoneIndex = 0,
            Target = (byte)ChannelTarget.Translation,
            Interpolation = (byte)InterpolationMode.Linear,
            KeyTimes = [0.0f, 1.0f],
            KeyValues = [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f],
        });

        byte[] json = JsonSerializer.SerializeToUtf8Bytes(payload, ChunkJsonSerializerContext.Default.ChunkPayloadDto);
        ChunkPayloadDto decoded = ChunkCodec.Decode(json);
        decoded.ClipId.Should().Be("walk");
        decoded.Tracks.Count.Should().Be(1);

        Action corrupt = () => ChunkCodec.Decode("not json"u8);
        corrupt.Should().Throw<StreamingException>()
            .Where(e => e.Code == AnimationErrorCode.StreamingChunkCorrupt);

        var badVersion = new ChunkPayloadDto { Version = 99, ClipId = "walk" };
        byte[] badJson = JsonSerializer.SerializeToUtf8Bytes(badVersion, ChunkJsonSerializerContext.Default.ChunkPayloadDto);
        Action version = () => ChunkCodec.Decode(badJson);
        version.Should().Throw<StreamingException>()
            .Where(e => e.Code == AnimationErrorCode.StreamingChunkIncompatible);
    }

    [Fact]
    public void Merge_ReplacesAndAppends()
    {
        AnimationClip clip = LinearClip();
        var payload = new ChunkPayloadDto { ClipId = "walk", Duration = 2.0f };
        payload.Tracks.Add(new ChunkTrackDto
        {
            BoneIndex = 0,
            Target = (byte)ChannelTarget.Translation,
            Interpolation = (byte)InterpolationMode.Linear,
            KeyTimes = [0.0f, 2.0f],
            KeyValues = [5.0f, 0.0f, 0.0f, 6.0f, 0.0f, 0.0f],
        });
        payload.Tracks.Add(new ChunkTrackDto
        {
            BoneIndex = 1,
            Target = (byte)ChannelTarget.Scale,
            Interpolation = (byte)InterpolationMode.Linear,
            KeyTimes = [0.0f],
            KeyValues = [1.0f, 1.0f, 1.0f],
        });

        AnimationChannel[] replaced = ChunkCodec.Merge([.. clip.Channels], payload, MergeMode.ReplaceRange);
        replaced.Should().HaveCount(3);

        AnimationChannel[] all = ChunkCodec.Merge([.. clip.Channels], payload, MergeMode.ReplaceAll);
        all.Should().HaveCount(2);
    }

    [Fact]
    public void Merge_ReplaceRangeKeepsKeysOutsideWindow()
    {
        AnimationClip clip = LinearClip();
        var payload = new ChunkPayloadDto
        {
            ClipId = "walk",
            StartTime = 0.5f,
            EndTime = 1.5f,
            Duration = 2.0f,
        };
        payload.Tracks.Add(new ChunkTrackDto
        {
            BoneIndex = 0,
            Target = (byte)ChannelTarget.Translation,
            Interpolation = (byte)InterpolationMode.Linear,
            KeyTimes = [0.5f, 1.5f],
            KeyValues = [10.0f, 0.0f, 0.0f, 20.0f, 0.0f, 0.0f],
        });

        AnimationChannel[] merged = ChunkCodec.Merge(clip, payload, MergeMode.ReplaceRange);
        AnimationChannel translation = merged.Single(c => c.Target == ChannelTarget.Translation);
        translation.KeyTimes.ToArray().Should().Equal(0.0f, 0.5f, 1.5f, 2.0f);
        translation.KeyValues.ToArray().Should().Equal(
            0.0f, 0.0f, 0.0f,
            10.0f, 0.0f, 0.0f,
            20.0f, 0.0f, 0.0f,
            2.0f, 0.0f, 0.0f);
    }

    [Fact]
    public void Merge_RejectsChunkForAnotherClip()
    {
        AnimationClip clip = LinearClip();
        var payload = new ChunkPayloadDto { ClipId = "run", Duration = 2.0f };

        Action merge = () => ChunkCodec.Merge(clip, payload, MergeMode.ReplaceRange);

        merge.Should().Throw<StreamingException>()
            .Where(e => e.Code == AnimationErrorCode.StreamingChunkIncompatible);
    }

    [Fact]
    public void Decode_RejectsUnknownInterpolation()
    {
        var payload = new ChunkPayloadDto { ClipId = "walk", Duration = 1.0f };
        payload.Tracks.Add(new ChunkTrackDto
        {
            BoneIndex = 0,
            Target = (byte)ChannelTarget.Translation,
            Interpolation = 99,
            KeyTimes = [0.0f],
            KeyValues = [0.0f, 0.0f, 0.0f],
        });
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(payload, ChunkJsonSerializerContext.Default.ChunkPayloadDto);

        Action decode = () => ChunkCodec.Decode(json);

        decode.Should().Throw<StreamingException>()
            .Where(e => e.Code == AnimationErrorCode.StreamingChunkIncompatible);
    }

    [Fact]
    public void Decode_RejectsDuplicateTracks()
    {
        var payload = new ChunkPayloadDto { ClipId = "walk", Duration = 1.0f };
        var track = new ChunkTrackDto
        {
            BoneIndex = 0,
            Target = (byte)ChannelTarget.Translation,
            Interpolation = (byte)InterpolationMode.Linear,
            KeyTimes = [0.0f],
            KeyValues = [0.0f, 0.0f, 0.0f],
        };
        payload.Tracks.Add(track);
        payload.Tracks.Add(track);
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(payload, ChunkJsonSerializerContext.Default.ChunkPayloadDto);

        Action decode = () => ChunkCodec.Decode(json);

        decode.Should().Throw<StreamingException>()
            .Where(e => e.Code == AnimationErrorCode.StreamingChunkCorrupt);
    }

    [Fact]
    public void Scheduler_OrdersActiveBeforePreload()
    {
        var scheduler = new StreamingScheduler();
        var outRequests = new Collection<ChunkRequest>();
        (ClipId Clip, float Time, float Weight)[] activities = [(new ClipId("walk"), 1.0f, 1.0f)];

        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, outRequests);
        outRequests.Should().HaveCount(2);
        outRequests[0].IsPreload.Should().BeFalse();
        outRequests[1].IsPreload.Should().BeTrue();

        var again = new Collection<ChunkRequest>();
        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, outRequests: again);
        again.Should().BeEmpty();

        scheduler.MarkLoaded(outRequests[0].Key);
        var third = new Collection<ChunkRequest>();
        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, outRequests: third);
        third.Should().BeEmpty();
    }

    [Fact]
    public void Scheduler_FailedChunksWaitForReset()
    {
        var scheduler = new StreamingScheduler();
        var first = new Collection<ChunkRequest>();
        (ClipId Clip, float Time, float Weight)[] activities = [(new ClipId("walk"), 1.0f, 1.0f)];

        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 0.0f, first);
        first.Should().HaveCount(1);

        scheduler.MarkFailed(first[0].Key);
        var second = new Collection<ChunkRequest>();
        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 0.0f, second);
        second.Should().BeEmpty();

        scheduler.Reset(first[0].Key);
        var third = new Collection<ChunkRequest>();
        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 0.0f, third);
        third.Should().HaveCount(1);
    }

    [Fact]
    public void ChunkKey_FormatsWithoutAllocating()
    {
        var key = new ChunkKey(new ClipId("walk"), 3);

        Span<char> chars = stackalloc char[32];
        key.TryFormat(chars, out int written).Should().BeTrue();
        new string(chars[..written]).Should().Be("walk:v:3");
        key.ToString().Should().Be("walk:v:3");

        Span<byte> utf8 = stackalloc byte[32];
        key.TryFormat(utf8, out int bytesWritten).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(utf8[..bytesWritten]).Should().Be("walk:v:3");

        Span<char> tiny = stackalloc char[2];
        key.TryFormat(tiny, out _).Should().BeFalse();

        var clip = new ClipId("run");
        Span<char> clipChars = stackalloc char[8];
        clip.TryFormat(clipChars, out int clipWritten).Should().BeTrue();
        new string(clipChars[..clipWritten]).Should().Be("run");
    }

    [Fact]
    public void ScheduleSpan_WritesSortedWithoutAllocating()
    {
        var scheduler = new StreamingScheduler();
        (ClipId Clip, float Time, float Weight)[] activities = [(new ClipId("walk"), 1.0f, 1.0f)];
        var destination = new ChunkRequest[4];

        int written = scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, destination);
        written.Should().Be(2);
        destination[0].IsPreload.Should().BeFalse();
        destination[1].IsPreload.Should().BeTrue();

        var repeat = new ChunkRequest[4];
        scheduler.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, repeat).Should().Be(0);

        var tiny = new ChunkRequest[1];
        var fresh = new StreamingScheduler();
        fresh.Schedule(activities, chunkDuration: 2.0f, preloadWindow: 1.5f, tiny).Should().Be(1);
    }

    [Fact]
    public void Optimizer_DropsCollinearKeys()
    {
        AnimationClip clip = LinearClip();
        AnimationClip optimized = KeyframeOptimizer.Optimize(clip);

        int before = 0;
        foreach (AnimationChannel channel in clip.Channels)
        {
            before += channel.KeyTimes.Length;
        }

        int after = 0;
        foreach (AnimationChannel channel in optimized.Channels)
        {
            after += channel.KeyTimes.Length;
        }

        after.Should().BeLessThan(before);
        optimized.Events.Length.Should().Be(1);
        optimized.Tags.Should().Contain("locomotion");

        var frame = new AnimationFrame(1, new Dictionary<CurveId, int>());
        optimized.Sample(1.0f, frame);
        frame.ReadTranslations()[0].X.Should().BeApproximately(1.0f, 1e-4f);
    }

    [Fact]
    public void Skinning_ComposesPalette()
    {
        var rig = new Rig(new RigId("r"), [
            new BoneInfo { Name = "root", ParentIndex = -1 },
        ]);
        Span<Vec3> worldT = stackalloc Vec3[1];
        Span<Quat> worldR = stackalloc Quat[1];
        Span<Vec3> worldS = stackalloc Vec3[1];
        worldT[0] = new Vec3(1.0f, 2.0f, 3.0f);
        worldR[0] = Quat.Identity;
        worldS[0] = Vec3.One;

        Span<float> palette = stackalloc float[16];
        SkinningPalette.ComputeFromWorldPose(rig, worldT, worldR, worldS, palette);
        palette[3].Should().Be(1.0f);
        palette[7].Should().Be(2.0f);
        palette[11].Should().Be(3.0f);
        palette[15].Should().Be(1.0f);
    }
}
