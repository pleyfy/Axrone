namespace Axrone.Scene.Runtime.Tests;

using System.IO;
using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Prefab;
using Axrone.Scene.Runtime;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneJointCodecTests
{
    [Fact]
    public void DistanceJoint_RoundTripsBitExact()
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.ConnectedBody = new SceneJointActorRef(3, 7u);
        value.Distance = 2.5f;
        value.MinDistance = 0.25f;
        value.Stiffness = 4.0f;
        value.Damping = 0.75f;
        value.AnchorA = new Vec2(0.1f, 0.2f);
        value.AnchorB = new Vec2(-0.3f, 0.4f);
        value.AutoConfigureDistance = false;
        value.EnableCollision = true;
        value.BreakTorque = 1234.5f;

        RoundTrip(new SceneDistanceJoint2DCodec(), value).Should().Be(value);
    }

    [Fact]
    public void HingeJoint_RoundTripsBitExact()
    {
        SceneHingeJoint2D value = SceneHingeJoint2D.Default;
        value.ConnectedBody = new SceneJointActorRef(5, 2u);
        value.Anchor = new Vec2(1.5f, -2.5f);
        value.UseMotor = true;
        value.MotorSpeed = 3.25f;
        value.MaxMotorTorque = 9000.0f;
        value.UseLimits = true;
        value.LimitsMin = -45.0f;
        value.LimitsMax = 60.0f;

        RoundTrip(new SceneHingeJoint2DCodec(), value).Should().Be(value);
    }

    [Fact]
    public void FixedAndSliderAndSpringAndMotor_RoundTripBitExact()
    {
        SceneFixedJoint2D fixedValue = SceneFixedJoint2D.Default;
        fixedValue.ConnectedBody = new SceneJointActorRef(1, 1u);
        fixedValue.Anchor = new Vec2(0.5f, 0.25f);
        fixedValue.Frequency = 3.0f;
        RoundTrip(new SceneFixedJoint2DCodec(), fixedValue).Should().Be(fixedValue);

        SceneSliderJoint2D sliderValue = SceneSliderJoint2D.Default;
        sliderValue.ConnectedBody = new SceneJointActorRef(2, 4u);
        sliderValue.Axis = new Vec2(0.6f, 0.8f);
        sliderValue.UseMotor = true;
        sliderValue.MotorSpeed = -1.0f;
        sliderValue.UseLimits = true;
        sliderValue.LimitsMin = -2.0f;
        sliderValue.LimitsMax = 5.0f;
        RoundTrip(new SceneSliderJoint2DCodec(), sliderValue).Should().Be(sliderValue);

        SceneSpringJoint2D springValue = SceneSpringJoint2D.Default;
        springValue.ConnectedBody = new SceneJointActorRef(6, 9u);
        springValue.Stiffness = 12.5f;
        RoundTrip(new SceneSpringJoint2DCodec(), springValue).Should().Be(springValue);

        SceneMotorJoint2D motorValue = SceneMotorJoint2D.Default;
        motorValue.ConnectedBody = new SceneJointActorRef(7, 3u);
        motorValue.LinearOffset = new Vec2(0.5f, 0.5f);
        motorValue.AngularOffset = 0.2f;
        motorValue.CorrectionFactor = 0.8f;
        RoundTrip(new SceneMotorJoint2DCodec(), motorValue).Should().Be(motorValue);
    }

    [Fact]
    public void WheelRopeMouseGear_RoundTripBitExact()
    {
        SceneWheelJoint2D wheelValue = SceneWheelJoint2D.Default;
        wheelValue.ConnectedBody = new SceneJointActorRef(8, 5u);
        wheelValue.AnchorA = new Vec2(0.1f, 0.2f);
        wheelValue.AnchorB = new Vec2(0.3f, 0.4f);
        wheelValue.EnableLimit = true;
        wheelValue.LowerTranslation = -1.5f;
        wheelValue.UpperTranslation = 2.5f;
        wheelValue.EnableMotor = true;
        wheelValue.MotorSpeed = 4.0f;
        wheelValue.Stiffness = 3.0f;
        wheelValue.Damping = 0.6f;
        RoundTrip(new SceneWheelJoint2DCodec(), wheelValue).Should().Be(wheelValue);

        SceneRopeJoint2D ropeValue = SceneRopeJoint2D.Default;
        ropeValue.ConnectedBody = new SceneJointActorRef(9, 6u);
        ropeValue.MaxLength = 7.5f;
        RoundTrip(new SceneRopeJoint2DCodec(), ropeValue).Should().Be(ropeValue);

        SceneMouseJoint2D mouseValue = SceneMouseJoint2D.Default;
        mouseValue.ConnectedBody = new SceneJointActorRef(10, 8u);
        mouseValue.Target = new Vec2(3.0f, -4.0f);
        mouseValue.MaxForce = 500.0f;
        RoundTrip(new SceneMouseJoint2DCodec(), mouseValue).Should().Be(mouseValue);

        SceneGearJoint2D gearValue = SceneGearJoint2D.Default;
        gearValue.ConnectedBody = new SceneJointActorRef(11, 2u);
        gearValue.JointA = new SceneJointRef2D(4, 3u, SceneJointKind2D.Hinge);
        gearValue.JointB = new SceneJointRef2D(5, 1u, SceneJointKind2D.Slider);
        gearValue.Ratio = -2.0f;
        RoundTrip(new SceneGearJoint2DCodec(), gearValue).Should().Be(gearValue);
    }

    [Fact]
    public void InfinityDefaults_RoundTripThroughNullEncoding()
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.MaxDistance.Should().Be(float.PositiveInfinity);
        value.BreakForce.Should().Be(float.PositiveInfinity);

        SceneDistanceJoint2D roundTripped = RoundTrip(new SceneDistanceJoint2DCodec(), value);
        roundTripped.Should().Be(value);

        using MemoryStream buffer = new();
        using (Utf8JsonWriter writer = new(buffer))
        {
            writer.WriteStartObject();
            new SceneDistanceJoint2DCodec().Write(writer, in value);
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.ToArray());
        document.RootElement.TryGetProperty("maxDistance", out JsonElement maxDistance).Should().BeTrue();
        maxDistance.ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public void NonFiniteScalars_RoundTripBitExact()
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.BreakForce = 100.0f;
        SceneDistanceJoint2D roundTripped = RoundTrip(new SceneDistanceJoint2DCodec(), value);
        roundTripped.BreakForce.Should().Be(100.0f);

        SceneJointActorRef invalid = SceneJointActorRef.Invalid;
        invalid.IsValid.Should().BeFalse();
    }

    [Fact]
    public void Joint3DCodecs_RoundTripBitExact()
    {
        SceneFixedJoint3D fixedValue = SceneFixedJoint3D.Default;
        fixedValue.ConnectedBody = new SceneJointActorRef(12, 3u);
        fixedValue.Anchor = new Vec3(0.1f, 0.2f, 0.3f);
        fixedValue.AutoConfigureConnectedAnchor = false;
        fixedValue.ConnectedAnchor = new Vec3(0.4f, 0.5f, 0.6f);
        fixedValue.EnableCollision = true;
        fixedValue.EnablePreprocessing = false;
        fixedValue.MassScale = 2.0f;
        RoundTrip(new SceneFixedJoint3DCodec(), fixedValue).Should().Be(fixedValue);

        SceneHingeJoint3D hingeValue = SceneHingeJoint3D.Default;
        hingeValue.ConnectedBody = new SceneJointActorRef(13, 4u);
        hingeValue.Axis = new Vec3(0.0f, 1.0f, 0.0f);
        hingeValue.AutoConfigureConnectedAnchor = false;
        hingeValue.UseLimits = true;
        hingeValue.Limits = new SceneJointLimits3D(-45.0f, 90.0f, 0.2f, 0.5f);
        hingeValue.UseMotor = true;
        hingeValue.Motor = new SceneJointMotor3D(120.0f, 300.0f, true);
        hingeValue.UseSpring = true;
        hingeValue.Spring = new SceneSoftJointLimitSpring3D(10.0f, 2.0f);
        RoundTrip(new SceneHingeJoint3DCodec(), hingeValue).Should().Be(hingeValue);

        SceneSliderJoint3D sliderValue = SceneSliderJoint3D.Default;
        sliderValue.ConnectedBody = new SceneJointActorRef(14, 5u);
        sliderValue.AutoConfigureConnectedAnchor = false;
        sliderValue.UseLimits = true;
        sliderValue.Limits = new SceneJointLimits3D(-1.0f, 1.0f, 0.0f, 0.0f);
        RoundTrip(new SceneSliderJoint3DCodec(), sliderValue).Should().Be(sliderValue);

        SceneSpringJoint3D springValue = SceneSpringJoint3D.Default;
        springValue.ConnectedBody = new SceneJointActorRef(15, 6u);
        springValue.MinDistance = 1.0f;
        springValue.MaxDistance = 3.0f;
        springValue.Spring = 25.0f;
        springValue.Damper = 1.5f;
        springValue.Tolerance = 0.05f;
        springValue.AutoConfigureConnectedAnchor = false;
        springValue.AutoConfigureDistance = false;
        RoundTrip(new SceneSpringJoint3DCodec(), springValue).Should().Be(springValue);

        SceneCharacterJoint3D characterValue = SceneCharacterJoint3D.Default;
        characterValue.ConnectedBody = new SceneJointActorRef(16, 7u);
        characterValue.SwingAxis = new Vec3(0.0f, 1.0f, 0.0f);
        characterValue.LowTwistLimit = new SceneSoftJointLimit3D(-0.4f, 0.1f, 0.02f);
        characterValue.HighTwistLimit = new SceneSoftJointLimit3D(0.4f, 0.1f, 0.02f);
        characterValue.Swing1Limit = new SceneSoftJointLimit3D(0.6f, 0.0f, 0.0f);
        characterValue.Swing2Limit = new SceneSoftJointLimit3D(0.3f, 0.0f, 0.0f);
        characterValue.TwistLimitSpring = new SceneSoftJointLimitSpring3D(5.0f, 0.5f);
        characterValue.SwingLimitSpring = new SceneSoftJointLimitSpring3D(4.0f, 0.4f);
        characterValue.EnableProjection = true;
        characterValue.ProjectionDistance = 0.2f;
        characterValue.ProjectionAngle = 90.0f;
        characterValue.MotorSpeed = 1.0f;
        characterValue.MaxMotorTorque = 5.0f;
        characterValue.AutoConfigureConnectedAnchor = false;
        RoundTrip(new SceneCharacterJoint3DCodec(), characterValue).Should().Be(characterValue);

        SceneConfigurableJoint3D configurableValue = SceneConfigurableJoint3D.Default;
        configurableValue.ConnectedBody = new SceneJointActorRef(17, 8u);
        configurableValue.AutoConfigureConnectedAnchor = false;
        configurableValue.XMotion = 2.0f;
        configurableValue.YMotion = 1.0f;
        configurableValue.ZMotion = 0.0f;
        configurableValue.AngularXMotion = 2.0f;
        configurableValue.AngularYMotion = 1.0f;
        configurableValue.AngularZMotion = 0.0f;
        configurableValue.LinearLimit = new SceneSoftJointLimit3D(0.5f, 0.1f, 0.01f);
        configurableValue.XDrive = new SceneJointDrive3D(1.0f, 0.5f, 10.0f, true);
        configurableValue.YDrive = new SceneJointDrive3D(2.0f, 1.0f, float.PositiveInfinity, false);
        configurableValue.TargetPosition = new Vec3(0.1f, 0.2f, 0.3f);
        configurableValue.TargetVelocity = new Vec3(1.0f, 0.0f, -1.0f);
        configurableValue.TargetRotation = new Quat(0.0f, 0.7071f, 0.0f, 0.7071f);
        configurableValue.TargetAngularVelocity = new Vec3(0.5f, 0.0f, 0.25f);
        configurableValue.RotationDriveMode = 1;
        configurableValue.ConfiguredInWorldSpace = true;
        configurableValue.SwapBodies = true;
        RoundTrip(new SceneConfigurableJoint3DCodec(), configurableValue).Should().Be(configurableValue);
    }

    [Fact]
    public void VectorComponent_NonFiniteFallsBackPerComponent()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"anchorA":[1e400, 2.0],"anchorB":["NaN", -1.0],"axis":[1e400, 0]}""");
        SceneDistanceJoint2D anchors = new SceneDistanceJoint2DCodec().Read(document.RootElement);
        SceneSliderJoint2D slider = new SceneSliderJoint2DCodec().Read(document.RootElement);

        anchors.AnchorA.Should().Be(new Vec2(0.0f, 2.0f));
        anchors.AnchorB.Should().Be(new Vec2(0.0f, -1.0f));
        slider.Axis.Should().Be(new Vec2(1.0f, 0.0f));
    }

    [Fact]
    public void VectorComponent_NonFiniteFallsBackFor3DAxes()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"anchor":[1e400, 0, 0],"axis":[1, "NaN", 0],"secondaryAxis":[0, 1e400, 0],"connectedAnchor":["x", 2, 3]}""");
        SceneHingeJoint3D value = new SceneHingeJoint3DCodec().Read(document.RootElement);

        value.Anchor.Should().Be(new Vec3(0.0f, 0.0f, 0.0f));
        value.Axis.Should().Be(new Vec3(1.0f, 0.0f, 0.0f));
        value.SecondaryAxis.Should().Be(new Vec3(0.0f, 1.0f, 0.0f));
        value.ConnectedAnchor.Should().Be(new Vec3(0.0f, 2.0f, 3.0f));
    }

    [Fact]
    public void ScalarNull_ReadsAsPositiveInfinity()
    {
        using JsonDocument document = JsonDocument.Parse("""{"breakForce":null,"maxDistance":null}""");
        SceneDistanceJoint2D value = new SceneDistanceJoint2DCodec().Read(document.RootElement);

        value.BreakForce.Should().Be(float.PositiveInfinity);
        value.MaxDistance.Should().Be(float.PositiveInfinity);
    }

    [Fact]
    public void Write_NaNScalarThrowsTypedError()
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.Distance = float.NaN;

        Action write = () => WriteOnly(new SceneDistanceJoint2DCodec(), value);
        write.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Write_NaNVectorThrowsTypedError()
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.AnchorA = new Vec2(float.NaN, 0.0f);

        Action write = () => WriteOnly(new SceneDistanceJoint2DCodec(), value);
        write.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Read_InconsistentReferenceThrowsTypedError()
    {
        using JsonDocument document = JsonDocument.Parse("""{"connectedBody":{"slot":1,"generation":0}}""");
        Action read = () => new SceneDistanceJoint2DCodec().Read(document.RootElement);
        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Read_GearInvalidKindThrowsTypedError()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"jointA":{"slot":1,"generation":1,"kind":42}}""");
        Action read = () => new SceneGearJoint2DCodec().Read(document.RootElement);
        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Read_EmptyPayload_YieldsDefaults()
    {
        using JsonDocument document = JsonDocument.Parse("{}");

        new SceneDistanceJoint2DCodec().Read(document.RootElement).Should().Be(SceneDistanceJoint2D.Default);
        new SceneHingeJoint2DCodec().Read(document.RootElement).Should().Be(SceneHingeJoint2D.Default);
        new SceneWheelJoint2DCodec().Read(document.RootElement).Should().Be(SceneWheelJoint2D.Default);
        new SceneGearJoint2DCodec().Read(document.RootElement).Should().Be(SceneGearJoint2D.Default);
        new SceneFixedJoint3DCodec().Read(document.RootElement).Should().Be(SceneFixedJoint3D.Default);
        new SceneHingeJoint3DCodec().Read(document.RootElement).Should().Be(SceneHingeJoint3D.Default);
        new SceneSliderJoint3DCodec().Read(document.RootElement).Should().Be(SceneSliderJoint3D.Default);
        new SceneSpringJoint3DCodec().Read(document.RootElement).Should().Be(SceneSpringJoint3D.Default);
        new SceneCharacterJoint3DCodec().Read(document.RootElement).Should().Be(SceneCharacterJoint3D.Default);
        new SceneConfigurableJoint3DCodec().Read(document.RootElement).Should().Be(SceneConfigurableJoint3D.Default);
    }

    [Fact]
    public void Read_FlatLimitKeysWinOverNested()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"useLimits":true,"limits":{"min":-10,"max":20},"limitsMin":-30,"limitsMax":40}""");
        SceneHingeJoint2D value = new SceneHingeJoint2DCodec().Read(document.RootElement);

        value.LimitsMin.Should().Be(-30.0f);
        value.LimitsMax.Should().Be(40.0f);
    }

    [Fact]
    public void Read_NestedLimitKeysApplyWhenFlatAbsent()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"useLimits":true,"limits":{"min":-10,"max":20}}""");
        SceneHingeJoint2D value = new SceneHingeJoint2DCodec().Read(document.RootElement);

        value.LimitsMin.Should().Be(-10.0f);
        value.LimitsMax.Should().Be(20.0f);
    }

    [Fact]
    public void Snapshot_RoundTripsJointsIntoFreshTwoDRuntime()
    {
        using var source = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD
        });

        SceneActor actorA = source.World.CreateActor("A");
        source.World.GetTransform2D(actorA).SetPosition(Vec2.Zero);
        source.World.AddData(actorA, SceneRigidbody2D.Default);
        source.World.AddData(actorA, SceneCollider2D.Default);

        SceneActor actorB = source.World.CreateActor("B");
        source.World.GetTransform2D(actorB).SetPosition(new Vec2(4.0f, 0.0f));
        source.World.AddData(actorB, SceneRigidbody2D.Default);
        source.World.AddData(actorB, SceneCollider2D.Default);

        SceneHingeJoint2D joint = SceneHingeJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.UseLimits = true;
        joint.LimitsMin = -60.0f;
        source.World.AddData(actorA, joint);
        source.World.UpdateTransforms();

        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/joints-2d");

        using var target = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD
        });
        ScenePrefabInstantiationResult result = target.LoadSnapshot(snapshot);

        SceneActor loadedA = result.NodeMap[actorA.Slot.ToString("D", System.Globalization.CultureInfo.InvariantCulture)];
        target.World.GetData<SceneHingeJoint2D>(loadedA).Should().Be(joint);
    }

    [Fact]
    public void Snapshot_CoreProfileRejectsJointComponentWithTypedError()
    {
        using var source = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD
        });

        SceneActor actorA = source.World.CreateActor("A");
        source.World.GetTransform2D(actorA).SetPosition(Vec2.Zero);
        source.World.AddData(actorA, SceneRigidbody2D.Default);
        source.World.AddData(actorA, SceneDistanceJoint2D.Default);
        source.World.UpdateTransforms();

        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/joints-rejected");

        using var target = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.Core
        });

        Action load = () => target.LoadSnapshot(snapshot);
        load.Should().Throw<SceneSnapshotException>()
            .WithInnerException<ScenePrefabException>();
    }

    [Fact]
    public void Runtime_TwoDJointsWithoutTwoDBridgeFailsClosed()
    {
        var customProfile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("custom/joints-only")))
            .AddTransform2D()
            .AddPhysics2D()
            .Build();

        Action construct = () =>
        {
            using SceneRuntime subject = new SceneRuntime(new SceneRuntimeOptions
            {
                Profile = customProfile
            });

            subject.Should().NotBeNull();
        };

        construct.Should().Throw<SceneConfigurationException>();
    }

    private static void WriteOnly<T>(SceneDataCodec<T> codec, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        using MemoryStream buffer = new();
        using (Utf8JsonWriter writer = new(buffer))
        {
            writer.WriteStartObject();
            codec.Write(writer, in value);
            writer.WriteEndObject();
        }
    }

    private static T RoundTrip<T>(SceneDataCodec<T> codec, T value)
        where T : unmanaged, ISceneDataComponent
    {
        using MemoryStream buffer = new();
        using (Utf8JsonWriter writer = new(buffer))
        {
            writer.WriteStartObject();
            codec.Write(writer, in value);
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.ToArray());
        return codec.Read(document.RootElement);
    }
}
