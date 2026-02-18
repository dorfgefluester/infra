/**
 * Navigation System Contract Tests
 * 
 * ⚠️ CRITICAL: These tests define the contract that the navigation system MUST fulfill.
 * If any of these tests fail after a code change, the navigation system is broken.
 * 
 * DO NOT modify these tests unless you are intentionally changing the navigation contract.
 */

import { 
  NavigationContract, 
  validatePlayerContract, 
  validateRouterContract 
} from '../../src/systems/NavigationContract.js';

// Mock Logger
jest.mock('../../src/utils/Logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    event: jest.fn()
  }
}));

import Player from '../../src/entities/Player.js';
import OSRMRouter from '../../src/systems/OSRMRouter.js';

describe('Navigation System Contract', () => {
  describe('Player Contract Compliance', () => {
    let mockScene;
    let player;

    beforeEach(() => {
      mockScene = {
        add: {
          circle: jest.fn(() => ({
            setStrokeStyle: jest.fn().mockReturnThis(),
            setData: jest.fn().mockReturnThis(),
            setDepth: jest.fn().mockReturnThis(),
            setPosition: jest.fn().mockReturnThis(),
            destroy: jest.fn()
          }))
        },
        events: { on: jest.fn() },
        animationSystem: null
      };
      player = new Player(mockScene, 0, 0);
    });

    afterEach(() => {
      player?.destroy();
    });

    test('Player MUST conform to NavigationContract', () => {
      const result = validatePlayerContract(player);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error('Contract violations:', result.errors);
      }
    });

    test('Player.setPath MUST accept waypoint array and start movement', () => {
      const path = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
      
      player.setPath(path);
      
      expect(player.isMoving).toBe(true);
      expect(player.path).toEqual(path);
      expect(player.currentPathIndex).toBe(0);
    });

    test('Player.setPath with empty array MUST NOT start movement', () => {
      player.setPath([]);
      expect(player.isMoving).toBe(false);
    });

    test('Player.stopMovement MUST stop and clear path', () => {
      player.setPath([{ x: 100, y: 100 }]);
      expect(player.isMoving).toBe(true);

      player.stopMovement();

      expect(player.isMoving).toBe(false);
      expect(player.path).toEqual([]);
      expect(player.currentPathIndex).toBe(0);
    });

    test('Player.getPosition MUST return {x, y} object', () => {
      player.moveTo(150, 250);
      
      const pos = player.getPosition();
      
      expect(pos).toEqual({ x: 150, y: 250 });
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    });

    test('Player.update MUST move player toward waypoint', () => {
      const startX = player.x;
      player.setPath([{ x: 100, y: 0 }]);
      
      player.update(0, 500); // 0.5 seconds
      
      expect(player.x).toBeGreaterThan(startX);
    });

    test('Player.update MUST advance to next waypoint when reached', () => {
      player.setPath([{ x: 1, y: 0 }, { x: 100, y: 0 }]);
      
      // Move close enough to first waypoint
      player.update(0, 100);
      
      // Should have advanced past first waypoint
      expect(player.currentPathIndex).toBeGreaterThan(0);
    });

    test('Player.update MUST set isMoving=false when path complete', () => {
      player.setPath([{ x: 1, y: 0 }]);
      
      // Complete the path
      for (let i = 0; i < 10; i++) {
        player.update(0, 100);
        if (!player.isMoving) break;
      }
      
      expect(player.isMoving).toBe(false);
    });

    test('Player.moveSpeed MUST affect movement rate', () => {
      const path = [{ x: 1000, y: 0 }];
      
      // Normal speed
      const player1 = new Player(mockScene, 0, 0);
      player1.moveSpeed = 100;
      player1.setPath([...path]);
      player1.update(0, 1000); // 1 second
      const normalDistance = player1.x;
      
      // Double speed
      const player2 = new Player(mockScene, 0, 0);
      player2.moveSpeed = 200;
      player2.setPath([...path]);
      player2.update(0, 1000); // 1 second
      const fastDistance = player2.x;
      
      // Fast player should move approximately twice as far
      expect(fastDistance).toBeGreaterThan(normalDistance * 1.5);
      
      player1.destroy();
      player2.destroy();
    });
  });

  describe('OSRMRouter Contract Compliance', () => {
    let router;

    beforeEach(() => {
      router = new OSRMRouter();
    });

    test('OSRMRouter MUST conform to NavigationContract', () => {
      const result = validateRouterContract(router);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error('Contract violations:', result.errors);
      }
    });

    test('OSRMRouter.getRoute MUST be an async function', () => {
      expect(typeof router.getRoute).toBe('function');
      // Async functions return promises
      const result = router.getRoute(0, 0, 0, 0);
      expect(result).toBeInstanceOf(Promise);
    });

    test('OSRMRouter.waypointsToPixels MUST convert GPS to pixel coordinates', () => {
      const waypoints = [
        { lat: 52.52, lon: 13.405 },
        { lat: 52.53, lon: 13.41 }
      ];
      
      const pixels = router.waypointsToPixels(waypoints, 18);
      
      expect(Array.isArray(pixels)).toBe(true);
      expect(pixels.length).toBe(waypoints.length);
      expect(typeof pixels[0].x).toBe('number');
      expect(typeof pixels[0].y).toBe('number');
    });

    test('OSRMRouter.isAvailable MUST return boolean', () => {
      const result = router.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    test('OSRMRouter.latLonToPixels MUST convert correctly', () => {
      // Test known coordinates
      const result = router.latLonToPixels(52.52, 13.405, 18);
      
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
      expect(result.x).toBeGreaterThan(0);
      expect(result.y).toBeGreaterThan(0);
    });
  });

  describe('Critical Navigation Behaviors', () => {
    let mockScene;
    let player;

    beforeEach(() => {
      mockScene = {
        add: {
          circle: jest.fn(() => ({
            setStrokeStyle: jest.fn().mockReturnThis(),
            setData: jest.fn().mockReturnThis(),
            setDepth: jest.fn().mockReturnThis(),
            setPosition: jest.fn().mockReturnThis(),
            destroy: jest.fn()
          }))
        },
        events: { on: jest.fn() },
        animationSystem: null
      };
      player = new Player(mockScene, 0, 0);
    });

    afterEach(() => {
      player?.destroy();
    });

    test('BEHAVIOR: Player MUST reach exact final waypoint position', () => {
      const finalPos = { x: 50, y: 75 };
      player.setPath([finalPos]);
      
      // Run until stopped
      for (let i = 0; i < 100 && player.isMoving; i++) {
        player.update(0, 100);
      }
      
      expect(player.x).toBe(finalPos.x);
      expect(player.y).toBe(finalPos.y);
    });

    test('BEHAVIOR: Player MUST follow multi-waypoint path in order', () => {
      const path = [
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 150, y: 0 }
      ];
      player.setPath(path);
      
      // Verify path is traversed in order by checking positions
      const positions = [];
      
      for (let i = 0; i < 200 && player.isMoving; i++) {
        player.update(0, 50);
        positions.push({ x: player.x, index: player.currentPathIndex });
      }
      
      // Player should start at 0,0 and end at 150,0
      expect(player.x).toBe(150);
      expect(player.isMoving).toBe(false);
      
      // X position should always be increasing (moving forward through waypoints)
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i].x).toBeGreaterThanOrEqual(positions[i - 1].x);
      }
    });

    test('BEHAVIOR: Setting new path MUST override current path', () => {
      player.setPath([{ x: 1000, y: 0 }]);
      player.update(0, 100); // Start moving
      
      const newPath = [{ x: -100, y: 0 }];
      player.setPath(newPath);
      
      expect(player.path).toEqual(newPath);
      expect(player.currentPathIndex).toBe(0);
    });

    test('BEHAVIOR: Player MUST not move when update called with no path', () => {
      const startX = player.x;
      const startY = player.y;
      
      player.update(0, 1000);
      
      expect(player.x).toBe(startX);
      expect(player.y).toBe(startY);
    });

    test('BEHAVIOR: Player MUST handle diagonal movement correctly', () => {
      player.setPath([{ x: 100, y: 100 }]);
      
      for (let i = 0; i < 50 && player.isMoving; i++) {
        player.update(0, 100);
      }
      
      expect(player.x).toBe(100);
      expect(player.y).toBe(100);
    });
  });
});
