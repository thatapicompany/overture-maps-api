import { Source } from "../../places/interfaces/place.interface";
import { Bbox } from "../../common/interfaces/geometry.interface";
import { Geometry, MultiPolygon, Polygon ,Point} from "geojson";


export interface Building {
    
    id: string;
    geometry: Point|Polygon|MultiPolygon;
    bbox?: Bbox;
    version: string;
    sources: Source[];
    subtype: string;
    class: string;
    names: string;
    level: string;
    has_parts: boolean;
    height: number;
    is_underground: boolean;
    num_floors: number;
    num_floors_underground: number;
    min_height: number;
    min_floor: number;
    facade_color: string;
    facade_material: string;
    roof_material: string;
    roof_shape: string;
    roof_direction: string;
    roof_orientation: string;
    roof_color: string;
    roof_height: number;
    ext_distance: number;
    theme: string;
    type: string;
}