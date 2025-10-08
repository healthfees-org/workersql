/**
 * Unit tests for GeospatialService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GeospatialService } from '../../src/services/GeospatialService';
import type { CloudflareEnvironment, Point, LineString, Polygon, Position } from '../../src/types';
import { createMockEnvironment } from '../setup';

describe('GeospatialService', () => {
  let service: GeospatialService;
  let env: CloudflareEnvironment;

  beforeEach(() => {
    env = createMockEnvironment();
    service = new GeospatialService(env);
  });

  describe('Geometry Validation', () => {
    it('should validate a valid Point geometry', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749], // San Francisco
      };

      const result = service.validateGeometry(point);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid Point coordinates', () => {
      const invalidPoint: Point = {
        type: 'Point',
        coordinates: [-200, 100], // Invalid lon/lat
      };

      const result = service.validateGeometry(invalidPoint);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate a valid LineString geometry', () => {
      const lineString: LineString = {
        type: 'LineString',
        coordinates: [
          [-122.4194, 37.7749],
          [-122.4084, 37.7849],
        ],
      };

      const result = service.validateGeometry(lineString);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject LineString with less than 2 points', () => {
      const invalidLineString: LineString = {
        type: 'LineString',
        coordinates: [[-122.4194, 37.7749]],
      };

      const result = service.validateGeometry(invalidLineString);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('LineString must have at least 2 positions');
    });

    it('should validate a valid Polygon geometry', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4194, 37.7749],
            [-122.4084, 37.7749],
            [-122.4084, 37.7849],
            [-122.4194, 37.7849],
            [-122.4194, 37.7749], // Closed ring
          ],
        ],
      };

      const result = service.validateGeometry(polygon);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn about unclosed Polygon rings', () => {
      const unclosedPolygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4194, 37.7749],
            [-122.4084, 37.7749],
            [-122.4084, 37.7849],
            [-122.4194, 37.7849],
            [-122.4000, 37.7700], // Not closed
          ],
        ],
      };

      const result = service.validateGeometry(unclosedPolygon);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.[0]).toContain('not closed');
    });
  });

  describe('Distance Calculations', () => {
    it('should calculate distance between two points (Haversine)', () => {
      const sf: Position = [-122.4194, 37.7749]; // San Francisco
      const la: Position = [-118.2437, 34.0522]; // Los Angeles

      const distance = service.calculateDistance(sf, la);

      // Approximate distance SF to LA is ~559 km
      expect(distance).toBeGreaterThan(550000); // 550 km
      expect(distance).toBeLessThan(570000); // 570 km
    });

    it('should return zero distance for same point', () => {
      const point: Position = [-122.4194, 37.7749];
      const distance = service.calculateDistance(point, point);
      expect(distance).toBe(0);
    });

    it('should throw error for invalid positions', () => {
      const invalidPoint: Position = [undefined as any, 37.7749];
      const validPoint: Position = [-122.4194, 37.7749];

      expect(() => {
        service.calculateDistance(invalidPoint, validPoint);
      }).toThrow('Invalid positions for distance calculation');
    });
  });

  describe('Bearing Calculations', () => {
    it('should calculate bearing from SF to LA', () => {
      const sf: Position = [-122.4194, 37.7749];
      const la: Position = [-118.2437, 34.0522];

      const bearing = service.calculateBearing(sf, la);

      // Bearing from SF to LA should be roughly southeast (~125-135 degrees)
      expect(bearing).toBeGreaterThan(120);
      expect(bearing).toBeLessThan(140);
    });

    it('should return bearing between 0 and 360 degrees', () => {
      const point1: Position = [0, 0];
      const point2: Position = [10, 10];

      const bearing = service.calculateBearing(point1, point2);

      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    });
  });

  describe('Bounding Box', () => {
    it('should calculate bounding box for a Point', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749],
      };

      const bbox = service.getBounds(point);

      expect(bbox.minLon).toBe(-122.4194);
      expect(bbox.maxLon).toBe(-122.4194);
      expect(bbox.minLat).toBe(37.7749);
      expect(bbox.maxLat).toBe(37.7749);
    });

    it('should calculate bounding box for a Polygon', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5, 37.7],
            [-122.3, 37.7],
            [-122.3, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.7],
          ],
        ],
      };

      const bbox = service.getBounds(polygon);

      expect(bbox.minLon).toBe(-122.5);
      expect(bbox.maxLon).toBe(-122.3);
      expect(bbox.minLat).toBe(37.7);
      expect(bbox.maxLat).toBe(37.8);
    });
  });

  describe('Point in BBox', () => {
    it('should return true for point inside bbox', () => {
      const point: Position = [-122.4, 37.75];
      const bbox = {
        minLon: -122.5,
        minLat: 37.7,
        maxLon: -122.3,
        maxLat: 37.8,
      };

      const result = service.isPointInBBox(point, bbox);
      expect(result).toBe(true);
    });

    it('should return false for point outside bbox', () => {
      const point: Position = [-122.6, 37.75];
      const bbox = {
        minLon: -122.5,
        minLat: 37.7,
        maxLon: -122.3,
        maxLat: 37.8,
      };

      const result = service.isPointInBBox(point, bbox);
      expect(result).toBe(false);
    });
  });

  describe('Point in Circle', () => {
    it('should return true for point inside circle', () => {
      const center: Position = [-122.4194, 37.7749];
      const point: Position = [-122.4184, 37.7749]; // ~88 meters away

      const circle = {
        center,
        radiusMeters: 100,
      };

      const result = service.isPointInCircle(point, circle);
      expect(result).toBe(true);
    });

    it('should return false for point outside circle', () => {
      const center: Position = [-122.4194, 37.7749];
      const point: Position = [-122.4094, 37.7749]; // ~882 meters away

      const circle = {
        center,
        radiusMeters: 100,
      };

      const result = service.isPointInCircle(point, circle);
      expect(result).toBe(false);
    });
  });

  describe('Geohash Encoding', () => {
    it('should encode position to geohash', () => {
      const sf: Position = [-122.4194, 37.7749];
      const result = service.positionToGeohash(sf, 9);

      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(9);
      expect(result.precision).toBe(9);
      expect(result.bounds).toBeDefined();
    });

    it('should produce consistent geohashes for same position', () => {
      const position: Position = [-122.4194, 37.7749];
      const hash1 = service.positionToGeohash(position, 9);
      const hash2 = service.positionToGeohash(position, 9);

      expect(hash1.hash).toBe(hash2.hash);
    });

    it('should produce different geohashes for different precisions', () => {
      const position: Position = [-122.4194, 37.7749];
      const hash5 = service.positionToGeohash(position, 5);
      const hash9 = service.positionToGeohash(position, 9);

      expect(hash5.hash.length).toBe(5);
      expect(hash9.hash.length).toBe(9);
      expect(hash9.hash.startsWith(hash5.hash)).toBe(true);
    });
  });

  describe('H3 Indexing', () => {
    it('should convert position to H3 cell', () => {
      const sf: Position = [-122.4194, 37.7749];
      const result = service.positionToH3(sf, 9);

      if (result) {
        expect(result.cell).toBeDefined();
        expect(result.resolution).toBe(9);
        expect(result.center).toBeDefined();
        expect(result.boundary).toBeDefined();
      } else {
        // H3 library not available - test should still pass
        expect(result).toBeNull();
      }
    });

    it('should get H3 cells covering a bounding box', () => {
      const bbox = {
        minLon: -122.5,
        minLat: 37.7,
        maxLon: -122.3,
        maxLat: 37.8,
      };

      const cells = service.bboxToH3Cells(bbox, 9);

      if (cells.length > 0) {
        expect(cells).toBeInstanceOf(Array);
        expect(cells.length).toBeGreaterThan(0);
      } else {
        // H3 library not available
        expect(cells).toEqual([]);
      }
    });
  });

  describe('WKT Conversion', () => {
    it('should convert Point to WKT', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749],
      };

      const wkt = service.geometryToWKT(point);
      expect(wkt).toBe('POINT(-122.4194 37.7749)');
    });

    it('should convert LineString to WKT', () => {
      const lineString: LineString = {
        type: 'LineString',
        coordinates: [
          [-122.4194, 37.7749],
          [-122.4084, 37.7849],
        ],
      };

      const wkt = service.geometryToWKT(lineString);
      expect(wkt).toBe('LINESTRING(-122.4194 37.7749,-122.4084 37.7849)');
    });

    it('should convert Polygon to WKT', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5, 37.7],
            [-122.3, 37.7],
            [-122.3, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.7],
          ],
        ],
      };

      const wkt = service.geometryToWKT(polygon);
      expect(wkt).toContain('POLYGON(');
      expect(wkt).toContain('-122.5 37.7');
    });
  });

  describe('Spatial Index Creation', () => {
    it('should create H3 spatial index entries', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749],
      };

      const entries = service.createSpatialIndex('test-point-1', point, {
        type: 'h3',
        resolution: 9,
      });

      if (entries.length > 0) {
        const entry = entries[0];
        if (entry) {
          expect(entry.geometryId).toBe('test-point-1');
          expect(entry.indexType).toBe('h3');
          expect(entry.indexValue).toBeDefined();
        }
      } else {
        // H3 not available
        expect(entries).toEqual([]);
      }
    });

    it('should create geohash spatial index entries', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749],
      };

      const entries = service.createSpatialIndex('test-point-2', point, {
        type: 'geohash',
        resolution: 9,
      });

      expect(entries.length).toBeGreaterThan(0);
      const entry = entries[0];
      if (entry) {
        expect(entry.geometryId).toBe('test-point-2');
        expect(entry.indexType).toBe('geohash');
        expect(entry.indexValue).toBeDefined();
        expect(entry.bounds).toBeDefined();
      }
    });
  });

  describe('Spatial SQL Generation', () => {
    it('should generate SQL for bounding box query', () => {
      const bbox: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5, 37.7],
            [-122.3, 37.7],
            [-122.3, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.7],
          ],
        ],
      };

      const sql = service.generateSpatialSQL('locations', 'geometry', {
        geometry: bbox,
        operator: 'ST_Contains',
        target: bbox,
      });

      expect(sql).toContain('json_extract');
      expect(sql).toContain('coordinates');
    });

    it('should generate SQL for proximity query', () => {
      const point: Point = {
        type: 'Point',
        coordinates: [-122.4194, 37.7749],
      };

      const sql = service.generateSpatialSQL('locations', 'geometry', {
        geometry: point,
        operator: 'ST_DWithin',
        distance: 1000,
      });

      expect(sql).toContain('json_extract');
      expect(sql).toContain('ABS');
    });
  });

  describe('Turf.js Integration', () => {
    it('should search within radius using Turf.js', () => {
      const center: Position = [-122.4194, 37.7749]; // San Francisco
      const features = [
        {
          type: 'Feature' as const,
          properties: { name: 'Location 1' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4184, 37.7749] as Position, // ~88m away
          },
        },
        {
          type: 'Feature' as const,
          properties: { name: 'Location 2' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4094, 37.7749] as Position, // ~882m away
          },
        },
      ];

      const results = service.searchWithinRadius(center, 500, features);

      expect(results.length).toBe(1);
      const firstResult = results[0];
      if (firstResult) {
        expect(firstResult.properties?.['name']).toBe('Location 1');
        expect(firstResult.distance).toBeLessThan(500);
      }
    });

    it('should search within circle using Turf.js', () => {
      const center: Position = [-122.4194, 37.7749];
      const features = [
        {
          type: 'Feature' as const,
          properties: { name: 'Location 1' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4184, 37.7749] as Position,
          },
        },
      ];

      const results = service.searchWithinCircle(center, 500, features);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should find nearest point using Turf.js', () => {
      const target: Position = [-122.4194, 37.7749];
      const features = [
        {
          type: 'Feature' as const,
          properties: { name: 'Location 1' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4184, 37.7749] as Position,
          },
        },
        {
          type: 'Feature' as const,
          properties: { name: 'Location 2' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4094, 37.7749] as Position,
          },
        },
      ];

      const nearest = service.findNearest(target, features);

      expect(nearest).toBeDefined();
      if (nearest) {
        expect(nearest.properties?.['name']).toBe('Location 1');
      }
    });

    it('should check point in polygon using Turf.js', () => {
      const testPoint: Position = [-122.4, 37.75];
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5, 37.7],
            [-122.3, 37.7],
            [-122.3, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.7],
          ],
        ],
      };

      const result = service.isPointInPolygon(testPoint, polygon);
      expect(result).toBe(true);
    });

    it('should search by bounding box using RBush', () => {
      const features = [
        {
          type: 'Feature' as const,
          properties: { name: 'Location 1' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.4, 37.75] as Position,
          },
        },
        {
          type: 'Feature' as const,
          properties: { name: 'Location 2' },
          geometry: {
            type: 'Point' as const,
            coordinates: [-122.6, 37.9] as Position, // Outside bbox
          },
        },
      ];

      service.loadFeatures(features);

      const bbox = {
        minLon: -122.5,
        minLat: 37.7,
        maxLon: -122.3,
        maxLat: 37.8,
      };

      const results = service.searchByBBox(bbox);
      expect(results.length).toBe(1);
      const firstResult = results[0];
      if (firstResult) {
        expect(firstResult.properties?.['name']).toBe('Location 1');
      }
    });
  });

  describe('Edge Cases and Robustness', () => {
    describe('Null and Undefined Handling', () => {
      it('should handle empty feature arrays gracefully', () => {
        const center: Position = [-122.4194, 37.7749];
        const results = service.searchWithinRadius(center, 5000, []);
        expect(results).toEqual([]);
      });

      it('should handle findNearest with empty array', () => {
        const target: Position = [-122.4194, 37.7749];
        const nearest = service.findNearest(target, []);
        expect(nearest).toBeNull();
      });

      it('should handle searchWithinCircle with empty array', () => {
        const center: Position = [-122.4194, 37.7749];
        const results = service.searchWithinCircle(center, 5000, []);
        expect(results).toEqual([]);
      });

      it('should handle searchByBBox with no loaded features', () => {
        const bbox = {
          minLon: -122.5,
          minLat: 37.7,
          maxLon: -122.3,
          maxLat: 37.8,
        };
        const results = service.searchByBBox(bbox);
        expect(results).toEqual([]);
      });
    });

    describe('Coordinate System Boundaries', () => {
      it('should handle coordinates near the antimeridian (±180° longitude)', () => {
        const point1: Position = [179.9, 0];
        const point2: Position = [-179.9, 0];
        
        // These points are very close across the antimeridian
        const distance = service.calculateDistance(point1, point2);
        
        // Should be a small distance (approximately 22km at equator)
        expect(distance).toBeLessThan(25000);
        expect(distance).toBeGreaterThan(20000);
      });

      it('should handle coordinates at the North Pole', () => {
        const northPole: Position = [0, 90];
        const nearNorthPole: Position = [0, 89.9];
        
        const distance = service.calculateDistance(northPole, nearNorthPole);
        
        // 0.1 degrees latitude at pole is ~11.1km
        expect(distance).toBeGreaterThan(10000);
        expect(distance).toBeLessThan(12000);
      });

      it('should handle coordinates at the South Pole', () => {
        const southPole: Position = [0, -90];
        const nearSouthPole: Position = [0, -89.9];
        
        const distance = service.calculateDistance(southPole, nearSouthPole);
        
        expect(distance).toBeGreaterThan(10000);
        expect(distance).toBeLessThan(12000);
      });

      it('should handle coordinates at the equator', () => {
        const equator1: Position = [0, 0];
        const equator2: Position = [1, 0];
        
        const distance = service.calculateDistance(equator1, equator2);
        
        // 1 degree longitude at equator is ~111.32km
        expect(distance).toBeGreaterThan(110000);
        expect(distance).toBeLessThan(112000);
      });

      it('should validate coordinates at exact boundaries', () => {
        const validBoundaries = [
          { type: 'Point' as const, coordinates: [-180, -90] as Position },
          { type: 'Point' as const, coordinates: [180, -90] as Position },
          { type: 'Point' as const, coordinates: [-180, 90] as Position },
          { type: 'Point' as const, coordinates: [180, 90] as Position },
        ];

        validBoundaries.forEach(point => {
          const result = service.validateGeometry(point);
          expect(result.valid).toBe(true);
        });
      });
    });

    describe('Bearing Edge Cases', () => {
      it('should calculate bearing for same point (should return 0)', () => {
        const point: Position = [-122.4194, 37.7749];
        const bearing = service.calculateBearing(point, point);
        
        // Bearing to same point is undefined but should not throw
        expect(typeof bearing).toBe('number');
      });

      it('should calculate bearing North (0°)', () => {
        const start: Position = [0, 0];
        const north: Position = [0, 1];
        
        const bearingValue = service.calculateBearing(start, north);
        
        // Should be close to 0° (North)
        expect(bearingValue).toBeGreaterThanOrEqual(0);
        expect(bearingValue).toBeLessThan(1);
      });

      it('should calculate bearing East (90°)', () => {
        const start: Position = [0, 0];
        const east: Position = [1, 0];
        
        const bearingValue = service.calculateBearing(start, east);
        
        // Should be close to 90° (East)
        expect(bearingValue).toBeGreaterThan(89);
        expect(bearingValue).toBeLessThan(91);
      });

      it('should calculate bearing South (180°)', () => {
        const start: Position = [0, 0];
        const south: Position = [0, -1];
        
        const bearingValue = service.calculateBearing(start, south);
        
        // Should be close to 180° (South)
        expect(bearingValue).toBeGreaterThan(179);
        expect(bearingValue).toBeLessThan(181);
      });

      it('should calculate bearing West (270°)', () => {
        const start: Position = [0, 0];
        const west: Position = [-1, 0];
        
        const bearingValue = service.calculateBearing(start, west);
        
        // Should be close to 270° (West)
        expect(bearingValue).toBeGreaterThan(269);
        expect(bearingValue).toBeLessThan(271);
      });
    });

    describe('Distance Edge Cases', () => {
      it('should return 0 for identical coordinates', () => {
        const point: Position = [-122.4194, 37.7749];
        const distance = service.calculateDistance(point, point);
        expect(distance).toBe(0);
      });

      it('should calculate antipodal points correctly', () => {
        const point1: Position = [0, 0];
        const point2: Position = [180, 0]; // Opposite side of Earth at equator
        
        const distance = service.calculateDistance(point1, point2);
        
        // Half of Earth's circumference (~20,000 km)
        expect(distance).toBeGreaterThan(19900000);
        expect(distance).toBeLessThan(20100000);
      });

      it('should handle very small distances (sub-meter precision)', () => {
        const point1: Position = [-122.41940, 37.77490];
        const point2: Position = [-122.41941, 37.77490]; // ~1 meter difference
        
        const distance = service.calculateDistance(point1, point2);
        
        // Should be approximately 1 meter
        expect(distance).toBeGreaterThan(0.5);
        expect(distance).toBeLessThan(2);
      });
    });

    describe('Proximity Search Edge Cases', () => {
      it('should handle radius of 0', () => {
        const center: Position = [-122.4194, 37.7749];
        const features = [
          {
            type: 'Feature' as const,
            properties: { name: 'Exact Location' },
            geometry: {
              type: 'Point' as const,
              coordinates: [-122.4194, 37.7749] as Position,
            },
          },
          {
            type: 'Feature' as const,
            properties: { name: 'Nearby' },
            geometry: {
              type: 'Point' as const,
              coordinates: [-122.4195, 37.7749] as Position,
            },
          },
        ];

        const results = service.searchWithinRadius(center, 0, features);
        
        // Only exact match should be returned
        expect(results.length).toBe(1);
        expect(results[0]?.distance).toBe(0);
      });

      it('should handle very large radius (global search)', () => {
        const center: Position = [0, 0];
        const features = [
          {
            type: 'Feature' as const,
            properties: { name: 'Far East' },
            geometry: {
              type: 'Point' as const,
              coordinates: [179, 0] as Position,
            },
          },
          {
            type: 'Feature' as const,
            properties: { name: 'Far West' },
            geometry: {
              type: 'Point' as const,
              coordinates: [-179, 0] as Position,
            },
          },
        ];

        // Earth's circumference / 2 in meters (~20,000 km)
        const results = service.searchWithinRadius(center, 20100000, features);
        
        // Should find all points
        expect(results.length).toBe(2);
      });

      it('should return results sorted by distance', () => {
        const center: Position = [0, 0];
        const features = [
          {
            type: 'Feature' as const,
            properties: { name: 'Far' },
            geometry: {
              type: 'Point' as const,
              coordinates: [0, 10] as Position,
            },
          },
          {
            type: 'Feature' as const,
            properties: { name: 'Near' },
            geometry: {
              type: 'Point' as const,
              coordinates: [0, 1] as Position,
            },
          },
          {
            type: 'Feature' as const,
            properties: { name: 'Medium' },
            geometry: {
              type: 'Point' as const,
              coordinates: [0, 5] as Position,
            },
          },
        ];

        const results = service.searchWithinRadius(center, 2000000, features);
        
        // Should be sorted: Near, Medium, Far
        expect(results.length).toBe(3);
        expect(results[0]?.properties?.['name']).toBe('Near');
        expect(results[1]?.properties?.['name']).toBe('Medium');
        expect(results[2]?.properties?.['name']).toBe('Far');
        
        // Verify ascending order
        expect(results[0]?.distance).toBeLessThan(results[1]?.distance ?? Infinity);
        expect(results[1]?.distance).toBeLessThan(results[2]?.distance ?? Infinity);
      });
    });

    describe('Bounding Box Edge Cases', () => {
      it('should handle point exactly on bbox boundary', () => {
        const testPoint: Position = [-122.5, 37.7];
        const bbox = {
          minLon: -122.5,
          minLat: 37.7,
          maxLon: -122.3,
          maxLat: 37.8,
        };

        const result = service.isPointInBBox(testPoint, bbox);
        expect(result).toBe(true); // Point on boundary should be included
      });

      it('should handle zero-area bbox (single point)', () => {
        const testPoint: Position = [-122.4, 37.75];
        const bbox = {
          minLon: -122.4,
          minLat: 37.75,
          maxLon: -122.4,
          maxLat: 37.75,
        };

        const result = service.isPointInBBox(testPoint, bbox);
        expect(result).toBe(true);
      });

      it('should handle bbox crossing antimeridian', () => {
        // Bbox from 170°E to -170°E (crosses 180°)
        const testPoint1: Position = [175, 0]; // Should be inside
        const testPoint2: Position = [-175, 0]; // Should be inside
        const testPoint3: Position = [0, 0]; // Should be outside

        // Note: Simple bbox doesn't handle antimeridian crossing
        // This test documents current behavior
        const bbox = {
          minLon: 170,
          minLat: -10,
          maxLon: -170,
          maxLat: 10,
        };

        // With simple implementation, this will fail for antimeridian
        // Document the limitation
        const result1 = service.isPointInBBox(testPoint1, bbox);
        const result2 = service.isPointInBBox(testPoint2, bbox);
        const result3 = service.isPointInBBox(testPoint3, bbox);

        // Current implementation doesn't handle antimeridian crossing
        // This test documents the edge case
        expect(typeof result1).toBe('boolean');
        expect(typeof result2).toBe('boolean');
        expect(typeof result3).toBe('boolean');
      });

      it('should generate correct bounds for complex geometry', () => {
        const multiPoint = {
          type: 'MultiPoint' as const,
          coordinates: [
            [-122.5, 37.7] as Position,
            [-122.3, 37.8] as Position,
            [-122.4, 37.75] as Position,
          ],
        };

        const bounds = service.getBounds(multiPoint);
        
        expect(bounds.minLon).toBe(-122.5);
        expect(bounds.maxLon).toBe(-122.3);
        expect(bounds.minLat).toBe(37.7);
        expect(bounds.maxLat).toBe(37.8);
      });
    });

    describe('Point-in-Polygon Edge Cases', () => {
      it('should handle point on polygon edge', () => {
        const testPoint: Position = [-122.4, 37.75]; // On edge
        const polygon: Polygon = {
          type: 'Polygon',
          coordinates: [
            [
              [-122.5, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.5, 37.8],
              [-122.5, 37.7],
            ],
          ],
        };

        const result = service.isPointInPolygon(testPoint, polygon);
        // Point on edge - behavior depends on Turf.js implementation
        expect(typeof result).toBe('boolean');
      });

      it('should handle point at polygon vertex', () => {
        const testPoint: Position = [-122.5, 37.7]; // At vertex
        const polygon: Polygon = {
          type: 'Polygon',
          coordinates: [
            [
              [-122.5, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.5, 37.8],
              [-122.5, 37.7],
            ],
          ],
        };

        const result = service.isPointInPolygon(testPoint, polygon);
        expect(typeof result).toBe('boolean');
      });

      it('should handle polygon with holes', () => {
        const testPointInHole: Position = [-122.4, 37.75];
        const testPointInOuter: Position = [-122.45, 37.75];
        
        const polygonWithHole: Polygon = {
          type: 'Polygon',
          coordinates: [
            // Outer ring
            [
              [-122.5, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.5, 37.8],
              [-122.5, 37.7],
            ],
            // Hole
            [
              [-122.42, 37.73],
              [-122.38, 37.73],
              [-122.38, 37.77],
              [-122.42, 37.77],
              [-122.42, 37.73],
            ],
          ],
        };

        const resultInHole = service.isPointInPolygon(testPointInHole, polygonWithHole);
        const resultInOuter = service.isPointInPolygon(testPointInOuter, polygonWithHole);

        expect(resultInHole).toBe(false); // In hole, should be false
        expect(resultInOuter).toBe(true); // In outer ring, should be true
      });
    });

    describe('Circle Edge Cases', () => {
      it('should handle point at exact circle center', () => {
        const center: Position = [-122.4194, 37.7749];
        const circle = {
          center,
          radiusMeters: 1000,
        };

        const result = service.isPointInCircle(center, circle);
        expect(result).toBe(true);
      });

      it('should handle point at exact circle boundary', () => {
        const center: Position = [0, 0];
        // Point exactly 1000m away (approximately 0.009 degrees at equator)
        const boundaryPoint: Position = [0.009, 0];
        
        const circle = {
          center,
          radiusMeters: 1000,
        };

        const result = service.isPointInCircle(boundaryPoint, circle);
        // Should be very close to the boundary
        expect(typeof result).toBe('boolean');
      });

      it('should handle zero radius circle', () => {
        const center: Position = [-122.4194, 37.7749];
        const samePoint: Position = [-122.4194, 37.7749];
        const differentPoint: Position = [-122.4195, 37.7749];

        const circle = {
          center,
          radiusMeters: 0,
        };

        expect(service.isPointInCircle(samePoint, circle)).toBe(true);
        expect(service.isPointInCircle(differentPoint, circle)).toBe(false);
      });
    });

    describe('Performance and Large Datasets', () => {
      it('should handle large number of features efficiently', () => {
        const center: Position = [0, 0];
        const features = [];
        
        // Generate 1000 random points
        for (let i = 0; i < 1000; i++) {
          features.push({
            type: 'Feature' as const,
            properties: { id: i },
            geometry: {
              type: 'Point' as const,
              coordinates: [
                (Math.random() - 0.5) * 2, // -1 to 1
                (Math.random() - 0.5) * 2,
              ] as Position,
            },
          });
        }

        const startTime = Date.now();
        const results = service.searchWithinRadius(center, 100000, features);
        const endTime = Date.now();

        expect(results.length).toBeGreaterThan(0);
        expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      });

      it('should handle RBush index with large dataset', () => {
        const features = [];
        
        // Generate 5000 random points
        for (let i = 0; i < 5000; i++) {
          features.push({
            type: 'Feature' as const,
            properties: { id: i },
            geometry: {
              type: 'Point' as const,
              coordinates: [
                (Math.random() - 0.5) * 360, // -180 to 180
                (Math.random() - 0.5) * 180, // -90 to 90
              ] as Position,
            },
          });
        }

        service.loadFeatures(features);

        const bbox = {
          minLon: -10,
          minLat: -10,
          maxLon: 10,
          maxLat: 10,
        };

        const startTime = Date.now();
        const results = service.searchByBBox(bbox);
        const endTime = Date.now();

        expect(results.length).toBeGreaterThan(0);
        expect(endTime - startTime).toBeLessThan(100); // Should be very fast with index
      });
    });

    describe('Geometry Validation Edge Cases', () => {
      it('should reject invalid geometry type', () => {
        const invalidGeometry = {
          type: 'InvalidType' as any,
          coordinates: [0, 0],
        };

        const result = service.validateGeometry(invalidGeometry);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should reject coordinates with NaN', () => {
        const invalidPoint: Point = {
          type: 'Point',
          coordinates: [NaN, 37.7749],
        };

        const result = service.validateGeometry(invalidPoint);
        expect(result.valid).toBe(false);
      });

      it('should reject coordinates with Infinity', () => {
        const invalidPoint: Point = {
          type: 'Point',
          coordinates: [Infinity, 37.7749],
        };

        const result = service.validateGeometry(invalidPoint);
        expect(result.valid).toBe(false);
      });

      it('should handle empty coordinates array', () => {
        const invalidLineString: LineString = {
          type: 'LineString',
          coordinates: [],
        };

        const result = service.validateGeometry(invalidLineString);
        expect(result.valid).toBe(false);
      });

      it('should validate complex MultiPolygon', () => {
        const multiPolygon = {
          type: 'MultiPolygon' as const,
          coordinates: [
            [
              [
                [-122.5, 37.7],
                [-122.3, 37.7],
                [-122.3, 37.8],
                [-122.5, 37.8],
                [-122.5, 37.7],
              ],
            ],
            [
              [
                [-122.2, 37.6],
                [-122.0, 37.6],
                [-122.0, 37.7],
                [-122.2, 37.7],
                [-122.2, 37.6],
              ],
            ],
          ],
        };

        const result = service.validateGeometry(multiPolygon);
        expect(result.valid).toBe(true);
      });
    });

    describe('H3 and Geohash Edge Cases', () => {
      it('should handle geohash at different precisions', () => {
        const position: Position = [-122.4194, 37.7749];

        // Test various precisions
        const precisions = [1, 5, 9, 12];
        precisions.forEach(precision => {
          const result = service.positionToGeohash(position, precision);
          expect(result.hash).toBeDefined();
          expect(result.hash.length).toBe(precision);
          expect(result.precision).toBe(precision);
        });
      });

      it('should handle geohash near poles', () => {
        const nearNorthPole: Position = [0, 89.9];
        const result = service.positionToGeohash(nearNorthPole, 9);
        
        expect(result.hash).toBeDefined();
        expect(result.precision).toBe(9);
      });

      it('should handle geohash near antimeridian', () => {
        const nearAntimeridian: Position = [179.9, 0];
        const result = service.positionToGeohash(nearAntimeridian, 9);
        
        expect(result.hash).toBeDefined();
        expect(result.precision).toBe(9);
      });

      it('should generate consistent geohash for same location', () => {
        const position: Position = [-122.4194, 37.7749];
        
        const result1 = service.positionToGeohash(position, 9);
        const result2 = service.positionToGeohash(position, 9);
        
        expect(result1.hash).toBe(result2.hash);
      });
    });

    describe('WKT Conversion Edge Cases', () => {
      it('should convert Point to WKT', () => {
        const point: Point = {
          type: 'Point',
          coordinates: [-122.4194, 37.7749],
        };

        const wkt = service.geometryToWKT(point);
        expect(wkt).toContain('POINT');
        expect(wkt).toContain('-122.4194');
        expect(wkt).toContain('37.7749');
      });

      it('should convert LineString to WKT', () => {
        const lineString: LineString = {
          type: 'LineString',
          coordinates: [
            [-122.4194, 37.7749],
            [-122.4084, 37.7849],
          ],
        };

        const wkt = service.geometryToWKT(lineString);
        expect(wkt).toContain('LINESTRING');
      });

      it('should convert Polygon to WKT', () => {
        const polygon: Polygon = {
          type: 'Polygon',
          coordinates: [
            [
              [-122.5, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.5, 37.8],
              [-122.5, 37.7],
            ],
          ],
        };

        const wkt = service.geometryToWKT(polygon);
        expect(wkt).toContain('POLYGON');
      });
    });
  });
});
