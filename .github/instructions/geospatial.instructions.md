---
applyTo: 'src/services/GeospatialService.ts,src/types/geospatial.ts,tests/services/GeospatialService.test.ts'
---

# Geospatial and GeoJSON Support with Turf.js Integration

This instruction documents the geospatial and GeoJSON support implementation for WorkerSQL, providing comprehensive spatial data storage, indexing, and querying capabilities powered by Turf.js.

## Overview

The geospatial implementation provides:
- GeoJSON storage and validation using `@types/geojson`
- **Turf.js** for industry-standard spatial operations
- **RBush** (geojson-rbush) for fast R-tree spatial indexing
- H3 hexagonal grid indexing for efficient spatial queries
- Geohash encoding for proximity searches
- Distance and bearing calculations
- Geometry validation and transformation
- SQL generation for spatial queries
- Full TypeScript integration with no SQLite spatial extension dependencies

## Key Components

### 1. Turf.js Integration

**Primary Spatial Library**: Turf.js is the industry-standard JavaScript library for geospatial operations.

**Installed Packages**:
- `@turf/turf` - Main package
- `@turf/distance` - Distance calculations
- `@turf/bearing` - Bearing calculations  
- `@turf/circle` - Create geodesic circles
- `@turf/points-within-polygon` - Spatial containment
- `@turf/boolean-point-in-polygon` - Point-in-polygon tests
- `@turf/nearest-point` - Find nearest feature
- `@turf/bbox` - Bounding box calculations
- `@turf/helpers` - GeoJSON helpers (point, featureCollection)
- `geojson-rbush` - RBush R-tree spatial index

**Key Methods**:
```typescript
// Proximity search (5-mile radius example)
searchWithinRadius(center: Position, radiusMeters: number, features: Feature<Point>[]): 
  Array<Feature<Point> & { distance: number }>;

// Circle-based search
searchWithinCircle(center: Position, radiusMeters: number, features: Feature<Point>[]): 
  Feature[];

// Find nearest feature
findNearest(targetPoint: Position, features: Feature<Point>[]): Feature<Point> | null;

// Point-in-polygon test
isPointInPolygon(testPoint: Position, polygon: Polygon): boolean;
```

### 1. Type Definitions (`src/types/geospatial.ts`)

Comprehensive TypeScript types for geospatial operations:

- Re-exports standard GeoJSON types from `@types/geojson`
- Custom types for spatial indexing (H3, S2, Geohash)
- Bounding box and circle definitions
- Spatial query request/response types
- Configuration types for storage and indexing

### 2. GeospatialService (`src/services/GeospatialService.ts`)

Main service class providing geospatial functionality:

**Core Methods:**
- `validateGeometry(geometry)`: Validates GeoJSON geometry objects
- `calculateDistance(point1, point2)`: Haversine distance in meters
- `calculateBearing(point1, point2)`: Bearing in degrees (0-360)
- `getBounds(geometry)`: Computes bounding box for any geometry
- `isPointInBBox(point, bbox)`: Point-in-bounding-box test
- `isPointInCircle(point, circle)`: Point-in-circle test

**Spatial Indexing:**
- `positionToH3(position, resolution)`: Converts position to H3 cell
- `bboxToH3Cells(bbox, resolution)`: Gets H3 cells covering bbox
- `positionToGeohash(position, precision)`: Generates geohash
- `createSpatialIndex(geometryId, geometry, config)`: Creates index entries

**Format Conversion:**
- `geometryToWKT(geometry)`: Converts GeoJSON to Well-Known Text
- `generateSpatialSQL(table, column, query)`: Generates spatial SQL queries

### 3. SQLCompatibilityService Extensions

Added geospatial function mappings to `src/services/SQLCompatibilityService.ts`:

