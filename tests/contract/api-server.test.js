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
      headers: {
        accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
        accessControlAllowHeaders: response.headers.get('access-control-allow-headers'),
      },
    };
  }

  beforeEach(async () => {
    storage = createMemoryStorage();
    api = await createApiServer({
      config: {
        apiPort: 0,
        databaseUrl: '',
        appOrigin: 'http://127.0.0.1:3000',
        allowLocalDebugAuth: true,
        sessionCookieName: 'test_session',
        sessionTtlHours: 24,
        secureCookies: false,
        exposeResetTokens: true,
        apiLogLevel: 'error',
        authRateLimitWindowMs: 60 * 1000,
        authRateLimitMax: 3,
        maxJsonBodyBytes: 2048,
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

  test('validates public payloads and rate limits auth endpoints', async () => {
    const invalidRegister = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'invalid',
        password: 'short',
      }),
    });

    expect(invalidRegister.status).toBe(400);
    expect(invalidRegister.data.error).toBe('invalid_registration');

    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'validate@test.dev',
        password: 'valid-password-123',
        playerName: 'Validator',
      }),
    });
    expect(registered.status).toBe(201);

    const invalidMigration = await request('/api/profile/guest-migration', {
      method: 'POST',
      body: JSON.stringify({
        saveSlots: [{ slot: 99 }],
      }),
    });
    expect(invalidMigration.status).toBe(400);
    expect(invalidMigration.data.error).toBe('invalid_guest_migration');

    const logout = await request('/api/auth/logout', { method: 'POST', body: '{}' });
    expect(logout.status).toBe(200);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loginAttempt = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'validate@test.dev',
          password: 'wrong-password',
        }),
      });
      if (attempt < 3) {
        expect(loginAttempt.status).toBe(401);
      } else {
        expect(loginAttempt.status).toBe(429);
        expect(loginAttempt.data.error).toBe('too_many_requests');
      }
    }
  });

  test('rejects oversized request bodies before parsing', async () => {
    const oversized = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'big@test.dev',
        password: 'x'.repeat(4096),
      }),
    });

    expect(oversized.status).toBe(413);
    expect(oversized.data).toEqual(
      expect.objectContaining({
        error: 'payload_too_large',
        limitBytes: 2048,
      }),
    );
  });

  test('limits localhost debug auth and CORS shortcuts to explicit local-debug mode', async () => {
    api.config.nodeEnv = 'production';
    api.config.appOrigin = 'https://dorfgefluester.prod.example.com';
    api.config.allowLocalDebugAuth = false;
    api.config.exposeResetTokens = true;

    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'prod-lockdown@test.dev',
        password: 'valid-password-123',
        playerName: 'ProdLockdown',
      }),
    });

    expect(registered.status).toBe(201);
    expect(registered.data.debugSessionId).toBeUndefined();

    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    const forgot = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'prod-lockdown@test.dev' }),
    });

    expect(forgot.status).toBe(200);
    expect(forgot.data.debugToken).toBeUndefined();

    const localhostCors = await request('/api/health', {
      method: 'GET',
      headers: {
        origin: 'http://127.0.0.1:5173',
      },
    });
    expect(localhostCors.headers.accessControlAllowOrigin).toBeNull();

    const appCors = await request('/api/health', {
      method: 'GET',
      headers: {
        origin: 'https://dorfgefluester.prod.example.com',
      },
    });
    expect(appCors.headers.accessControlAllowOrigin).toBe('https://dorfgefluester.prod.example.com');
    expect(appCors.headers.accessControlAllowHeaders).toBe('content-type');
  });
});
