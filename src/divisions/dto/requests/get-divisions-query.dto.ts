import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsNumber, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { Format, GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';

export class GetDivisionsQuery extends GetByLocationDto {

    // Redeclared to relax the base rule: divisions can also be queried by
    // name, id or bbox, in which case lat/lng are not required.
    @ApiProperty({
        description: 'Latitude coordinate. Required if no country, name or bbox filter is provided.',
        example: 40.7128,
        required: false,
    })
    @ValidateIf(o => !o.country && !o.name && !o.bbox)
    @Transform(({ value }) => parseFloat(value))
    @IsNumber()
    lat: number;

    @ApiProperty({
        description: 'Longitude coordinate. Required if no country, name or bbox filter is provided.',
        example: -74.0060,
        required: false,
    })
    @ValidateIf(o => !o.country && !o.name && !o.bbox)
    @Transform(({ value }) => parseFloat(value))
    @IsNumber()
    lng: number;

    @ApiPropertyOptional({
        description: 'Case-insensitive substring match against the division primary name and English common name. Also matches an exact division ID.',
        example: 'westminster',
    })
    @IsOptional()
    @IsString()
    @MinLength(2, { message: 'name must be at least 2 characters to keep searches selective' })
    name?: string;

    @ApiPropertyOptional({
        description: 'Filter by division subtype, provided as a comma-separated list (e.g. "county,locality").',
        example: 'county,locality',
        type: [String],
    })
    @IsOptional()
    @Transform(({ value }) => String(value).split(',').map((s: string) => s.trim()).filter(Boolean))
    @IsString({ each: true })
    subtype?: string[];

    @ApiPropertyOptional({
        description: 'Filter by admin_level — the division\'s position in its country\'s hierarchy (0 = country). Provided as a comma-separated list (e.g. "1,2").',
        example: '2',
        type: String,
    })
    @IsOptional()
    @Transform(({ value }) => String(value).split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !Number.isNaN(n)))
    @IsNumber({}, { each: true, message: 'admin_level must be a comma-separated list of integers' })
    admin_level?: number[];

    @ApiPropertyOptional({
        description: 'Bounding box filter as "xmin,ymin,xmax,ymax" (lng/lat order). Returns divisions whose bounding box intersects it.',
        example: '-74.3,40.5,-73.7,40.9',
        type: String,
    })
    @IsOptional()
    @Transform(({ value }) => String(value).split(',').map((s: string) => parseFloat(s.trim())))
    @ArrayMinSize(4, { message: 'bbox must be "xmin,ymin,xmax,ymax"' })
    @ArrayMaxSize(4, { message: 'bbox must be "xmin,ymin,xmax,ymax"' })
    @IsNumber({}, { each: true, message: 'bbox must contain four numbers: "xmin,ymin,xmax,ymax"' })
    bbox?: number[];

    @ApiPropertyOptional({
        description: 'Whether to include the full polygon geometry in each result. Defaults to false for name searches (fetch geometry via GET /divisions/{id}) and true otherwise. Division polygons can be megabytes each, so leave this off for search boxes.',
        example: false,
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true)
    @IsBoolean()
    include_geometry?: boolean;

    /**
     * Effective geometry behaviour: an explicit include_geometry always wins;
     * geojson output needs geometry; name searches default to metadata-only.
     */
    resolveIncludeGeometry(): boolean {
        if (this.include_geometry !== undefined) return this.include_geometry;
        if (this.format === Format.GEOJSON) return true;
        return !this.name;
    }

}
