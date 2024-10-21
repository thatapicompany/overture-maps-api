## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Endpoints

- [./Places](https://docs.overturemaps.org/guides/places/) - The Overture places theme has one feature type, called place, and contains more than 53 million point representations of real-world entities: schools, businesses, hospitals, religious organizations, landmarks, mountain peaks, and much more.
- [./Addressess](https://docs.overturemaps.org/guides/addresses/) - An address is a feature type that represents a physical place through a series of attributes: street number, street name, unit, address_levels, postalcode and/or country. They also have a Point geometry, which provides an approximate location of the position most commonly associated with the feature. 
- [./Wikidata](https://www.wikidata.org/wiki/Wikidata:Main_Page) - Wikidata is a free and open knowledge base that can be read and edited by both humans and machines. It is used to match the brand.wikidata with the wikidata_id of the place.


### Schemas
- [Place](https://docs.overturemaps.org/schema/reference/places/place/)
- [Address](https://docs.overturemaps.org/schema/reference/addresses/address/)


### BigQuery
- [Place](https://console.cloud.google.com/bigquery?project=bigquery-public-data&p=bigquery-public-data&d=overture_maps&t=place&page=table)

Example Query
```SQL
SELECT *
FROM `bigquery-public-data.overture_maps.place`
WHERE ST_DWithin(geometry, ST_GeogPoint(16.3738, 48.2082), 500)
```

### Extras
- [Overture Maps](https://overturemaps.org/)
- [Overture Maps API](https://docs.overturemaps.org/)


### Data patching
- Wikidata ID - is not always availble in the Overture Maps data. We can use the Wikidata API to get the wikidata_id for the place with a name and country match for best quess. This can be disabled in the request parameters via `patch_wikidata=false`.

### Deployment
- [Google Cloud Platform](./docs/google-cloud-platform.md)