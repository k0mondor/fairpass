#!/usr/bin/env bash
# Prepares the two FairPass demo events directly on the Fabric ledger (chain only).
#   Event A "upcoming": starts in 7 days, draw published, nobody has claimed yet
#   Event B "in progress": started, tickets claimed before the start, one transferred, none redeemed
# Timing: A_START_DAYS=7  B_START_MIN=3  B_END_HOURS=24
# Event ids are random on every run. These events exist on the chain only.

CC=fairpass
CH=mychannel

S1=11111111-1111-4111-8111-111111111111   # student1
S2=22222222-2222-4222-8222-222222222222   # student2
S3=33333333-3333-4333-8333-333333333333   # student3
ORGZ=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa # organizer1
INS=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb  # inspector1

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

inv() {
  sleep 4
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls \
    --cafile "$O/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    -C $CH -n $CC \
    --peerAddresses localhost:7051 --tlsRootCertFiles "$ORG1_TLS" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG2_TLS" \
    -c "$(args "$@")" 2>&1
}

qry() { peer chaincode query -C $CH -n $CC -c "$(args "$@")" 2>&1; }

step() {
  if echo "$2" | grep -q 'status:200'; then
    echo "OK    $1"
  else
    echo "FAIL  $1"
    echo "$2" | tail -3
    echo "Stopped. Fix the problem above and run the script again (new event ids are generated)."
    exit 1
  fi
}

iso() { date -u -d "$1" +%Y-%m-%dT%H:%M:%SZ; }
uuid() { uuidgen | tr 'A-Z' 'a-z'; }
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

EV_A=$(uuid)
EV_B=$(uuid)

A_START=$(iso "+${A_START_DAYS:-7} days")
A_END=$(iso "+${A_START_DAYS:-7} days +3 hours")
WA="[\"$S1\",\"$S2\"]"
echo "== Event A (upcoming) $EV_A  start=$A_START"
step "A: CreateEvent"  "$(inv CreateEvent "$EV_A" "$ORGZ" 2 "$A_START" "$A_END")"
step "A: PublishDraw"  "$(inv PublishDraw "$EV_A" "$WA" "$(sha "$WA")")"

B_START=$(iso "+${B_START_MIN:-3} minutes")
B_END=$(iso "+${B_END_HOURS:-24} hours")
WB="[\"$S1\",\"$S2\"]"
TB1=$(sha "ticket:$EV_B:$S1")
TB2=$(sha "ticket:$EV_B:$S2")
echo "== Event B (in progress) $EV_B  start=$B_START  end=$B_END"
step "B: CreateEvent"        "$(inv CreateEvent "$EV_B" "$ORGZ" 2 "$B_START" "$B_END")"
step "B: PublishDraw"        "$(inv PublishDraw "$EV_B" "$WB" "$(sha "$WB")")"
step "B: student1 claims"    "$(inv ClaimTicket "$EV_B" "$S1")"
step "B: student2 claims"    "$(inv ClaimTicket "$EV_B" "$S2")"
step "B: student2 -> student3 transfer" "$(inv TransferTicket "$TB2" "$S2" "$S3")"

NOW=$(date +%s); TARGET=$(date -u -d "$B_START" +%s)
if [ $TARGET -gt $NOW ]; then
  echo "waiting $((TARGET - NOW + 5))s for event B to start..."
  sleep $((TARGET - NOW + 5))
fi

echo
echo "== Result"
echo "Event A id: $EV_A   (claim/transfer demo, starts $A_START)"
echo "Event B id: $EV_B   (redeem demo, open until $B_END)"
echo "Event B ticket held by student1: $TB1"
echo "Event B ticket held by student3: $TB2  (transferred from student2)"
echo "Inspector id for redeem: $INS"
echo
echo "-- Event A"
qry GetEvent "$EV_A"
echo
echo "-- Event B"
qry GetEvent "$EV_B"
echo
echo "-- Event B tickets of student1 / student3 (both must be ACTIVE)"
qry GetTicketsByOwner "$S1"
qry GetTicketsByOwner "$S3"
echo
echo "Redeem one ticket as the inspector (do this only during the demo):"
echo "  peer chaincode invoke ... -c '{\"function\":\"RedeemTicket\",\"Args\":[\"$TB1\",\"$INS\"]}'"
