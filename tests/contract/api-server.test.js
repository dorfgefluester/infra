/** @jest-environment node */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createApiServer } from '../../api/src/server.js';
import { createMemoryStorage } from '../../api/src/storage/memoryStorage.js';

describe('API server', () => {
  let api;
  let storage;
  let baseUrl;
  let cookie = '';

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(cookie ? { cookie } : {}),
        ...(cookie ? { 'x-test-session-id': cookie.split('=')[1] } : {}),
      },
    });

    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (setCookies.length > 0) {
      cookie = setCookies[0].split(';')[0];
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (data.debugSessionId) {
      cookie = `test_session=${data.debugSessionId}`;
    }

    return {
      status: response.status,
      data,
    };
  }

  beforeEach(async () => {
    storage = createMemoryStorage();
    api = await createApiServer({
      config: {
        apiPort: 0,
        databaseUrl: '',
        appOrigin: 'http://127.0.0.1:3000',
        sessionCookieName: 'test_session',
        sessionTtlHours: 24,
        secureCookies: false,
        exposeResetTokens: true,
        nodeEnv: 'test',
      },
      storage,
    });
    await api.listen();
    baseUrl = `http://127.0.0.1:${api.server.address().port}`;
    cookie = '';
  });

  async function authenticateAs(email) {
    const user = await storage.getUserByEmail(email);
    const session = await storage.createSession({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      sessionId: 'manual-test-session',
    });
    cookie = `test_session=${session.id}`;
  }

  afterEach(async () => {
    await api.close();
  });

  test('registers, persists cloud saves, and enforces auth', async () => {
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'save@test.dev',
        password: 'topsecret123',
        playerName: 'CloudTester',
      }),
    });

    expect(registered.status).toBe(201);
    expect(registered.data.authenticated).toBe(true);

    const writeSave = await request('/api/saves/1', {
      method: 'PUT',
      body: JSON.stringify({
        payload: {
          name: 'Cloud Slot 1',
          preview: { location: 'Village', quests: 2 },
          player: { x: 10, y: 20 },
        },
      }),
    });

    expect(writeSave.status).toBe(200);
    expect(writeSave.data.slot.slot).toBe(1);

    const listSaves = await request('/api/saves', { method: 'GET' });
    expect(listSaves.status).toBe(200);
    expect(listSaves.data.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: 1,
          exists: true,
          payload: expect.objectContaining({ player: { x: 10, y: 20 } }),
        }),
      ]),
    );

    const logout = await request('/api/auth/logout', { method: 'POST', body: '{}' });
    expect(logout.status).toBe(200);

    const unauthorized = await request('/api/saves', { method: 'GET' });
    expect(unauthorized.status).toBe(401);
  });

  test('supports guest migration and password reset', async () => {
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'migrate@test.dev',
        password: 'topsecret123',
        playerName: 'Migrator',
      }),
    });
    expect(registered.status).toBe(201);
    await authenticateAs('migrate@test.dev');

    const migration = await request('/api/profile/guest-migration', {
      method: 'POST',
      body: JSON.stringify({
        playerName: 'MigratedName',
        saveSlots: [
          {
            slot: 2,
            name: 'Imported Slot',
            preview: { location: 'Forest' },
            payload: { name: 'Imported Slot', preview: { location: 'Forest' }, player: { x: 5, y: 8 } },
          },
        ],
      }),
    });

    expect(migration.status).toBe(200);
    expect(migration.data.profile.migrationSource).toBe('guest');

    const slot = await request('/api/saves/2', { method: 'GET' });
    expect(slot.status).toBe(200);
    expect(slot.data.slot.payload.player).toEqual({ x: 5, y: 8 });

    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    const forgot = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'migrate@test.dev' }),
    });

    expect(forgot.status).toBe(200);
    expect(forgot.data.debugToken).toBeTruthy();

    const reset = await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: forgot.data.debugToken,
        password: 'changed-password-123',
      }),
    });

    expect(reset.status).toBe(200);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'migrate@test.dev',
        password: 'changed-password-123',
      }),
    });

    expect(login.status).toBe(200);
    expect(login.data.authenticated).toBe(true);
  });
});
