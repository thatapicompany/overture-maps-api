import { Point } from "geojson";

export interface Address {
    id: string;
    geometry: Point;
    bbox?: any;
    version: number;
    update_time?: string;
    sources: any[];
    country?: string;
    postcode?: string;
    street?: string;
    number?: string;
    unit?: string;
    address_levels?: any[];
    postal_city?: string;
    ext_distance?: number;
}
