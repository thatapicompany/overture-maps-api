# Build the image
docker build -t gcr.io/[PROJECT_ID]/overture-maps-api .

# Push the image to Google Container Registry
docker push gcr.io/[PROJECT_ID]/overture-maps-api