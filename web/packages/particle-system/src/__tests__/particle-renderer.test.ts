import { Camera3D } from '@axrone/geometry';
import { describe, expect, it } from 'vitest';
import { ParticleSystemRenderer, BlendMode, CullMode } from '../particle-renderer';
import { ParticleSOA } from '../particle-soa';
import { SortMode } from '../types';

const createMaterial = () => ({
    id: 'particle-material',
    shader: {
        id: 'particle-shader',
        vertexSource: '',
        fragmentSource: '',
        uniforms: {},
        attributes: {},
    },
    blendMode: BlendMode.Alpha,
    sortMode: SortMode.Distance,
    priority: 0,
    cullMode: CullMode.None,
    depthTest: true,
    depthWrite: false,
    properties: {},
});

describe('ParticleSystemRenderer', () => {
    it('accepts Camera3D as a frustum source for particle culling', () => {
        const renderer = new ParticleSystemRenderer(8);
        const particles = new ParticleSOA({ capacity: 8, autoResize: false });
        const material = createMaterial();
        const camera = Camera3D.perspective({
            id: 'camera:particles',
            projection: {
                kind: 'perspective',
                verticalFieldOfView: Math.PI / 3,
                aspectRatio: 1,
                near: 0.1,
                far: 50,
            },
            pose: {
                position: [0, 0, 0],
                target: [0, 0, -1],
            },
        });

        (particles as unknown as { _initializeFreeList(): void })._initializeFreeList();
        particles.addParticle({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 0 }, 5, 1);
        particles.addParticle({ x: 18, y: 0, z: -3 }, { x: 0, y: 0, z: 0 }, 5, 1);

        renderer.updateFrustum(camera);
        renderer.createRenderBatches(particles, [material]);

        expect(renderer.getStats().renderedParticles).toBe(1);
    });
});