```typescript
// Geospatial functions (MySQL spatial functions to JSON-based equivalents)
ST_ASGEOJSON: 'json',
ST_GEOMFROMGEOJSON: 'json',
ST_X: "json_extract",
ST_Y: "json_extract",
ST_LATITUDE: "json_extract",
ST_LONGITUDE: "json_extract",
ST_DISTANCE_SPHERE: 'ST_DISTANCE_SPHERE', // Custom implementation required
ST_CONTAINS: 'ST_CONTAINS', // Custom implementation required
ST_WITHIN: 'ST_WITHIN', // Custom implementation required
ST_INTERSECTS: 'ST_INTERSECTS', // Custom implementation required
ST_DWITHIN: 'ST_DWITHIN', // Custom implementation required
```

Added geospatial data types:

```typescript
GEOJSON: 'TEXT',
GEOMETRY: 'TEXT',
POINT: 'TEXT',
LINESTRING: 'TEXT',
POLYGON: 'TEXT',
MULTIPOINT: 'TEXT',
MULTILINESTRING: 'TEXT',
MULTIPOLYGON: 'TEXT',
GEOMETRYCOLLECTION: 'TEXT',
```

## Implementation Details

### Turf.js Proximity Search ("Within 5 Miles" Use Case)

The primary use case for Turf.js integration is efficient proximity searches.

#### Approach 1: Distance Filter (Simple & Accurate)

```typescript
import { point, featureCollection } from '@turf/helpers';

const center: Position = [-122.4194, 37.7749]; // San Francisco
const radiusMiles = 5;
const radiusMeters = radiusMiles * 1609.34; // Convert to meters

// Search using Turf.js distance calculations
const results = geospatialService.searchWithinRadius(center, radiusMeters, entityFeatures);

// Results are sorted by distance and include distance in meters
results.forEach(feature => {
  const distanceMiles = feature.distance / 1609.34;
  console.log(`${feature.properties.name}: ${distanceMiles.toFixed(2)} miles away`);
});
```

**How it works**:
1. Computes Haversine distance from query point to each entity
2. Filters entities ≤ radiusMeters
3. Returns sorted by distance (nearest first)
4. Turf's `distance` API supports miles directly

#### Approach 2: Circle + Points Within Polygon (Geodesic Circle)

```typescript
const center: Position = [-122.4194, 37.7749];
const radiusMiles = 5;
const radiusMeters = radiusMiles * 1609.34;

// Create a true geodesic circle and find points within it
const within5mi = geospatialService.searchWithinCircle(center, radiusMeters, entityFeatures);

console.log(`Found ${within5mi.length} locations within 5 miles`);
```

**How it works**:
1. Creates a geodesic circle polygon (64 steps for smoothness)
2. Uses Turf's `pointsWithinPolygon` for spatial containment
3. More accurate than simple bbox filter

#### Finding the Nearest Entity

```typescript
const queryPoint: Position = [-122.4194, 37.7749];

// Find the closest entity
const nearest = geospatialService.findNearest(queryPoint, entityFeatures);

if (nearest) {
  const distance = geospatialService.calculateDistance(queryPoint, nearest.geometry.coordinates);
  const distanceMiles = distance / 1609.34;
  console.log(`Nearest: ${nearest.properties.name} at ${distanceMiles.toFixed(2)} miles`);
}
```

### RBush Spatial Index (Performance Optimization)

For large datasets (10,000+ entities), use RBush for fast bbox pre-filtering:

```typescript
// Load features into RBush R-tree index (one-time operation)
geospatialService.loadFeatures(entityFeatures);

// Fast bbox query (O(log n) complexity)
const bbox = {
  minLon: -122.5,
  minLat: 37.7,
  maxLon: -122.3,
  maxLat: 37.8
};

const candidates = geospatialService.searchByBBox(bbox);

// Then refine with distance filter
const center: Position = [-122.4194, 37.7749];
const within5mi = candidates
  .map(f => ({
    ...f,
    distance: geospatialService.calculateDistance(center, f.geometry.coordinates)
  }))
  .filter(f => f.distance <= 5 * 1609.34)
  .sort((a, b) => a.distance - b.distance);
```

