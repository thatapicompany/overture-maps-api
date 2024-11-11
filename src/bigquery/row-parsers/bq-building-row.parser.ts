import { Building } from "../../buildings/interfaces/building.interface"
import { parsePolygonToGeoJSON } from "../../utils/geojson"

export const  parseBuildingRow = (row: any): Building => {

    return {

      id: row.id,
      geometry: parsePolygonToGeoJSON(row.geometry.value),
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

      subtype: row.subtype,
      class: row.class,
      names: row.names,
      level: row.level,
      has_parts: row.has_parts,
      height: row.height,
      is_underground: row.is_underground,
      num_floors: row.num_floors,
      num_floors_underground: row.num_floors_underground,
      min_height: row.min_height,
      min_floor: row.min_floor,
      facade_color: row.facade_color,
      facade_material: row.facade_material,
      roof_material: row.roof_material,
      roof_shape: row.roof_shape,
      roof_direction: row.roof_direction,
      roof_orientation: row.roof_orientation,
      roof_color: row.roof_color,
      roof_height: row.roof_height,
      ext_distance: parseFloat(row.ext_distance),
      theme: row.theme,
      type: row.type,


    }
  }
