import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Vec3, Vec4, Quat } from '@axrone/numeric';
import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { OrbitCameraController } from '../components/orbit-camera-controller';
import { TrailRenderer } from '../components/trail-renderer';
import { PathAgent } from '../components/path-agent';
import { BillboardRenderer } from '../components/billboard-renderer';
import { createSceneRegistry } from '../scene-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createActorWithTransform(): { world: World; actor: Actor; transform: Transform } {
    const world = new World(createSceneRegistry());
    const actor = new Actor(world);
    const transform = actor.getComponent(Transform)!;
    return { world, actor, transform };
}

function getPrivateField<T>(obj: object, field: string): T {
    return (obj as Record<string, unknown>)[field] as T;
}

/**
 * Resolve a path relative to the project root (one level above Axrone/web).
 * The test file lives at Axrone/web/packages/scene-runtime/src/__tests__/,
 * so we go up 5 levels to reach the project root where Assets/ lives.
 */
function projectRoot(...segments: string[]): string {
    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', ...segments);
}

/**
 * Resolve a path relative to the web/ monorepo root (Axrone/web).
 * The test file lives at packages/scene-runtime/src/__tests__/,
 * so we go up 4 levels to reach the web/ root.
 */
function webRoot(...segments: string[]): string {
    return path.resolve(__dirname, '..', '..', '..', '..', ...segments);
}

/**
 * Read a source file from the project root or web root.
 * Paths starting with 'Assets/' resolve from the project root;
 * all others resolve from the web/ monorepo root.
 */
