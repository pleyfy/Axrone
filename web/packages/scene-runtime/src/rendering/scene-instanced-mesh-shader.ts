import type { SceneShaderDefinition } from '../types';

/**
 * Per-instance mesh streams derived from an existing shader pair.
 *
 * The derived program keeps the original shader source intact except for two
 * surgical edits:
 *
 *  - the object matrix uniform (`u_Model`) becomes a per-instance attribute,
 *  - the per-object color uniform (`u_Color`, when declared) becomes a
 *    per-instance attribute forwarded through a matching varying.
 *
 * Everything else (camera uniforms, material uniforms, sampling, precision)
 * compiles exactly as before, so a group draw produces the same fragment work
 * as the individual path. Transformations are all-or-nothing: any source shape
 * this module does not recognise returns `null` and the caller falls back to
 * the individual draw path instead of guessing.
 */

/**
 * Base vertex attribute location of the per-instance mat4 stream. Scene meshes
 * occupy locations 0..10 (`SCENE_ATTRIBUTE_LOCATIONS`), so 11..14 are free and
 * 15 carries the instance color.
 */
export const SCENE_INSTANCE_MATRIX_LOCATION = 11;
export const SCENE_INSTANCE_COLOR_LOCATION = 15;
export const SCENE_INSTANCE_COLOR_ATTRIBUTE = 'a_InstanceColor';
/**
 * Raw instance-matrix attribute name.
 *
 * The stream is uploaded in the engine's native row-major `Mat4` order (a
 * single bulk copy), and the shader macro below transposes it per vertex.
 * `transpose()` is core GLSL ES 3.00 and costs a few ALU ops, which is far
 * cheaper than permuting 16 floats per instance on the CPU every frame.
 */
export const SCENE_INSTANCE_MATRIX_ATTRIBUTE = 'ax_InstanceModel';

export interface SceneInstancedShaderSources {
    readonly vertexSource: string;
    readonly fragmentSource: string;
    /** True when the fragment shader sampled `u_Color` and it was rewritten. */
    readonly instanceColor: boolean;
}

const VERSION_PATTERN = /^\s*#version\s+300\s+es\s*$/m;
const MODEL_UNIFORM_PATTERN =
    /^[ \t]*(?:uniform[ \t]+)(?:(?:lowp|mediump|highp)[ \t]+)?mat4[ \t]+u_Model[ \t]*;[ \t]*$/gm;
const COLOR_UNIFORM_PATTERN = /^[ \t]*uniform[ \t]+vec4[ \t]+u_Color[ \t]*;[ \t]*$/m;
const OTHER_COLOR_UNIFORM_PATTERN = /\buniform\s+\w+\s+u_Color\b/;
const VERTEX_COLOR_DECLARATION_PATTERN = /\b(?:uniform|in|out|attribute|varying)\s+\w+\s+u_Color\b/;
const FRAGMENT_COLOR_VARYING_PATTERN = /\b(?:in|out)\s+\w+\s+u_Color\b/;
const MVP_UNIFORM_PATTERN = /\buniform\s+\w+\s+u_MVP\b/;
const FRAGMENT_MAIN_PATTERN = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/;
const LAYOUT_LOCATION_PATTERN = /layout\s*\(\s*location\s*=\s*(\d+)\s*\)/g;
const PRECISION_LINE_PATTERN = /^[ \t]*precision[ \t]+\w+[ \t]+\w+[ \t]*;[ \t]*$/;

const countMatches = (source: string, pattern: RegExp): number => {
    const matcher = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    );
    let count = 0;
    while (matcher.exec(source) !== null) {
        count += 1;
    }
    return count;
};

/** Index just past the `#version` line and any leading precision statements. */
const findPreambleEnd = (source: string): number => {
    const versionMatch = VERSION_PATTERN.exec(source);
    if (!versionMatch) {
        return -1;
    }

    let cursor = versionMatch.index + versionMatch[0].length;
    for (;;) {
        // Skip the rest of the version line, then blank lines.
        const newline = source.indexOf('\n', cursor);
        if (newline === -1) {
            return source.length;
        }
        cursor = newline + 1;

        const nextLine = source.slice(
            cursor,
            source.indexOf('\n', cursor) === -1 ? source.length : source.indexOf('\n', cursor)
        );
        if (PRECISION_LINE_PATTERN.test(nextLine)) {
            cursor += nextLine.length;
            continue;
        }
        return cursor;
    }
};

