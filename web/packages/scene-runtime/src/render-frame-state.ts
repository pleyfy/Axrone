import type { SceneMeshResource } from './mesh-registry';

export class SceneRenderFrameState {
    private readonly _activeRendererIds = new Set<string>();
    private _frame = 0;
    private _drawCalls = 0;
    private _trianglesSubmitted = 0;

    begin(frame: number): this {
        this._frame = frame;
        this._drawCalls = 0;
        this._trianglesSubmitted = 0;
        this._activeRendererIds.clear();
        return this;
    }

    markActiveRenderer(rendererId: string): void {
        this._activeRendererIds.add(rendererId);
    }

    recordDraw(mesh: Pick<SceneMeshResource, 'topology' | 'indexCount' | 'vertexCount'>): void {
        this._drawCalls += 1;

        if (mesh.topology !== 'triangles') {
            return;
        }

        if (mesh.indexCount > 0) {
            this._trianglesSubmitted += Math.floor(mesh.indexCount / 3);
            return;
        }

        this._trianglesSubmitted += Math.floor(mesh.vertexCount / 3);
    }

    recordTriangles(triangleCount: number, drawCalls: number = 1): void {
        this._drawCalls += Math.max(0, Math.floor(drawCalls));
        this._trianglesSubmitted += Math.max(0, Math.floor(triangleCount));
    }

    get frame(): number {
        return this._frame;
    }

    get drawCalls(): number {
        return this._drawCalls;
    }

    get trianglesSubmitted(): number {
        return this._trianglesSubmitted;
    }

    get activeRendererIds(): ReadonlySet<string> {
        return this._activeRendererIds;
    }
}
