import { DeepPartial } from '@axrone/utility';
import { EventEmitter } from '../event/event-emitter';
import {
    SpringConfig,
    SpringEventMap,
    TweenableValue,
    UpdateCallback,
    VoidCallback,
} from './types';

export class SpringSimulation {
    private _mass: number;
    private _stiffness: number;
    private _damping: number;
    private _precision: number;

    constructor(config: SpringConfig = {}) {
        this._mass = config.mass ?? 1;
        this._stiffness = config.stiffness ?? 100;
        this._damping = config.damping ?? 10;
        this._precision = config.precision ?? 0.001;
    }

    update(
        position: number,
        velocity: number,
        target: number,
        dt: number
    ): [number, number, boolean] {
        const displacement = position - target;
        const springForce = -this._stiffness * displacement;
        const dampingForce = -this._damping * velocity;
        const force = springForce + dampingForce;

        const acceleration = force / this._mass;

        const newVelocity = velocity + acceleration * dt;

        const newPosition = position + newVelocity * dt;

        const isAtRest =
            Math.abs(newPosition - target) < this._precision &&
            Math.abs(newVelocity) < this._precision;

        return [newPosition, newVelocity, isAtRest];
    }
}

export class Spring<T extends TweenableValue> extends EventEmitter<SpringEventMap<T>> {
    private _target: T;
    private _current: T;
    private _velocity: Record<string, number> = Object.create(null);
    private _simulation: SpringSimulation;
    private _isRunning = false;
    private _animFrameId?: number;
    private _lastTime?: number;
    private _props = new Set<string>();
    private _autoUpdate = false;

    constructor(initial: T, config: SpringConfig = {}) {
        super();

        this._current = this._deepClone(initial);
        this._target = this._deepClone(initial);
        this._simulation = new SpringSimulation(config);

        const initialVelocity = config.velocity ?? 0;

        if (typeof initial === 'number') {
            this._current = { value: initial } as any;
            this._target = { value: initial } as any;
            this._velocity['value'] = initialVelocity;
            this._props.add('value');
        } else {
            this._collectProps(initial, '', this._props);

            for (const prop of this._props) {
                this._velocity[prop] = initialVelocity;
            }
        }
    }

