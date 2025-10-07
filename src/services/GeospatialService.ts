/**
 * GeospatialService - Provides comprehensive geospatial and GeoJSON support
 *
 * Features:
 * - GeoJSON storage and validation
 * - H3 and S2 cell indexing
 * - Proximity and bounding box queries
 * - Spatial relationship operators
 * - Distance calculations (Haversine formula)
 * - Geometry validation and transformation
 */

import { BaseService } from './BaseService';
import type { CloudflareEnvironment } from '../types';
import type {
  Geometry,
  Point,
  LineString,
  Polygon,
  Position,
  BoundingBox,
  Circle,
  SpatialIndexConfig,
  SpatialQueryRequest,
  SpatialIndexEntry,
  GeometryValidationResult,
  GeospatialStorageOptions,
  H3Index,
  S2CellId,
  GeohashIndex,
} from '../types/geospatial';

// Import H3 library with optional handling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let h3: any = null;

try {
  h3 = await import('h3-js');
} catch {
  // H3 not available - H3 indexing will be disabled
}

/**
 * Earth radius in meters (mean radius)
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Default H3 resolution for spatial indexing
 */
const DEFAULT_H3_RESOLUTION = 9; // ~174m hexagon edge

/**
 * Default S2 level for spatial indexing (not used currently)
 */
const DEFAULT_S2_LEVEL = 15; // ~200m cells

/**
 * GeospatialService implementation
 */
export class GeospatialService extends BaseService {
  private readonly storageOptions: GeospatialStorageOptions;

  constructor(env: CloudflareEnvironment) {
    super(env);

    // Initialize storage options from environment or use defaults
    this.storageOptions = {
      format: 'geojson',
      autoIndex: true,
      defaultIndexType: 'h3',
      h3Resolution: DEFAULT_H3_RESOLUTION,
      s2Level: DEFAULT_S2_LEVEL,
      validateGeometry: true,
    };
  }