**Performance Benefits**:
- RBush index: O(log n) bbox search
- Works efficiently with 100,000+ features
- Reduces distance calculations needed

### H3 Indexing

H3 (Hexagonal Hierarchical Spatial Index) provides efficient spatial indexing:

```typescript
// Convert position to H3 cell
const sf: Position = [-122.4194, 37.7749];
const h3Index = geospatialService.positionToH3(sf, 9);
// Returns: { cell: '89283082837ffff', resolution: 9, center: [...], boundary: [...] }

// Get H3 cells covering a bounding box
const bbox = { minLon: -122.5, minLat: 37.7, maxLon: -122.3, maxLat: 37.8 };
const cells = geospatialService.bboxToH3Cells(bbox, 9);
// Returns array of H3 cell IDs
```

**Resolution Guidelines:**
- Resolution 5: ~8.5 km cell edge - Regional searches
- Resolution 7: ~1.2 km - City-level searches
- Resolution 9: ~174 m - Neighborhood searches (default)
- Resolution 11: ~25 m - Street-level searches
- Resolution 13: ~3.6 m - Building-level precision

### Geohash Encoding

Geohash provides string-based spatial encoding for simple proximity searches:

```typescript
const position: Position = [-122.4194, 37.7749];
const geohash = geospatialService.positionToGeohash(position, 9);
// Returns: { hash: '9q8yy', precision: 9, bounds: {...} }
```

**Precision Guidelines:**
- Precision 5: ±2.4 km
- Precision 7: ±76 m
- Precision 9: ±2.4 m (default)

### Distance Calculations

Haversine formula for great-circle distances:

```typescript
const sf: Position = [-122.4194, 37.7749]; // San Francisco
const la: Position = [-118.2437, 34.0522]; // Los Angeles
const distance = geospatialService.calculateDistance(sf, la);
// Returns: ~559,000 meters (559 km)
```

### Geometry Validation

Validates GeoJSON geometry according to specification:

```typescript
const point: Point = {
  type: 'Point',
  coordinates: [-122.4194, 37.7749]
};
const result = geospatialService.validateGeometry(point);
// Returns: { valid: true, errors: [] }
```

Validation checks:
- Valid geometry types
- Coordinate array structure
- Longitude range: -180 to 180
- Latitude range: -90 to 90
- Polygon ring closure (warns if not closed)
- Minimum coordinate counts

## Storage Patterns

### Schema Design

```sql
-- Main table with GeoJSON geometries
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT,
  geometry TEXT, -- GeoJSON as TEXT
  created_at INTEGER
);

-- Spatial index table for H3
CREATE TABLE spatial_index_h3 (
  geometry_id TEXT NOT NULL,
  h3_cell TEXT NOT NULL,
  resolution INTEGER NOT NULL,
  bounds_json TEXT, -- BoundingBox as JSON
  created_at INTEGER
);

CREATE INDEX idx_h3_cell ON spatial_index_h3(h3_cell, resolution);

-- Spatial index table for Geohash
CREATE TABLE spatial_index_geohash (
  geometry_id TEXT NOT NULL,
  geohash TEXT NOT NULL,
  precision INTEGER NOT NULL,
  bounds_json TEXT,
  created_at INTEGER
);

CREATE INDEX idx_geohash ON spatial_index_geohash(geohash);
```

### Inserting Spatial Data