function readSource(...segments: string[]): string {
    const fullPath = segments[0] === 'Assets'
        ? projectRoot(...segments)
        : webRoot(...segments);
    return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Extract the body of a method from source code by finding the method
 * declaration and matching braces. Returns the method body string or null.
 * Skips matches inside comments and uses lookbehind to avoid partial
 * identifier matches (e.g. _updateRemainingDistance containing 'update').
 */
function extractMethodBody(source: string, methodName: string): string | null {
    // Use negative lookbehind to ensure the method name is not part of a
    // larger identifier (e.g. _updateRemainingDistance should not match 'update').
    const regex = new RegExp(`(?<![a-zA-Z0-9_$])${methodName}\\s*\\(`, 'g');

    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
        const matchIdx = match.index;

        // Skip matches inside single-line comments
        const lineStart = source.lastIndexOf('\n', matchIdx) + 1;
        const prefix = source.substring(lineStart, matchIdx);
        if (prefix.trimStart().startsWith('//')) continue;

        // Skip matches inside block comments (simple check: count /* and */)
        const beforeMatch = source.substring(0, matchIdx);
        const opens = (beforeMatch.match(/\/\*/g) || []).length;
        const closes = (beforeMatch.match(/\*\//g) || []).length;
        if (opens > closes) continue;

        // Position of the opening '('
        const openParenIdx = matchIdx + match[0].length - 1;

        // Track parentheses depth to find the matching close ')'
        let depth = 1;
        let closeParenIdx = -1;
        for (let i = openParenIdx + 1; i < source.length; i++) {
            if (source[i] === '(') depth++;
            else if (source[i] === ')') {
                depth--;
                if (depth === 0) {
                    closeParenIdx = i;
                    break;
                }
            }
        }
        if (closeParenIdx === -1) continue;

        // Find the opening '{' of the method body (skip return type annotations)
        let braceStart = -1;
        for (let i = closeParenIdx + 1; i < source.length; i++) {
            if (source[i] === '{') {
                braceStart = i;
                break;
            }
            // If we hit a semicolon before a brace, this isn't a method with a body
            if (source[i] === ';') break;
        }
        if (braceStart === -1) continue;

        // Match braces to find the end of the method body
        let braceDepth = 1;
        for (let i = braceStart + 1; i < source.length; i++) {
            if (source[i] === '{') braceDepth++;
            else if (source[i] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    return source.substring(braceStart + 1, i);
                }
            }
        }
    }

    return null;
}

/**
 * Check whether a method body contains the `new` keyword followed by a
 * capital letter (indicating object allocation). Excludes `new Map()` /
 * `new Set()` in comments and type annotations.
 */
function containsAllocation(methodBody: string): boolean {
    // Remove single-line comments
    const cleaned = methodBody
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Check for `new SomeClass(` pattern
    return /\bnew\s+[A-Z]/.test(cleaned);
}

/**
 * Check whether a method body contains array literal allocation `[...]`.
 * Excludes destructuring patterns and type annotations.
 */
function containsArrayLiteral(methodBody: string): boolean {
    const cleaned = methodBody
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Simple heuristic: look for `= [` or `return [` patterns
    return /(?:=\s*\[|return\s*\[)/.test(cleaned);
}

/**
 * Check whether a method body contains string concatenation with `+`
 * between string-typed expressions.
 */
function containsStringConcat(methodBody: string): boolean {
    const cleaned = methodBody
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Heuristic: `'...' +` or `+ '...'` patterns
    return /['"`]\s*\+|\+\s*['"`]/.test(cleaned);
}

// ---------------------------------------------------------------------------
// Paths to production source files
// ---------------------------------------------------------------------------

const CAMERA_FOLLOW_SOURCE = readSource('Assets', 'Scripts', 'CameraFollowControl.ts');
const CHARACTER_MOVEMENT_SOURCE = readSource('Assets', 'Scripts', 'CharacterMovement.ts');
const ORBIT_CAMERA_SOURCE = readSource(
    'packages', 'scene-runtime', 'src', 'components', 'orbit-camera-controller.ts'
);
const TRAIL_RENDERER_SOURCE = readSource(
    'packages', 'scene-runtime', 'src', 'components', 'trail-renderer.ts'
);
const PATH_AGENT_SOURCE = readSource(
    'packages', 'scene-runtime', 'src', 'components', 'path-agent.ts'
);
const BILLBOARD_RENDERER_SOURCE = readSource(
    'packages', 'scene-runtime', 'src', 'components', 'billboard-renderer.ts'
);

// ===========================================================================
// 1. Production Game Script Verification — CameraFollowControl (static)
// ===========================================================================

describe('T-11: Production Script Verification — CameraFollowControl (source-level)', () => {
    it('source file exists and exports a class decorated with @script', () => {
        expect(CAMERA_FOLLOW_SOURCE).toContain('@script(');
        expect(CAMERA_FOLLOW_SOURCE).toContain('class CameraFollowControl');
        expect(CAMERA_FOLLOW_SOURCE).toContain('extends Component');
    });

    it('declares pre-allocated readonly Vec3/Quat temporaries', () => {
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_desiredPosition\s*=\s*new\s+Vec3\(\)/);
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_lookDirection\s*=\s*new\s+Vec3\(\)/);
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_tempRotation\s*=\s*new\s+Quat\(\)/);
    });

    it('has onLoad() lifecycle method', () => {
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/onLoad\s*\(\s*\)\s*:\s*void/);
    });

    it('has lateUpdate(deltaTime: number) lifecycle method', () => {
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/lateUpdate\s*\(\s*deltaTime\s*:\s*number\s*\)\s*:\s*void/);
    });

    it('lateUpdate() contains zero allocations (no `new` keyword)', () => {
        const body = extractMethodBody(CAMERA_FOLLOW_SOURCE, 'lateUpdate');
        expect(body).not.toBeNull();
        expect(containsAllocation(body!)).toBe(false);
    });

    it('lateUpdate() contains no array literal allocations', () => {
        const body = extractMethodBody(CAMERA_FOLLOW_SOURCE, 'lateUpdate');
        expect(body).not.toBeNull();
        expect(containsArrayLiteral(body!)).toBe(false);
    });

    it('lateUpdate() contains no string concatenation', () => {
        const body = extractMethodBody(CAMERA_FOLLOW_SOURCE, 'lateUpdate');
        expect(body).not.toBeNull();
        expect(containsStringConcat(body!)).toBe(false);
    });

    it('uses exponential smoothing (not linear) for frame-rate independence', () => {
        expect(CAMERA_FOLLOW_SOURCE).toContain('Math.exp');
    });

    it('has a guard against degenerate lookRotation (FOLLOW_MIN_DISTANCE)', () => {
        expect(CAMERA_FOLLOW_SOURCE).toContain('FOLLOW_MIN_DISTANCE');
    });

    it('caches the transform reference in onLoad to avoid per-frame lookup', () => {
        expect(CAMERA_FOLLOW_SOURCE).toContain('_cachedTransform');
    });
});

// ===========================================================================
// 2. Production Game Script Verification — CharacterMovement (source-level)
// ===========================================================================

