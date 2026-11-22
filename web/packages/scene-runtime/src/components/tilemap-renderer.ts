import { Component, script } from '@axrone/ecs-runtime';
import { Color, type IColorLike } from '@axrone/numeric';

export type TilemapRendererTint = Color | Readonly<IColorLike> | readonly number[];

export interface TilemapRendererConfig {
    readonly mapId?: string;
    readonly tilesetId?: string;
    readonly visibleLayers?: readonly string[] | null;
    readonly sortingLayer?: number;
    readonly renderOrder?: number;
    /** Chunk prefetch radius around the camera, in chunks. */
    readonly chunkWindow?: number;
    readonly tint?: TilemapRendererTint;
    readonly visible?: boolean;
}

const toColor = (value: TilemapRendererTint | undefined): Color => {
    if (value === undefined) return Color.WHITE;
    if (value instanceof Color) return Color.from(value);
    if (Array.isArray(value)) return Color.fromArray(value);
    return Color.from(value as Readonly<IColorLike>);
};

/**
 * Opt-in component that binds an actor to a `TilemapRuntime` map. It stores
 * only stable IDs and presentation settings; map data and chunk streaming live
 * in the runtime, not in the component.
 */
@script({
    scriptName: 'TilemapRenderer',
    priority: 100,
    executeInEditMode: true,
    singleton: false,
    trackInstances: false,
})
export class TilemapRenderer extends Component {
    #mapId = '';
    #tilesetId = '';
    #visibleLayers: readonly string[] | null = null;
    #sortingLayer = 0;
    #renderOrder = 0;
    #chunkWindow = 2;
    #tint = Color.WHITE;
    #visible = true;

    constructor(config: TilemapRendererConfig = {}) {
        super();
        this.#mapId = config.mapId ?? '';
        this.#tilesetId = config.tilesetId ?? '';
        this.#visibleLayers =
            config.visibleLayers === undefined || config.visibleLayers === null
                ? null
                : Object.freeze([...config.visibleLayers]);
        this.#sortingLayer = config.sortingLayer ?? 0;
        this.#renderOrder = config.renderOrder ?? 0;
        this.#chunkWindow = Math.max(0, Math.trunc(config.chunkWindow ?? 2));
        this.#tint = toColor(config.tint);
        this.#visible = config.visible ?? true;
    }

    get mapId(): string {
        return this.#mapId;
    }

    set mapId(value: string) {
        if (this.#mapId === value) return;
        this.#mapId = value;
        this.touch();
    }

    get tilesetId(): string {
        return this.#tilesetId;
    }

    set tilesetId(value: string) {
        if (this.#tilesetId === value) return;
        this.#tilesetId = value;
        this.touch();
    }

    get visibleLayers(): readonly string[] | null {
        return this.#visibleLayers;
    }

    set visibleLayers(value: readonly string[] | null) {
        const next = value === null ? null : Object.freeze([...value]);
        if (
            this.#visibleLayers === next ||
            (this.#visibleLayers !== null &&
                next !== null &&
                this.#visibleLayers.length === next.length &&
                this.#visibleLayers.every((name, index) => name === next[index]))
        ) {
            return;
        }
        this.#visibleLayers = next;
        this.touch();
    }

    get sortingLayer(): number {
        return this.#sortingLayer;
    }

    set sortingLayer(value: number) {
        if (this.#sortingLayer === value) return;
        this.#sortingLayer = value;
        this.touch();
    }

    get renderOrder(): number {
        return this.#renderOrder;
    }

    set renderOrder(value: number) {
        if (this.#renderOrder === value) return;
        this.#renderOrder = value;
        this.touch();
    }

    get chunkWindow(): number {
        return this.#chunkWindow;
    }

    set chunkWindow(value: number) {
        const next = Math.max(0, Math.trunc(value));
        if (this.#chunkWindow === next) return;
        this.#chunkWindow = next;
        this.touch();
    }

    get tint(): Color {
        return this.#tint;
    }

    set tint(value: TilemapRendererTint) {
        this.#tint = toColor(value);
        this.touch();
    }

    get visible(): boolean {
        return this.#visible;
    }

    set visible(value: boolean) {
        if (this.#visible === value) return;
        this.#visible = value;
        this.touch();
    }

    override serialize(): Record<string, unknown> {
        return {
            mapId: this.#mapId,
            tilesetId: this.#tilesetId,
            visibleLayers:
                this.#visibleLayers === null ? null : [...this.#visibleLayers],
            sortingLayer: this.#sortingLayer,
            renderOrder: this.#renderOrder,
            chunkWindow: this.#chunkWindow,
            tint: [
                this.#tint.r,
                this.#tint.g,
                this.#tint.b,
                this.#tint.a,
            ],
            visible: this.#visible,
        };
    }

    override deserialize(data: Record<string, unknown>): void {
        if (typeof data.mapId === 'string') this.#mapId = data.mapId;
        if (typeof data.tilesetId === 'string') this.#tilesetId = data.tilesetId;
        if (data.visibleLayers === null) {
            this.#visibleLayers = null;
        } else if (Array.isArray(data.visibleLayers)) {
            this.#visibleLayers = Object.freeze(
                data.visibleLayers.filter(
                    (entry): entry is string => typeof entry === 'string'
                )
            );
        }
        if (typeof data.sortingLayer === 'number') {
            this.#sortingLayer = data.sortingLayer;
        }
        if (typeof data.renderOrder === 'number') {
            this.#renderOrder = data.renderOrder;
        }
        if (typeof data.chunkWindow === 'number') {
            this.#chunkWindow = Math.max(0, Math.trunc(data.chunkWindow));
        }
        if (Array.isArray(data.tint) && data.tint.length >= 4) {
            this.#tint = Color.fromArray(data.tint as number[]);
        }
        if (typeof data.visible === 'boolean') this.#visible = data.visible;
        this.touch();
    }
}
