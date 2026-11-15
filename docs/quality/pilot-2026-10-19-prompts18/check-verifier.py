"""Check the offline verifier using temporary copies; never changes original evidence."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
RELATIVE = Path("docs/quality/pilot-2026-10-19-prompts18")
checks = []
with tempfile.TemporaryDirectory(prefix="cll-prompts18-verifier-") as temporary:
    temporary = Path(temporary)
    for child in ROOT.iterdir():
        if child.name != "docs":
            (temporary / child.name).symlink_to(child, target_is_directory=child.is_dir())
    (temporary / "docs/quality").mkdir(parents=True)
    shutil.copytree(ROOT / RELATIVE, temporary / RELATIVE)

    def run(name, success):
        result = subprocess.run(
            ["node", "--import", "tsx", str(RELATIVE / "verify.mts")],
            cwd=temporary, capture_output=True, text=True,
        )
        assert (result.returncode == 0) == success, (name, result.stderr)
        if not success:
            assert "AssertionError" in result.stderr, (name, result.stderr)
        checks.append({"name": name, "exitCode": result.returncode, "expectedResult": success,
                       "matchedExpectation": True})

    run("Unmodified evidence passes", True)
    acceptance = temporary / RELATIVE / "acceptance.json"
    original = acceptance.read_bytes()
    data = json.loads(original)
    pending = next(c for c in data["cases"] if c["semantic"] == "needs_review")
    pending["accepted"] = True
    acceptance.write_text(json.dumps(data))
    run("Pending case cannot be accepted", False)
    acceptance.write_bytes(original)

    data = json.loads(original)
    pending = next(c for c in data["cases"] if c["semantic"] == "needs_review")
    review = temporary / RELATIVE / pending["review"]
    old_review = review.read_bytes()
    reviewed = json.loads(old_review)
    reviewed["verdict"] = "passed"
    pending["semantic"] = "passed"
    pending["accepted"] = True
    review.write_text(json.dumps(reviewed))
    acceptance.write_text(json.dumps(data))
    run("Verdict alone cannot hide a pending finding", False)
    acceptance.write_bytes(original)
    review.write_bytes(old_review)

    response = next((temporary / RELATIVE / "batch-1").rglob("*-response.json"))
    response.write_bytes(response.read_bytes() + b" ")
    run("Changed raw response is rejected", False)

report = {"scope": "Temporary copy mutations only; no model calls or original evidence changes",
          "command": "python3 docs/quality/pilot-2026-10-19-prompts18/check-verifier.py",
          "checks": checks, "newInferenceCalls": 0}
(ROOT / RELATIVE / "verifier-boundary-checks.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
