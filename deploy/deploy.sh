#!/usr/bin/env bash
# Build the backend + frontend images and deploy this app onto the
# couchbase-demo-server K3s/Rancher cluster at 192.168.111.5:3002.
#
# IMPORTANT: this script builds Docker images and imports them straight
# into K3s's own containerd image store (`k3s ctr images import`), so it
# must run ON the K3s node itself (couchbase-demo-server) - not on your
# laptop - unless you push to a registry both machines can reach instead
# (see the REGISTRY option below).
#
# Usage (run on couchbase-demo-server):
#   ./deploy/deploy.sh
#
# Env vars you can override:
#   IMAGE_TAG   image tag to build/deploy (default: k3s)
#   NAMESPACE   Kubernetes namespace (default: procurement-demo)
#   RELEASE     Helm release name (default: procurement-demo)
#   REGISTRY    if set, push to this registry instead of importing
#               directly into containerd (e.g. REGISTRY=localhost:5000)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE_TAG="${IMAGE_TAG:-k3s}"
NAMESPACE="${NAMESPACE:-procurement-demo}"
RELEASE="${RELEASE:-procurement-demo}"
BACKEND_IMAGE="couchbase-pcc-backend"
FRONTEND_IMAGE="couchbase-pcc-frontend"

echo "==> Building ${BACKEND_IMAGE}:${IMAGE_TAG} ..."
docker build -t "${BACKEND_IMAGE}:${IMAGE_TAG}" ./backend
echo "==> Building ${FRONTEND_IMAGE}:${IMAGE_TAG} ..."
docker build -t "${FRONTEND_IMAGE}:${IMAGE_TAG}" ./frontend

if [ -n "${REGISTRY:-}" ]; then
  echo "==> Tagging and pushing to ${REGISTRY} ..."
  for img in "${BACKEND_IMAGE}" "${FRONTEND_IMAGE}"; do
    docker tag "${img}:${IMAGE_TAG}" "${REGISTRY}/${img}:${IMAGE_TAG}"
    docker push "${REGISTRY}/${img}:${IMAGE_TAG}"
  done
  BACKEND_REPO="${REGISTRY}/${BACKEND_IMAGE}"
  FRONTEND_REPO="${REGISTRY}/${FRONTEND_IMAGE}"
else
  echo "==> Importing images into K3s's containerd ..."
  docker save "${BACKEND_IMAGE}:${IMAGE_TAG}" | sudo k3s ctr images import -
  docker save "${FRONTEND_IMAGE}:${IMAGE_TAG}" | sudo k3s ctr images import -
  BACKEND_REPO="${BACKEND_IMAGE}"
  FRONTEND_REPO="${FRONTEND_IMAGE}"
fi

echo "==> helm upgrade --install ${RELEASE} -n ${NAMESPACE} ..."
helm upgrade --install "${RELEASE}" ./helm/couchbase-agent-operations-manager-demo \
  --namespace "${NAMESPACE}" --create-namespace \
  --set backend.image.repository="${BACKEND_REPO}" \
  --set backend.image.tag="${IMAGE_TAG}" \
  --set frontend.image.repository="${FRONTEND_REPO}" \
  --set frontend.image.tag="${IMAGE_TAG}" \
  "$@"

echo "==> Done. Status:"
kubectl get pods,svc -n "${NAMESPACE}"
