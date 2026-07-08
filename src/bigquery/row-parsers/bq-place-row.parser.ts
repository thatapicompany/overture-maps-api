import { Place, PlaceWithBuilding, Taxonomy } from "../../places/interfaces/place.interface"
import { parsePointToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "../../utils/geojson"

// BigQuery returns Overture's Parquet-style repeated fields as { list: [{ element: x }] }.
const unwrapList = (wrapped: any): any[] =>
    wrapped?.list ? wrapped.list.map((item: any) => item.element) : [];

const parseTaxonomy = (taxonomy: any): Taxonomy | undefined => {
    if (!taxonomy) return undefined;
    return {
        primary: taxonomy.primary,
        hierarchy: unwrapList(taxonomy.hierarchy),
        alternates: unwrapList(taxonomy.alternates),
    };
};

// Overture removes the `categories` column in the September 2026 release,
// replaced by `taxonomy`/`basic_category`. Keep the API's `categories` field
// alive by deriving it from taxonomy once the source column is gone, so
// existing clients never see the field disappear.
const parseCategories = (row: any): { primary: string; alternate: string[] } => {
    if (row.categories) {
        return {
            primary: row.categories.primary,
            alternate: unwrapList(row.categories.alternate).filter((c: any) => typeof c === 'string'),
        };
    }
    return {
        primary: row.taxonomy?.primary ?? row.basic_category,
        alternate: unwrapList(row.taxonomy?.alternates).filter((c: any) => typeof c === 'string'),
    };
};

export const parsePlaceRow = (row: any): Place => {

    return {
        id: row.id,
        theme: 'places',
        type: 'place',
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
          license: source.element.license ?? undefined,
        })),
        names: {
          primary: row.names.primary,
          common: row.names.common,
          rules: row.names.rules,
        },
        categories: parseCategories(row),
        basic_category: row.basic_category ?? undefined,
        taxonomy: parseTaxonomy(row.taxonomy),
        operating_status: row.operating_status ?? undefined,
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
