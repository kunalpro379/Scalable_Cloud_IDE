# Check if registry container exists and is running
$registry = docker container inspect registry 2>$null
if (-not $registry) {
    Write-Host "Starting local registry..."
    docker-compose up -d registry
}

# Build and push images
Write-Host "Building images..."
docker-compose build

Write-Host "Pushing images to local registry..."
docker-compose push

# Apply kubernetes configurations
Write-Host "Applying Kubernetes configurations..."
kubectl apply -f k8s/deployment.yaml

Write-Host "Deployment complete!"
