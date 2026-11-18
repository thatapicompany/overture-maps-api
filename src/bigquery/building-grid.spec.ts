import { buildingCell, buildingCellsForCircle } from './building-grid';

describe('building grid cells', () => {
  it('numbers cells the way the table is built: 3 degrees, row by row from the south-west', () => {
    expect(buildingCell(-90, -180)).toBe(0);
    expect(buildingCell(-90, -177)).toBe(1);
    expect(buildingCell(-87, -180)).toBe(120);
    expect(buildingCell(40.7484, -73.9857)).toBe(43 * 120 + 35);
    expect(buildingCell(0, 0)).toBe(30 * 120 + 60);
    // The far edges belong to the last row and column, not to ones that do not exist.
    expect(buildingCell(90, 180)).toBe(59 * 120 + 119);
  });

  it('gives one cell for a small search well inside a cell', () => {
    expect(buildingCellsForCircle(40.7484, -73.9857, 40)).toEqual([43 * 120 + 35]);
    expect(buildingCellsForCircle(40.7484, -73.9857, 25000)).toEqual([43 * 120 + 35]);
  });

  it('adds the neighbouring cells when the search area crosses a cell edge', () => {
    // 100 m from the edge at longitude -75, and from the corner at 39, -75.
    expect(buildingCellsForCircle(40.5, -74.999, 500)).toEqual([43 * 120 + 34, 43 * 120 + 35]);
    expect(buildingCellsForCircle(39.001, -74.999, 500)).toEqual([42 * 120 + 34, 42 * 120 + 35, 43 * 120 + 34, 43 * 120 + 35]);
  });

  it('always includes the cell of any point inside the circle', () => {
    const cases: [number, number, number][] = [
      [51.5074, -0.1278, 20000], [-33.8688, 151.2093, 5000], [1.3521, 103.8198, 25000], [64.1466, -21.9426, 50000], [-54.8, -68.3, 10000], [0.0001, 179.9999, 3000],
    ];
    for (const [lat, lng, radius] of cases) {
      const cells = new Set(buildingCellsForCircle(lat, lng, radius)!);
      for (let bearing = 0; bearing < 360; bearing += 15) {
        const dLat = (radius / 111_320) * Math.cos((bearing * Math.PI) / 180);
        const dLng = ((radius / 111_320) * Math.sin((bearing * Math.PI) / 180)) / Math.cos((lat * Math.PI) / 180);
        let edgeLng = lng + dLng;
        if (edgeLng > 180) edgeLng -= 360;
        if (edgeLng < -180) edgeLng += 360;
        expect(cells.has(buildingCell(lat + dLat, edgeLng))).toBe(true);
      }
    }
  });

  it('wraps across the antimeridian', () => {
    expect(buildingCellsForCircle(-17.0, 179.99, 5000)).toEqual([24 * 120, 24 * 120 + 119]);
    expect(buildingCellsForCircle(-17.0, -179.99, 5000)).toEqual([24 * 120, 24 * 120 + 119]);
  });

  it('gives up, so the query runs without a cell list, when the area is too wide or the inputs are unusable', () => {
    expect(buildingCellsForCircle(89.9, 10, 20000)).toBeNull();
    expect(buildingCellsForCircle(10, 10, 3_000_000)).toBeNull();
    expect(buildingCellsForCircle(NaN, 10, 100)).toBeNull();
    expect(buildingCellsForCircle(10, 10, -1)).toBeNull();
  });
});
