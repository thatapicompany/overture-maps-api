// src/places/interfaces/place.interface.ts
export interface Place {
    id: string;
    geometry: Geometry;
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
    distance_m?: number;
  }
  
  export interface Geometry {
    type: string; // "Point"
    coordinates: number[]; // [longitude, latitude]
  }
  
  export interface Bbox {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
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
    common?: string;
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
    common?: string;
    rules?: any; // No clear type provided, so keeping it as `any`
  }
  
  export interface Address {
    freeform: string;
    locality: string;
    postcode?: string;
    region?: string;
    country: string;
  }
  