describe('T-11: Production Script Verification — CharacterMovement (source-level)', () => {
    it('source file exists and exports a class decorated with @script', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('@script(');
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('class CharacterMovement');
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('extends Component');
    });

    it('declares pre-allocated readonly Vec3/Quat temporaries', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_moveDirection\s*=\s*new\s+Vec3\(\)/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_newPosition\s*=\s*new\s+Vec3\(\)/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_tempRotation\s*=\s*new\s+Quat\(\)/);
    });

    it('declares a readonly Set for pressed keys (reused across frames)', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_pressedKeys\s*=\s*new\s+Set/);
    });

    it('has onLoad() lifecycle method that caches the transform', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/onLoad\s*\(\s*\)\s*:\s*void/);
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('_cachedTransform');
    });

    it('has update(deltaTime: number) lifecycle method', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/update\s*\(\s*deltaTime\s*:\s*number\s*\)\s*:\s*void/);
    });

    it('update() contains zero allocations (no `new` keyword)', () => {
        const body = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsAllocation(body!)).toBe(false);
    });

    it('update() contains no array literal allocations', () => {
        const body = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsArrayLiteral(body!)).toBe(false);
    });

    it('update() contains no string concatenation', () => {
        const body = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsStringConcat(body!)).toBe(false);
    });

    it('has serialize() and deserialize() methods', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/serialize\s*\(\s*\)/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/deserialize\s*\(\s*data/);
    });

    it('has onDestroy() that cleans up event listeners', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/onDestroy\s*\(\s*\)\s*:\s*void/);
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('_cleanupInput');
    });

    it('subscribes to input events in onLoad() and unsubscribes in onDestroy()', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('addEventListener');
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('removeEventListener');
    });
});

// ===========================================================================
// 3. Production Component Verification — OrbitCameraController (runtime)
// ===========================================================================

describe('T-11: Production Script Verification — OrbitCameraController (runtime)', () => {
    function createController(config: Record<string, unknown> = {}) {
        const { world, actor, transform } = createActorWithTransform();
        transform.position = new Vec3(0, 5, 10);
        const controller = actor.addComponent(OrbitCameraController, {
            target: [0, 0, 0],
            distance: 10,
            azimuth: 0.5,
            elevation: 0.35,
            ...config,
        });
        return { world, actor, transform, controller };
    }

    it('is an instance of OrbitCameraController extending Component', () => {
        const { controller } = createController();
        expect(controller).toBeInstanceOf(OrbitCameraController);
    });

    it('pre-allocated _tempPosition is a Vec3 instance, initialized at construction', () => {
        const controller = new OrbitCameraController();
        const field = getPrivateField<Vec3>(controller, '_tempPosition');
        expect(field).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempForward is a Vec3 instance, initialized at construction', () => {
        const controller = new OrbitCameraController();
        const field = getPrivateField<Vec3>(controller, '_tempForward');
        expect(field).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempNormalizedForward is a Vec3 instance', () => {
        const controller = new OrbitCameraController();
        const field = getPrivateField<Vec3>(controller, '_tempNormalizedForward');
        expect(field).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempBackward is a Vec3 instance', () => {
        const controller = new OrbitCameraController();
        const field = getPrivateField<Vec3>(controller, '_tempBackward');
        expect(field).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempRotation is a Quat instance', () => {
        const controller = new OrbitCameraController();
        const field = getPrivateField<Quat>(controller, '_tempRotation');
        expect(field).toBeInstanceOf(Quat);
    });

    it('all five pre-allocated temp fields are distinct instances', () => {
        const controller = new OrbitCameraController();
        const fields = [
            getPrivateField<object>(controller, '_tempPosition'),
            getPrivateField<object>(controller, '_tempForward'),
            getPrivateField<object>(controller, '_tempNormalizedForward'),
            getPrivateField<object>(controller, '_tempBackward'),
            getPrivateField<object>(controller, '_tempRotation'),
        ];
        const uniqueSet = new Set(fields);
        expect(uniqueSet.size).toBe(5);
    });

    it('pre-allocated field references are stable across update() calls', () => {
        const { controller } = createController({ autoRotateSpeed: 1.0 });
        const refsBefore = {
            tempPosition: getPrivateField<Vec3>(controller, '_tempPosition'),
            tempForward: getPrivateField<Vec3>(controller, '_tempForward'),
            tempRotation: getPrivateField<Quat>(controller, '_tempRotation'),
        };

        for (let i = 0; i < 100; i++) {
            controller.update(16);
        }

        expect(getPrivateField<Vec3>(controller, '_tempPosition')).toBe(refsBefore.tempPosition);
        expect(getPrivateField<Vec3>(controller, '_tempForward')).toBe(refsBefore.tempForward);
        expect(getPrivateField<Quat>(controller, '_tempRotation')).toBe(refsBefore.tempRotation);
    });

    it('has serialize() method returning expected keys', () => {
        const { controller } = createController();
        const serialized = controller.serialize();
        expect(serialized).toHaveProperty('target');
        expect(serialized).toHaveProperty('distance');
        expect(serialized).toHaveProperty('azimuth');
        expect(serialized).toHaveProperty('elevation');
        expect(serialized).toHaveProperty('autoRotateSpeed');
    });

    it('has deserialize() method that restores state', () => {
        const { controller } = createController();
        controller.deserialize({
            azimuth: 2.5,
            elevation: 0.8,
            distance: 20,
        });
        expect(controller.azimuth).toBe(2.5);
        expect(controller.elevation).toBeCloseTo(0.8, 5);
        expect(controller.distance).toBe(20);
    });

    it('source-level: update() contains zero allocations', () => {
        const body = extractMethodBody(ORBIT_CAMERA_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsAllocation(body!)).toBe(false);
    });

    it('source-level: update() contains no array literal allocations', () => {
        const body = extractMethodBody(ORBIT_CAMERA_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsArrayLiteral(body!)).toBe(false);
    });

    it('source-level: declares all temp fields as private readonly', () => {
        expect(ORBIT_CAMERA_SOURCE).toMatch(/private\s+readonly\s+_tempPosition\s*=\s*new\s+Vec3\(\)/);
        expect(ORBIT_CAMERA_SOURCE).toMatch(/private\s+readonly\s+_tempForward\s*=\s*new\s+Vec3\(\)/);
        expect(ORBIT_CAMERA_SOURCE).toMatch(/private\s+readonly\s+_tempNormalizedForward\s*=\s*new\s+Vec3\(\)/);
        expect(ORBIT_CAMERA_SOURCE).toMatch(/private\s+readonly\s+_tempBackward\s*=\s*new\s+Vec3\(\)/);
        expect(ORBIT_CAMERA_SOURCE).toMatch(/private\s+readonly\s+_tempRotation\s*=\s*new\s+Quat\(\)/);
    });
});

