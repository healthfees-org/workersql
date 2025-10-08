/**
 * Geospatial and GeoJSON type definitions for WorkerSQL
 * Provides comprehensive support for spatial data storage, indexing, and querying
 */

import type {
  GeoJSON,
  Geometry,
  Point,
  LineString,
  Polygon,
  MultiPoint,
  MultiLineString,
  MultiPolygon,
  GeometryCollection,
  Feature,
  FeatureCollection,
  Position,
} from 'geojson';

// Re-export standard GeoJSON types
export type {
  GeoJSON,
  Geometry,
  Point,
  LineString,
  Polygon,
  MultiPoint,
  MultiLineString,
  MultiPolygon,
  GeometryCollection,
  Feature,
  FeatureCollection,
  Position,
};

/**
 * Supported spatial index types
 */
export type SpatialIndexType = 'h3' | 's2' | 'geohash' | 'rtree';

/**
 * Spatial index configuration
 */
export interface SpatialIndexConfig {
  type: SpatialIndexType;
  resolution?: number; // For H3/S2/Geohash
  precision?: number; // For distance calculations
}

/**
 * Bounding box for spatial queries
 */
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Circle definition for proximity queries
 */
export interface Circle {
  center: Position; // [lon, lat]
  radiusMeters: number;
}

/**
 * Spatial query operators
 */
export type SpatialOperator =
  | 'ST_Contains'
  | 'ST_Within'
  | 'ST_Intersects'
  | 'ST_Crosses'
  | 'ST_Overlaps'
  | 'ST_Touches'
  | 'ST_Disjoint'
  | 'ST_DWithin'
  | 'ST_Distance';

/**
 * Spatial query hints for optimization
 */
export interface SpatialQueryHints {
  useIndex?: boolean;
  indexType?: SpatialIndexType;
  maxResults?: number;
  sortByDistance?: boolean;
}

/**
 * Spatial query request
 */
export interface SpatialQueryRequest {
  geometry: Geometry;
  operator: SpatialOperator;
  target?: Geometry;
  distance?: number; // For ST_DWithin
  hints?: SpatialQueryHints;
}

/**
 * Spatial query result with distance metadata
 */
export interface SpatialQueryResult {
  feature: Feature;
  distance?: number; // In meters
  bearing?: number; // In degrees
}

/**
 * H3 cell index
 */
export interface H3Index {
  cell: string; // H3 cell ID
  resolution: number;
  center: Position;
  boundary: Position[];
}

/**
 * S2 cell index
 */
export interface S2CellId {
  id: string; // S2 cell ID (uint64 as string)
  level: number;
  center: Position;
  boundary: Position[];
}

/**
 * Geohash index
 */
export interface GeohashIndex {
  hash: string;
  precision: number;
  bounds: BoundingBox;
}

/**
 * Spatial index entry stored in database
 */
export interface SpatialIndexEntry {
  geometryId: string;
  indexType: SpatialIndexType;
  indexValue: string; // H3 cell, S2 cell, or geohash
  geometry: Geometry;
  bounds: BoundingBox;
  createdAt: number;
}

/**
 * Column definition for geospatial data
 */
export interface GeospatialColumn {
  name: string;
  type: 'POINT' | 'LINESTRING' | 'POLYGON' | 'GEOMETRY' | 'GEOJSON';
  srid?: number; // Spatial Reference System ID (default: 4326 for WGS84)
  indexed?: boolean;
  indexConfig?: SpatialIndexConfig;
}

/**
 * Spatial function configuration
 */
export interface SpatialFunctionConfig {
  earthRadiusMeters?: number; // Default: 6371000 (mean Earth radius)
  distanceFormula?: 'haversine' | 'vincenty' | 'euclidean';
  angleUnit?: 'degrees' | 'radians';
}

/**
 * Geospatial query builder interface
 */
export interface GeospatialQueryBuilder {
  /**
   * Find features within a bounding box
   */
  withinBBox(bbox: BoundingBox): this;

  /**
   * Find features within a distance from a point
   */
  withinDistance(point: Position, radiusMeters: number): this;

  /**
   * Find features that intersect with a geometry
   */
  intersects(geometry: Geometry): this;

  /**
   * Find features contained within a geometry
   */
  contains(geometry: Geometry): this;

  /**
   * Order results by distance from a point
   */
  orderByDistance(point: Position, ascending?: boolean): this;

  /**
   * Limit the number of results
   */
  limit(count: number): this;

  /**
   * Execute the query
   */
  execute(): Promise<SpatialQueryResult[]>;
}

/**
 * Geospatial storage options
 */
export interface GeospatialStorageOptions {
  /**
   * Store geometry as GeoJSON or WKT (Well-Known Text)
   */
  format: 'geojson' | 'wkt' | 'wkb';

  /**
   * Whether to automatically create spatial indexes
   */
  autoIndex: boolean;

  /**
   * Default spatial index type
   */
  defaultIndexType: SpatialIndexType;

  /**
   * Default H3 resolution (0-15)
   */
  h3Resolution?: number;

  /**
   * Default S2 level (0-30)
   */
  s2Level?: number;

  /**
   * Whether to validate GeoJSON on insert
   */
  validateGeometry: boolean;
}

/**
 * GeoJSON validation result
 */
export interface GeometryValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Spatial statistics for a geometry column
 */
export interface SpatialStatistics {
  totalFeatures: number;
  bounds: BoundingBox;
  geometryTypes: Record<string, number>;
  averageVertices?: number;
  indexCoverage?: number; // Percentage of features indexed
}
