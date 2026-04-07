import type { ParticleId, ModuleId } from '../types';
import type { IModule, IParticleBuffer, IParticleData } from '../core/interfaces';
import type { ModuleConfigurationMap, ModuleType } from '../core/configuration';
import { ParticleSystemException } from '../core/error';

export abstract class BaseModule<T extends ModuleType = ModuleType> implements IModule<T> {
    private static _nextId = 1;

    protected readonly _id: ModuleId;
    protected readonly _type: T;
    protected readonly _dependencies: readonly ModuleId[];
    protected _priority: number;
    protected _enabled: boolean;
    protected _configuration: ModuleConfigurationMap[T];
    protected _initialized = false;

    constructor(
        type: T,
        configuration: ModuleConfigurationMap[T],
        priority: number = 0,
        dependencies: readonly ModuleId[] = []
    ) {
        this._id = BaseModule._nextId++ as ModuleId;
        this._type = type;
        this._configuration = configuration;
        this._priority = priority;
        this._enabled = configuration.enabled;
        this._dependencies = dependencies;
    }

    get id(): ModuleId {
        return this._id;
    }
    get type(): T {
        return this._type;
    }
    get priority(): number {
        return this._priority;
    }
    get enabled(): boolean {
        return this._enabled;
    }
    get dependencies(): readonly ModuleId[] {
        return this._dependencies;
    }

    initialize(): void {
        if (this._initialized) return;

        try {
            this.onInitialize();
            this._initialized = true;
        } catch (error) {
            throw ParticleSystemException.invalidConfiguration(
                `Failed to initialize module ${this._type}: ${error}`
            );
        }
    }

    destroy(): void {
        if (!this._initialized) return;

        try {
            this.onDestroy();
            this._initialized = false;
        } catch (error) {
            console.warn(`Failed to destroy module ${this._type}:`, error);
        }
    }

    reset(): void {
        if (!this._initialized) return;

        try {
            this.onReset();
        } catch (error) {
            console.warn(`Failed to reset module ${this._type}:`, error);
        }
    }

    update(deltaTime: number): void {
        if (!this._initialized || !this._enabled) return;

        try {
            this.onUpdate(deltaTime);
        } catch (error) {
            console.error(`Module ${this._type} update failed:`, error);
            this._enabled = false;
        }
    }

    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    canProcess(particles: IParticleData): boolean {
        return this._initialized && this._enabled && particles.count > 0;
    }

    process(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.canProcess(particles)) return;

        try {
            this.onProcess(particles, deltaTime);
        } catch (error) {
            console.error(`Module ${this._type} process failed:`, error);
            this._enabled = false;
        }
    }

    configure(config: ModuleConfigurationMap[T]): void {
        const oldConfig = this._configuration;
        this._configuration = { ...config };
        this._enabled = config.enabled;
        this._priority = config.priority;

        try {
            this.onConfigure(config, oldConfig);
        } catch (error) {
            this._configuration = oldConfig;
            throw ParticleSystemException.invalidConfiguration(
                `Failed to configure module ${this._type}: ${error}`
            );
        }
    }

    getConfiguration(): Readonly<ModuleConfigurationMap[T]> {
        return this._configuration;
    }

    protected abstract onInitialize(): void;
    protected abstract onDestroy(): void;
    protected abstract onReset(): void;
    protected abstract onUpdate(deltaTime: number): void;
    protected abstract onProcess(particles: IParticleBuffer, deltaTime: number): void;
    protected abstract onConfigure(
        newConfig: ModuleConfigurationMap[T],
        oldConfig: ModuleConfigurationMap[T]
    ): void;

    protected get config(): Readonly<ModuleConfigurationMap[T]> {
        return this._configuration;
    }

    protected throwIfNotInitialized(): void {
        if (!this._initialized) {
            throw ParticleSystemException.systemNotInitialized(this._id);
        }
    }
}
