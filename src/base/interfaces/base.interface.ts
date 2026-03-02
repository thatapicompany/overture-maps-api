import { Geometry } from "geojson";

export interface BaseFeature {
    id: string;
    geometry: Geometry;
    bbox?: any;
    version: string;
    sources: any[];
    theme: string;
    type: string;
    subtype: string;
    class: string;
    ext_distance?: number;
}
