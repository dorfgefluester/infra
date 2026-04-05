/** @jest-environment node */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createApiServer } from '../../api/src/server.js';
import { createMemoryStorage } from '../../api/src/storage/memoryStorage.js';

describe('API server', () => {
  let api;
  let storage;
  let baseUrl;
  let cookie = '';
  let sharedCache;

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
    const cacheValues = new Map();
    sharedCache = {
      async remember(namespace, rawKey, ttlSeconds, loader) {
        const key = `${namespace}:${rawKey}`;
        if (cacheValues.has(key)) {
          return { value: cacheValues.get(key), hit: true };
        }

        const value = await loader();
        if (value !== null && value !== undefined) {
          cacheValues.set(key, value);
        }
        return { value, hit: false };
      },
      async delete(namespace, rawKey) {
        cacheValues.delete(`${namespace}:${rawKey}`);
      },
      async deleteMany(entries = []) {
        for (const [namespace, rawKey] of entries) {
          cacheValues.delete(`${namespace}:${rawKey}`);
        }
      },
    };
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
        apiLogLevel: 'error',
        authRateLimitWindowMs: 60 * 1000,
        authRateLimitMax: 3,
        mapSearchCacheTtlSeconds: 60,
        routeCacheTtlSeconds: 60,
        nearestRoadCacheTtlSeconds: 60,
        saveSlotCacheTtlSeconds: 30,
        workerMaintenanceIntervalMs: 60 * 1000,
        nodeEnv: 'test',
      },
      storage,
      sharedCache,
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
          time: { hour: 8, minute: 15, day: 2 },
          world: { currentMapId: 'city-square', virtualPosition: { x: 10, y: 20 } },
          systems: {
            inventory: { items: { apple: 2, bread: 1 } },
            quests: {
              activeQuests: [['fetch_flour', { progress: 50 }]],
              completedQuests: ['welcome'],
            },
            audio: { isMuted: true },
            accessibility: { highContrastEnabled: true },
          },
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
          preview: expect.objectContaining({
            currentMapId: 'city-square',
            quests: 1,
            completedQuests: 1,
            inventoryItems: 3,
          }),
          payload: expect.objectContaining({
            player: { x: 10, y: 20 },
            world: expect.objectContaining({ currentMapId: 'city-square' }),
            systems: expect.objectContaining({
              inventory: { items: { apple: 2, bread: 1 } },
            }),
          }),
        }),
      ]),
    );
    expect(listSaves.data.slots.find((slot) => slot.slot === 1)?.payload.systems.audio).toBeUndefined();
    expect(
      listSaves.data.slots.find((slot) => slot.slot === 1)?.payload.systems.accessibility,
    ).toBeUndefined();

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

  test('caches save reads and invalidates them on writes', async () => {
    const originalListSaveSlots = storage.listSaveSlots.bind(storage);
    const originalGetSaveSlot = storage.getSaveSlot.bind(storage);
    const listSpy = jest.fn(originalListSaveSlots);
    const getSpy = jest.fn(originalGetSaveSlot);
    storage.listSaveSlots = listSpy;
    storage.getSaveSlot = getSpy;

    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'cache@test.dev',
        password: 'topsecret123',
        playerName: 'CacheTester',
      }),
    });
    expect(registered.status).toBe(201);

    await request('/api/saves/1', {
      method: 'PUT',
      body: JSON.stringify({
        payload: {
          name: 'Cached Slot',
          player: { x: 1, y: 2 },
        },
      }),
    });
    listSpy.mockClear();
    getSpy.mockClear();

    await request('/api/saves', { method: 'GET' });
    await request('/api/saves', { method: 'GET' });
    expect(listSpy).toHaveBeenCalledTimes(1);

    await request('/api/saves/1', { method: 'GET' });
    const slotReadsAfterFirstGet = getSpy.mock.calls.length;
    await request('/api/saves/1', { method: 'GET' });
    expect(getSpy).toHaveBeenCalledTimes(slotReadsAfterFirstGet);

    await request('/api/saves/1', {
      method: 'PUT',
      body: JSON.stringify({
        payload: {
          name: 'Updated Slot',
          player: { x: 3, y: 4 },
        },
      }),
    });

    const slotReadsBeforeInvalidatedGet = getSpy.mock.calls.length;
    const updatedSlot = await request('/api/saves/1', { method: 'GET' });
    expect(updatedSlot.data.slot.payload.player).toEqual({ x: 3, y: 4 });
    expect(getSpy.mock.calls.length).toBeGreaterThan(slotReadsBeforeInvalidatedGet);

    await request('/api/saves', { method: 'GET' });
    expect(listSpy).toHaveBeenCalledTimes(2);
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

  test('answers contextual help queries and accepts feedback without auth', async () => {
    const query = await request('/api/help/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'How do I continue a quest?',
        locale: 'en',
        anonymousId: 'guest-help-test',
        context: {
          currentScene: 'InfiniteMapScene',
          surface: 'help-modal',
          activeQuestIds: ['fetch_flour'],
          sessionMode: 'guest',
        },
      }),
    });

    expect(query.status).toBe(200);
    expect(query.data.answer).toContain('quest');
    expect(query.data.feedbackToken).toBeTruthy();
    expect(query.data.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.any(String),
          label: expect.any(String),
        }),
      ]),
    );

    const feedback = await request('/api/help/feedback', {
      method: 'POST',
      body: JSON.stringify({
        feedbackToken: query.data.feedbackToken,
        helpful: false,
        reason: 'missing-or-unclear',
        locale: 'en',
        anonymousId: 'guest-help-test',
        context: {
          currentScene: 'InfiniteMapScene',
          surface: 'help-modal',
          activeQuestIds: ['fetch_flour'],
        },
      }),
    });

    expect(feedback.status).toBe(200);
    expect(feedback.data.ok).toBe(true);
  });

  test('records explicit help telemetry and validates malformed help payloads', async () => {
    const telemetry = await request('/api/help/telemetry', {
      method: 'POST',
      body: JSON.stringify({
        eventName: 'failed-search',
        locale: 'de',
        anonymousId: 'guest-help-telemetry',
        context: {
          currentScene: 'InfiniteMapScene',
          surface: 'start-location-modal',
          failedSearchType: 'location-search',
          sessionMode: 'guest',
        },
        metadata: {
          queryLength: 7,
          resultCount: 0,
        },
      }),
    });

    expect(telemetry.status).toBe(200);
    expect(telemetry.data.ok).toBe(true);

    const invalidQuery = await request('/api/help/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'hi',
      }),
    });
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.data.error).toBe('invalid_help_query');

    const invalidFeedback = await request('/api/help/feedback', {
      method: 'POST',
      body: JSON.stringify({
        feedbackToken: 'missing-token',
        locale: 'en',
      }),
    });
    expect(invalidFeedback.status).toBe(400);
    expect(invalidFeedback.data.error).toBe('invalid_help_feedback');
  });

  test('proxies map search, route, and nearest-road requests', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      if (String(url).startsWith(baseUrl)) {
        return originalFetch(url, options);
      }

      if (String(url).includes('nominatim.openstreetmap.org')) {
        return {
          ok: true,
          json: async () => [
            {
              place_id: 5,
              display_name: 'Berlin, Deutschland',
              lat: '52.52',
              lon: '13.405',
            },
          ],
        };
      }

      if (String(url).includes('/route/v1/')) {
        return {
          ok: true,
          json: async () => ({
            code: 'Ok',
            routes: [
              {
                distance: 1200,
                duration: 900,
                geometry: {
                  coordinates: [
                    [13.405, 52.52],
                    [13.41, 52.521],
                  ],
                },
                legs: [{ steps: [{ name: 'Walk ahead' }] }],
              },
            ],
          }),
        };
      }

      if (String(url).includes('/nearest/v1/')) {
        return {
          ok: true,
          json: async () => ({
            code: 'Ok',
            waypoints: [{ location: [13.4055, 52.5205], name: 'Test Street' }],
          }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const search = await request('/api/map/search?q=berlin&limit=5', { method: 'GET' });
      expect(search.status).toBe(200);
      expect(search.data.results[0].display_name).toContain('Berlin');

      const route = await request(
        '/api/map/route?startLat=52.52&startLon=13.405&endLat=52.521&endLon=13.41',
        { method: 'GET' },
      );
      expect(route.status).toBe(200);
      expect(route.data.route.distance).toBe(1200);
      expect(route.data.route.waypoints).toHaveLength(2);

      const nearest = await request('/api/map/nearest?lat=52.52&lon=13.405', { method: 'GET' });
      expect(nearest.status).toBe(200);
      expect(nearest.data.road).toEqual({
        lat: 52.5205,
        lon: 13.4055,
        name: 'Test Street',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
