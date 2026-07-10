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
    /** Position of the division in its country's hierarchy, e.g. 0, 1, 2 (Overture schema v1.16+). */
    admin_level?: number;
    is_land?: boolean;
    is_territorial?: boolean;
    /** ID of the `division` feature this area belongs to. */
    division_id?: string;
    primary_name?: string;
    names?: DivisionNames;
    country?: string;
    region?: string;
    ext_distance?: number;
    /**
     * Present when the record's own geometry is NULL upstream and the boundary
     * was taken from a sibling area of the same division — the value is the
     * sibling's class, e.g. "maritime" (land + territorial waters).
     * See github.com/OvertureMaps/data/issues/540.
     */
    ext_geometry_source?: string;
}
