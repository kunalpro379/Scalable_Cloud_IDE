#!/bin/bash

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo "Starting minikube..."
    minikube start
fi

# Set docker to use minikube's docker daemon
eval $(minikube docker-env)

# Build images
echo "Building images..."
docker compose build

# Create namespace if it doesn't exist
kubectl create namespace cloud-editor --dry-run=client -o yaml | kubectl apply -f -

# Apply Kubernetes configurations
echo "Applying Kubernetes configurations..."
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployment.yaml

echo "Deployment complete!"
echo "To access services, run: minikube service <service-name> -n cloud-editor"
