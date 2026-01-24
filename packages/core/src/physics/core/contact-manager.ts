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
    private readonly _contactFlags: Uint8Array; // [isEnabled, isTouching] packed
    private readonly _contactIndices: Int32Array; // [childIndexA, childIndexB]

    private readonly _contactIdToIndex: Map<ContactId, number>;
    private readonly _bodyToContacts: Map<BodyId, Set<ContactId>>;

    private _contactListener: IContactListener2D | null = null;
    private _collisionFilter: ICollisionFilter | null = null;
    private _disposed: boolean = false;
    private readonly _freeIndices: number[] = [];

    constructor(maxContacts: number = 4096) {
        this._maxContacts = maxContacts;

        this._contactMetadata = new Map();

        this._contactData = new Float64Array(maxContacts * 12); // friction, rest, tanSpeed, normal(2), tan(2), points(4), impulses(2) ... optimized layout
        this._contactFlags = new Uint8Array(maxContacts);
        this._contactIndices = new Int32Array(maxContacts * 2);

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
            manifoldId: contactId as unknown as ManifoldId, // Simple mapping for now
        });

        const dataOffset = index * 12;
        this._contactData[dataOffset] = 0.2;
        this._contactData[dataOffset + 1] = 0.0;
        this._contactData[dataOffset + 2] = 0.0;

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

        const offset = index * 12;
        this._contactData[offset + 3] = manifold.normal.x;
        this._contactData[offset + 4] = manifold.normal.y;

        if (manifold.pointCount > 0) {
            this._contactData[offset + 5] = manifold.points[0].localPointA.x;
            this._contactData[offset + 6] = manifold.points[0].localPointA.y;
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