// ===========================================================================
// 4. Production Component Verification — TrailRenderer (runtime)
// ===========================================================================

describe('T-11: Production Script Verification — TrailRenderer (runtime)', () => {
    function createTrail(config: Record<string, unknown> = {}) {
        const { world, actor, transform } = createActorWithTransform();
        const trail = actor.addComponent(TrailRenderer, {
            lifetime: 2,
            minVertexDistance: 0.5,
            startWidth: 1,
            endWidth: 0,
            ...config,
        });
        return { world, actor, transform, trail };
    }

    it('is an instance of TrailRenderer extending Component', () => {
        const { trail } = createTrail();
        expect(trail).toBeInstanceOf(TrailRenderer);
    });

    it('pre-allocated _tempPosition is a Vec3 instance', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec3>(trail, '_tempPosition')).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempColor is a Vec4 instance', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec4>(trail, '_tempColor')).toBeInstanceOf(Vec4);
    });

    it('pre-allocated _tempLowerColor is a Vec4 instance', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec4>(trail, '_tempLowerColor')).toBeInstanceOf(Vec4);
    });

    it('pre-allocated _tempUpperColor is a Vec4 instance', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec4>(trail, '_tempUpperColor')).toBeInstanceOf(Vec4);
    });

    it('pre-allocated _lastPosition is a Vec3 instance', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec3>(trail, '_lastPosition')).toBeInstanceOf(Vec3);
    });

    it('ring buffer is pre-allocated to capacity 256 with TrailPoint objects', () => {
        const trail = new TrailRenderer();
        const capacity = getPrivateField<number>(trail, '_capacity');
        const points = getPrivateField<Array<{ position: Vec3; time: number; width: number }>>(trail, '_points');
        expect(capacity).toBe(256);
        expect(points.length).toBe(256);
        for (let i = 0; i < 10; i++) {
            expect(points[i]).toBeDefined();
            expect(points[i]!.position).toBeInstanceOf(Vec3);
        }
    });

    it('pre-allocated temp field references are stable across update() calls', () => {
        const { trail, transform } = createTrail();
        const refsBefore = {
            tempPosition: getPrivateField<Vec3>(trail, '_tempPosition'),
            tempColor: getPrivateField<Vec4>(trail, '_tempColor'),
            lastPosition: getPrivateField<Vec3>(trail, '_lastPosition'),
        };

        for (let i = 0; i < 50; i++) {
            transform.position = new Vec3(i * 1.0, 0, 0);
            trail.update(100);
        }

        expect(getPrivateField<Vec3>(trail, '_tempPosition')).toBe(refsBefore.tempPosition);
        expect(getPrivateField<Vec4>(trail, '_tempColor')).toBe(refsBefore.tempColor);
        expect(getPrivateField<Vec3>(trail, '_lastPosition')).toBe(refsBefore.lastPosition);
    });

    it('evaluateColor() always returns the same _tempColor reference', () => {
        const { trail } = createTrail();
        const results = new Set<Vec4>();
        for (let i = 0; i <= 20; i++) {
            results.add(trail.evaluateColor(i / 20));
        }
        expect(results.size).toBe(1);
    });

    it('has serialize() method returning expected keys', () => {
        const { trail } = createTrail();
        const serialized = trail.serialize();
        expect(serialized).toHaveProperty('lifetime');
        expect(serialized).toHaveProperty('minVertexDistance');
        expect(serialized).toHaveProperty('startWidth');
        expect(serialized).toHaveProperty('endWidth');
        expect(serialized).toHaveProperty('colorGradient');
        expect(serialized).toHaveProperty('textureMode');
    });

    it('has deserialize() method that restores state', () => {
        const { trail } = createTrail();
        trail.deserialize({
            lifetime: 5,
            startWidth: 2,
            endWidth: 0.5,
        });
        expect(trail.lifetime).toBe(5);
        expect(trail.startWidth).toBe(2);
        expect(trail.endWidth).toBe(0.5);
    });

    it('source-level: update() contains zero allocations', () => {
        const body = extractMethodBody(TRAIL_RENDERER_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsAllocation(body!)).toBe(false);
    });

    it('source-level: declares MutableTrailConfig via Mutable<T> from @axrone/utility (no `as any` bypass)', () => {
        expect(TRAIL_RENDERER_SOURCE).toContain('MutableTrailConfig');
        expect(TRAIL_RENDERER_SOURCE).toMatch(/type\s+MutableTrailConfig\s*=\s*Mutable<TrailRendererConfig>/);
    });

    it('source-level: declares all temp fields as private readonly', () => {
        expect(TRAIL_RENDERER_SOURCE).toMatch(/private\s+readonly\s+_tempPosition:\s*Vec3\s*=\s*new\s+Vec3\(\)/);
        expect(TRAIL_RENDERER_SOURCE).toMatch(/private\s+readonly\s+_tempColor:\s*Vec4\s*=\s*new\s+Vec4\(\)/);
        expect(TRAIL_RENDERER_SOURCE).toMatch(/private\s+readonly\s+_tempLowerColor:\s*Vec4\s*=\s*new\s+Vec4\(\)/);
        expect(TRAIL_RENDERER_SOURCE).toMatch(/private\s+readonly\s+_tempUpperColor:\s*Vec4\s*=\s*new\s+Vec4\(\)/);
        expect(TRAIL_RENDERER_SOURCE).toMatch(/private\s+readonly\s+_lastPosition:\s*Vec3\s*=\s*new\s+Vec3\(\)/);
    });
});

