// src/places/dto/place-response.dto.ts
import { Place } from '../interfaces/place.interface';

export class PlaceResponseDto {
  id: string;
  type: string;
  geometry: {
    type: string;
    coordinates: number[];
  };
  properties: {
    categories: {
      primary: string;
    };
    confidence?: number;
    websites?: string[];
    emails?: string[];
    socials?: string[];
    phones?: string[];
    brand?: {
      names: {
        primary: string;
      };
      wikidata?: string;
    };
    addresses?: {
      freeform?: string;
      locality?: string;
      region?: string;
      country?: string;
    }[];
    theme: string;
    type: string;
    version: number;
    sources: {
      property: string;
      dataset: string;
      record_id: string;
    }[];
    names: {
      primary: string;
      common?: Record<string, string>;
      rules?: {
        variant: string;
        value: string;
      }[];
    };
  };

  constructor(place: Place) {
    this.id = place.id;
    // assign any values ofr place to this object
    Object.assign(this, place);
    
  }
}
