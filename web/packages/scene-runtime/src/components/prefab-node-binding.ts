import { Component } from '@axrone/ecs';
import { script } from '@axrone/ecs';

export interface PrefabNodeBindingConfig {
    readonly nodeId?: string;
    readonly instanceId?: string;
}

@script({
    scriptName: 'PrefabNodeBinding',
    priority: 950,
    executeInEditMode: true,
    singleton: false,
})
export class PrefabNodeBinding extends Component {
    private _nodeId: string | null;
    private _instanceId: string | null;

    constructor(config: PrefabNodeBindingConfig = {}) {
        super();
        this._nodeId = config.nodeId ?? null;
        this._instanceId = config.instanceId ?? null;
    }

    get nodeId(): string | null {
        return this._nodeId;
    }

    set nodeId(value: string | null) {
        this._nodeId = value;
    }

    get instanceId(): string | null {
        return this._instanceId;
    }

    set instanceId(value: string | null) {
        this._instanceId = value;
    }

    override serialize(): Record<string, unknown> {
        return {
            nodeId: this._nodeId,
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (typeof data.nodeId === 'string' || data.nodeId === null) {
            this._nodeId = data.nodeId;
        }
        if (typeof data.instanceId === 'string' || data.instanceId === null) {
            this._instanceId = data.instanceId;
        }
    }
}