    setAutoUpdate(enabled: boolean): void {
        this._autoUpdate = enabled;

        if (!enabled && this._animFrameId !== undefined) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = undefined;
        }
    }

    getAutoUpdate(): boolean {
        return this._autoUpdate;
    }

    private _collectProps(obj: any, prefix: string, props: Set<string>): void {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj) || ArrayBuffer.isView(obj)) {
            const length = Array.isArray(obj) ? obj.length : (obj as any).length;
            for (let i = 0; i < length; i++) {
                props.add(prefix ? `${prefix}.${i}` : `${i}`);
            }
        } else {
            for (const key in obj) {
                const value = obj[key];
                const propPath = prefix ? `${prefix}.${key}` : key;

                if (
                    value !== null &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    !ArrayBuffer.isView(value)
                ) {
                    this._collectProps(value, propPath, props);
                } else {
                    props.add(propPath);
                }
            }
        }
    }

    setTarget(target: DeepPartial<T>): this {
        if (typeof target === 'number') {
            this._target = { value: target } as any;
        } else {
            this._updateTarget(this._target, target);
        }

        this._collectProps(target, '', this._props);

        for (const prop of this._props) {
            if (!(prop in this._velocity)) {
                this._velocity[prop] = 0;
            }
        }

        if (!this._isRunning && this._autoUpdate) {
            this.start();
        }

        return this;
    }

    private _updateTarget(current: any, target: any): void {
        if (!target || typeof target !== 'object') return;

        for (const key in target) {
            const value = target[key];

            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                !ArrayBuffer.isView(value)
            ) {
                if (!(key in current)) {
                    current[key] = Array.isArray(value) ? [] : {};
                }
                this._updateTarget(current[key], value);
            } else {
                current[key] = value;
            }
        }
    }

    getCurrent(): T {
        if (
            typeof (this._current as any).value === 'number' &&
            Object.keys(this._current as any).length === 1
        ) {
            return (this._current as any).value;
        }
        return this._deepClone(this._current);
    }

    start(): this {
        if (this._isRunning) {
            return this;
        }

        this._isRunning = true;
        this._lastTime = performance.now();

        if (this._autoUpdate) {
            this._startInternalLoop();
        }

        this.emitSync('start', undefined);

        return this;
    }

    updateManual(deltaTime: number): boolean {
        if (!this._isRunning) return false;

        const dt = Math.min(deltaTime / 1000, 0.064);
        return this._simulateStep(dt);
    }

    stop(): this {
        if (!this._isRunning) {
            return this;
        }

        this._isRunning = false;

        if (this._animFrameId !== undefined) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = undefined;
        }

        this.emitSync('stop', undefined);

        return this;
    }

    onUpdate(callback: UpdateCallback<T>): this {
        this.on('update', callback);
        return this;
    }

    onComplete(callback: VoidCallback): this {
        this.on('complete', callback);
        return this;
    }

    onStart(callback: VoidCallback): this {
        this.on('start', callback);
        return this;
    }

    private _startInternalLoop(): void {
        if (this._animFrameId !== undefined) return;
        this._tick();
    }

    private _simulateStep(dt: number): boolean {
        let allAtRest = true;

        if (typeof this._current === 'number' && typeof this._target === 'number') {
            const [position, velocity, atRest] = this._simulation.update(
                this._current as number,
                this._velocity['value'],
                this._target as number,
                dt
            );

            (this._current as any) = position;
            this._velocity['value'] = velocity;
            allAtRest = atRest;
        } else {
            for (const prop of this._props) {
                const position = this._getPropValue(this._current, prop) ?? 0;
                const target = this._getPropValue(this._target, prop) ?? 0;

                if (typeof position === 'number' && typeof target === 'number') {
                    const [newPosition, newVelocity, atRest] = this._simulation.update(
                        position,
                        this._velocity[prop] ?? 0,
                        target,
                        dt
                    );

                    this._setPropValue(this._current, prop, newPosition);
                    this._velocity[prop] = newVelocity;

                    if (!atRest) {
                        allAtRest = false;
                    }
                }
            }
        }

        this.emitSync('update', this._deepClone(this._current));

        if (allAtRest) {
            this._current = this._deepClone(this._target);

            for (const prop in this._velocity) {
                this._velocity[prop] = 0;
            }

            this._isRunning = false;
            this.emitSync('update', this._deepClone(this._current));
            this.emitSync('complete', undefined);
            return false;
        }

        return true;
    }

    private _tick = (): void => {
        if (!this._isRunning || this._lastTime === undefined || !this._autoUpdate) {
            return;
        }

        const now = performance.now();
        const dt = Math.min((now - this._lastTime) / 1000, 0.064);
        this._lastTime = now;

        const isStillRunning = this._simulateStep(dt);

        if (isStillRunning) {
            this._animFrameId = requestAnimationFrame(this._tick);
        } else {
            this._animFrameId = undefined;
        }
    };

    private _getPropValue(obj: any, path: string): any {
        if (!obj) return undefined;

        if (path === 'value' && typeof obj === 'number') {
            return obj;
        }

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }

        return current;
    }

    private _setPropValue(obj: any, path: string, value: any): void {
        if (!obj) return;

        if (path === 'value' && typeof obj === 'number') {
            (obj as any) = value;
            return;
        }

        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];

            if (current[part] === undefined) {
                const nextPart = parts[i + 1];
                const isArrayIndex = !isNaN(Number(nextPart));
                current[part] = isArrayIndex ? [] : {};
            }

            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        current[lastPart] = value;
    }

    private _deepClone<U>(source: U): U {
        if (source === null || source === undefined || typeof source !== 'object') {
            return source;
        }

        if (Array.isArray(source)) {
            return source.map((item) => this._deepClone(item)) as unknown as U;
        }

        if (ArrayBuffer.isView(source)) {
            const constructor = source.constructor as any;
            return new constructor(source as any) as unknown as U;
        }

        if (source instanceof Date) {
            return new Date(source.getTime()) as unknown as U;
        }

        if (source instanceof Map) {
            const result = new Map();
            source.forEach((value, key) => {
                result.set(key, this._deepClone(value));
            });
            return result as unknown as U;
        }

        if (source instanceof Set) {
            const result = new Set();
            for (const value of source) {
                result.add(this._deepClone(value));
            }
            return result as unknown as U;
        }

        const result = Object.create(null);
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                result[key] = this._deepClone((source as any)[key]);
            }
        }

        return result as U;
    }
}
