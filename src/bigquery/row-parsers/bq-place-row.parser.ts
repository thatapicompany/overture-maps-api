import { Place, PlaceWithBuilding } from "../../places/interfaces/place.interface"
import { parsePointToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "../../utils/geojson"

export const parsePlaceRow = (row: any): Place => {

    return {
        id: row.id,
        geometry:  parsePointToGeoJSON(row.geometry.value),
        bbox: {
          xmin: parseFloat(row.bbox.xmin),
          xmax: parseFloat(row.bbox.xmax),
          ymin: parseFloat(row.bbox.ymin),
          ymax: parseFloat(row.bbox.ymax),
        },
        version: row.version,
        sources: row.sources.list.map((source: any) => ({
          property: source.element.property,
          dataset: source.element.dataset,
          record_id: source.element.record_id,
          update_time: source.element.update_time,
          confidence: source.element.confidence ? parseFloat(source.element.confidence) : null,
        })),
        names: {
          primary: row.names.primary,
          common: row.names.common,
          rules: row.names.rules,
        },
        categories: {
          primary: row.categories?.primary,
          alternate: row.categories?.alternate?.split ? row.categories?.alternate?.split(',') : [],
        },
        confidence: parseFloat(row.confidence),
        websites: row.websites?.split ? row.websites.split(',') : [],
        socials: row.socials?.list ? row.socials.list.map((social: any) => social.element) : [],
        emails: row.emails?.split ? row.emails.split(',') : [],
        phones: row.phones?.list ? row.phones.list.map((phone: any) => phone.element) : [],
        brand: row.brand ? {
          names: {
            primary: row.brand?.names?.primary,
            common: row.brand?.names?.common,
            rules: row.brand?.names?.rules,
          },
          wikidata: row.brand?.wikidata,
        } : undefined,
        addresses: row.addresses?.list ? row.addresses?.list.map((address: any) => ({
          freeform: address.element?.freeform,
          locality: address.element?.locality,
          postcode: address.element?.postcode,
          region: address.element?.region,
          country: address.element?.country,
        })) : [],
        ext_distance: parseFloat(row.ext_distance),
      }
    }

export const parsePlaceWithBuildingRow = (row: any): PlaceWithBuilding => {

    const place = parsePlaceRow(row)
     const building = {
        id: row.building_id,
        distance: parseFloat(row.distance_to_nearest_building),
        geometry: parseWKTToGeoJSON(row.building_geometry.value),

     }
    return {
        ...place,
        building,
    }
}