  /**
   * Validate GeoJSON geometry
   */
  validateGeometry(geometry: Geometry): GeometryValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!geometry || !geometry.type) {
      errors.push('Geometry must have a type property');
      return { valid: false, errors };
    }

    const validTypes = [
      'Point',
      'LineString',
      'Polygon',
      'MultiPoint',
      'MultiLineString',
      'MultiPolygon',
      'GeometryCollection',
    ];

    if (!validTypes.includes(geometry.type)) {
      errors.push(`Invalid geometry type: ${geometry.type}`);
      return { valid: false, errors };
    }

    // Validate coordinates based on type
    switch (geometry.type) {
      case 'Point':
        if (!this.isValidPosition((geometry as Point).coordinates)) {
          errors.push('Invalid Point coordinates');
        }
        break;

      case 'LineString':
        if (
          !Array.isArray((geometry as LineString).coordinates) ||
          (geometry as LineString).coordinates.length < 2
        ) {
          errors.push('LineString must have at least 2 positions');
        }
        (geometry as LineString).coordinates.forEach((pos, idx) => {
          if (!this.isValidPosition(pos)) {
            errors.push(`Invalid position at index ${idx}`);
          }
        });
        break;

      case 'Polygon': {
        const rings = (geometry as Polygon).coordinates;
        if (!Array.isArray(rings) || rings.length === 0) {
          errors.push('Polygon must have at least one ring');
        }
        rings.forEach((ring, ringIdx) => {
          if (!Array.isArray(ring) || ring.length < 4) {
            errors.push(`Ring ${ringIdx} must have at least 4 positions`);
          }
          const firstPos = ring[0];
          const lastPos = ring[ring.length - 1];
          if (
            ring.length >= 4 &&
            firstPos !== undefined &&
            lastPos !== undefined &&
            !this.arePositionsEqual(firstPos, lastPos)
          ) {
            warnings.push(`Ring ${ringIdx} is not closed (first != last position)`);
          }
          ring.forEach((pos, idx) => {
            if (!this.isValidPosition(pos)) {
              errors.push(`Invalid position at ring ${ringIdx}, index ${idx}`);
            }
          });
        });
        break;
      }

      // Add validation for other geometry types as needed
    }

    return {
      valid: errors.length === 0,
      errors,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Check if position is valid [lon, lat] or [lon, lat, elevation]
   */
  private isValidPosition(pos: Position): boolean {
    if (!Array.isArray(pos) || pos.length < 2 || pos.length > 3) {
      return false;
    }
    const lon = pos[0];
    const lat = pos[1];
    return (
      typeof lon === 'number' &&
      typeof lat === 'number' &&
      lon >= -180 &&
      lon <= 180 &&
      lat >= -90 &&
      lat <= 90
    );
  }

  /**
   * Check if two positions are equal
   */
  private arePositionsEqual(pos1: Position, pos2: Position): boolean {
    return pos1[0] === pos2[0] && pos1[1] === pos2[1];
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in meters
   */
  calculateDistance(point1: Position, point2: Position): number {
    const lon1 = point1[0];
    const lat1 = point1[1];
    const lon2 = point2[0];
    const lat2 = point2[1];

    if (
      lon1 === undefined ||
      lat1 === undefined ||
      lon2 === undefined ||
      lat2 === undefined
    ) {
      throw new Error('Invalid positions for distance calculation');
    }

    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(deltaLon / 2) *
        Math.sin(deltaLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
  }

  /**
   * Calculate bearing from point1 to point2 in degrees
   */
  calculateBearing(point1: Position, point2: Position): number {
    const lon1 = point1[0];
    const lat1 = point1[1];
    const lon2 = point2[0];
    const lat2 = point2[1];

    if (
      lon1 === undefined ||
      lat1 === undefined ||
      lon2 === undefined ||
      lat2 === undefined
    ) {
      throw new Error('Invalid positions for bearing calculation');
    }

    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const toDegrees = (radians: number) => (radians * 180) / Math.PI;

    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);
    const deltaLon = toRadians(lon2 - lon1);

    const y = Math.sin(deltaLon) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);

    const bearing = toDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360; // Normalize to 0-360
  }

  /**
   * Get bounding box for a geometry
   */
  getBounds(geometry: Geometry): BoundingBox {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const processPosition = (pos: Position) => {
      const lon = pos[0];
      const lat = pos[1];
      if (lon !== undefined && lat !== undefined) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    };

    const processCoordinates = (coords: unknown) => {
      if (Array.isArray(coords) && typeof coords[0] === 'number') {
        // Single position
        processPosition(coords as Position);
      } else if (Array.isArray(coords) && Array.isArray(coords[0])) {
        // Array of positions or deeper
        coords.forEach(processCoordinates);
      }
    };

    if ('coordinates' in geometry) {
      processCoordinates(geometry.coordinates);
    }

    return { minLon, minLat, maxLon, maxLat };
  }

  /**
   * Check if a point is within a bounding box
   */
  isPointInBBox(point: Position, bbox: BoundingBox): boolean {
    const lon = point[0];
    const lat = point[1];
    
    if (lon === undefined || lat === undefined) {
      return false;
    }

    return (
      lon >= bbox.minLon &&
      lon <= bbox.maxLon &&
      lat >= bbox.minLat &&
      lat <= bbox.maxLat
    );
  }

  /**
   * Check if a point is within a circle
   */
  isPointInCircle(point: Position, circle: Circle): boolean {
    const distance = this.calculateDistance(point, circle.center);
    return distance <= circle.radiusMeters;
  }

  /**
   * Convert position to H3 cell index
   */
  positionToH3(position: Position, resolution?: number): H3Index | null {
    if (!h3) {
      console.warn('H3 library not available');
      return null;
    }

    const res = resolution ?? this.storageOptions.h3Resolution ?? DEFAULT_H3_RESOLUTION;
    const lon = position[0];
    const lat = position[1];

    if (lon === undefined || lat === undefined) {
      return null;
    }

    try {
      const cell = h3.latLngToCell(lat, lon, res);
      const center = h3.cellToLatLng(cell);
      const boundary = h3.cellToBoundary(cell);

      return {
        cell,
        resolution: res,
        center: [center[1], center[0]], // Convert [lat, lon] to [lon, lat]
        boundary: boundary.map((p: number[]) => [p[1], p[0]] as Position),
      };
    } catch (error) {
      console.error('Failed to convert position to H3', { error, position });
      return null;
    }
  }

  /**
   * Get H3 cells covering a bounding box
   */
  bboxToH3Cells(bbox: BoundingBox, resolution?: number): string[] {
    if (!h3) {
      console.warn('H3 library not available');
      return [];
    }

    const res = resolution ?? this.storageOptions.h3Resolution ?? DEFAULT_H3_RESOLUTION;

    try {
      // Create polygon from bbox - convert to [lat, lon] for H3
      const polygon = [
        [
          [bbox.minLat, bbox.minLon],
          [bbox.minLat, bbox.maxLon],
          [bbox.maxLat, bbox.maxLon],
          [bbox.maxLat, bbox.minLon],
          [bbox.minLat, bbox.minLon],
        ],
      ];

      return h3.polygonToCells(polygon, res);
    } catch (error) {
      console.error('Failed to convert bbox to H3 cells', { error, bbox });
      return [];
    }
  }

  /**
   * Convert position to S2 cell ID (placeholder - S2 library has compatibility issues)
   */
  positionToS2(_position: Position, _level?: number): S2CellId | null {
    console.warn('S2 indexing not currently available');
    // S2 library omitted due to type compatibility issues
    return null;
  }

  /**
   * Generate geohash for a position
   */
  positionToGeohash(position: Position, precision: number = 9): GeohashIndex {
    const lon = position[0];
    const lat = position[1];

    if (lon === undefined || lat === undefined) {
      throw new Error('Invalid position for geohash');
    }

    const hash = this.encodeGeohash(lat, lon, precision);
    const bounds = this.geohashToBounds(hash);

    return { hash, precision, bounds };
  }

  /**
   * Encode position to geohash string
   */
  private encodeGeohash(lat: number, lon: number, precision: number): string {
    const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    let idx = 0;
    let bit = 0;
    let evenBit = true;
    let geohash = '';

    let latMin = -90,
      latMax = 90;
    let lonMin = -180,
      lonMax = 180;

    while (geohash.length < precision) {
      if (evenBit) {
        const lonMid = (lonMin + lonMax) / 2;
        if (lon > lonMid) {
          idx |= 1 << (4 - bit);
          lonMin = lonMid;
        } else {
          lonMax = lonMid;
        }
      } else {
        const latMid = (latMin + latMax) / 2;
        if (lat > latMid) {
          idx |= 1 << (4 - bit);
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }

      evenBit = !evenBit;

      if (bit < 4) {
        bit++;
      } else {
        geohash += base32[idx];
        bit = 0;
        idx = 0;
      }
    }

    return geohash;
  }

  /**
   * Decode geohash to bounding box
   */
  private geohashToBounds(geohash: string): BoundingBox {
    let evenBit = true;
    let latMin = -90,
      latMax = 90;
    let lonMin = -180,
      lonMax = 180;

    const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    for (let i = 0; i < geohash.length; i++) {
      const chr = geohash[i];
      if (!chr) {continue;}
      
      const idx = base32.indexOf(chr);

      if (idx === -1) {
        throw new Error(`Invalid geohash character: ${chr}`);
      }

      for (let n = 4; n >= 0; n--) {
        const bit = (idx >> n) & 1;

        if (evenBit) {
          const lonMid = (lonMin + lonMax) / 2;
          if (bit === 1) {
            lonMin = lonMid;
          } else {
            lonMax = lonMid;
          }
        } else {
          const latMid = (latMin + latMax) / 2;
          if (bit === 1) {
            latMin = latMid;
          } else {
            latMax = latMid;
          }
        }

        evenBit = !evenBit;
      }
    }

    return { minLon: lonMin, minLat: latMin, maxLon: lonMax, maxLat: latMax };
  }

  /**
   * Create spatial index entry for a geometry
   */
  createSpatialIndex(
    geometryId: string,
    geometry: Geometry,
    config?: SpatialIndexConfig
  ): SpatialIndexEntry[] {
    const entries: SpatialIndexEntry[] = [];
    const indexType = config?.type ?? this.storageOptions.defaultIndexType;
    const bounds = this.getBounds(geometry);

    switch (indexType) {
      case 'h3': {
        const cells = this.bboxToH3Cells(bounds, config?.resolution);
        cells.forEach((cell) => {
          entries.push({
            geometryId,
            indexType: 'h3',
            indexValue: cell,
            geometry,
            bounds,
            createdAt: Date.now(),
          });
        });
        break;
      }

      case 's2': {
        // S2 not currently available
        console.warn('S2 indexing not available');
        break;
      }

      case 'geohash': {
        const center: Position = [
          (bounds.minLon + bounds.maxLon) / 2,
          (bounds.minLat + bounds.maxLat) / 2,
        ];
        const geohash = this.positionToGeohash(center, config?.resolution ?? 9);
        entries.push({
          geometryId,
          indexType: 'geohash',
          indexValue: geohash.hash,
          geometry,
          bounds,
          createdAt: Date.now(),
        });
        break;
      }

      default:
        console.warn(`Unsupported index type: ${indexType}`);
    }

    return entries;
  }

  /**
   * Convert geometry to WKT (Well-Known Text)
   */
  geometryToWKT(geometry: Geometry): string {
    const positionToString = (pos: Position) => `${pos[0]} ${pos[1]}`;

    switch (geometry.type) {
      case 'Point':
        return `POINT(${positionToString((geometry as Point).coordinates)})`;

      case 'LineString': {
        const lineCoords = (geometry as LineString).coordinates
          .map(positionToString)
          .join(',');
        return `LINESTRING(${lineCoords})`;
      }

      case 'Polygon': {
        const ringStrings = (geometry as Polygon).coordinates.map(
          (ring) => `(${ring.map(positionToString).join(',')})`
        );
        return `POLYGON(${ringStrings.join(',')})`;
      }

      default:
        throw new Error(`Unsupported geometry type for WKT: ${geometry.type}`);
    }
  }

  /**
   * Generate SQL for geospatial queries
   * Note: This generates SQLite-compatible JSON queries, not spatial extensions
   */
  generateSpatialSQL(_table: string, column: string, query: SpatialQueryRequest): string {
    // For SQLite without spatial extensions, we use JSON functions
    // and store geometries as GeoJSON text
    const sqlParts: string[] = [];

    switch (query.operator) {
      case 'ST_Within':
      case 'ST_Contains':
        // For basic implementation, check bounding box
        if (query.target && query.target.type === 'Polygon') {
          const bounds = this.getBounds(query.target);
          sqlParts.push(`
            json_extract(${column}, '$.coordinates[0]') >= ${bounds.minLon}
            AND json_extract(${column}, '$.coordinates[0]') <= ${bounds.maxLon}
            AND json_extract(${column}, '$.coordinates[1]') >= ${bounds.minLat}
            AND json_extract(${column}, '$.coordinates[1]') <= ${bounds.maxLat}
          `);
        }
        break;

      case 'ST_DWithin':
        if (query.geometry.type === 'Point' && query.distance) {
          // For proximity, we'd need a distance calculation in SQL
          // This is a simplified version - full implementation would use spatial index
          const point = (query.geometry as Point).coordinates;
          const lon = point[0];
          const lat = point[1];
          sqlParts.push(`
            /* Approximate distance check - use spatial index for production */
            ABS(json_extract(${column}, '$.coordinates[0]') - ${lon}) < 0.01
            AND ABS(json_extract(${column}, '$.coordinates[1]') - ${lat}) < 0.01
          `);
        }
        break;

      default:
        throw new Error(`Unsupported spatial operator: ${query.operator}`);
    }

    return sqlParts.join(' AND ');
  }
}
