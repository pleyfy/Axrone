import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactManager2D } from '../../physics/core/contact-manager';

describe('ContactManager2D', () => {
    let manager: ContactManager2D;
    const bodyIdA = 1 as any;
    const bodyIdB = 2 as any;
    const shapeIdA = 10 as any;
    const shapeIdB = 20 as any;

    beforeEach(() => {
        manager = new ContactManager2D(64);
    });

    describe('Contact Creation', () => {
        it('creates contact', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            expect(contactId).toBeGreaterThan(0);
            expect(manager.contactCount).toBe(1);
        });

        it('creates multiple contacts', () => {
            manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            manager.createContact(shapeIdA, 21 as any, bodyIdA, bodyIdB);
            manager.createContact(11 as any, shapeIdB, bodyIdA, bodyIdB);
            expect(manager.contactCount).toBe(3);
        });

        it('throws when capacity exceeded', () => {
            const smallManager = new ContactManager2D(2);
            smallManager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            smallManager.createContact(shapeIdA, 21 as any, bodyIdA, bodyIdB);
            expect(() => {
                smallManager.createContact(11 as any, shapeIdB, bodyIdA, bodyIdB);
            }).toThrow();
        });
    });

    describe('Contact Destruction', () => {
        it('destroys contact', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            expect(manager.contactCount).toBe(1);
            manager.destroyContact(contactId);
            expect(manager.contactCount).toBe(0);
        });

        it('handles destroying non-existent contact', () => {
            manager.destroyContact(9999 as any);
            expect(manager.contactCount).toBe(0);
        });

        it('destroys multiple contacts', () => {
            const id1 = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const id2 = manager.createContact(shapeIdA, 21 as any, bodyIdA, bodyIdB);
            manager.destroyContact(id1);
            manager.destroyContact(id2);
            expect(manager.contactCount).toBe(0);
        });
    });

    describe('Contact Updates', () => {
        it('updates contact manifold', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const manifold = {
                normal: { x: 1, y: 0 },
                pointCount: 1,
                points: [{
                    localPointA: { x: 0, y: 0 },
                    localPointB: { x: 0, y: 0 },
                    separation: -0.1,
                    id: 0 as any,
                    normalImpulse: 0,
                    tangentImpulse: 0,
                }],
            };

            manager.updateContact(contactId, manifold as any);
        });

        it('updates contact with multiple points', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const manifold = {
                normal: { x: 1, y: 0 },
                pointCount: 2,
                points: [
                    {
                        localPointA: { x: 0, y: 0 },
                        localPointB: { x: 0, y: 0 },
                        separation: -0.1,
                        id: 0 as any,
                        normalImpulse: 0,
                        tangentImpulse: 0,
                    },
                    {
                        localPointA: { x: 1, y: 0 },
                        localPointB: { x: 1, y: 0 },
                        separation: -0.1,
                        id: 1 as any,
                        normalImpulse: 0,
                        tangentImpulse: 0,
                    },
                ],
            };

            manager.updateContact(contactId, manifold as any);
        });

        it('handles update of non-existent contact', () => {
            const manifold = {
                normal: { x: 1, y: 0 },
                pointCount: 0,
                points: [],
            };
            manager.updateContact(9999 as any, manifold as any);
        });
    });

    describe('Warm Start Impulses', () => {
        it('gets warm start impulse', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const impulse = manager.getWarmStartImpulse(contactId, 0);
            expect(impulse.normalImpulse).toBe(0);
            expect(impulse.tangentImpulse).toBe(0);
        });

        it('sets warm start impulse', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            manager.setWarmStartImpulse(contactId, 0, 10, 5);
            const impulse = manager.getWarmStartImpulse(contactId, 0);
            expect(impulse.normalImpulse).toBe(10);
            expect(impulse.tangentImpulse).toBe(5);
        });

        it('sets impulses for multiple contact points', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            manager.setWarmStartImpulse(contactId, 0, 10, 5);
            manager.setWarmStartImpulse(contactId, 1, 20, 15);

            const impulse0 = manager.getWarmStartImpulse(contactId, 0);
            const impulse1 = manager.getWarmStartImpulse(contactId, 1);

            expect(impulse0.normalImpulse).toBe(10);
            expect(impulse1.normalImpulse).toBe(20);
        });

        it('returns zero impulse for non-existent contact', () => {
            const impulse = manager.getWarmStartImpulse(9999 as any, 0);
            expect(impulse.normalImpulse).toBe(0);
            expect(impulse.tangentImpulse).toBe(0);
        });
    });

    describe('Contact Data Access', () => {
        it('gets contact data', () => {
            const contactId = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const data = manager.getContactData(contactId);
            expect(data).not.toBeNull();
            if (data) {
                expect(data.friction).toBeDefined();
                expect(data.restitution).toBeDefined();
            }
        });

        it('returns null for non-existent contact', () => {
            const data = manager.getContactData(9999 as any);
            expect(data).toBeNull();
        });
    });

    describe('Contact Listener', () => {
        it('sets contact listener', () => {
            const listener = {
                onCollisionBegin: vi.fn(),
                onCollisionEnd: vi.fn(),
            };
            manager.setContactListener(listener);
        });

        it('clears contact listener', () => {
            manager.setContactListener(null);
        });
    });

    describe('Collision Filter', () => {
        it('sets collision filter', () => {
            const filter = {
                shouldCollide: vi.fn(() => true),
            };
            manager.setCollisionFilter(filter);
        });

        it('clears collision filter', () => {
            manager.setCollisionFilter(null);
        });
    });

    describe('Body Contact Queries', () => {
        it('gets contacts for body', () => {
            const id1 = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            const id2 = manager.createContact(shapeIdA, 21 as any, bodyIdA, 3 as any);

            const contacts = Array.from(manager.getContactsForBody(bodyIdA));
            expect(contacts).toHaveLength(2);
            expect(contacts).toContain(id1);
            expect(contacts).toContain(id2);
        });

        it('returns empty for body with no contacts', () => {
            const contacts = Array.from(manager.getContactsForBody(999 as any));
            expect(contacts).toHaveLength(0);
        });
    });

    describe('Disposal', () => {
        it('disposes manager', () => {
            manager[Symbol.dispose]();
        });

        it('throws when using after disposal', () => {
            manager[Symbol.dispose]();
            expect(() => {
                manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
            }).toThrow();
        });

        it('allows double disposal', () => {
            manager[Symbol.dispose]();
            manager[Symbol.dispose]();
        });
    });

    describe('Edge Cases', () => {
        it('handles many contacts', () => {
            for (let i = 0; i < 50; i++) {
                manager.createContact((10 + i) as any, (20 + i) as any, bodyIdA, bodyIdB);
            }
            expect(manager.contactCount).toBe(50);
        });

        it('handles contact creation and destruction cycle', () => {
            for (let i = 0; i < 20; i++) {
                const id = manager.createContact(shapeIdA, shapeIdB, bodyIdA, bodyIdB);
                manager.destroyContact(id);
            }
            expect(manager.contactCount).toBe(0);
        });
    });
});
