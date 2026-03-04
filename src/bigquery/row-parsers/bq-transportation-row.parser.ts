import { TransportationSegment } from "../../transportation/interfaces/transportation.interface";
import { parsePointToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "../../utils/geojson";

export const parseTransportationRow = (row: any): TransportationSegment => {
    let geometry;
    try {
        geometry = parseWKTToGeoJSON(row.geometry.value)
    } catch {
        geometry = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry;
    }

    const unpackList = (obj: any) => obj?.list ? obj.list.map((o: any) => o.element) : undefined;

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
        sources: unpackList(row.sources) || [],
        subtype: row.subtype,
        class: row.class,
        subclass: row.subclass,
        names: row.names,
        connectors: unpackList(row.connectors),
        routes: unpackList(row.routes),
        subclass_rules: unpackList(row.subclass_rules),
        access_restrictions: unpackList(row.access_restrictions),
        level_rules: unpackList(row.level_rules),
        destinations: unpackList(row.destinations),
        prohibited_transitions: unpackList(row.prohibited_transitions),
        road_surface: unpackList(row.road_surface),
        road_flags: unpackList(row.road_flags),
        speed_limits: unpackList(row.speed_limits),
        width_rules: unpackList(row.width_rules),
        rail_flags: unpackList(row.rail_flags),
        ext_distance: row.ext_distance ? parseFloat(row.ext_distance) : undefined,
    }
}
