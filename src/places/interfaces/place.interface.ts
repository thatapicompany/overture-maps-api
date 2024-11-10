import { Point, Polygon } from "geojson";
import { Bbox } from "../../common/interfaces/geometry.interface";

export interface Place {
    id: string;
    geometry: Point|Polygon;
    bbox?: Bbox;
    version: string;
    sources: Source[];
    names: Names;
    categories: Categories;
    confidence: number;
    websites?: string[];
    socials?: string[];
    emails?: string[];
    phones?: string[];
    brand?: Brand;
    addresses: Address[];
    ext_distance?: number;
    theme?: string;
    type?: string;
  }
  
  
  export interface Source {
    property: string;
    dataset: string;
    record_id: string;
    update_time: string;
    confidence?: number;
  }
  
  export interface Names {
    primary: string;
    common?: Record<string, string>;
    rules?: any; // No clear type provided, so keeping it as `any`
  }
  
  export interface Categories {
    primary: string;
    alternate?: string[];
  }
  
  export interface Brand {
    names: BrandNames;
    wikidata?: string;
  }
  
  export interface BrandNames {
    primary: string;
    common?: Record<string, string>;
    rules?: any; // No clear type provided, so keeping it as `any`
  }
  
  export interface Address {
    freeform: string;
    locality: string;
    postcode?: string;
    region?: string;
    country: string;
  }
  