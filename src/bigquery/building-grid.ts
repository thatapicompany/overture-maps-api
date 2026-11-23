// The building table is very large (about 2.5 billion rows), and clustering it
// by geometry alone cannot narrow a small radius search below roughly a
// gigabyte: the clustering works on storage blocks, and in a table that size
// the blocks are big. A 40 m search and a 2 km search read the same amount.
//
// The grid table (etl/build-buildings-grid-mirror.sql) is the same data
// partitioned by a coarse 3 degree grid, with each building in the cell that
// holds its centroid, and clustered by geometry inside each cell. A query that
// names the cells its search area touches reads those partitions only, where
// the blocks are far smaller.
//
// The cell arithmetic here must match the SQL that builds the table.

export const CELL_DEGREES = 3;
const LAT_CELLS = 180 / CELL_DEGREES;
const LNG_CELLS = 360 / CELL_DEGREES;
const METRES_PER_DEGREE = 111_320;
/** Past this many cells the list is not worth sending; the query runs without it. */
const MAX_CELLS = 64;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const latIndex = (lat: number): number => clamp(Math.floor((lat + 90) / CELL_DEGREES), 0, LAT_CELLS - 1);
const lngIndex = (lng: number): number => clamp(Math.floor((lng + 180) / CELL_DEGREES), 0, LNG_CELLS - 1);

/** The grid cell a point falls in. */
export function buildingCell(lat: number, lng: number): number {
  return latIndex(lat) * LNG_CELLS + lngIndex(lng);
}

/**
 * Every grid cell that a circle of `radiusMetres` around a point can touch,
 * taken from the square that encloses the circle. A building that lies wholly
 * inside the circle has its centroid inside the circle too, so its cell is in
 * this list. Pass a larger radius when buildings only partly inside the search
 * area must be found as well. Returns null when the area is too wide for a
 * cell list to help, or the inputs are not usable.
 */
export function buildingCellsForCircle(lat: number, lng: number, radiusMetres: number): number[] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMetres) || radiusMetres < 0) return null;
  // A little over, so rounding at a cell edge can only add a cell.
  const reach = radiusMetres * 1.01 + 100;
  const dLat = reach / METRES_PER_DEGREE;
  const south = lat - dLat;
  const north = lat + dLat;
  // Near a pole a circle reaches every longitude.
  const widest = Math.cos((Math.min(Math.max(Math.abs(south), Math.abs(north)), 90) * Math.PI) / 180);
  const dLng = widest > 1e-6 ? reach / (METRES_PER_DEGREE * widest) : Infinity;

  const rows: number[] = [];
  for (let row = latIndex(south); row <= latIndex(north); row++) rows.push(row);

  const columns: number[] = [];
  if (dLng >= 180 - CELL_DEGREES) {
    for (let column = 0; column < LNG_CELLS; column++) columns.push(column);
  } else {
    // Longitude wraps at the antimeridian; latitude does not.
    const first = Math.floor((lng - dLng + 180) / CELL_DEGREES);
    const last = Math.floor((lng + dLng + 180) / CELL_DEGREES);
    for (let column = first; column <= last; column++) columns.push(((column % LNG_CELLS) + LNG_CELLS) % LNG_CELLS);
  }

  const cells = new Set<number>();
  for (const row of rows) for (const column of columns) cells.add(row * LNG_CELLS + column);
  if (cells.size > MAX_CELLS) return null;
  return [...cells].sort((a, b) => a - b);
}
