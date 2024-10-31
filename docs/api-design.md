# Design Principles

## API Design

Response objects should be as close to the Overture Schema as possible, and use the `ext_` prefix for any additional fields. This allows us to easily map the response to the schema, and also allows us to add additional fields without breaking the schema.


## Query Parameters

Request parameters should use the Overture fields for reference, with underscore separators for filtering by nested fields. For example, `brand_wikidata` for filtering by `brand.wikidata`.

Where a filter is a name that could be used to filter against multiple fields, we should use the `name` field. For example, `brand_name=McDonalds` should filter against `brand.names.primary` and `brand.names.common`.

## Security

OWASP Top 10 security risks should be considered when designing the API

## Cost control

Rate limiting and caching should be used to control costs. We can use the free tier for Cloud Run and Cloud Storage to cache the data for faster response times. In production you should consider using Redis instead of Cloud storage for caching, and migrating the parts of the dataset you need to a private BigQuery dataset or a different database for speed and cost, especially for building shapes

## Strictness

As this is an educational API we should stick to the principle of being flexible in what we accept and strict in what we return. This means we should accept a wide range of input parameters, but return a strict response format.
