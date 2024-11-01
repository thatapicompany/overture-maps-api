import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Place } from '../interfaces/place.interface';
import { BrandDto } from './models/brand.dto';
import { CategoryDto } from './models/category.dto';

export class RulesDto {
  @ApiProperty({ description: 'Variant of the rule.', example: 'Abbreviation' })
  variant: string;

  @ApiProperty({ description: 'Value associated with the rule.', example: 'CP' })
  value: string;
}
export class SourceDto {
  @ApiProperty({ description: 'Source property name.', example: 'OpenStreetMap' })
  property: string;

  @ApiProperty({ description: 'Dataset source for the place.', example: 'OSM' })
  dataset: string;

  @ApiProperty({ description: 'Unique identifier for the record in the dataset.', example: 'osm12345' })
  record_id: string;
}

export class PlaceNamesDto {
  @ApiProperty({ description: 'Primary name of the place.', example: 'Central Park' })
  primary: string;

  @ApiPropertyOptional({ description: 'Common names in different languages.', type: 'object', example: { en: 'Central Park', es: 'Parque Central' } , properties: {}})
  common?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Naming rules or variants associated with the place.',
    type: [RulesDto],
  })
  rules?: RulesDto[];
}
export class AddressDto {
  @ApiPropertyOptional({ description: 'Full freeform address of the place.', example: '123 Main St, Springfield' })
  freeform?: string;

  @ApiPropertyOptional({ description: 'Locality or city name.', example: 'Springfield' })
  locality?: string;

  @ApiPropertyOptional({ description: 'Region or state name.', example: 'Illinois' })
  region?: string;

  @ApiPropertyOptional({ description: 'Country name.', example: 'United States' })
  country?: string;
}

export class GeometryDto {
  @ApiProperty({ description: 'Type of geometry', example: 'Point' })
  type: string;

  @ApiProperty({
    description: 'Coordinates representing the geometry.',
    example: [40.7128, -74.0060],
    type: [Number],
  })
  coordinates: number[];
}

export class PropertiesDto {
  @ApiProperty({ description: 'Primary category of the place.', type: () => CategoryDto })
  categories: CategoryDto;

  @ApiPropertyOptional({ description: 'Confidence score of the place.', example: 0.8 })
  confidence?: number;

  @ApiPropertyOptional({ description: 'Websites associated with the place.', type: [String] })
  websites?: string[];

  @ApiPropertyOptional({ description: 'Emails associated with the place.', type: [String] })
  emails?: string[];

  @ApiPropertyOptional({ description: 'Social media links associated with the place.', type: [String] })
  socials?: string[];

  @ApiPropertyOptional({ description: 'Phone numbers associated with the place.', type: [String] })
  phones?: string[];

  @ApiPropertyOptional({
    description: 'Brand details if applicable.',
    type: () => BrandDto,
  })
  brand?: BrandDto;

  @ApiPropertyOptional({
    description: 'Address information of the place.',
    type: [AddressDto],
  })
  addresses?: AddressDto[];

  @ApiProperty({ description: 'Theme associated with the place.', example: 'Restaurant' })
  theme: string;

  @ApiProperty({ description: 'Type of feature or place.', example: 'Commercial' })
  type: string;

  @ApiProperty({ description: 'Version number of the place data.', example: 1 })
  version: number;

  @ApiProperty({
    description: 'Source information for the place data.',
    type: [SourceDto],
  })
  sources: SourceDto[];

  @ApiProperty({
    description: 'Name details for the place.',
    type: () => PlaceNamesDto,
  })
  names: PlaceNamesDto;
}

export class PlaceResponseDto {
  @ApiProperty({ description: 'Unique identifier of the place.', example: '12345' })
  id: string;

  @ApiProperty({ description: 'Type of place or feature.', example: 'Point of Interest' })
  type: string;

  @ApiProperty({
    description: 'Geometric representation of the place.',
    type: () => GeometryDto,
  })
  geometry: GeometryDto;

  @ApiProperty({
    description: 'Properties and additional details of the place.',
    type: () => PropertiesDto,
  })
  properties: PropertiesDto;

  constructor(place: Place) {
    this.id = place.id;
    Object.assign(this, place);
  }
}


export const toPlacesGeoJSONResponseDto = (places: Place[]) => {
  const toplevel = 
   {
     "type":"FeatureCollection",
     "features":[
     ]
  }
   places.forEach(place => {
     toplevel.features.push({
       "type":"Feature",
       "geometry":place.geometry,
       "properties":{
         confidence: place.confidence,
         ...place.names,
         ...place.brand,
         ...place.categories
       }
     })
   })
   return toplevel;
 }