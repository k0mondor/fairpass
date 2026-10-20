#!/usr/bin/env bash
set -eo pipefail

# Preserve the running network and ledger; never run network.sh down here.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEV_ROOT=${FAIRPASS_DEV_ROOT:-/opt/fairpass-dev}
TN="$DEV_ROOT/fabric-samples/test-network"
CC_DIR="$DEV_ROOT/chaincode"
export PATH="$DEV_ROOT/node-v22.19.0-linux-x64/bin:$DEV_ROOT/fabric-samples/bin:/usr/bin:/bin"
export FABRIC_CFG_PATH="$DEV_ROOT/fabric-samples/config"
export CONTAINER_CLI_COMPOSE="docker compose"
cd "$TN"
export OVERRIDE_ORG=""
export VERBOSE=false
source scripts/envVar.sh
setGlobals 1
CURRENT=$(peer lifecycle chaincode querycommitted --channelID mychannel --name fairpass --output json)
SEQUENCE=$(printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>console.log(JSON.parse(s).sequence+1))')
VERSION="1.0.$SEQUENCE"
mkdir -p "$CC_DIR"
cp "$REPO/blockchain/chaincode/package.json" "$REPO/blockchain/chaincode/package-lock.json" "$REPO/blockchain/chaincode/tsconfig.json" "$CC_DIR/"
cp -r "$REPO/blockchain/chaincode/src" "$CC_DIR/"
./network.sh deployCC -ccn fairpass -ccp "$CC_DIR" -ccl typescript -ccv "$VERSION" -ccs "$SEQUENCE"
setGlobals 1
peer lifecycle chaincode querycommitted --channelID mychannel --name fairpass --output json
