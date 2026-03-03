import { BaseFeature } from "../../base/interfaces/base.interface";
import { parsePointToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "../../utils/geojson";

export const parseBaseRow = (row: any): BaseFeature => {
    let geometry;
    try {
        geometry = parseWKTToGeoJSON(row.geometry.value)
    } catch {
        // Fallback for ST_AsGeoJSON format as BigQuery might return different types based on underlying query structure
        geometry = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : parsePointToGeoJSON(row.geometry?.value || row.geometry);
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
        sources: row.sources?.list ? row.sources.list.map((source: any) => ({
            property: source.element.property,
            dataset: source.element.dataset,
            record_id: source.element.record_id,
        })) : [],
        theme: 'base',
        type: row.subtype === 'water' || row.subtype === 'wetland' ? 'water' : 'land',
        subtype: row.subtype,
        class: row.class,
        ext_distance: row.ext_distance ? parseFloat(row.ext_distance) : undefined,
    }
}