```typescript
// Insert location with geometry
const point: Point = {
  type: 'Point',
  coordinates: [-122.4194, 37.7749]
};

// Validate geometry
const validation = geospatialService.validateGeometry(point);
if (!validation.valid) {
  throw new Error(`Invalid geometry: ${validation.errors.join(', ')}`);
}

// Insert main record
await shard.exec(
  `INSERT INTO locations (id, tenant_id, name, geometry, created_at)
   VALUES (?, ?, ?, ?, ?)`,
  [locationId, tenantId, 'San Francisco Office', JSON.stringify(point), Date.now()]
);

// Create spatial index entries
const indexEntries = geospatialService.createSpatialIndex(locationId, point, {
  type: 'h3',
  resolution: 9
});

for (const entry of indexEntries) {
  await shard.exec(
    `INSERT INTO spatial_index_h3 (geometry_id, h3_cell, resolution, bounds_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      entry.geometryId,
      entry.indexValue,
      9,
      JSON.stringify(entry.bounds),
      Date.now()
    ]
  );
}
```

## Query Patterns

### Proximity Search (Find Nearby)

```typescript
// Find locations within 5km of San Francisco
const center: Position = [-122.4194, 37.7749];
const radiusMeters = 5000;

// 1. Get H3 cells within search radius (using k-ring)
const centerH3 = geospatialService.positionToH3(center, 9);
if (!centerH3) {
  throw new Error('H3 indexing not available');
}

// 2. Query using spatial index
const sql = `
  SELECT DISTINCT l.*
  FROM locations l
  JOIN spatial_index_h3 si ON si.geometry_id = l.id
  WHERE si.h3_cell = ?
    AND si.resolution = 9
`;

const candidates = await shard.exec(sql, [centerH3.cell]);

// 3. Filter by exact distance (client-side)
const results = candidates.rows
  .map(row => {
    const geom = JSON.parse(row.geometry) as Point;
    const distance = geospatialService.calculateDistance(center, geom.coordinates);
    return { ...row, distance };
  })
  .filter(row => row.distance <= radiusMeters)
  .sort((a, b) => a.distance - b.distance);
```

### Bounding Box Query

```typescript
// Find all locations within a bounding box
const bbox = {
  minLon: -122.5,
  minLat: 37.7,
  maxLon: -122.3,
  maxLat: 37.8
};

// 1. Get H3 cells covering bbox
const cells = geospatialService.bboxToH3Cells(bbox, 9);

// 2. Query using spatial index
const sql = `
  SELECT DISTINCT l.*
  FROM locations l
  JOIN spatial_index_h3 si ON si.geometry_id = l.id
  WHERE si.h3_cell IN (${cells.map(() => '?').join(',')})
    AND si.resolution = 9
`;

const results = await shard.exec(sql, cells);

// 3. Optional: Verify with exact bbox check
const filtered = results.rows.filter(row => {
  const geom = JSON.parse(row.geometry) as Point;
  return geospatialService.isPointInBBox(geom.coordinates, bbox);
});
```

### Geohash Prefix Search

```typescript
// Find locations near a position using geohash
const center: Position = [-122.4194, 37.7749];
const precision = 7; // ~76m precision

const centerHash = geospatialService.positionToGeohash(center, precision);

// Query by geohash prefix
const sql = `
  SELECT DISTINCT l.*
  FROM locations l
  JOIN spatial_index_geohash si ON si.geometry_id = l.id
  WHERE si.geohash LIKE ?
    AND si.precision >= ?
`;

