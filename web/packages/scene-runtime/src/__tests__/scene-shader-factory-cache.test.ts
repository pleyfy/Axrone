import { describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    installWebGL2Constants,
} from '../../../../tests/shared/test-harness';
import {
    isShaderCacheEntryMatchingSources,
    SceneShaderFactory,
} from '../scene-shader-factory';
import type { SceneShaderDefinition } from '../types';

installWebGL2Constants();

const VERTEX = `attribute vec3 a_Position;
void main() { gl_Position = vec4(a_Position, 1.0); }`;
const FRAGMENT_A = `precision mediump float;
uniform vec4 u_Color;
void main() { gl_FragColor = u_Color; }`;
const FRAGMENT_B = `precision mediump float;
uniform vec4 u_Tint;
void main() { gl_FragColor = u_Tint; }`;

const createGL = () => {
    const gl = createMockGL(document.createElement('canvas')) as unknown as Record<
        string,
        unknown
    >;
    if (gl['blendEquation'] === undefined) {
        gl['blendEquation'] = vi.fn();
    }
    if (gl['getExtension'] === undefined) {
        gl['getExtension'] = vi.fn(() => null);
    }
    return gl as unknown as WebGL2RenderingContext;
};

const createDefinition = (id: string, fragmentSource: string): SceneShaderDefinition =>
    ({
        id,
        vertexSource: VERTEX,
        fragmentSource,
        uniforms: ['u_Color'],
    }) as unknown as SceneShaderDefinition;

describe('isShaderCacheEntryMatchingSources', () => {
    const entry = {
        vertexSource: VERTEX,
        fragmentSource: FRAGMENT_A,
        attributeKey: '{"a":"b"}',
    };

    it('matches identical sources', () => {
        expect(isShaderCacheEntryMatchingSources(entry, VERTEX, FRAGMENT_A, '{"a":"b"}')).toBe(
            true
        );
    });

    it('rejects a differing vertex source', () => {
        expect(
            isShaderCacheEntryMatchingSources(entry, 'other', FRAGMENT_A, '{"a":"b"}')
        ).toBe(false);
    });

    it('rejects a differing fragment source', () => {
        expect(isShaderCacheEntryMatchingSources(entry, VERTEX, FRAGMENT_B, '{"a":"b"}')).toBe(
            false
        );
    });

    it('rejects differing attribute bindings', () => {
        expect(isShaderCacheEntryMatchingSources(entry, VERTEX, FRAGMENT_A, '{"a":"c"}')).toBe(
            false
        );
    });
});

describe('SceneShaderFactory source-verified cache', () => {
    it('reuses the program for identical sources and records a hit', () => {
        const factory = new SceneShaderFactory({ gl: createGL() });

        const first = factory.create(createDefinition('a', FRAGMENT_A));
        const second = factory.create(createDefinition('b', FRAGMENT_A));

        expect(second.program).toBe(first.program);
        expect(factory.stats.cacheHits).toBe(1);
        expect(factory.stats.cacheMisses).toBe(1);

        factory.delete(first);
        factory.delete(second);
    });

    it('compiles a fresh program for differing sources', () => {
        const factory = new SceneShaderFactory({ gl: createGL() });

        const first = factory.create(createDefinition('a', FRAGMENT_A));
        const other = factory.create(createDefinition('c', FRAGMENT_B));

        expect(other.program).not.toBe(first.program);
        expect(factory.stats.cacheHits).toBe(0);
        expect(factory.stats.cacheMisses).toBe(2);

        factory.delete(first);
        factory.delete(other);
    });

    it('shares variant programs compiled from identical injected sources', () => {
        const factory = new SceneShaderFactory({ gl: createGL() });
        const definition = createDefinition('v', FRAGMENT_A);

        const first = factory.createVariant(definition, ['FOG']);
        const second = factory.createVariant(definition, ['FOG']);

        expect(second.program).toBe(first.program);
        expect(factory.stats.cacheHits).toBe(1);

        factory.delete(first);
        factory.delete(second);
    });
});
