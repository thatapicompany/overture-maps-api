import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Place, PlaceWithBuilding } from '../../interfaces/place.interface';
import { BrandDto } from '../models/brand.dto';
import { CategoryDto } from '../models/category.dto';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { Geometry, MultiPolygon, Point, Polygon } from 'geojson';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { applyIncludesToDto } from '../../../common/dto/responses/includes.dto';

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


export class PlacePropertiesDto {

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
  theme?: string;

  @ApiProperty({ description: 'Type of feature or place.', example: 'Commercial' })
  type?: string;

  @ApiProperty({ description: 'Version number of the place data.', example: "1" })
  version: string;

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


  @ApiProperty({
    description: 'Name of the place.',
    type: () => PlaceNamesDto,
  })
  ext_name?: string;


  ext_building?: {
    id:string;
    geometry:Point|Polygon|MultiPolygon;
    distance:number
  }

  ext_place_geometry?:Point;

  constructor(data={}) {
    Object.assign(this, data);
    this.ext_name = this.names?.primary;
  }
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
  geometry: Point|Polygon|MultiPolygon;

  @ApiProperty({
    description: 'Properties and additional details of the place.',
    type: () => PlacePropertiesDto,
  })
  properties: PlacePropertiesDto;

  constructor(place: Place) {
    this.id = place.id;
    this.geometry = place.geometry;
    //if(!this.properties) this.properties = new PropertiesDto();
    //Object.assign(this.properties, place);
    this.properties = new PlacePropertiesDto(place);

  }
}

export const toPlaceDto = (place: Place, requestQuery:GetByLocationDto):PlaceResponseDto => {

  const excludeFieldsFromProperties = ['properties','geometry','ext_distance','bbox'];

  
  const rPlace =  new PlaceResponseDto(place)

  const properties = {...rPlace.properties};
  excludeFieldsFromProperties.forEach(field => delete properties[field]);

  rPlace.properties = properties;

  rPlace.geometry = place.geometry;

  //remove any fields that are not requested
  if(requestQuery.includes && requestQuery.includes.length > 0)rPlace.properties = applyIncludesToDto(rPlace.properties,requestQuery.includes);

  return rPlace;
}

export const toPlaceWithBuildingDto = (place: PlaceWithBuilding, requestQuery:GetByLocationDto):PlaceResponseDto => {
  
    const rPlace =  toPlaceDto(place,requestQuery)

    const placeGeometry = rPlace.geometry;
    //swap geometry for building_geometry
    rPlace.geometry = place.building.geometry;

    //ensure properties.building is deleted and only ext_building exists
    //assign building to properties
    rPlace.properties.ext_building = place.building
    rPlace.properties.ext_place_geometry = placeGeometry as Point;

    if(requestQuery.includes && requestQuery.includes.length > 0)rPlace.properties = applyIncludesToDto(rPlace.properties,requestQuery.includes);

    return rPlace;
  }

