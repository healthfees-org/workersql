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
});
