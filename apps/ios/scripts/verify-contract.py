import hashlib
import json
from pathlib import Path


app = Path(__file__).absolute().parent.parent
root = app.parent.parent
resources = app / "ContextualLearning" / "Resources"
manifest = json.loads((resources / "contract-manifest.json").read_text())
fingerprint = hashlib.sha256()
for name in manifest["inputs"]:
    fingerprint.update(name.encode() + b"\0")
    fingerprint.update((root / name).read_bytes())
bundle_hash = hashlib.sha256((resources / "contract.js").read_bytes()).hexdigest()
if (
    manifest["contractVersion"] != 1
    or fingerprint.hexdigest() != manifest["sourceHash"]
    or bundle_hash != manifest["bundleHash"]
):
    raise SystemExit("iOS contract is stale. Run node apps/ios/scripts/build-contract.mjs")
print("iOS bundled contract and authoritative source fingerprints match.")
