import { 
    BaseMaterialComponent, 
    MaterialType, 
    MaterialConfig,
    MaterialPropertyValue
} from './base-material';
import { StandardMaterialComponent } from './standard-material';
import { PBRMaterialComponent } from './pbr-material';

export type MaterialConstructor<T extends MaterialConfig = MaterialConfig> = new (config: T) => BaseMaterialComponent<T>;

export interface MaterialFactoryEntry {
    readonly type: MaterialType;
    readonly constructor: MaterialConstructor;
    readonly defaultConfig: MaterialConfig;
    readonly description: string;
}

export interface MaterialEvents {
    materialCreated: { material: BaseMaterialComponent; type: MaterialType };
    materialDestroyed: { materialId: string; type: MaterialType };
    materialModified: { material: BaseMaterialComponent; property: string; value: MaterialPropertyValue };
    materialCloned: { original: BaseMaterialComponent; clone: BaseMaterialComponent };
}

export type MaterialEventListener<T extends keyof MaterialEvents = keyof MaterialEvents> = (
    event: MaterialEvents[T]
) => void;

export class MaterialManager {
    private static _instance: MaterialManager | null = null;
    private readonly _materials = new Map<string, BaseMaterialComponent>();
    private readonly _materialsByType = new Map<MaterialType, Set<BaseMaterialComponent>>();
    private readonly _factory = new Map<MaterialType, MaterialFactoryEntry>();
    private readonly _eventListeners = new Map<keyof MaterialEvents, Set<MaterialEventListener>>();
    private readonly _resourceTracker = new Map<string, number>(); 
    private readonly _cacheTimeout: number = 60000; 
    private readonly _cleanupInterval: NodeJS.Timeout;

    private constructor() {
        this._registerBuiltInMaterials();
        this._cleanupInterval = setInterval(() => this._performCleanup(), this._cacheTimeout);
    }

    public static getInstance(): MaterialManager {
        if (!MaterialManager._instance) {
            MaterialManager._instance = new MaterialManager();
        }
        return MaterialManager._instance;
    }

    public static destroy(): void {
        if (MaterialManager._instance) {
            MaterialManager._instance._cleanup();
            MaterialManager._instance = null;
        }
    }

    public registerMaterialType<T extends MaterialConfig>(
        type: MaterialType,
        constructor: MaterialConstructor<T>,
        defaultConfig: T,
        description: string = ''
    ): void {
        if (this._factory.has(type)) {
            console.warn(`Material type ${type} is already registered. Overwriting...`);
        }

        this._factory.set(type, {
            type,
            constructor: constructor as MaterialConstructor,
            defaultConfig,
            description
        });

        console.log(`✅ Material type '${type}' registered successfully`);
    }

    public unregisterMaterialType(type: MaterialType): boolean {
        if (!this._factory.has(type)) {
            console.warn(`Material type ${type} is not registered`);
            return false;
        }

        const materials = this._materialsByType.get(type);
        if (materials) {
            for (const material of materials) {
                this.destroyMaterial(material.id);
            }
        }

        this._factory.delete(type);
        this._materialsByType.delete(type);

        console.log(`✅ Material type '${type}' unregistered successfully`);
        return true;
    }

    public getRegisteredTypes(): MaterialType[] {
        return Array.from(this._factory.keys());
    }

    public getTypeInfo(type: MaterialType): MaterialFactoryEntry | null {
        return this._factory.get(type) || null;
    }

    public createMaterial<T extends MaterialConfig>(
        type: MaterialType,
        config: Partial<T> = {}
    ): BaseMaterialComponent<T> | null {
        const factoryEntry = this._factory.get(type);
        if (!factoryEntry) {
            console.error(`Material type ${type} is not registered`);
            return null;
        }

        try {

            const finalConfig = { 
                ...factoryEntry.defaultConfig, 
                ...config,
                materialType: type
            } as T;

            const material = new factoryEntry.constructor(finalConfig) as BaseMaterialComponent<T>;

            this._materials.set(material.id, material);

            if (!this._materialsByType.has(type)) {
                this._materialsByType.set(type, new Set());
            }
            this._materialsByType.get(type)!.add(material);

            this._resourceTracker.set(material.id, 1);

            this._emitEvent('materialCreated', { material, type });

            console.log(`✅ Material '${material.id}' of type '${type}' created successfully`);
            return material;

        } catch (error) {
            console.error(`❌ Failed to create material of type ${type}:`, error);
            return null;
        }
    }

    public getMaterial(id: string): BaseMaterialComponent | null {
        return this._materials.get(id) || null;
    }

    public getAllMaterials(): BaseMaterialComponent[] {
        return Array.from(this._materials.values());
    }

    public getMaterialsByType(type: MaterialType): BaseMaterialComponent[] {
        const materials = this._materialsByType.get(type);
        return materials ? Array.from(materials) : [];
    }

    public destroyMaterial(id: string): boolean {
        const material = this._materials.get(id);
        if (!material) {
            console.warn(`Material ${id} not found`);
            return false;
        }

        try {

            const refCount = this._resourceTracker.get(id) || 0;
            if (refCount > 1) {
                console.warn(`Material ${id} still has ${refCount} references. Force destroying...`);
            }

            this._materials.delete(id);
            this._resourceTracker.delete(id);

            const typeSet = this._materialsByType.get(material.materialType);
            if (typeSet) {
                typeSet.delete(material);
                if (typeSet.size === 0) {
                    this._materialsByType.delete(material.materialType);
                }
            }

            material.onDestroy();

            this._emitEvent('materialDestroyed', { 
                materialId: id, 
                type: material.materialType 
            });

            console.log(`✅ Material '${id}' destroyed successfully`);
            return true;

        } catch (error) {
            console.error(`❌ Failed to destroy material ${id}:`, error);
            return false;
        }
    }

