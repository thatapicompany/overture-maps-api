gcloud run deploy overture-maps-api \
  --image gcr.io/[PROJECT_ID]/overture-maps-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --port 8080 \
  --set-env-vars NODE_ENV=production,BIGQUERY_PROJECT_ID=[YOUR_PROJECT_ID],BIGQUERY_DATASET=[YOUR_DATASET],BIGQUERY_TABLE=[YOUR_TABLE],GOOGLE_APPLICATION_CREDENTIALS=[/path/to/your/service-account.json]
