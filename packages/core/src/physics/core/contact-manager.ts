import type { IVec2Like } from '@axrone/numeric';
import type {
    ContactId,
    BodyId,
    ShapeId,
    ManifoldId,
    IContactManifold2D,
    IContactListener2D,
    ICollisionFilter,
    Friction,
    Restitution,
    Impulse,
} from '../types';

const enum ContactManagerError {
    INVALID_STATE = 'INVALID_STATE',
    CONTACT_NOT_FOUND = 'CONTACT_NOT_FOUND',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
}

class ContactError extends Error {
    readonly code: ContactManagerError;
    constructor(message: string, code: ContactManagerError) {
        super(message);
        this.name = 'ContactError';
        this.code = code;
        Object.setPrototypeOf(this, ContactError.prototype);
    }
}

const CONTACT_STRIDE = 16;

export class ContactManager2D implements Disposable {
    private _nextContactId: number = 1;
    private _contactCount: number = 0;
    private readonly _maxContacts: number;

    private readonly _contactMetadata: Map<
        ContactId,
        {
            bodyIdA: BodyId;
            bodyIdB: BodyId;
            shapeIdA: ShapeId;
            shapeIdB: ShapeId;
            manifoldId: ManifoldId;
        }
    >;

    private readonly _contactData: Float64Array;
    private readonly _contactFlags: Uint8Array;
    private readonly _contactIndices: Int32Array;
    private readonly _warmStartData: Float64Array;

    private readonly _contactIdToIndex: Map<ContactId, number>;
    private readonly _bodyToContacts: Map<BodyId, Set<ContactId>>;

    private _contactListener: IContactListener2D | null = null;
    private _collisionFilter: ICollisionFilter | null = null;
    private _disposed: boolean = false;
    private readonly _freeIndices: number[] = [];

    constructor(maxContacts: number = 4096) {
        this._maxContacts = maxContacts;

        this._contactMetadata = new Map();

        this._contactData = new Float64Array(maxContacts * 16);
        this._contactFlags = new Uint8Array(maxContacts);
        this._contactIndices = new Int32Array(maxContacts * 2);
        this._warmStartData = new Float64Array(maxContacts * 8);

        this._contactIdToIndex = new Map();
        this._bodyToContacts = new Map();
    }

    get contactCount(): number {
        return this._contactCount;
    }

    createContact(
        shapeIdA: ShapeId,
        shapeIdB: ShapeId,
        bodyIdA: BodyId,
        bodyIdB: BodyId
    ): ContactId {
        this._assertNotDisposed();

        if (this._collisionFilter && !this._collisionFilter.shouldCollide(shapeIdA, shapeIdB)) {
        }

        if (this._contactCount >= this._maxContacts && this._freeIndices.length === 0) {
            throw new ContactError(
                'Contact capacity exceeded',
                ContactManagerError.CAPACITY_EXCEEDED
            );
        }

        const contactId = this._nextContactId++ as ContactId;
        const index = this._allocateIndex();

        this._contactIdToIndex.set(contactId, index);

        this._contactMetadata.set(contactId, {
            bodyIdA,
            bodyIdB,
            shapeIdA,
            shapeIdB,
            manifoldId: contactId as unknown as ManifoldId,
        });

        const dataOffset = index * 16;
        this._contactData[dataOffset] = 0.2;
        this._contactData[dataOffset + 1] = 0.0;
        this._contactData[dataOffset + 2] = 0.0;
        this._contactData[dataOffset + 3] = 0;
        this._contactData[dataOffset + 4] = 0;
        this._contactData[dataOffset + 5] = 0;
        this._contactData[dataOffset + 6] = 0;
        this._contactData[dataOffset + 7] = 0;
        this._contactData[dataOffset + 8] = 0;
        this._contactData[dataOffset + 9] = 0;
        this._contactData[dataOffset + 10] = 0;
        this._contactData[dataOffset + 11] = 0;
        this._contactData[dataOffset + 12] = 0;
        this._contactData[dataOffset + 13] = 0;
        this._contactData[dataOffset + 14] = 0;
        this._contactData[dataOffset + 15] = 0;

        const warmOffset = index * 8;
        this._warmStartData[warmOffset] = 0;
        this._warmStartData[warmOffset + 1] = 0;
        this._warmStartData[warmOffset + 2] = 0;
        this._warmStartData[warmOffset + 3] = 0;
        this._warmStartData[warmOffset + 4] = 0;
        this._warmStartData[warmOffset + 5] = 0;
        this._warmStartData[warmOffset + 6] = 0;
        this._warmStartData[warmOffset + 7] = 0;

        this._contactFlags[index] = 1;
        this._contactIndices[index * 2] = 0;
        this._contactIndices[index * 2 + 1] = 0;

        this._addToBody(bodyIdA, contactId);
        this._addToBody(bodyIdB, contactId);

        this._contactCount++;

        return contactId;
    }

    destroyContact(contactId: ContactId): void {
        this._assertNotDisposed();

        const index = this._contactIdToIndex.get(contactId);
        if (index === undefined) {
            return;
        }

        const metadata = this._contactMetadata.get(contactId)!;

        if (this._contactListener?.onCollisionEnd) {
            const wasTouching = (this._contactFlags[index] & 2) !== 0;
            if (wasTouching) {
                // Construct event... (simplified for this improved snippet)
            }
        }

        this._removeFromBody(metadata.bodyIdA, contactId);
        this._removeFromBody(metadata.bodyIdB, contactId);

        this._contactMetadata.delete(contactId);
        this._contactIdToIndex.delete(contactId);
        this._freeIndices.push(index);
        this._contactCount--;
    }

