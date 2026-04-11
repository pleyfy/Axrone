import { Mat4 } from '@axrone/numeric';
import { ObjectPool } from '@axrone/utility';
import { IBatchable, IBatchGroup } from './interfaces';
import { IMaterialInstance } from '../shader/interfaces';
import { IBuffer, createBufferFactory } from '../buffer';

interface InstanceData {
    worldMatrix: Float32Array;
    color: Float32Array;
    customData: Float32Array;
}

export class BatchGroup implements IBatchGroup {
    readonly id: string;
    readonly material: IMaterialInstance;
    readonly maxInstances: number;
    readonly isDynamic: boolean;

    private readonly gl: WebGL2RenderingContext;
    private readonly instancePool: ObjectPool<InstanceData>;
    private readonly instanceMap = new Map<string, IBatchable>();
    private readonly matrixBuffer: IBuffer;
    private readonly colorBuffer: IBuffer;
    private readonly customBuffer: IBuffer;

    private instanceCount = 0;
    private needsUpdate = true;
    private disposed = false;

    constructor(
        gl: WebGL2RenderingContext,
        material: IMaterialInstance,
        maxInstances: number = 1024,
        isDynamic: boolean = false
    ) {
        this.gl = gl;
        this.material = material;
        this.maxInstances = maxInstances;
        this.isDynamic = isDynamic;
        this.id = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        this.instancePool = new ObjectPool<InstanceData>({
            factory: () => ({
                worldMatrix: new Float32Array(16),
                color: new Float32Array(4),
                customData: new Float32Array(4),
            }),
            resetHandler: (data) => {
                data.worldMatrix.fill(0);
                data.color.fill(0);
                data.customData.fill(0);
            },
        });

        const bufferFactory = createBufferFactory(gl);

        this.matrixBuffer = bufferFactory.createBuffer(gl.ARRAY_BUFFER, {
            initialData: new Float32Array(maxInstances * 16),
            usage: isDynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
        });

        this.colorBuffer = bufferFactory.createBuffer(gl.ARRAY_BUFFER, {
            initialData: new Float32Array(maxInstances * 4),
            usage: isDynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
        });

        this.customBuffer = bufferFactory.createBuffer(gl.ARRAY_BUFFER, {
            initialData: new Float32Array(maxInstances * 4),
            usage: isDynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
        });
    }

    get instances(): readonly IBatchable[] {
        return Array.from(this.instanceMap.values());
    }

    get isFull(): boolean {
        return this.instanceCount >= this.maxInstances;
    }

    get isEmpty(): boolean {
        return this.instanceCount === 0;
    }

    get size(): number {
        return this.instanceCount;
    }

    addInstance(instance: IBatchable): boolean {
        if (this.disposed || this.isFull || this.instanceMap.has(instance.id)) {
            return false;
        }

        if (!this.isMaterialCompatible(instance.material)) {
            return false;
        }

        this.instanceMap.set(instance.id, instance);
        this.instanceCount++;
        this.needsUpdate = true;

        return true;
    }

    removeInstance(instanceId: string): boolean {
        if (this.disposed || !this.instanceMap.has(instanceId)) {
            return false;
        }

        this.instanceMap.delete(instanceId);
        this.instanceCount--;
        this.needsUpdate = true;

        return true;
    }

    updateInstance(instanceId: string): void {
        if (this.disposed || !this.instanceMap.has(instanceId)) {
            return;
        }

        this.needsUpdate = true;
    }

    update(): void {
        if (this.disposed || !this.needsUpdate || this.isEmpty) {
            return;
        }

        const matrixData = new Float32Array(this.instanceCount * 16);
        const colorData = new Float32Array(this.instanceCount * 4);
        const customData = new Float32Array(this.instanceCount * 4);

        let index = 0;
        for (const instance of this.instanceMap.values()) {
            if (!instance.visible) continue;

            matrixData.set(instance.worldMatrix.data, index * 16);

            const color =
                (instance.material.getProperty('baseColor') as Float32Array) ||
                new Float32Array([1, 1, 1, 1]);
            colorData.set(color, index * 4);

            const custom =
                (instance.material.getProperty('customData') as Float32Array) ||
                new Float32Array([0, 0, 0, 0]);
            customData.set(custom, index * 4);

            index++;
        }

        this.matrixBuffer.bind();
        this.matrixBuffer.update(matrixData);

        this.colorBuffer.bind();
        this.colorBuffer.update(colorData);

        this.customBuffer.bind();
        this.customBuffer.update(customData);

        this.needsUpdate = false;
    }

    render(viewMatrix: Mat4, projectionMatrix: Mat4): void {
        if (this.disposed || this.isEmpty) {
            return;
        }

        this.update();

        this.material.apply();

        this.material.setProperty('viewMatrix', viewMatrix.data);
        this.material.setProperty('projectionMatrix', projectionMatrix.data);

        this.setupInstanceAttributes();

        this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, this.instanceCount);
    }

    dispose(): void {
        if (this.disposed) return;

        this.matrixBuffer.dispose();
        this.colorBuffer.dispose();
        this.customBuffer.dispose();
        this.instanceMap.clear();

        this.disposed = true;
    }

    private isMaterialCompatible(material: IMaterialInstance): boolean {
        return this.material.shader === material.shader;
    }

    private setupInstanceAttributes(): void {
        const program = this.material.shader.shader.program;

        const matrixLocation = this.gl.getAttribLocation(program, 'instanceMatrix');
        if (matrixLocation !== -1) {
            this.matrixBuffer.bind();
            for (let i = 0; i < 4; i++) {
                const location = matrixLocation + i;
                this.gl.enableVertexAttribArray(location);
                this.gl.vertexAttribPointer(location, 4, this.gl.FLOAT, false, 64, i * 16);
                this.gl.vertexAttribDivisor(location, 1);
            }
        }

        const colorLocation = this.gl.getAttribLocation(program, 'instanceColor');
        if (colorLocation !== -1) {
            this.colorBuffer.bind();
            this.gl.enableVertexAttribArray(colorLocation);
            this.gl.vertexAttribPointer(colorLocation, 4, this.gl.FLOAT, false, 0, 0);
            this.gl.vertexAttribDivisor(colorLocation, 1);
        }

        const customLocation = this.gl.getAttribLocation(program, 'instanceCustom');
        if (customLocation !== -1) {
            this.customBuffer.bind();
            this.gl.enableVertexAttribArray(customLocation);
            this.gl.vertexAttribPointer(customLocation, 4, this.gl.FLOAT, false, 0, 0);
            this.gl.vertexAttribDivisor(customLocation, 1);
        }
    }
}
