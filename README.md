## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Endpoints

- [./Places](https://docs.overturemaps.org/guides/places/) - The Overture places theme has one feature type, called place, and contains more than 53 million point representations of real-world entities: schools, businesses, hospitals, religious organizations, landmarks, mountain peaks, and much more.
- [./Places/Brands]
- [./Places/Categories]
- [./Places/Countries]

### Schemas & Design

- [API Design](./docs/api-design.md)
- [Place](https://docs.overturemaps.org/schema/reference/places/place/)
- [Address](https://docs.overturemaps.org/schema/reference/addresses/address/)

### Extras

- [Overture Maps](https://overturemaps.org/)
- [Overture Maps API](https://docs.overturemaps.org/)

### Data patching

- Wikidata ID - is not always availble in the Overture Maps data. We can use the Wikidata API to get the wikidata_id for the place with a name and country match for best quess. This can be disabled in the request parameters via `patch_wikidata=false`.

### Deployment & Datasets

- [Google Cloud Platform](./docs/google-cloud-platform.md)


### API Key management

You can either use the hardcoded API key in the code, or use the Auth API by going to theAuthAPI.com and creating an account. You can then create an Access Key for the App and add it as an Env var, and then create any number of API Keys for secure access to the API, and rate-limit them for cost control.


### Running Locally

GCP: Download the Service Account .json file, and set the name in the .env variable `GOOGLE_APPLICATION_CREDENTIALS` to the path of the file.

```bash
 npm install
 npm run start
```

Test the API by curl on `http://localhost:8080/places/countries` with the DEMO-API-KEY

```bash
curl -H "x-api-key: DEMO-API-KEY" -X GET -G 'http://localhost:8080/places/brands' -d 'country=AU'
```
