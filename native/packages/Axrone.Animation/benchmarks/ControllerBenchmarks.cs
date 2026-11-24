using Axrone.Animation;
using Axrone.Numeric;
using BenchmarkDotNet.Attributes;

namespace Axrone.Animation.Benchmarks;

/// <summary>
/// Full controller update across bone counts and layer stacks. Unlike the leaf
/// microbenchmarks this measures state advance, blending, root extraction and
/// trigger cleanup together.
/// </summary>
[MemoryDiagnoser]
public class ControllerBenchmarks
{
    private AnimationController _controller = null!;
    private List<ClipEvent> _events = null!;

    /// <summary>Bones in the synthetic chain.</summary>
    [Params(16, 64, 256)]
    public int BoneCount { get; set; }

    /// <summary>Number of override layers, including the base.</summary>
    [Params(1, 3)]
    public int LayerCount { get; set; }

    [GlobalSetup]
    public void Setup()
    {
        var bones = new BoneInfo[BoneCount];
        for (int i = 0; i < bones.Length; i++)
        {
            bones[i] = new BoneInfo
            {
                Name = $"bone{i}",
                ParentIndex = i == 0 ? -1 : i - 1,
                RestTranslation = i == 0 ? Vec3.Zero : new Vec3(0.1f, 0.0f, 0.0f),
            };
        }

        var rig = new Rig(new RigId("controller-bench"), bones);
        var channels = new AnimationChannel[BoneCount * 2];
        Quat turn = Quat.CreateFromAxisAngle(Vec3.UnitY, 0.5f);
        for (int i = 0; i < BoneCount; i++)
        {
            channels[i * 2] = new AnimationChannel(
                i,
                ChannelTarget.Translation,
                InterpolationMode.Linear,
                [0.0f, 1.0f],
                [0.0f, 0.0f, 0.0f, 0.1f, 0.0f, 0.0f]);
            channels[(i * 2) + 1] = new AnimationChannel(
                i,
                ChannelTarget.Rotation,
                InterpolationMode.Linear,
                [0.0f, 1.0f],
                [0.0f, 0.0f, 0.0f, 1.0f, turn.X, turn.Y, turn.Z, turn.W]);
        }

        var clip = new AnimationClip(new ClipId("controller-bench"), 1.0f, channels);
        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        _controller = new AnimationController(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        for (int layer = 0; layer < LayerCount; layer++)
        {
            var state = new AnimationState(new StateId($"layer{layer}"), new ClipMotionNode(clip));
            _controller.AddLayer(new AnimationLayer(
                new LayerId($"layer{layer}"),
                new StateMachineInstance([state], Array.Empty<StateTransition>(), 0))
            {
                Weight = layer == 0 ? 1.0f : 0.5f,
            });
        }

        _controller.BindAll();
        _events = new List<ClipEvent>(16);
    }

    [GlobalCleanup]
    public void Cleanup() => _controller.Dispose();

    /// <summary>One 60 Hz controller update.</summary>
    [Benchmark]
    public void Update() => _controller.Update(1.0f / 60.0f, _events, out _, out _);
}
