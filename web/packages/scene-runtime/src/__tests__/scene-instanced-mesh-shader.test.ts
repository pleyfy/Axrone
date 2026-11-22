import { describe, expect, it } from 'vitest';
import {
    SCENE_INSTANCE_COLOR_ATTRIBUTE,
    SCENE_INSTANCE_COLOR_LOCATION,
    SCENE_INSTANCE_MATRIX_ATTRIBUTE,
    SCENE_INSTANCE_MATRIX_LOCATION,
    transformSceneShaderForInstancing,
} from '../rendering/scene-instanced-mesh-shader';

const VERTEX_WITH_COLOR_AGNOSTIC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`;

const FRAGMENT_WITH_COLOR = `#version 300 es
precision highp float;
uniform vec4 u_Color;
out vec4 o_Color;
void main() {
    o_Color = u_Color;
}`;

const FRAGMENT_WITHOUT_COLOR = `#version 300 es
precision highp float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0);
}`;

describe('transformSceneShaderForInstancing', () => {
    it('turns u_Model into a per-instance attribute and forwards u_Color through a varying', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC,
            fragmentSource: FRAGMENT_WITH_COLOR,
        });

        expect(result).not.toBeNull();
        expect(result!.instanceColor).toBe(true);

        // The object uniform becomes the instance attribute, and the shader
        // keeps referencing the `u_Model` token through the transpose macro.
        expect(result!.vertexSource).not.toContain('uniform mat4 u_Model;');
        expect(result!.vertexSource).toContain(
            `layout(location = ${SCENE_INSTANCE_MATRIX_LOCATION}) in mat4 ${SCENE_INSTANCE_MATRIX_ATTRIBUTE};`
        );
        expect(result!.vertexSource).toContain(
            `#define u_Model transpose(${SCENE_INSTANCE_MATRIX_ATTRIBUTE})`
        );
        expect(result!.vertexSource).toContain(
            `layout(location = ${SCENE_INSTANCE_COLOR_LOCATION}) in vec4 ${SCENE_INSTANCE_COLOR_ATTRIBUTE};`
        );
        expect(result!.vertexSource).toContain('out vec4 u_Color;');
        expect(result!.vertexSource).toContain(`u_Color = ${SCENE_INSTANCE_COLOR_ATTRIBUTE};`);

        // The fragment side reads the varying with the original uniform name.
        expect(result!.fragmentSource).not.toContain('uniform vec4 u_Color;');
        expect(result!.fragmentSource).toContain('in vec4 u_Color;');

        // `#version` stays first and declarations follow the precision lines.
        expect(result!.vertexSource.startsWith('#version 300 es')).toBe(true);
        const versionIndex = result!.vertexSource.indexOf('#version 300 es');
        const precisionIndex = result!.vertexSource.indexOf('precision highp float;');
        const declarationIndex = result!.vertexSource.indexOf(
            `layout(location = ${SCENE_INSTANCE_MATRIX_LOCATION})`
        );
        expect(declarationIndex).toBeGreaterThan(precisionIndex);
        expect(precisionIndex).toBeGreaterThan(versionIndex);
    });

    it('instances shaders that do not declare u_Color without a color stream', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC,
            fragmentSource: FRAGMENT_WITHOUT_COLOR,
        });

        expect(result).not.toBeNull();
        expect(result!.instanceColor).toBe(false);
        expect(result!.fragmentSource).toBe(FRAGMENT_WITHOUT_COLOR);
        expect(result!.vertexSource).not.toContain(SCENE_INSTANCE_COLOR_ATTRIBUTE);
    });

    it('rejects shaders without a GLSL ES 3.00 version directive', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC.replace('#version 300 es\n', ''),
            fragmentSource: FRAGMENT_WITH_COLOR,
        });
        expect(result).toBeNull();
    });

    it('rejects shaders without a u_Model uniform', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC.replace('uniform mat4 u_Model;\n', ''),
            fragmentSource: FRAGMENT_WITH_COLOR,
        });
        expect(result).toBeNull();
    });

    it('rejects shaders that bind u_MVP per object', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC.replace(
                'uniform mat4 u_Projection;',
                'uniform mat4 u_Projection;\nuniform mat4 u_MVP;'
            ),
            fragmentSource: FRAGMENT_WITH_COLOR,
        });
        expect(result).toBeNull();
    });

    it('rejects explicit attribute locations that collide with the instance stream', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC.replace(
                'layout(location = 0) in vec3 a_Position;',
                'layout(location = 0) in vec3 a_Position;\nlayout(location = 11) in vec4 a_Extra;'
            ),
            fragmentSource: FRAGMENT_WITH_COLOR,
        });
        expect(result).toBeNull();
    });

    it('rejects a non-vec4 u_Color declaration', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC,
            fragmentSource: FRAGMENT_WITH_COLOR.replace(
                'uniform vec4 u_Color;',
                'uniform vec3 u_Color;'
            ),
        });
        expect(result).toBeNull();
    });

    it('rejects sources that already declare u_Color in the vertex stage', () => {
        const result = transformSceneShaderForInstancing({
            vertexSource: VERTEX_WITH_COLOR_AGNOSTIC.replace(
                'uniform mat4 u_Projection;',
                'uniform mat4 u_Projection;\nuniform vec4 u_Color;'
            ),
            fragmentSource: FRAGMENT_WITH_COLOR,
        });
        expect(result).toBeNull();
    });
});