/**
 * Rewrites a shader pair so `u_Model` / `u_Color` read from per-instance
 * attributes. Returns `null` when the sources do not match the supported shape.
 */
export const transformSceneShaderForInstancing = (
    definition: Pick<SceneShaderDefinition, 'vertexSource' | 'fragmentSource'>
): SceneInstancedShaderSources | null => {
    const vertexSource = definition.vertexSource;
    const fragmentSource = definition.fragmentSource;
    if (!vertexSource || !fragmentSource) {
        return null;
    }

    // GLSL ES 3.00 only: `layout(location=)` and `in`/`out` attributes are
    // required for the derived program, so a GLSL ES 1.00 pair is unsupported.
    if (!VERSION_PATTERN.test(vertexSource) || !VERSION_PATTERN.test(fragmentSource)) {
        return null;
    }

    if (countMatches(vertexSource, new RegExp(MODEL_UNIFORM_PATTERN.source, 'm')) !== 1) {
        return null;
    }

    // The frame binder writes `u_MVP` from the object matrix before the draw;
    // an instanced program cannot honour a per-object uniform, so bail out.
    if (MVP_UNIFORM_PATTERN.test(vertexSource)) {
        return null;
    }

    if (VERTEX_COLOR_DECLARATION_PATTERN.test(vertexSource)) {
        return null;
    }

    // Instance attributes own locations 11..15. A shader that pins an attribute
    // in that range would collide with them.
    LAYOUT_LOCATION_PATTERN.lastIndex = 0;
    let match = LAYOUT_LOCATION_PATTERN.exec(vertexSource);
    while (match !== null) {
        if (Number(match[1]) >= SCENE_INSTANCE_MATRIX_LOCATION) {
            return null;
        }
        match = LAYOUT_LOCATION_PATTERN.exec(vertexSource);
    }

    const fragmentDeclaresColorUniform = COLOR_UNIFORM_PATTERN.test(fragmentSource);
    if (!fragmentDeclaresColorUniform && OTHER_COLOR_UNIFORM_PATTERN.test(fragmentSource)) {
        // `u_Color` exists but is not a `vec4` uniform: leave it alone, the
        // per-instance color stream would not match its type.
        return null;
    }
    if (fragmentDeclaresColorUniform && FRAGMENT_COLOR_VARYING_PATTERN.test(fragmentSource)) {
        return null;
    }

    let derivedVertex = vertexSource.replace(
        MODEL_UNIFORM_PATTERN,
        `layout(location = ${SCENE_INSTANCE_MATRIX_LOCATION}) in mat4 ${SCENE_INSTANCE_MATRIX_ATTRIBUTE};
#define u_Model transpose(${SCENE_INSTANCE_MATRIX_ATTRIBUTE})`
    );
    let derivedFragment = fragmentSource;

    if (fragmentDeclaresColorUniform) {
        const preambleEnd = findPreambleEnd(derivedVertex);
        if (preambleEnd < 0) {
            return null;
        }
        const mainMatch = FRAGMENT_MAIN_PATTERN.exec(derivedVertex);
        if (!mainMatch) {
            return null;
        }

        const declaration = `layout(location = ${SCENE_INSTANCE_COLOR_LOCATION}) in vec4 ${SCENE_INSTANCE_COLOR_ATTRIBUTE};\nout vec4 u_Color;\n`;
        derivedVertex =
            derivedVertex.slice(0, preambleEnd) + declaration + derivedVertex.slice(preambleEnd);

        // Recompute the main offset: declarations were inserted before it.
        const shiftedMain = FRAGMENT_MAIN_PATTERN.exec(derivedVertex);
        if (!shiftedMain) {
            return null;
        }
        const insertAt = shiftedMain.index + shiftedMain[0].length;
        derivedVertex =
            derivedVertex.slice(0, insertAt) +
            `\n    u_Color = ${SCENE_INSTANCE_COLOR_ATTRIBUTE};` +
            derivedVertex.slice(insertAt);

        derivedFragment = derivedFragment.replace(COLOR_UNIFORM_PATTERN, 'in vec4 u_Color;');
    }

    return {
        vertexSource: derivedVertex,
        fragmentSource: derivedFragment,
        instanceColor: fragmentDeclaresColorUniform,
    };
};