// ===========================================================================
// 5. Production Component Verification — PathAgent (runtime)
// ===========================================================================

describe('T-11: Production Script Verification — PathAgent (runtime)', () => {
    function createAgent(config: Record<string, unknown> = {}) {
        const { world, actor, transform } = createActorWithTransform();
        transform.position = new Vec3(0, 0, 0);
        const agent = actor.addComponent(PathAgent, {
            speed: 5,
            angularSpeed: 120,
            stoppingDistance: 0.5,
            ...config,
        });
        return { world, actor, transform, agent };
    }

    it('is an instance of PathAgent extending Component', () => {
        const { agent } = createAgent();
        expect(agent).toBeInstanceOf(PathAgent);
    });

    it('pre-allocated _tempToCorner is a Vec3 instance', () => {
        const agent = new PathAgent();
        expect(getPrivateField<Vec3>(agent, '_tempToCorner')).toBeInstanceOf(Vec3);
    });

    it('pre-allocated _tempVelocity is a Vec3 instance', () => {
        const agent = new PathAgent();
        expect(getPrivateField<Vec3>(agent, '_tempVelocity')).toBeInstanceOf(Vec3);
    });

    it('pre-allocated temp vectors are distinct instances', () => {
        const agent = new PathAgent();
        const toCorner = getPrivateField<Vec3>(agent, '_tempToCorner');
        const velocity = getPrivateField<Vec3>(agent, '_tempVelocity');
        expect(toCorner).not.toBe(velocity);
    });

    it('pre-allocated field references are stable across update() calls', () => {
        const { agent, transform } = createAgent();
        agent.setDestination(new Vec3(100, 0, 0));

        const refsBefore = {
            toCorner: getPrivateField<Vec3>(agent, '_tempToCorner'),
            velocity: getPrivateField<Vec3>(agent, '_tempVelocity'),
        };

        for (let i = 0; i < 100; i++) {
            agent.update(0.016);
        }

        expect(getPrivateField<Vec3>(agent, '_tempToCorner')).toBe(refsBefore.toCorner);
        expect(getPrivateField<Vec3>(agent, '_tempVelocity')).toBe(refsBefore.velocity);
    });

    it('has serialize() method returning expected keys', () => {
        const { agent } = createAgent();
        const serialized = agent.serialize();
        expect(serialized).toHaveProperty('speed');
        expect(serialized).toHaveProperty('angularSpeed');
        expect(serialized).toHaveProperty('stoppingDistance');
        expect(serialized).toHaveProperty('radius');
        expect(serialized).toHaveProperty('acceleration');
    });

    it('has deserialize() method that restores state', () => {
        const { agent } = createAgent();
        agent.deserialize({
            speed: 10,
            radius: 1.5,
            stoppingDistance: 2.0,
        });
        expect(agent.speed).toBe(10);
        expect(agent.radius).toBe(1.5);
        expect(agent.stoppingDistance).toBe(2.0);
    });

    it('source-level: update() contains zero allocations', () => {
        const body = extractMethodBody(PATH_AGENT_SOURCE, 'update');
        expect(body).not.toBeNull();
        expect(containsAllocation(body!)).toBe(false);
    });

    it('source-level: declares MutableConfig via Mutable<T> from @axrone/utility in deserialize (no `as any` bypass)', () => {
        expect(PATH_AGENT_SOURCE).toContain('MutableConfig');
        expect(PATH_AGENT_SOURCE).toMatch(/type\s+MutableConfig\s*=\s*Mutable<PathAgentConfig>/);
    });

    it('source-level: declares pre-allocated temp fields as private readonly', () => {
        expect(PATH_AGENT_SOURCE).toMatch(/private\s+readonly\s+_tempToCorner\s*=\s*new\s+Vec3\(\)/);
        expect(PATH_AGENT_SOURCE).toMatch(/private\s+readonly\s+_tempVelocity\s*=\s*new\s+Vec3\(\)/);
    });
});

