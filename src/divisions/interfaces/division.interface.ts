import { Geometry } from "geojson";

export interface DivisionArea {
    id: string;
    geometry: Geometry;
    bbox?: any;
    version: string;
    update_time: string;
    sources: any[];
    theme: string;
    type: string;
    subtype: string;
    class: string;
    ext_distance?: number;
}
