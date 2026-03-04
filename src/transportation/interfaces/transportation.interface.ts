import { Geometry } from "geojson";

export interface TransportationSegment {
    id: string;
    geometry: Geometry;
    bbox?: any;
    version: number;
    update_time?: string;
    sources: any[];
    subtype?: string;
    class?: string;
    subclass?: string;
    names?: any;
    connectors?: any[];
    routes?: any[];
    subclass_rules?: any[];
    access_restrictions?: any[];
    level_rules?: any[];
    destinations?: any[];
    prohibited_transitions?: any[];
    road_surface?: any[];
    road_flags?: any[];
    speed_limits?: any[];
    width_rules?: any[];
    rail_flags?: any[];
    ext_distance?: number;
}
