import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiEntryConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default createMultiEntryConfig({
    packageDir,
    entries: {
        index: 'src/index.ts',
        buffer: 'src/buffer.ts',
        framebuffer: 'src/framebuffer.ts',
        vao: 'src/vao.ts',
        shader: 'src/shader/index.ts',
        mesh: 'src/mesh/index.ts',
        batch: 'src/batch/index.ts',
        pipeline: 'src/pipeline.ts',
        context: 'src/context/index.ts',
        query: 'src/query.ts',
        sync: 'src/sync.ts',
        'transform-feedback': 'src/transform-feedback.ts',
        'frame-graph': 'src/frame-graph.ts',
        'render-target': 'src/render-target/index.ts',
    },
});
