#!/usr/bin/env bash
# M-14: Audit i18n translation keys — finds keys used in source but missing from en.json
# Usage: cd frontend && bash audit_i18n.sh

set -euo pipefail

EN_FILE="src/i18n/en.json"
SRC_DIR="src"

if [[ ! -f "$EN_FILE" ]]; then
  echo "ERROR: $EN_FILE not found. Run from frontend/ directory." >&2
  exit 1
fi

# 1. Extract all t("key") and t('key') calls from source
USED_KEYS=$(grep -rhoE 't\(["'"'"'][a-zA-Z0-9_.]+["'"'"']\)' "$SRC_DIR" --include='*.ts' --include='*.tsx' \
  | sed -E "s/t\([\"']([^\"']+)[\"']\)/\1/" \
  | sort -u)

# 2. Flatten en.json keys
EN_KEYS=$(python3 -c "
import json, sys

def flatten(d, prefix=''):
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            yield from flatten(v, key)
        else:
            yield key

with open('$EN_FILE') as f:
    for k in sorted(flatten(json.load(f))):
        print(k)
")

# 3. Compare — find used keys not in en.json
MISSING=0
echo "=== i18n Translation Key Audit ==="
echo ""
echo "Keys used in source but MISSING from en.json:"
echo "----------------------------------------------"
while IFS= read -r key; do
  if ! echo "$EN_KEYS" | grep -qxF "$key"; then
    echo "  MISSING: $key"
    MISSING=$((MISSING + 1))
  fi
done <<< "$USED_KEYS"

if [[ $MISSING -eq 0 ]]; then
  echo "  (none — all keys present)"
fi

echo ""
echo "Summary: $(echo "$USED_KEYS" | wc -l | tr -d ' ') keys used in source, $MISSING missing from en.json"

# 4. Check other languages for missing keys vs en.json
echo ""
echo "Keys in en.json missing from other languages:"
echo "----------------------------------------------"
for LANG_FILE in src/i18n/*.json; do
  [[ "$LANG_FILE" == "$EN_FILE" ]] && continue
  LANG=$(basename "$LANG_FILE" .json)
  LANG_KEYS=$(python3 -c "
import json
def flatten(d, prefix=''):
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            yield from flatten(v, key)
        else:
            yield key
with open('$LANG_FILE') as f:
    for k in sorted(flatten(json.load(f))):
        print(k)
")
  COUNT=0
  while IFS= read -r key; do
    if ! echo "$LANG_KEYS" | grep -qxF "$key"; then
      COUNT=$((COUNT + 1))
    fi
  done <<< "$EN_KEYS"
  echo "  $LANG: $COUNT missing keys"
done

echo ""
echo "Done. Run 'python3 sync_i18n.py' to backfill missing keys with English fallback."
