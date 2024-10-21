# Deploying the API to GCP (Google Cloud Platform)

Google hosts the Overture Maps dataset in it's public BigQuery dataset. This allows us to deploy the API to Google Cloud Platform (GCP) and take advantage of the free tier for hosting and querying the data. The $400 free credit is more than enough to get started and test the API. We can also use the free tier for Cloud Storage to cache the data for faster response times.

We can use the Cloud Run service to deploy the API. This allows us to scale the API based on demand and only pay for the resources we use. We can also use the Cloud Build service to automate the deployment process. 

In production you should consider using Redis instead of Cloud storage for caching, and migrating the parts of the dataset you need to a private BigQuery dataset or a different database for speed and cost.

## Setup

In this guide we will cover the following steps:
- Create GCP Account with free credit
- Authenticate with GCP
- Create GCS bucket for cache
- Deploy to Cloudrun via Cloudbuild
- Apply Env Variables
