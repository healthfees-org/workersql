# ADR-017: Geospatial and GeoJSON Support

## Status

Accepted

## Date

2025-01-07

## Context

WorkerSQL requires the ability to store, index, and query geospatial data for location-based applications. Many modern applications need to:

- Store geographic coordinates (points, lines, polygons)
- Perform proximity searches (find nearby locations)
- Execute spatial queries (bounding box, containment, intersection)
- Support geospatial indexing for performance
- Integrate with mapping and visualization tools

Traditional geospatial databases use specialized extensions like PostGIS (PostgreSQL) or spatial indexes (MySQL). However, SQLite in Cloudflare Durable Objects doesn't include native spatial extensions like SpatiaLite.

## Decision

We will implement comprehensive geospatial support using:

1. **GeoJSON as Storage Format**
   - Store geometries as GeoJSON text in SQLite
   - Leverage JSON functions for basic queries
   - Full TypeScript integration using `@types/geojson`
   - No dependency on SQLite spatial extensions

2. **Multiple Spatial Index Types**
   - **H3 Hexagonal Grid** (Uber's H3): Preferred for global coverage and consistent cell sizes
   - **Geohash**: Simple string-based encoding for proximity searches
   - **S2 Geometry** (Google's S2): Available but optional due to library compatibility

3. **Client-Side Spatial Operations**
   - Distance calculations (Haversine formula)
   - Bearing calculations
   - Bounding box computations
   - Point-in-polygon tests (ray casting)
   - Geometry validation

4. **SQL Compatibility Layer Extensions**
   - Map MySQL spatial functions to JSON-based equivalents
   - Custom geospatial functions for common operations
   - Query hint support for spatial operations

5. **Indexing Strategy**
   - Store spatial index entries in separate tables
   - Use H3 cells or geohash prefixes for efficient lookups
   - Support multiple resolution levels

## Rationale

### Why GeoJSON over WKT/WKB?

- **JSON-Native**: SQLite has excellent JSON support built-in
- **JavaScript-Friendly**: Direct integration with mapping libraries
- **Human-Readable**: Easier debugging and data inspection
- **Industry Standard**: Wide adoption in web mapping (Mapbox, Leaflet, OpenLayers)

### Why H3 over Other Grid Systems?

- **Hierarchical**: Multi-resolution support for zoom levels
- **Consistent Size**: Hexagonal cells have more uniform neighbor distances
- **Global Coverage**: Works seamlessly across pole and dateline
- **Performance**: Efficient lookup and neighbor finding
- **Industry Adoption**: Uber, DoorDash, and others use H3 for location services

### Why Not SpatiaLite?

- **Not Available**: Cloudflare Durable Objects don't support custom SQLite extensions
- **Portability**: Our approach works in any JavaScript runtime
- **Flexibility**: Can add new index types without recompiling SQLite
- **Edge-First**: Designed for distributed edge computing

## Implementation Details

### Type System

```typescript
// GeoJSON types from @types/geojson
import type { Point, LineString, Polygon, Position } from 'geojson';

// Custom spatial types
interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface H3Index {
  cell: string;
  resolution: number;
  center: Position;
  boundary: Position[];
}
```

### Storage Schema

```sql
-- Store geometries as GeoJSON text
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT,
  geometry TEXT, -- GeoJSON as TEXT
  created_at INTEGER
);

-- Spatial index table
CREATE TABLE spatial_index (
  geometry_id TEXT,
  index_type TEXT, -- 'h3', 'geohash', 's2'
  index_value TEXT, -- H3 cell, geohash string, or S2 cell ID
  bounds_json TEXT, -- BoundingBox as JSON
  created_at INTEGER
);

CREATE INDEX idx_spatial_index_value ON spatial_index(index_type, index_value);
```

### Query Examples

#### Find Points Near a Location

```typescript
const sf: Position = [-122.4194, 37.7749];
const radiusMeters = 5000;

// Get H3 cells covering search area
const searchCells = geospatialService.positionToH3(sf, 9);

// Query using spatial index
const sql = `
  SELECT l.*
  FROM locations l
  JOIN spatial_index si ON si.geometry_id = l.id
  WHERE si.index_type = 'h3'
    AND si.index_value IN (${searchCells.map(() => '?').join(',')})
`;
```

#### Bounding Box Query

```typescript
const bbox = {
  minLon: -122.5,
  minLat: 37.7,
  maxLon: -122.3,
  maxLat: 37.8,
};

const sql = `
  SELECT *
  FROM locations
  WHERE json_extract(geometry, '$.coordinates[0]') BETWEEN ? AND ?
    AND json_extract(geometry, '$.coordinates[1]') BETWEEN ? AND ?
`;
```

### GeospatialService API

```typescript
class GeospatialService {
  // Validation
  validateGeometry(geometry: Geometry): GeometryValidationResult;

  // Distance & Bearing
  calculateDistance(point1: Position, point2: Position): number;
  calculateBearing(point1: Position, point2: Position): number;

  // Bounding Box
  getBounds(geometry: Geometry): BoundingBox;
  isPointInBBox(point: Position, bbox: BoundingBox): boolean;
  isPointInCircle(point: Position, circle: Circle): boolean;

  // Spatial Indexing
  positionToH3(position: Position, resolution?: number): H3Index | null;
  positionToGeohash(position: Position, precision?: number): GeohashIndex;
  createSpatialIndex(geometryId: string, geometry: Geometry): SpatialIndexEntry[];

  // Format Conversion
  geometryToWKT(geometry: Geometry): string;

  // SQL Generation
  generateSpatialSQL(table: string, column: string, query: SpatialQueryRequest): string;
}
```

## Consequences

### Positive

1. **Full TypeScript Integration**: Type-safe geospatial operations
2. **No SQLite Extensions Required**: Works in any JavaScript runtime
3. **Multiple Index Options**: H3, Geohash, and future options
4. **Client-Side Computation**: No server-side dependencies
5. **GeoJSON Native**: Direct compatibility with mapping libraries
6. **Scalable**: Spatial indexes distribute well across shards
7. **Testable**: Pure TypeScript functions are easy to test

### Negative

1. **No Native Spatial Functions**: More complex queries require client-side filtering
2. **Performance**: JSON extraction slower than native binary formats
3. **Precision**: JavaScript number limitations (64-bit float)
4. **Index Size**: Spatial indexes add storage overhead
5. **Limited Spatial Operators**: Not all PostGIS functions supported

### Neutral

1. **H3 Library Dependency**: Optional, degrades gracefully if unavailable
2. **Learning Curve**: Developers need to understand spatial indexing concepts
3. **Query Complexity**: Some spatial queries require multi-step operations

## Migration Path

### From MySQL Spatial Types

```sql
-- MySQL with spatial extension
CREATE TABLE locations (
  id INT PRIMARY KEY,
  point POINT NOT NULL,
  SPATIAL INDEX(point)
);

-- WorkerSQL equivalent
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  geometry TEXT -- GeoJSON Point
);
CREATE TABLE spatial_index (
  geometry_id TEXT,
  index_type TEXT,
  index_value TEXT
);
```

### Data Migration

```typescript
// Convert MySQL POINT to GeoJSON
const mysqlPoint = 'POINT(-122.4194 37.7749)';
const geojson: Point = {
  type: 'Point',
  coordinates: [-122.4194, 37.7749],
};

// Create spatial index
const entries = geospatialService.createSpatialIndex('location-1', geojson, {
  type: 'h3',
  resolution: 9,
});
```

## Performance Considerations

### H3 Resolution Guidelines

| Resolution | Cell Edge (avg) | Area (avg)    | Use Case                      |
| ---------- | --------------- | ------------- | ----------------------------- |
| 5          | 8.5 km          | 252 km²       | Regional searches             |
| 7          | 1.2 km          | 5.2 km²       | City-level searches           |
| 9          | 174 m           | 0.11 km²      | Neighborhood searches (default)|
| 11         | 25 m            | 2,254 m²      | Street-level searches         |
| 13         | 3.6 m           | 47 m²         | Building-level precision      |

### Query Optimization

1. **Use Spatial Index First**: Filter by H3 cells before distance calculations
2. **Appropriate Resolution**: Higher resolution = more cells but finer granularity
3. **Cache Calculations**: Store computed distances and bearings
4. **Batch Operations**: Process multiple spatial queries together
5. **Bounding Box Pre-filter**: Eliminate distant candidates early

## Testing

Comprehensive test coverage includes:

- GeoJSON validation for all geometry types
- Distance calculations (Haversine formula accuracy)
- Bearing calculations
- Bounding box computations
- Point-in-polygon tests
- H3 cell generation and lookup
- Geohash encoding/decoding
- WKT format conversion
- Spatial index creation
- SQL generation for spatial queries

## Future Enhancements

1. **Additional Spatial Operators**
   - ST_Intersects
   - ST_Buffer
   - ST_Simplify
   - ST_Transform (coordinate system conversion)

2. **Performance Optimizations**
   - Compiled spatial functions (WebAssembly)
   - Cached H3 cell lookups
   - Spatial R-tree in memory

3. **Advanced Features**
   - Multi-resolution spatial indexes
   - Spatial clustering algorithms
   - Heatmap generation
   - Route optimization

4. **Integration**
   - Mapbox GL JS direct integration
   - Leaflet plugins
   - Deck.gl visualization
   - Turf.js geometry operations

## References

- [GeoJSON Specification (RFC 7946)](https://tools.ietf.org/html/rfc7946)
- [H3: Uber's Hexagonal Hierarchical Spatial Index](https://h3geo.org/)
- [Geohash Algorithm](https://en.wikipedia.org/wiki/Geohash)
- [SQLite JSON Functions](https://www.sqlite.org/json1.html)
- [PostGIS Spatial Functions Reference](https://postgis.net/docs/reference.html)
- [@types/geojson on npm](https://www.npmjs.com/package/@types/geojson)
- [Haversine Formula](https://en.wikipedia.org/wiki/Haversine_formula)

## Related ADRs

- ADR-002: Durable Objects for Authoritative Storage
- ADR-003: Cache-Aside Pattern with KV
- ADR-008: SQL Compatibility Layer
- ADR-016: D1 Mirror & Analytics (planned)
- ADR-018: Advanced SQL Features (planned)
