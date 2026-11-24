namespace Axrone.Animation;

/// <summary>IK solver selected per job.</summary>
public enum IkSolverKind
{
    /// <summary>Forward/backward reaching with rotation write-back.</summary>
    Fabrik = 0,

    /// <summary>Cyclic coordinate descent with weighted corrections.</summary>
    Ccd = 1,

    /// <summary>Closed-form three-bone solve with pole vector and bend limits.</summary>
    TwoBone = 2,

    /// <summary>Single-bone look-at with a turn limit and optional roll alignment.</summary>
    Aim = 3,
}

/// <summary>
/// Authored IK job: a bone chain, its target, and solver tuning. Job instances are
/// copied and compiled by <see cref="AnimationIkLayer"/>; mutating one after layer
/// construction has no effect.
/// </summary>
/// <param name="Id">Job identity used by <see cref="AnimationIkLayer.SetTarget(IkJobId, Vec3)"/>.</param>
/// <param name="RootBone">Chain root bone name (must be an ancestor of the tip).</param>
/// <param name="TipBone">Chain tip bone name.</param>
/// <param name="Solver">Solver family.</param>
/// <param name="TargetBone">Optional bone whose world transform drives the target each apply.</param>
/// <param name="TargetPosition">World-space target used when <paramref name="TargetBone"/> is absent.</param>
/// <param name="TargetRotation">World-space tip rotation used by <paramref name="PreserveTipRotation"/>.</param>
/// <param name="Precision">Reach tolerance in world units.</param>
/// <param name="MaxIterations">Iteration cap.</param>
/// <param name="Weight">Job weight multiplied with the layer weight.</param>
/// <param name="PreserveTipRotation">Whether the tip is rotated onto <paramref name="TargetRotation"/> after solving.</param>
/// <param name="PoleBone">Optional bone whose world position selects the two-bone bend plane.</param>
/// <param name="PolePosition">World-space pole used when <paramref name="PoleBone"/> is absent.</param>
/// <param name="MinBendDegrees">Minimum interior angle at the two-bone root, in degrees.</param>
/// <param name="MaxBendDegrees">Maximum interior angle at the two-bone root, in degrees.</param>
/// <param name="TwistDegrees">Twist around the root-to-target axis, in degrees.</param>
/// <param name="AimUp">World up used by <see cref="IkSolverKind.Aim"/> to remove roll.</param>
/// <param name="MaxAimAngleDegrees">Maximum turn for <see cref="IkSolverKind.Aim"/>, in degrees.</param>
public readonly record struct AnimationIkJob(
    IkJobId Id,
    string RootBone,
    string TipBone,
    IkSolverKind Solver = IkSolverKind.Fabrik,
    string? TargetBone = null,
    Vec3 TargetPosition = default,
    Quat? TargetRotation = null,
    float Precision = AnimationConstants.IkDefaultPrecision,
    int MaxIterations = AnimationConstants.IkDefaultMaxIterations,
    float Weight = 1.0f,
    bool PreserveTipRotation = false,
    string? PoleBone = null,
    Vec3 PolePosition = default,
    float MinBendDegrees = 0.0f,
    float MaxBendDegrees = 180.0f,
    float TwistDegrees = 0.0f,
    Vec3 AimUp = default,
    float MaxAimAngleDegrees = 180.0f);

/// <summary>
/// Ordered IK jobs applied to a pose after animation evaluation. Targets can be
/// authored in world space or driven by a target bone; every job is evaluated with
/// the compiled chain, so per-apply work does not resolve names or allocate chains.
/// </summary>
/// <remarks>
/// Apply mutates the supplied frame. Targets are mutable state and the layer is not
/// thread-safe: drive one layer from a single evaluation thread.
/// </remarks>
public sealed class AnimationIkLayer
{
    private struct CompiledJob
    {
        public IkJobId Id;
        public IkSolverKind Solver;
        public int[] Chain;
        public int TipIndex;
        public int TargetBoneIndex;
        public Vec3 TargetPosition;
        public Quat TargetRotation;
        public float Precision;
        public int MaxIterations;
        public float Weight;
        public bool PreserveTipRotation;
        public int PoleBoneIndex;
        public Vec3 PolePosition;
        public float MinBendRadians;
        public float MaxBendRadians;
        public float TwistRadians;
        public Vec3 AimUp;
        public float MaxAimAngleRadians;
    }