    public cloneMaterial(id: string, newId?: string): BaseMaterialComponent | null {
        const original = this._materials.get(id);
        if (!original) {
            console.error(`Material ${id} not found for cloning`);
            return null;
        }

        try {

            const clone = original.clone();

            if (newId) {

                (clone as any)._id = newId;
            }

            this._materials.set(clone.id, clone);

            const typeSet = this._materialsByType.get(clone.materialType);
            if (typeSet) {
                typeSet.add(clone);
            }

            this._resourceTracker.set(clone.id, 1);

            this._emitEvent('materialCloned', { original, clone });

            console.log(`✅ Material '${id}' cloned successfully as '${clone.id}'`);
            return clone;

        } catch (error) {
            console.error(`❌ Failed to clone material ${id}:`, error);
            return null;
        }
    }

    public addReference(id: string): boolean {
        if (!this._materials.has(id)) {
            console.warn(`Cannot add reference to non-existent material ${id}`);
            return false;
        }

        const currentCount = this._resourceTracker.get(id) || 0;
        this._resourceTracker.set(id, currentCount + 1);
        return true;
    }

    public removeReference(id: string): boolean {
        if (!this._materials.has(id)) {
            console.warn(`Cannot remove reference from non-existent material ${id}`);
            return false;
        }

        const currentCount = this._resourceTracker.get(id) || 0;
        if (currentCount <= 1) {

            console.log(`Material ${id} has no more references - eligible for cleanup`);
            this._resourceTracker.set(id, 0);
            return false;
        }

        this._resourceTracker.set(id, currentCount - 1);
        return true;
    }

    public getReferenceCount(id: string): number {
        return this._resourceTracker.get(id) || 0;
    }

    public addEventListener<T extends keyof MaterialEvents>(
        event: T,
        listener: MaterialEventListener<T>
    ): void {
        if (!this._eventListeners.has(event)) {
            this._eventListeners.set(event, new Set());
        }
        this._eventListeners.get(event)!.add(listener as MaterialEventListener);
    }

    public removeEventListener<T extends keyof MaterialEvents>(
        event: T,
        listener: MaterialEventListener<T>
    ): void {
        const listeners = this._eventListeners.get(event);
        if (listeners) {
            listeners.delete(listener as MaterialEventListener);
        }
    }

    private _emitEvent<T extends keyof MaterialEvents>(
        event: T,
        data: MaterialEvents[T]
    ): void {
        const listeners = this._eventListeners.get(event);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`Error in material event listener for ${event}:`, error);
                }
            }
        }
    }

    public getStatistics(): {
        totalMaterials: number;
        materialsByType: Record<MaterialType, number>;
        totalReferences: number;
        memoryUsage: number;
    } {
        const materialsByType: Record<MaterialType, number> = {} as any;

        for (const [type, materials] of this._materialsByType) {
            materialsByType[type] = materials.size;
        }

        const totalReferences = Array.from(this._resourceTracker.values())
            .reduce((sum, count) => sum + count, 0);

        const memoryUsage = this._materials.size * 1024; 

        return {
            totalMaterials: this._materials.size,
            materialsByType,
            totalReferences,
            memoryUsage
        };
    }

    public findMaterialsByProperty(
        propertyName: string, 
        value?: MaterialPropertyValue
    ): BaseMaterialComponent[] {
        const results: BaseMaterialComponent[] = [];

        for (const material of this._materials.values()) {
            if (material.hasProperty(propertyName)) {
                if (value === undefined || material.getProperty(propertyName) === value) {
                    results.push(material);
                }
            }
        }

        return results;
    }

    public findMaterialsByKeyword(keyword: string): BaseMaterialComponent[] {
        const results: BaseMaterialComponent[] = [];

        for (const material of this._materials.values()) {
            if (material.hasKeyword(keyword)) {
                results.push(material);
            }
        }

        return results;
    }

    private _registerBuiltInMaterials(): void {

        this.registerMaterialType(
            MaterialType.STANDARD,
            StandardMaterialComponent,
            { materialType: MaterialType.STANDARD },
            'Unity-style Standard PBR Material'
        );

        this.registerMaterialType(
            MaterialType.PBR,
            PBRMaterialComponent,
            { materialType: MaterialType.PBR },
            'glTF 2.0 compatible PBR Material'
        );

        console.log('✅ Built-in material types registered');
    }

    private _performCleanup(): void {
        let cleanedCount = 0;

        for (const [id, refCount] of this._resourceTracker) {
            if (refCount === 0) {
                this.destroyMaterial(id);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} unused materials`);
        }
    }

    private _cleanup(): void {

        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
        }

        for (const id of this._materials.keys()) {
            this.destroyMaterial(id);
        }

        this._materials.clear();
        this._materialsByType.clear();
        this._factory.clear();
        this._eventListeners.clear();
        this._resourceTracker.clear();

        console.log('✅ Material Manager cleaned up');
    }
}

export function createMaterial<T extends MaterialConfig>(
    type: MaterialType,
    config: Partial<T> = {}
): BaseMaterialComponent<T> | null {
    return MaterialManager.getInstance().createMaterial(type, config);
}

export function getMaterial(id: string): BaseMaterialComponent | null {
    return MaterialManager.getInstance().getMaterial(id);
}

export function destroyMaterial(id: string): boolean {
    return MaterialManager.getInstance().destroyMaterial(id);
}

export function cloneMaterial(id: string, newId?: string): BaseMaterialComponent | null {
    return MaterialManager.getInstance().cloneMaterial(id, newId);
}

export const materialManager = MaterialManager.getInstance();