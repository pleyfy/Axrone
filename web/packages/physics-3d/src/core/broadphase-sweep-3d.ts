export type SweepAxis3D = 'x' | 'y' | 'z';

export interface ISweepBoxSource {
    collectLeafIds(out: number[]): number;
    getAABB(proxyId: number): {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
    };
}

export class SweepAndPrune3D {
    private readonly _axis: SweepAxis3D;
    private _lo: number[] = [];
    private _hi: number[] = [];
    private _firstMin: number[] = [];
    private _firstMax: number[] = [];
    private _secondMin: number[] = [];
    private _secondMax: number[] = [];
    private _liveStamp: number[] = [];
    private _queuedStamp: number[] = [];
    private _live: number[] = [];
    private _order: number[] = [];
    private _active: number[] = [];
    private _leafScratch: number[] = [];
    private _stamp = 0;
    boxTests = 0;
    leafPairs = 0;

    constructor(axis: SweepAxis3D = 'x') {
        this._axis = axis;
    }

    get proxyCount(): number {
        return this._live.length;
    }

    sync(source: ISweepBoxSource): number {
        const stamp = ++this._stamp;
        const ids = this._leafScratch;
        const count = source.collectLeafIds(ids);

        const live = this._live;
        live.length = 0;
        const marked = this._liveStamp;
        const queued = this._queuedStamp;
        const lo = this._lo;
        const hi = this._hi;
        const firstMin = this._firstMin;
        const firstMax = this._firstMax;
        const secondMin = this._secondMin;
        const secondMax = this._secondMax;
        const axis = this._axis;

        for (let i = 0; i < count; i++) {
            const id = ids[i];
            if (marked[id] === stamp) continue;
            marked[id] = stamp;
            live.push(id);
            const box = source.getAABB(id);
            if (axis === 'x') {
                lo[id] = box.min.x;
                hi[id] = box.max.x;
                firstMin[id] = box.min.y;
                firstMax[id] = box.max.y;
                secondMin[id] = box.min.z;
                secondMax[id] = box.max.z;
            } else if (axis === 'y') {
                lo[id] = box.min.y;
                hi[id] = box.max.y;
                firstMin[id] = box.min.x;
                firstMax[id] = box.max.x;
                secondMin[id] = box.min.z;
                secondMax[id] = box.max.z;
            } else {
                lo[id] = box.min.z;
                hi[id] = box.max.z;
                firstMin[id] = box.min.x;
                firstMax[id] = box.max.x;
                secondMin[id] = box.min.y;
                secondMax[id] = box.max.y;
            }
        }

        const order = this._order;
        let write = 0;
        for (let r = 0, n = order.length; r < n; r++) {
            const id = order[r];
            if (marked[id] !== stamp || queued[id] === stamp) continue;
            queued[id] = stamp;
            order[write++] = id;
        }
        for (let r = 0, n = live.length; r < n; r++) {
            const id = live[r];
            if (queued[id] === stamp) continue;
            queued[id] = stamp;
            order[write++] = id;
        }
        order.length = write;

        for (let i = 1, n = order.length; i < n; i++) {
            const moving = order[i];
            const key = lo[moving];
            let j = i - 1;
            while (j >= 0 && lo[order[j]] > key) {
                order[j + 1] = order[j];
                j--;
            }
            order[j + 1] = moving;
        }

        return order.length;
    }

    queryPairs(callback: (proxyIdA: number, proxyIdB: number) => boolean): void {
        this.boxTests = 0;
        this.leafPairs = 0;
        const order = this._order;
        const active = this._active;
        const lo = this._lo;
        const hi = this._hi;
        const firstMin = this._firstMin;
        const firstMax = this._firstMax;
        const secondMin = this._secondMin;
        const secondMax = this._secondMax;
        let n = 0;

        for (let i = 0, len = order.length; i < len; i++) {
            const b = order[i];
            const bLo = lo[b];
            let w = 0;
            for (let j = 0; j < n; j++) {
                const a = active[j];
                if (hi[a] < bLo) continue;
                active[w++] = a;
            }
            n = w;

            const bFirstMin = firstMin[b];
            const bFirstMax = firstMax[b];
            const bSecondMin = secondMin[b];
            const bSecondMax = secondMax[b];
            for (let j = 0; j < n; j++) {
                const a = active[j];
                this.boxTests++;
                if (bFirstMin > firstMax[a] || bFirstMax < firstMin[a]) continue;
                if (bSecondMin > secondMax[a] || bSecondMax < secondMin[a]) continue;
                this.leafPairs++;
                if (!callback(a, b)) return;
            }
            active[n++] = b;
        }
    }
}