    private readonly Rig _rig;
    private readonly CompiledJob[] _jobs;
    private readonly Dictionary<IkJobId, int> _indexById;
    private readonly Vec3[] _fabrikScratch;

    /// <summary>Creates a compiled IK layer over a rig.</summary>
    /// <param name="rig">Rig the bone names resolve against.</param>
    /// <param name="id">Non-empty layer identity.</param>
    /// <param name="jobs">Job definitions, compiled once.</param>
    /// <param name="weight">Base layer weight; clamped by <see cref="Apply(AnimationFrame, float)"/>.</param>
    /// <exception cref="ValidationException">The id, a chain, or a job definition is invalid.</exception>
    /// <exception cref="IkException">A root or tip bone does not resolve on the rig.</exception>
    public AnimationIkLayer(Rig rig, string id, ReadOnlySpan<AnimationIkJob> jobs, float weight = 1.0f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        if (string.IsNullOrEmpty(id))
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, "IK layers require a non-empty id.");
        }

        if (!float.IsFinite(weight))
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, "IK layer weight must be finite.");
        }

        _rig = rig;
        Id = id;
        Weight = weight;
        _jobs = new CompiledJob[jobs.Length];
        _indexById = new Dictionary<IkJobId, int>(jobs.Length);
        int maxChainLength = 0;

        for (int i = 0; i < jobs.Length; i++)
        {
            AnimationIkJob job = jobs[i];
            if (!_indexById.TryAdd(job.Id, i))
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.ValidationInvalidArgument,
                    $"Duplicate IK job '{job.Id}'.");
            }

            IkSolverKind solver = job.Solver switch
            {
                IkSolverKind.Ccd => IkSolverKind.Ccd,
                IkSolverKind.TwoBone => IkSolverKind.TwoBone,
                IkSolverKind.Aim => IkSolverKind.Aim,
                _ => IkSolverKind.Fabrik,
            };

            int rootIndex = ResolveBone(rig, job.RootBone, job.Id);
            int tipIndex = solver == IkSolverKind.Aim
                ? rootIndex
                : ResolveBone(rig, job.TipBone, job.Id);
            int[] chain = BuildChain(rig, rootIndex, tipIndex, job.Id);
            maxChainLength = Math.Max(maxChainLength, chain.Length);

            if (solver == IkSolverKind.TwoBone && chain.Length != 3)
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.ValidationInvalidArgument,
                    $"Two-bone IK job '{job.Id}' requires exactly three bones (root, mid, tip) but resolved {chain.Length}.");
            }

            if (solver == IkSolverKind.Aim && chain.Length != 1)
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.ValidationInvalidArgument,
                    $"Aim job '{job.Id}' must resolve to one bone but resolved {chain.Length}.");
            }

            if (solver == IkSolverKind.Aim &&
                (!float.IsFinite(job.MaxAimAngleDegrees) || job.MaxAimAngleDegrees < 0.0f || job.MaxAimAngleDegrees > 180.0f))
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.ValidationInvalidArgument,
                    $"Aim job '{job.Id}' max angle {job.MaxAimAngleDegrees} must be finite and inside [0, 180].");
            }

            int targetBone = -1;
            if (!string.IsNullOrEmpty(job.TargetBone))
            {
                BoneHandle handle = rig.FindBoneIndex(job.TargetBone);
                targetBone = handle.IsValid ? handle.Index : -1;
            }

            int poleBone = -1;
            if (!string.IsNullOrEmpty(job.PoleBone))
            {
                BoneHandle handle = rig.FindBoneIndex(job.PoleBone);
                poleBone = handle.IsValid ? handle.Index : -1;
            }

            if (!float.IsFinite(job.MinBendDegrees) || !float.IsFinite(job.MaxBendDegrees) ||
                !float.IsFinite(job.TwistDegrees) ||
                job.MinBendDegrees < 0.0f || job.MaxBendDegrees > 180.0f || job.MinBendDegrees > job.MaxBendDegrees)
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.ValidationInvalidArgument,
                    $"IK job '{job.Id}' bend limits [{job.MinBendDegrees}, {job.MaxBendDegrees}] must be finite, ordered and inside [0, 180].");
            }

            _jobs[i] = new CompiledJob
            {
                Id = job.Id,
                Solver = solver,
                Chain = chain,
                TipIndex = tipIndex,
                TargetBoneIndex = targetBone,
                TargetPosition = job.TargetPosition,
                TargetRotation = FastMath.Normalize(job.TargetRotation ?? Quat.Identity),
                Precision = float.IsFinite(job.Precision)
                    ? MathF.Max(job.Precision, AnimationConstants.IkPrecisionFloor)
                    : AnimationConstants.IkDefaultPrecision,
                MaxIterations = Math.Max(1, job.MaxIterations),
                Weight = float.IsFinite(job.Weight) ? job.Weight : 1.0f,
                PreserveTipRotation = job.PreserveTipRotation,
                PoleBoneIndex = poleBone,
                PolePosition = job.PolePosition,
                MinBendRadians = job.MinBendDegrees * (MathF.PI / 180.0f),
                MaxBendRadians = job.MaxBendDegrees * (MathF.PI / 180.0f),
                TwistRadians = job.TwistDegrees * (MathF.PI / 180.0f),
                AimUp = job.AimUp,
                MaxAimAngleRadians = job.MaxAimAngleDegrees * (MathF.PI / 180.0f),
            };
        }

        _fabrikScratch = maxChainLength > 0 ? new Vec3[maxChainLength] : [];
    }

    /// <summary>Layer identity.</summary>
    public string Id { get; }

    /// <summary>Base weight passed to <see cref="Apply(AnimationFrame)"/>.</summary>
    public float Weight { get; }

    /// <summary>Compiled job count.</summary>
    public int JobCount => _jobs.Length;

    /// <summary>Overrides a job target position in world space.</summary>
    /// <param name="jobId">Compiled job identity.</param>
    /// <param name="target">World-space target.</param>
    /// <returns>This layer, for call chaining.</returns>
    /// <exception cref="IkException">No job matches <paramref name="jobId"/>.</exception>
    public AnimationIkLayer SetTarget(IkJobId jobId, Vec3 target)
    {
        int index = IndexOf(jobId);
        _jobs[index].TargetPosition = target;
        return this;
    }

    /// <summary>Overrides a job position and tip rotation in world space.</summary>
    /// <param name="jobId">Compiled job identity.</param>
    /// <param name="target">World-space target.</param>
    /// <param name="rotation">World-space tip rotation.</param>
    /// <returns>This layer, for call chaining.</returns>
    /// <exception cref="IkException">No job matches <paramref name="jobId"/>.</exception>
    public AnimationIkLayer SetTarget(IkJobId jobId, Vec3 target, Quat rotation)
    {
        int index = IndexOf(jobId);
        _jobs[index].TargetPosition = target;
        _jobs[index].TargetRotation = FastMath.Normalize(rotation);
        return this;
    }

    /// <summary>Applies every job using the layer weight.</summary>
    /// <param name="frame">Pose to mutate in place.</param>
    public void Apply(AnimationFrame frame) => Apply(frame, Weight);

    /// <summary>Applies every job with an explicit weight multiplier.</summary>
    /// <param name="frame">Pose to mutate in place.</param>
    /// <param name="weight">Layer weight; clamped to the unit interval.</param>
    /// <exception cref="ArgumentException">The frame does not match the layer rig.</exception>
    public void Apply(AnimationFrame frame, float weight)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.BoneCount != _rig.BoneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"IK layer '{Id}' targets {_rig.BoneCount} bones but the frame has {frame.BoneCount}.");
        }

        float layerWeight = FastMath.Clamp01(weight);
        if (layerWeight <= 0.0f)
        {
            return;
        }

        for (int i = 0; i < _jobs.Length; i++)
        {
            ref CompiledJob job = ref _jobs[i];
            float jobWeight = FastMath.Clamp01(layerWeight * (float.IsFinite(job.Weight) ? job.Weight : 1.0f));
            if (jobWeight <= 0.0f)
            {
                continue;
            }

            if (job.TargetBoneIndex >= 0 || job.PoleBoneIndex >= 0)
            {
                ResolveTarget(ref job, frame);
            }

            switch (job.Solver)
            {
                case IkSolverKind.Fabrik:
                    IkSolvers.SolveFabrik(
                        _rig,
                        frame,
                        job.Chain,
                        job.TargetPosition,
                        _fabrikScratch.AsSpan(0, job.Chain.Length),
                        job.MaxIterations,
                        job.Precision,
                        jobWeight);
                    break;

                case IkSolverKind.TwoBone:
                    TwoBoneIk.Solve(
                        _rig,
                        frame,
                        job.Chain[0],
                        job.Chain[1],
                        job.Chain[2],
                        job.TargetPosition,
                        job.PolePosition,
                        jobWeight,
                        job.MinBendRadians,
                        job.MaxBendRadians,
                        job.TwistRadians);
                    break;

                case IkSolverKind.Aim:
                    AimSolver.Solve(
                        _rig,
                        frame,
                        job.Chain[0],
                        job.TargetPosition,
                        job.AimUp,
                        jobWeight,
                        job.MaxAimAngleRadians);
                    break;

                default:
                    IkSolvers.SolveCcd(
                        _rig,
                        frame,
                        job.Chain,
                        job.TargetPosition,
                        jobWeight,
                        job.MaxIterations,
                        job.Precision);
                    break;
            }

            if (job.PreserveTipRotation && job.Solver != IkSolverKind.Aim)
            {
                ApplyTipRotation(frame, job.TipIndex, job.TargetRotation, jobWeight);
            }
        }
    }

    private int IndexOf(IkJobId jobId)
    {
        if (!_indexById.TryGetValue(jobId, out int index))
        {
            AnimationThrowHelper.ThrowIk(AnimationErrorCode.IkTargetNotFound, $"Unknown IK job '{jobId}'.");
        }

        return index;
    }

    private void ResolveTarget(ref CompiledJob job, AnimationFrame frame)
    {
        int boneCount = _rig.BoneCount;
        using ScratchWorldBuffers buffers = ScratchWorldBuffers.UseStack(boneCount)
            ? ScratchWorldBuffers.FromStack(
                stackalloc Vec3[boneCount],
                stackalloc Quat[boneCount],
                stackalloc Vec3[boneCount])
            : ScratchWorldBuffers.RentPooled(boneCount);

        BlendingKernels.ForwardKinematics(_rig, frame, buffers.Translations, buffers.Rotations, buffers.Scales);
        if (job.TargetBoneIndex >= 0)
        {
            job.TargetPosition = buffers.Translations[job.TargetBoneIndex];
            job.TargetRotation = buffers.Rotations[job.TargetBoneIndex];
        }

        if (job.PoleBoneIndex >= 0)
        {
            job.PolePosition = buffers.Translations[job.PoleBoneIndex];
        }
    }

    private void ApplyTipRotation(AnimationFrame frame, int tipIndex, in Quat targetRotation, float weight)
    {
        Span<Quat> rotations = frame.GetRotations();
        Quat parentWorld = ParentWorldRotation(frame, tipIndex);
        Quat targetLocal = FastMath.Normalize(FastMath.Multiply(FastMath.Invert(parentWorld), targetRotation));
        rotations[tipIndex] = FastMath.Normalize(FastMath.Slerp(rotations[tipIndex], targetLocal, weight));
    }

    /// <summary>Composes the parent chain's local rotations without touching the frame.</summary>
    private Quat ParentWorldRotation(AnimationFrame frame, int bone)
    {
        ReadOnlySpan<Quat> locals = frame.ReadRotations();
        int parent = _rig.Parents[bone];
        Quat world = Quat.Identity;
        while (parent >= 0)
        {
            world = FastMath.Multiply(locals[parent], world);
            parent = _rig.Parents[parent];
        }

        return world;
    }

    private static int ResolveBone(Rig rig, string name, IkJobId jobId)
    {
        BoneHandle handle = string.IsNullOrEmpty(name) ? BoneHandle.Invalid : rig.FindBoneIndex(name);
        if (!handle.IsValid)
        {
            AnimationThrowHelper.ThrowIk(
                AnimationErrorCode.IkTargetNotFound,
                $"IK job '{jobId}' references unknown bone '{name}'.");
        }

        return handle.Index;
    }

    private static int[] BuildChain(Rig rig, int rootIndex, int tipIndex, IkJobId jobId)
    {
        int[] path = new int[rig.BoneCount];
        int depth = 0;
        int current = tipIndex;
        while (current >= 0)
        {
            path[depth++] = current;
            if (current == rootIndex)
            {
                Array.Reverse(path, 0, depth);
                return path.AsSpan(0, depth).ToArray();
            }

            current = rig.Parents[current];
        }

        AnimationThrowHelper.ThrowValidation(
            AnimationErrorCode.ValidationInvalidArgument,
            $"IK job '{jobId}' root '{rig.BoneNames[rootIndex]}' is not an ancestor of tip '{rig.BoneNames[tipIndex]}'.");
        return [];
    }
}