// ===========================================================================
// 6. Production Component Verification — BillboardRenderer (runtime)
// ===========================================================================

describe('T-11: Production Script Verification — BillboardRenderer (runtime)', () => {
    function createBillboard(config: Record<string, unknown> = {}) {
        const { world, actor, transform } = createActorWithTransform();
        const billboard = actor.addComponent(BillboardRenderer, {
            width: 2,
            height: 4,
            ...config,
        });
        return { world, actor, transform, billboard };
    }

    it('is an instance of BillboardRenderer extending Component', () => {
        const { billboard } = createBillboard();
        expect(billboard).toBeInstanceOf(BillboardRenderer);
    });

    it('has no own update() method — passive component with zero per-frame cost', () => {
        const { billboard } = createBillboard();
        const hasOwnUpdate = Object.prototype.hasOwnProperty.call(billboard, 'update');
        expect(hasOwnUpdate).toBe(false);
    });

    it('pivot Vec3 is stable across property reads (no allocation on access)', () => {
        const { billboard } = createBillboard({ pivot: [0.5, 0.5, 0] });
        const pivotBefore = billboard.pivot;
        void billboard.pivot;
        void billboard.pivot;
        const pivotAfter = billboard.pivot;
        expect(pivotBefore).toBe(pivotAfter);
    });

    it('getAdjustedUVs() returns consistent results', () => {
        const { billboard } = createBillboard({ flipX: true, flipY: false });
        const uvs1 = billboard.getAdjustedUVs();
        const uvs2 = billboard.getAdjustedUVs();
        expect(uvs1).toEqual(uvs2);
    });

    it('has serialize() method returning expected keys', () => {
        const { billboard } = createBillboard();
        const serialized = billboard.serialize();
        expect(serialized).toHaveProperty('width');
        expect(serialized).toHaveProperty('height');
        expect(serialized).toHaveProperty('pivot');
        expect(serialized).toHaveProperty('mode');
        expect(serialized).toHaveProperty('opacity');
    });

    it('has deserialize() method that restores state', () => {
        const { billboard } = createBillboard();
        billboard.deserialize({
            width: 10,
            height: 20,
            opacity: 0.5,
        });
        expect(billboard.width).toBe(10);
        expect(billboard.height).toBe(20);
        expect(billboard.opacity).toBe(0.5);
    });

    it('source-level: declares MutableBillboardConfig via Mutable<T> from @axrone/utility in deserialize', () => {
        expect(BILLBOARD_RENDERER_SOURCE).toContain('MutableBillboardConfig');
        expect(BILLBOARD_RENDERER_SOURCE).toMatch(/type\s+MutableBillboardConfig\s*=\s*Mutable<BillboardRendererConfig>/);
    });

    it('source-level: no update() method defined (passive component)', () => {
        // BillboardRenderer should not have an update() override
        const hasUpdate = /override\s+update\s*\(/.test(BILLBOARD_RENDERER_SOURCE);
        expect(hasUpdate).toBe(false);
    });
});

// ===========================================================================
// 7. Cross-cutting: MutableConfig governance (no `as any` casts)
// ===========================================================================

describe('T-11: Production Script Verification — MutableConfig governance', () => {
    it('TrailRenderer deserialize uses MutableTrailConfig (not `as any`)', () => {
        // Verify the pattern: `const patch: MutableTrailConfig = {}`
        expect(TRAIL_RENDERER_SOURCE).toMatch(/const\s+patch\s*:\s*MutableTrailConfig\s*=\s*\{\}/);
        // Verify there is no `as any` cast on the patch variable (strip comments first
        // because the source has a doc comment mentioning `(patch as any)` as anti-pattern)
        const codeWithoutComments = TRAIL_RENDERER_SOURCE
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(codeWithoutComments).not.toMatch(/patch\s+as\s+any/);
    });

    it('PathAgent deserialize uses MutableConfig (not `as any`)', () => {
        expect(PATH_AGENT_SOURCE).toMatch(/const\s+patch\s*:\s*MutableConfig\s*=\s*\{\}/);
        expect(PATH_AGENT_SOURCE).not.toMatch(/patch\s+as\s+any/);
    });

    it('BillboardRenderer deserialize uses MutableBillboardConfig (not `as any`)', () => {
        expect(BILLBOARD_RENDERER_SOURCE).toMatch(/const\s+patch\s*:\s*MutableBillboardConfig\s*=\s*\{\}/);
        expect(BILLBOARD_RENDERER_SOURCE).not.toMatch(/patch\s+as\s+any/);
    });
});

// ===========================================================================
// 8. Cross-cutting: Lifecycle method existence on production components
// ===========================================================================

describe('T-11: Production Script Verification — lifecycle method contracts', () => {
    it('OrbitCameraController has update() and serialize()/deserialize()', () => {
        const controller = new OrbitCameraController();
        expect(typeof controller.update).toBe('function');
        expect(typeof controller.serialize).toBe('function');
        expect(typeof controller.deserialize).toBe('function');
    });

    it('TrailRenderer has update() and serialize()/deserialize()', () => {
        const trail = new TrailRenderer();
        expect(typeof trail.update).toBe('function');
        expect(typeof trail.serialize).toBe('function');
        expect(typeof trail.deserialize).toBe('function');
    });

    it('PathAgent has update() and serialize()/deserialize()', () => {
        const agent = new PathAgent();
        expect(typeof agent.update).toBe('function');
        expect(typeof agent.serialize).toBe('function');
        expect(typeof agent.deserialize).toBe('function');
    });

    it('BillboardRenderer has serialize()/deserialize() but no own update()', () => {
        const billboard = new BillboardRenderer();
        expect(typeof billboard.serialize).toBe('function');
        expect(typeof billboard.deserialize).toBe('function');
        // BillboardRenderer is passive — no own update()
        const hasOwnUpdate = Object.prototype.hasOwnProperty.call(billboard, 'update');
        expect(hasOwnUpdate).toBe(false);
    });

    it('CameraFollowControl source has onLoad() and lateUpdate() (not update())', () => {
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/onLoad\s*\(/);
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/lateUpdate\s*\(/);
        // CameraFollowControl uses lateUpdate, not update
        const hasOwnUpdate = /^\s*update\s*\(/m.test(
            CAMERA_FOLLOW_SOURCE.replace(/override\s+update/g, '__no_match__')
        );
        expect(hasOwnUpdate).toBe(false);
    });

    it('CharacterMovement source has onLoad(), update(), onDestroy()', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/onLoad\s*\(/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/update\s*\(/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/onDestroy\s*\(/);
    });
});

// ===========================================================================
// 9. Cross-cutting: Event subscription / unsubscription patterns
// ===========================================================================

describe('T-11: Production Script Verification — event lifecycle patterns', () => {
    it('CharacterMovement subscribes in onLoad() and unsubscribes in onDestroy()', () => {
        // Verify addEventListener in onLoad context
        const onLoadBody = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'onLoad');
        expect(onLoadBody).not.toBeNull();
        expect(onLoadBody!).toContain('addEventListener');

        // Verify removeEventListener in onDestroy context
        const destroyBody = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'onDestroy');
        expect(destroyBody).not.toBeNull();
        expect(destroyBody!).toContain('_cleanupInput');
    });

    it('CharacterMovement stores cleanup function for later invocation', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toContain('_cleanupInput');
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/this\._cleanupInput\s*=\s*\(\)\s*=>/);
    });

    it('CharacterMovement onDestroy nulls the cleanup reference after calling it', () => {
        const destroyBody = extractMethodBody(CHARACTER_MOVEMENT_SOURCE, 'onDestroy');
        expect(destroyBody).not.toBeNull();
        expect(destroyBody!).toContain('null');
    });
});

