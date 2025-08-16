# Overture Maps API

- Built using [NestJS](https://github.com/nestjs/nest) TypeScript Framework by [ThatAPICompany](https://thatapicompany.com) - specialists in all things APIs

## Demo

[See the API in Action at https://www.OvertureMapsAPI.com/](https://www.overturemapsapi.com/)

## Hosted Version

The hosted version of the Overture Maps API has additional datasets including that are expensive to build & host, and are not included in the self-hosted version:

- OpenStreetMap entity Id for each Place where available
- additional data sources for Places
- additional metadata fields for each Place
- Endpoint: [https://api.overturemapsapi.com](https://api.overturemapsapi.com)
- OpenAPI Doc: [https://api.overturemapsapi.com/api-docs](https://api.overturemapsapi.com/api-docs)

[Sign up at https://overturemapsapi.com](https://overturemapsapi.com/)

## Self Hosting

- [Deploy to Google Cloud Platform using Cloudrun and BigQuery](./docs/google-cloud-platform.md)

## API Endpoints

- [OpenAPI Spec Doc](https://api.overturemapsapi.com/api-docs.json)
- [./Places](https://www.overturemapsapi.com/docs/api-endpoints/places/) - The Overture places theme has one feature type, called place, and contains more than 53 million point representations of real-world entities: schools, businesses, hospitals, religious organizations, landmarks, mountain peaks, and much more.
- [./Places/Brands](https://www.overturemapsapi.com/docs/api-endpoints/places-brands) - Lists all the Brands used in the Places data, along with counts of Places for each.
- [./Places/Categories](https://www.overturemapsapi.com/docs/api-endpoints/places-categories) - Lists all the Categories used in the Places data, along with counts of Places and Brands in each.
- [./Places/Countries](https://www.overturemapsapi.com/docs/api-endpoints/places-countries) - Lists all the Countries used in the Places data, along with counts of Places and Brands in each.
- [./Places/Buildings](https://www.overturemapsapi.com/docs/api-endpoints/places-buildings) - Returns the Building shapes with the Places

### Schemas & Design

- [API Design](./docs/api-design.md)
- [Response Formats GeoJSON & JSON](./docs/response-formats.md)
- [Place Schema](https://docs.overturemaps.org/schema/reference/places/place/)
- [Address Schema](https://docs.overturemaps.org/schema/reference/addresses/address/)
- [Overture Maps Official site](https://overturemaps.org/)

### API Roadmap

- [x] Places endpoint for Overture Maps 'Place' Theme
- [x] Places/Brands endpoint
- [x] Places/Categories endpoint
- [x] Places/Countries endpoint
- [x] Places/Buildings endpoint
- [ ] Addresses endpoint for Overture Maps 'Address' Theme
- [ ] Base endpoint for Overture Maps 'Base' Theme
- [ ] Buildings endpoint for Overture Maps 'Building' Theme
- [ ] Transportation endpoint for Overture Maps 'Transportation' Theme
- [ ] Divisions endpoint for Overture Maps 'Division' Theme

Extras:

- [ ] Fill `wikidata` holes in the data
- [ ] Add `wikidata` to the appropriate response for things like Brand logos, and more info

### API Key management

You can either use the hardcoded API key in the code `DEMO-API-KEY`, or use the Auth API by going to theAuthAPI.com and creating an account. You can then create an Access Key for the App and add it as an Env var, and then create any number of API Keys for secure access to the API, and rate-limit them for cost control.

### Running Locally

- GCP: setup a key as per the [GCP guide](./docs/google-cloud-platform.md), then download the Service Account .json file locally, and set the name in the `.env` variable `GOOGLE_APPLICATION_CREDENTIALS` to the path of the file.

```bash
 npm install
 npm run test
 npm run start
```

Test the API by curl on `http://localhost:8080/places/countries` with the DEMO-API-KEY

```bash
curl -H "x-api-key: DEMO-API-KEY" -X GET -G 'http://localhost:8080/places/brands' \
-d 'country=AU'
```

To get GeoJSON format, add `format=geojson` to the query string

```bash
curl -H "x-api-key: DEMO-API-KEY" -X GET -G 'http://localhost:8080/places' \
-d 'country=AU'  -d 'brand_name=TAB' -d 'limit=2' -d 'format=geojson'
```

To get the Categories or Brands filtered by Category for a Country

```bash
curl -H "x-api-key: DEMO-API-KEY" -X GET -G 'http://localhost:8080/places/categories' \
-d 'country=AU'
curl -H "x-api-key: DEMO-API-KEY" -X GET -G 'http://localhost:8080/places/brands' \
-d 'country=AU' -d 'categories=airlines,airline'
```


#### Credits

Another fine API from ThatAPICompany - specialists in all things APIs