import { Point } from "geojson";

export interface Address {
    id: string;
    geometry: Point;
    bbox?: any;
    version: string;
    update_time: string;
    sources: any[];
    theme: string;
    type: string;
    address: string;
    postcode: string;
    locality: string;
    region: string;
    country: string;
    ext_distance?: number;
}
