import { SceneMeshError } from './errors';
import type { SceneMeshResource } from './mesh-registry';
import { SCENE_ATTRIBUTE_LOCATIONS } from './scene-vertex-layout';
import type { SceneMeshDefinition, SceneMeshSemantic, SceneMeshTopology } from './types';

const mapTopologyToMode = (gl: WebGL2RenderingContext, topology: SceneMeshTopology): number => {
    switch (topology) {
        case 'lines':
            return gl.LINES;
        case 'points':
            return gl.POINTS;
        case 'triangles':
        default:
            return gl.TRIANGLES;
    }
};

export interface SceneMeshFactoryOptions {
    readonly gl: WebGL2RenderingContext;
}

export class SceneMeshFactory {
    constructor(private readonly _options: SceneMeshFactoryOptions) {}

    create(definition: SceneMeshDefinition): SceneMeshResource {
        if (definition.attributes.length === 0) {
            throw new SceneMeshError(`Mesh '${definition.id}' must define at least one attribute`);
        }

        const vao = this._options.gl.createVertexArray();
        const vertexBuffer = this._options.gl.createBuffer();

        if (!vao || !vertexBuffer) {
            throw new SceneMeshError(`Failed to allocate mesh resources for '${definition.id}'`);
        }

        const usage = definition.usage ?? this._options.gl.STATIC_DRAW;
        this._options.gl.bindVertexArray(vao);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, vertexBuffer);
        this._options.gl.bufferData(this._options.gl.ARRAY_BUFFER, definition.vertices, usage);

        const attributes = new Set<SceneMeshSemantic>();
        for (let index = 0; index < definition.attributes.length; index += 1) {
            const attribute = definition.attributes[index]!;
            attributes.add(attribute.semantic);
            const location = SCENE_ATTRIBUTE_LOCATIONS[attribute.semantic];
            this._options.gl.enableVertexAttribArray(location);
            const attributeType = attribute.type ?? this._options.gl.FLOAT;
            if (attribute.integer && typeof this._options.gl.vertexAttribIPointer === 'function') {
                this._options.gl.vertexAttribIPointer(
                    location,
                    attribute.componentCount,
                    attributeType,
                    attribute.stride,
                    attribute.offset
                );
            } else {
                this._options.gl.vertexAttribPointer(
                    location,
                    attribute.componentCount,
                    attributeType,
                    attribute.normalized ?? false,
                    attribute.stride,
                    attribute.offset
                );
            }
        }

        let indexBuffer: WebGLBuffer | null = null;
        let indexCount = 0;
        let indexType: number | null = null;

        if (definition.indices) {
            indexBuffer = this._options.gl.createBuffer();
            if (!indexBuffer) {
                throw new SceneMeshError(
                    `Failed to create index buffer for mesh '${definition.id}'`
                );
            }

            this._options.gl.bindBuffer(this._options.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            this._options.gl.bufferData(
                this._options.gl.ELEMENT_ARRAY_BUFFER,
                definition.indices,
                usage
            );
            indexCount = definition.indices.length;
            indexType =
                definition.indices instanceof Uint32Array
                    ? this._options.gl.UNSIGNED_INT
                    : definition.indices instanceof Uint8Array
                      ? this._options.gl.UNSIGNED_BYTE
                      : this._options.gl.UNSIGNED_SHORT;
        }

        this._options.gl.bindVertexArray(null);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, null);
        this._options.gl.bindBuffer(this._options.gl.ELEMENT_ARRAY_BUFFER, null);

        const stride = definition.attributes[0]!.stride;
        const byteLength = definition.vertices.byteLength;
        const vertexCount = definition.vertexCount ?? Math.floor(byteLength / stride);
        const topology = definition.topology ?? 'triangles';

        return {
            id: definition.id,
            vertexArray: vao,
            vertexBuffer,
            indexBuffer,
            vertexCount,
            indexCount,
            indexType,
            topology,
            mode: mapTopologyToMode(this._options.gl, topology),
            attributes,
        };
    }

    dispose(mesh: SceneMeshResource): void {
        this._options.gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.indexBuffer) {
            this._options.gl.deleteBuffer(mesh.indexBuffer);
        }
        this._options.gl.deleteVertexArray(mesh.vertexArray);
    }

    applyMissingVertexAttributeDefaults(mesh: Pick<SceneMeshResource, 'attributes'>): void {
        if (
            !mesh.attributes.has('joints0') &&
            typeof this._options.gl.vertexAttribI4ui === 'function'
        ) {
            this._options.gl.vertexAttribI4ui(SCENE_ATTRIBUTE_LOCATIONS.joints0, 0, 0, 0, 0);
        }
    }
}
