#!/usr/bin/env bash
set -euo pipefail

# Run in Ubuntu-22.04. Keep Linux dependencies and the SQLite database off /mnt/c.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEV_ROOT=${FAIRPASS_DEV_ROOT:-/opt/fairpass-dev}
TN="$DEV_ROOT/fabric-samples/test-network"
RUNTIME="$DEV_ROOT/backend"
export PATH="$DEV_ROOT/node-v22.19.0-linux-x64/bin:$DEV_ROOT/fabric-samples/bin:$PATH"
export CONTAINER_CLI_COMPOSE="docker compose"
test -d "$TN" || { echo "Fabric test-network is missing at $TN" >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
docker info >/dev/null

cd "$TN"
if ! docker ps --format '{{.Names}}' | grep -qx peer0.org1.example.com; then
  if docker container inspect peer0.org1.example.com >/dev/null 2>&1; then
    DOCKER_SOCK=/var/run/docker.sock docker compose \
      -f compose/compose-test-net.yaml \
      -f compose/docker/docker-compose-test-net.yaml up -d
  else
    ./network.sh up createChannel -c mychannel
  fi
fi
if [ ! -f "$DEV_ROOT/.fairpass-deployed" ]; then
  mkdir -p "$DEV_ROOT/chaincode"
  tar -C "$REPO/blockchain/chaincode" --exclude=node_modules --exclude=dist -cf - . |
    tar -C "$DEV_ROOT/chaincode" -xf -
  ./network.sh deployCC -ccn fairpass -ccp "$DEV_ROOT/chaincode" -ccl typescript -ccv 1.0 -ccs 1
  touch "$DEV_ROOT/.fairpass-deployed"
fi

mkdir -p "$RUNTIME/data"
cp "$REPO/backend/package.json" "$REPO/backend/package-lock.json" "$REPO/backend/tsconfig.json" "$RUNTIME/"
cp -r "$REPO/backend/src" "$REPO/backend/scripts" "$RUNTIME/"
cd "$RUNTIME"
if [ ! -f .env ]; then
  umask 077
  CERT_DIR="$TN/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp"
  CERT=$(find "$CERT_DIR/signcerts" -maxdepth 1 -type f | head -1)
  KEY=$(find "$CERT_DIR/keystore" -maxdepth 1 -type f | head -1)
  test -n "$CERT" && test -n "$KEY"
  printf '%s\n' \
    'PORT=3000' \
    'CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173' \
    'SQLITE_PATH=./data/fairpass.sqlite' \
    "DEMO_TOKEN_SECRET=$(openssl rand -hex 32)" \
    'DEMO_TOKEN_TTL_SECONDS=86400' \
    'FABRIC_GATEWAY_MODE=real' \
    'FABRIC_CHANNEL_NAME=mychannel' \
    'FABRIC_CHAINCODE_NAME=fairpass' \
    'FABRIC_MSP_ID=Org1MSP' \
    'FABRIC_PEER_ENDPOINT=localhost:7051' \
    'FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com' \
    "FABRIC_TLS_CERT_PATH=$TN/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    "FABRIC_CLIENT_CERT_PATH=$CERT" \
    "FABRIC_CLIENT_KEY_PATH=$KEY" > .env
fi
npm ci --no-audit --no-fund
npm run build
npm run db:seed
exec npm start
