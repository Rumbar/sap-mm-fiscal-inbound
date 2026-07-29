#!/usr/bin/env bash
# Envia um XML de NF-e para o webhook do n8n embrulhado em JSON.
# Uso: ./enviar_nfe.sh test-data/nfe_01_ok.xml [URL_WEBHOOK]
XML_FILE="$1"
URL="${2:-http://localhost:5678/webhook/nfe-inbound}"
python3 - "$XML_FILE" "$URL" << 'PYEOF'
import json, sys, urllib.request
xml = open(sys.argv[1]).read()
req = urllib.request.Request(sys.argv[2], data=json.dumps({"xml": xml}).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
try:
    r = urllib.request.urlopen(req)
    print(r.status, r.read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())
PYEOF
