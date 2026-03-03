import { DivisionArea } from "../../divisions/interfaces/division.interface";
import { parsePointToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "../../utils/geojson";

export const parseDivisionRow = (row: any): DivisionArea => {
    let geometry;
    try {
        geometry = parseWKTToGeoJSON(row.geometry.value)
    } catch {
        // Fallback for ST_AsGeoJSON format
        geometry = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : parsePolygonToGeoJSON(row.geometry?.value || row.geometry);
    }
    return {
        id: row.id,
        geometry: geometry,
        bbox: row.bbox ? {
            xmin: parseFloat(row.bbox.xmin),
            xmax: parseFloat(row.bbox.xmax),
            ymin: parseFloat(row.bbox.ymin),
            ymax: parseFloat(row.bbox.ymax),
        } : undefined,
        version: row.version,
        update_time: row.update_time,
        sources: row.sources?.list ? row.sources.list.map((source: any) => ({
            property: source.element.property,
            dataset: source.element.dataset,
            record_id: source.element.record_id,
        })) : [],
        theme: row.theme,
        type: row.type,
        subtype: row.subtype,
        class: row.class,
        ext_distance: row.ext_distance ? parseFloat(row.ext_distance) : undefined,
    }
}
