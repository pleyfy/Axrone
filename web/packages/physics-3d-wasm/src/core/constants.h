#pragma once

#include <stdint.h>

namespace axrone::physics {

constexpr float kDefaultFriction = 0.6f;
constexpr float kPositionSlop = 0.005f;
constexpr float kPositionPercent = 0.2f;
constexpr float kMaxPositionCorrection = 0.2f;
constexpr float kFaceEdgeBias = 0.001f;
constexpr float kQuatEps = 1e-12f;
constexpr float kEps = 1e-9f;
constexpr float kCrossEps = 1e-8f;
constexpr float kTangentThreshold = 0.57735026f;
constexpr float kSphereVolume = 4.1887902047863905f;
constexpr float kSphereInertia = 0.4f;
constexpr float kBoxVolume = 8.0f;
constexpr float kPi = 3.14159274101257324219f;
constexpr float kMaxDt = 0.1f;
constexpr int32_t kMaxIterations = 64;
constexpr int32_t kMaxBodies = 262144;
constexpr int32_t kMaxContacts = 262144;
constexpr int32_t kMaxShapesPerBody = 8;
constexpr int32_t kMaxConstraints = 4096;
constexpr int32_t kMaxJointRows = 4;
constexpr int32_t kConstraintIdSlotBits = 12;
constexpr int32_t kConstraintIdSlotMask = 0xFFF;
constexpr int32_t kConstraintIdGenMask = 0x3FF;
constexpr int32_t kConstraintIdGenShift = 12;
constexpr float kJointBaumgarte = 0.2f;
constexpr float kJointPositionFactor = 0.8f;
constexpr float kJointLinearSlop = 0.005f;
constexpr float kJointAngularSlop = 0.0349f;
constexpr float kBig = 1e30f;
constexpr float kRestitutionThreshold = 1.0f;

constexpr int32_t kKindSphereSphere = 1;
constexpr int32_t kKindSphereBox = 2;
constexpr int32_t kKindBoxFace = 3;
constexpr int32_t kKindBoxEdge = 4;
constexpr int32_t kKindCapsuleSphere = 5;
constexpr int32_t kKindCapsuleCapsule = 6;
constexpr int32_t kKindCapsuleBox = 7;
constexpr int32_t kKindHullFace = 8;
constexpr int32_t kKindHullSphere = 9;
constexpr int32_t kKindCapsuleHull = 10;
constexpr int32_t kKindMeshTriangle = 11;

constexpr int32_t kHullRingVertices = 8;
constexpr int32_t kHullMaxVertices = 16;
constexpr int32_t kHullMaxFaces = 10;
constexpr int32_t kHullMaxIndices = 48;
constexpr int32_t kHullMaxFaceVertices = 8;
constexpr int32_t kHullClipCapacity = 24;
constexpr int32_t kHullManifoldCapacity = 4;
constexpr int32_t kCapsuleManifoldCapacity = 4;

constexpr int32_t kBulkMaxVertices = 256;
constexpr int32_t kBulkMaxFaces = 508;
constexpr int32_t kBulkMaxFaceIndices = 1524;
constexpr int32_t kBulkMaxTriangles = 4096;
constexpr int32_t kBulkMaxHeightFieldSide = 128;
constexpr int32_t kBulkScratchBytes = 8 * 1024 * 1024;
constexpr int32_t kHullScratchFaces = 3 * kBulkMaxVertices - 8;

constexpr int32_t kBoxClipCapacity = 16;
constexpr int32_t kEventCapacity = 4096;
constexpr int32_t kEventHashCapacity = 8192;

constexpr int32_t kCapsuleBoxSamples = 16;

constexpr int32_t kBodyTypeStatic = 0;
constexpr int32_t kBodyTypeDynamic = 1;
constexpr int32_t kBodyTypeKinematic = 2;

constexpr int32_t kShapeTypeCodeSphere = 5;
constexpr int32_t kShapeTypeCodeBox = 3;
constexpr int32_t kShapeTypeCodeCapsule = 1;
constexpr int32_t kShapeTypeCodeCylinder = 6;
constexpr int32_t kShapeTypeCodeCone = 7;
constexpr int32_t kShapeTypeCodeHull = 8;
constexpr int32_t kShapeTypeCodeMesh = 9;
constexpr int32_t kShapeTypeCodeHeightField = 10;

constexpr int32_t kShapeIdSlotBits = 3;
constexpr int32_t kShapeIdSlotMask = 7;
constexpr int32_t kShapeIdBodyMask = 0x3FFFF;
constexpr int32_t kShapeIdGenMask = 0x3FF;
constexpr int32_t kShapeIdGenShift = 21;
constexpr int32_t kShapeIdMax = 0x7FFFFFFF;

constexpr float kShapeMaterialInherit = -1.0f;
constexpr int32_t kDefaultCategoryBits = 1;
constexpr int32_t kDefaultMaskBits = 0xFFFF;

constexpr int32_t kBodyFreezeRotationX = 1;
constexpr int32_t kBodyFreezeRotationY = 2;
constexpr int32_t kBodyFreezeRotationZ = 4;
constexpr int32_t kBodyFreezePositionX = 8;
constexpr int32_t kBodyFreezePositionY = 16;
constexpr int32_t kBodyFreezePositionZ = 32;

constexpr float kSleepTimeLimit = 0.5f;
constexpr float kSleepLinearThresholdSq = 1e-4f;
constexpr float kSleepAngularThresholdSq = 1.218e-3f;
constexpr float kSleepWakeSpeedSq = 1e-4f;

}
