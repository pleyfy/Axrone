import { Component, script } from '@axrone/ecs-runtime';

export interface TilemapAgentConfig {
    readonly mapId?: string;
    readonly speed?: number;
    /** Interleaved world-space waypoints `[x0, y0, x1, y1, ...]`. */
    readonly waypoints?: readonly number[] | Float32Array;
    readonly pathRequestId?: string | null;
}

/**
 * Follows a path produced by `@axrone/tilemap/path`. The component never runs
 * its own loop; the scene's tilemap system steps it.
 */
@script({
    scriptName: 'TilemapAgent',
    priority: 80,
    executeInEditMode: false,
    singleton: false,
    trackInstances: false,
})
export class TilemapAgent extends Component {
    #mapId = '';
    #speed = 1;
    #waypoints = new Float32Array(0);
    #waypointIndex = 0;
    #moving = false;
    #pathRequestId: string | null = null;

    constructor(config: TilemapAgentConfig = {}) {
        super();
        this.#mapId = config.mapId ?? '';
        this.#speed = config.speed ?? 1;
        this.#pathRequestId = config.pathRequestId ?? null;
        if (config.waypoints !== undefined) this.setPath(config.waypoints);
    }

    get mapId(): string {
        return this.#mapId;
    }

    set mapId(value: string) {
        if (this.#mapId === value) return;
        this.#mapId = value;
        this.touch();
    }

    get speed(): number {
        return this.#speed;
    }

    set speed(value: number) {
        if (this.#speed === value) return;
        this.#speed = value;
        this.touch();
    }

    get pathRequestId(): string | null {
        return this.#pathRequestId;
    }

    get moving(): boolean {
        return this.#moving;
    }

    get waypointCount(): number {
        return this.#waypoints.length / 2;
    }

    get waypointIndex(): number {
        return this.#waypointIndex;
    }

    requestPath(requestId: string): void {
        this.#pathRequestId = requestId;
        this.touch();
    }

    completePath(requestId: string): boolean {
        if (this.#pathRequestId !== requestId) return false;
        this.#pathRequestId = null;
        this.touch();
        return true;
    }

    setPath(waypoints: readonly number[] | Float32Array): void {
        const length = waypoints.length - (waypoints.length % 2);
        this.#waypoints = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            this.#waypoints[index] = waypoints[index]!;
        }
        this.#waypointIndex = 0;
        this.#moving = length > 0;
        this.touch();
    }

    clearPath(): void {
        this.#waypoints = new Float32Array(0);
        this.#waypointIndex = 0;
        this.#moving = false;
        this.touch();
    }

    waypointAt(index: number): { readonly x: number; readonly y: number } | null {
        if (index < 0 || index * 2 + 1 >= this.#waypoints.length) return null;
        return {
            x: this.#waypoints[index * 2]!,
            y: this.#waypoints[index * 2 + 1]!,
        };
    }

    advanceWaypoint(): void {
        if (!this.#moving) return;
        this.#waypointIndex++;
        if (this.#waypointIndex >= this.waypointCount) {
            this.#waypointIndex = this.waypointCount;
            this.#moving = false;
        }
        this.touch();
    }

    override serialize(): Record<string, unknown> {
        return {
            mapId: this.#mapId,
            speed: this.#speed,
            waypoints: Array.from(this.#waypoints),
            waypointIndex: this.#waypointIndex,
            moving: this.#moving,
            pathRequestId: this.#pathRequestId,
        };
    }

    override deserialize(data: Record<string, unknown>): void {
        if (typeof data.mapId === 'string') this.#mapId = data.mapId;
        if (typeof data.speed === 'number') this.#speed = data.speed;
        if (Array.isArray(data.waypoints)) {
            this.setPath(data.waypoints.filter((value) => typeof value === 'number'));
        }
        if (typeof data.waypointIndex === 'number') {
            this.#waypointIndex = Math.max(
                0,
                Math.min(this.waypointCount, Math.trunc(data.waypointIndex))
            );
        }
        if (typeof data.moving === 'boolean') this.#moving = data.moving;
        this.#pathRequestId =
            typeof data.pathRequestId === 'string' ? data.pathRequestId : null;
        this.touch();
    }
}
