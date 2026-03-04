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
        country: row.country,
        postcode: row.postcode,
        street: row.street,
        number: row.number,
        unit: row.unit,
        address_levels: row.address_levels?.list ? row.address_levels.list.map((level: any) => level.element?.value) : undefined,
        postal_city: row.postal_city,
        ext_distance: row.ext_distance ? parseFloat(row.ext_distance) : undefined,
    }
}
