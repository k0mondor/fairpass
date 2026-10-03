#!/usr/bin/env bash
CC=fairpass
CH=mychannel

export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
O=${PWD}/organizations
ORG1_TLS=$O/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
ORG2_TLS=$O/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_TLS_ROOTCERT_FILE=$ORG1_TLS
export CORE_PEER_MSPCONFIGPATH=$O/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

args() { python3 -c 'import json,sys; print(json.dumps({"function":sys.argv[1],"Args":sys.argv[2:]}))' "$@"; }

inv() { sleep 4;
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls \
    --cafile "$O/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    -C $CH -n $CC \
    --peerAddresses localhost:7051 --tlsRootCertFiles "$ORG1_TLS" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG2_TLS" \
    -c "$(args "$@")" 2>&1
}

qry() { peer chaincode query -C $CH -n $CC -c "$(args "$@")" 2>&1; }

check() {
  if echo "$3" | grep -q -- "$2"; then
    echo "PASS  $1"
  else
    echo "FAIL  $1   (expected: $2)"
    echo "$3" | tail -3
  fi
}

uuid() { uuidgen | tr 'A-Z' 'a-z'; }

EV=$(uuid); ORGZ=$(uuid); A=$(uuid); B=$(uuid); INS=$(uuid)
START=$(date -u -d '+3 minutes' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u -d '+90 minutes' +%Y-%m-%dT%H:%M:%SZ)
WJ="[\"$A\"]"
WH=$(printf '%s' "$WJ" | sha256sum | cut -d' ' -f1)
TID=$(printf 'ticket:%s:%s' "$EV" "$A" | sha256sum | cut -d' ' -f1)

echo "event=$EV start=$START"

check "CreateEvent ok"                      'status:200'              "$(inv CreateEvent "$EV" "$ORGZ" 1 "$START" "$END")"
check "CreateEvent duplicate -> IDEMPOTENCY_CONFLICT" 'IDEMPOTENCY_CONFLICT' "$(inv CreateEvent "$EV" "$ORGZ" 1 "$START" "$END")"
check "PublishDraw ok"                      'status:200'              "$(inv PublishDraw "$EV" "$WJ" "$WH")"
check "ClaimTicket ok"                      'status:200'              "$(inv ClaimTicket "$EV" "$A")"
check "Transfer to self -> INVALID_RECIPIENT" 'INVALID_RECIPIENT'     "$(inv TransferTicket "$TID" "$A" "$A")"
check "Transfer A->B ok"                    'status:200'              "$(inv TransferTicket "$TID" "$A" "$B")"
check "Second transfer -> TRANSFER_LIMIT_REACHED" 'TRANSFER_LIMIT_REACHED' "$(inv TransferTicket "$TID" "$B" "$A")"

echo "waiting for event start..."
NOW=$(date +%s); TARGET=$(date -u -d "$START" +%s)
[ $TARGET -gt $NOW ] && sleep $((TARGET - NOW + 5))

check "RedeemTicket ok"                     'status:200'              "$(inv RedeemTicket "$TID" "$INS")"
check "Transfer after redeem -> ALREADY_REDEEMED" 'ALREADY_REDEEMED'  "$(inv TransferTicket "$TID" "$B" "$A")"

OPS=$(qry GetOperationsByTicket "$TID")
check "CLAIMED op has toUserId = winner"    "\"toUserId\":\"$A\""     "$OPS"
check "REDEEMED op has fromUserId = owner (B)" "\"fromUserId\":\"$B\"" "$OPS"