// ===========================================================================
// 10. Cross-cutting: Pre-allocated fields are class members (not lazy)
// ===========================================================================

describe('T-11: Production Script Verification — eager initialization of temp fields', () => {
    it('OrbitCameraController: all temp fields are non-undefined immediately after `new`', () => {
        const controller = new OrbitCameraController();
        expect(getPrivateField<Vec3>(controller, '_tempPosition')).toBeDefined();
        expect(getPrivateField<Vec3>(controller, '_tempForward')).toBeDefined();
        expect(getPrivateField<Vec3>(controller, '_tempNormalizedForward')).toBeDefined();
        expect(getPrivateField<Vec3>(controller, '_tempBackward')).toBeDefined();
        expect(getPrivateField<Quat>(controller, '_tempRotation')).toBeDefined();
    });

    it('TrailRenderer: all temp fields are non-undefined immediately after `new`', () => {
        const trail = new TrailRenderer();
        expect(getPrivateField<Vec3>(trail, '_tempPosition')).toBeDefined();
        expect(getPrivateField<Vec4>(trail, '_tempColor')).toBeDefined();
        expect(getPrivateField<Vec4>(trail, '_tempLowerColor')).toBeDefined();
        expect(getPrivateField<Vec4>(trail, '_tempUpperColor')).toBeDefined();
        expect(getPrivateField<Vec3>(trail, '_lastPosition')).toBeDefined();
    });

    it('PathAgent: all temp fields are non-undefined immediately after `new`', () => {
        const agent = new PathAgent();
        expect(getPrivateField<Vec3>(agent, '_tempToCorner')).toBeDefined();
        expect(getPrivateField<Vec3>(agent, '_tempVelocity')).toBeDefined();
    });

    it('source-level: CameraFollowControl uses field initializers (not constructor assignment)', () => {
        // The readonly fields should be initialized at declaration site
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_desiredPosition\s*=\s*new\s+Vec3\(\)/);
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_lookDirection\s*=\s*new\s+Vec3\(\)/);
        expect(CAMERA_FOLLOW_SOURCE).toMatch(/private\s+readonly\s+_tempRotation\s*=\s*new\s+Quat\(\)/);
    });

    it('source-level: CharacterMovement uses field initializers (not constructor assignment)', () => {
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_moveDirection\s*=\s*new\s+Vec3\(\)/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_newPosition\s*=\s*new\s+Vec3\(\)/);
        expect(CHARACTER_MOVEMENT_SOURCE).toMatch(/private\s+readonly\s+_tempRotation\s*=\s*new\s+Quat\(\)/);
    });
});