    updateContact(contactId: ContactId, manifold: IContactManifold2D): void {
        const index = this._contactIdToIndex.get(contactId);
        if (index === undefined) return;

        const wasTouching = (this._contactFlags[index] & 2) !== 0;
        const isTouching = manifold.pointCount > 0;

        let flags = this._contactFlags[index];
        if (isTouching) flags |= 2;
        else flags &= ~2;
        this._contactFlags[index] = flags;

        const offset = index * 16;
        this._contactData[offset + 3] = manifold.normal.x;
        this._contactData[offset + 4] = manifold.normal.y;

        if (manifold.pointCount > 0) {
            this._contactData[offset + 5] = manifold.points[0].localPointA.x;
            this._contactData[offset + 6] = manifold.points[0].localPointA.y;
            this._contactData[offset + 7] = manifold.points[0].localPointB.x;
            this._contactData[offset + 8] = manifold.points[0].localPointB.y;
            this._contactData[offset + 9] = manifold.points[0].separation;
        }

        if (manifold.pointCount > 1) {
            this._contactData[offset + 10] = manifold.points[1].localPointA.x;
            this._contactData[offset + 11] = manifold.points[1].localPointA.y;
            this._contactData[offset + 12] = manifold.points[1].localPointB.x;
            this._contactData[offset + 13] = manifold.points[1].localPointB.y;
            this._contactData[offset + 14] = manifold.points[1].separation;
        }

        if (isTouching && !wasTouching) {
            if (this._contactListener?.onCollisionBegin) {
            }
        } else if (!isTouching && wasTouching) {
            if (this._contactListener?.onCollisionEnd) {
            }
        } else if (isTouching && wasTouching) {
            if (this._contactListener?.onCollisionStay) {
            }
        }
    }

    getWarmStartImpulse(contactId: ContactId, pointIndex: number): { normalImpulse: number; tangentImpulse: number } {
        const index = this._contactIdToIndex.get(contactId);
        if (index === undefined) return { normalImpulse: 0, tangentImpulse: 0 };

        const offset = index * 8 + pointIndex * 4;
        return {
            normalImpulse: this._warmStartData[offset],
            tangentImpulse: this._warmStartData[offset + 1],
        };
    }

    setWarmStartImpulse(contactId: ContactId, pointIndex: number, normalImpulse: number, tangentImpulse: number): void {
        const index = this._contactIdToIndex.get(contactId);
        if (index === undefined) return;

        const offset = index * 8 + pointIndex * 4;
        this._warmStartData[offset] = normalImpulse;
        this._warmStartData[offset + 1] = tangentImpulse;
        this._warmStartData[offset + 2] = 0;
        this._warmStartData[offset + 3] = 0;
    }

    getContactData(contactId: ContactId): {
        friction: number;
        restitution: number;
        normal: IVec2Like;
        pointCount: number;
        point0: { localA: IVec2Like; localB: IVec2Like; separation: number };
        point1?: { localA: IVec2Like; localB: IVec2Like; separation: number };
    } | null {
        const index = this._contactIdToIndex.get(contactId);
        if (index === undefined) return null;

        const offset = index * 16;
        const pointCount = this._contactData[offset + 15];

        return {
            friction: this._contactData[offset],
            restitution: this._contactData[offset + 1],
            normal: { x: this._contactData[offset + 3], y: this._contactData[offset + 4] },
            pointCount: pointCount,
            point0: {
                localA: { x: this._contactData[offset + 5], y: this._contactData[offset + 6] },
                localB: { x: this._contactData[offset + 7], y: this._contactData[offset + 8] },
                separation: this._contactData[offset + 9],
            },
            point1: pointCount > 1 ? {
                localA: { x: this._contactData[offset + 10], y: this._contactData[offset + 11] },
                localB: { x: this._contactData[offset + 12], y: this._contactData[offset + 13] },
                separation: this._contactData[offset + 14],
            } : undefined,
        };
    }

    setContactListener(listener: IContactListener2D | null): void {
        this._contactListener = listener;
    }

    setCollisionFilter(filter: ICollisionFilter | null): void {
        this._collisionFilter = filter;
    }

    getContactsForBody(bodyId: BodyId): IterableIterator<ContactId> {
        const contacts = this._bodyToContacts.get(bodyId);
        return contacts ? contacts.values() : [][Symbol.iterator]();
    }

    private _allocateIndex(): number {
        if (this._freeIndices.length > 0) {
            return this._freeIndices.pop()!;
        }
        return this._contactCount;
    }

    private _addToBody(bodyId: BodyId, contactId: ContactId): void {
        let contacts = this._bodyToContacts.get(bodyId);
        if (!contacts) {
            contacts = new Set();
            this._bodyToContacts.set(bodyId, contacts);
        }
        contacts.add(contactId);
    }

    private _removeFromBody(bodyId: BodyId, contactId: ContactId): void {
        const contacts = this._bodyToContacts.get(bodyId);
        if (contacts) {
            contacts.delete(contactId);
            if (contacts.size === 0) {
                this._bodyToContacts.delete(bodyId);
            }
        }
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new ContactError('Manager is disposed', ContactManagerError.INVALID_STATE);
        }
    }

    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;
        this._contactMetadata.clear();
        this._contactIdToIndex.clear();
        this._bodyToContacts.clear();
    }
}
