import { User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthMapper } from './auth.mapper';

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'customer@barakahbazaar.com.bd',
  phone: '+8801711111111',
  fullName: 'Rahim Uddin',
  role: UserRole.CUSTOMER,
  isActive: true,
  lastSeenAt: new Date('2026-08-29T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-29T00:00:00.000Z'),
  ...overrides,
});

describe('AuthMapper', () => {
  it('maps every field of the profile contract', () => {
    expect(AuthMapper.toProfile(userRow())).toEqual({
      id: 'user-1',
      supabaseUserId: '11111111-1111-1111-1111-111111111111',
      email: 'customer@barakahbazaar.com.bd',
      phone: '+8801711111111',
      fullName: 'Rahim Uddin',
      role: UserRole.CUSTOMER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('never leaks the operational columns', () => {
    const profile = AuthMapper.toProfile(userRow());

    expect(profile).not.toHaveProperty('isActive');
    expect(profile).not.toHaveProperty('lastSeenAt');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it('passes a null name through rather than inventing one', () => {
    expect(AuthMapper.toProfile(userRow({ fullName: null })).fullName).toBeNull();
  });
});
