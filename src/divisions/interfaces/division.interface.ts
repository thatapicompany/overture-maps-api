import { Geometry } from "geojson";

export interface DivisionNames {
    primary?: string;
    common?: Record<string, string>;
}

export interface DivisionArea {
    id: string;
    geometry?: Geometry;
    bbox?: any;
    version?: string | number;
    update_time?: string;
    sources?: any[];
    theme?: string;
    type: string;
    subtype: string;
    class?: string;
    primary_name?: string;
    names?: DivisionNames;
    country?: string;
    region?: string;
    ext_distance?: number;
}
