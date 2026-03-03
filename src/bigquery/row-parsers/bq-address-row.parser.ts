import { Address } from "../../addresses/interfaces/address.interface";
import { parsePointToGeoJSON } from "../../utils/geojson";

export const parseAddressRow = (row: any): Address => {
    return {
        id: row.id,
        geometry: parsePointToGeoJSON(row.geometry.value),
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
        address: row.address,
        postcode: row.postcode,
        locality: row.locality,
        region: row.region,
        country: row.country,
        ext_distance: row.ext_distance ? parseFloat(row.ext_distance) : undefined,
    }
}