const results = await shard.exec(sql, [centerHash.hash + '%', precision]);
```

## Testing

Comprehensive test suite in `tests/services/GeospatialService.test.ts`:

**Validation Tests:**
- Valid and invalid Point, LineString, Polygon geometries
- Coordinate range validation
- Ring closure warnings

**Distance & Bearing Tests:**
- Haversine distance accuracy (SF to LA ~559 km)
- Zero distance for same point
- Bearing calculations (0-360 degrees)

**Geometry Tests:**
- Bounding box calculations
- Point-in-bbox tests
- Point-in-circle tests

**Indexing Tests:**
- H3 cell generation (when library available)
- Geohash encoding/decoding
- Spatial index creation
- Consistent hash generation

**Conversion Tests:**
- GeoJSON to WKT format conversion
- SQL generation for spatial queries

## Performance Considerations

### Spatial Index Selection

**H3 (Recommended):**
- Pros: Hierarchical, consistent cell sizes, global coverage
- Cons: Requires h3-js library (~50KB)
- Use Case: Most spatial queries, especially proximity and clustering

**Geohash:**
- Pros: Simple, no dependencies, string-based
- Cons: Less efficient at poles, variable cell sizes
- Use Case: Simple proximity searches, URL encoding

**S2 (Not Currently Implemented):**
- Pros: Google-scale proven, excellent global coverage
- Cons: Library compatibility issues in Workers runtime
- Use Case: Future enhancement for advanced spatial queries

### Query Optimization

1. **Use Appropriate Resolution**
   - Higher resolution = more cells but finer granularity
   - Start with resolution 9 for most use cases
   - Adjust based on search radius and data density

2. **Index First, Filter Second**
   - Use spatial index to get candidates (fast)
   - Apply exact distance/geometry checks client-side (precise)

3. **Cache Computed Values**
   - Store frequently accessed H3 cells or geohashes
   - Cache distance calculations for hot paths

4. **Batch Operations**
   - Process multiple spatial queries together
   - Combine index lookups when possible

## Troubleshooting

### H3 Library Not Available

If H3 functions return `null`:
- Check that `h3-js` is installed: `npm install h3-js`
- H3 is optional - system degrades gracefully to geohash
- Consider using geohash for simpler use cases

### Distance Calculation Errors

Invalid position errors indicate undefined coordinates:
- Validate positions before passing to `calculateDistance`
- Ensure GeoJSON coordinates are [lon, lat] (not [lat, lon])

### Geometry Validation Warnings

Unclosed polygon rings:
- First and last positions must be identical
- Add closing point: `coordinates.push(coordinates[0])`

## Future Enhancements

- [ ] WebAssembly-based spatial functions for performance
- [ ] S2 geometry library integration (when compatible)
- [x] R-tree spatial index in memory (RBush implemented)
- [x] Additional Turf.js spatial operators (distance, bearing, circle, pointsWithinPolygon)
- [ ] Multi-resolution spatial indexes
- [ ] Spatial clustering algorithms
- [x] Direct Turf.js integration for industry-standard operations

## Related Documentation

- ADR-017: Geospatial and GeoJSON Support with Turf.js (`docs/architecture/017-geospatial.md`)
- SQLCompatibilityService: Spatial function mappings
- Type definitions: `src/types/geospatial.ts`
- Test suite: `tests/services/GeospatialService.test.ts`
- Turf.js Documentation: https://turfjs.org/

## Dependencies

### Production Dependencies
- `@turf/turf`: Turf.js main package - geospatial operations
- `@turf/distance`: Distance calculations (Haversine)
- `@turf/bearing`: Bearing calculations
- `@turf/circle`: Create geodesic circles
- `@turf/points-within-polygon`: Spatial containment
- `@turf/boolean-point-in-polygon`: Point-in-polygon tests
- `@turf/nearest-point`: Find nearest feature
- `@turf/bbox`: Bounding box calculations
- `@turf/helpers`: GeoJSON helper functions
- `geojson-rbush`: RBush R-tree spatial index for GeoJSON
- `h3-js`: H3 hexagonal grid library (optional runtime dependency)
- `s2-geometry`: S2 geometry library (planned, currently not used)

### Development Dependencies
- `@types/geojson`: TypeScript definitions for GeoJSON

## Notes

- All geometries stored as GeoJSON TEXT (not binary)
- Coordinates always [longitude, latitude] per GeoJSON spec
- **Turf.js uses kilometers** by default - convert to/from meters as needed
- Distance calculations use WGS84 ellipsoid
- H3 library is optional - functions degrade gracefully if unavailable
- S2 integration planned but deferred due to type compatibility issues
- RBush provides O(log n) bbox queries for performance
- Turf.js is modular and tree-shakeable to minimize bundle size
