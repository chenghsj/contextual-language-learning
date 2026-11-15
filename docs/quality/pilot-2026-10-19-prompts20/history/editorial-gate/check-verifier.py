"""Exercise provenance and acceptance checks in temporary copies; no model calls."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
RELATIVE = Path("docs/quality/pilot-2026-10-19-prompts20")
checks = []
with tempfile.TemporaryDirectory(prefix="cll-prompts20-verifier-") as temporary:
    temporary = Path(temporary)
    for child in ROOT.iterdir():
        if child.name != "docs":
            (temporary / child.name).symlink_to(child, target_is_directory=child.is_dir())
    (temporary / "docs/quality").mkdir(parents=True)
    shutil.copytree(ROOT / RELATIVE, temporary / RELATIVE)

    def run(name, success):
        result = subprocess.run(
            ["node", "--import", "tsx", str(RELATIVE / "verify.mts"), *(["--prepared"] if prepared_only else [])],
            cwd=temporary, capture_output=True, text=True,
        )
        assert (result.returncode == 0) == success, (name, result.stderr)
        if not success:
            assert "AssertionError" in result.stderr, (name, result.stderr)
        checks.append({"name": name, "exitCode": result.returncode,
                       "expectedResult": success, "matchedExpectation": True})

    for child in (ROOT / "docs/quality").iterdir():
        if child.name != RELATIVE.name:
            (temporary / "docs/quality" / child.name).symlink_to(child, target_is_directory=child.is_dir())
    prepared_only = not (temporary / RELATIVE / "acceptance.json").exists()
    run("Unmodified evidence passes", True)
    if prepared_only:
        request = temporary / RELATIVE / "prepared/requests.json"
        original = request.read_bytes()
        request.write_bytes(original + b" ")
        run("Changed prepared request is rejected", False)
        request.write_bytes(original)
        plan = temporary / RELATIVE / "plan.json"
        original = plan.read_bytes()
        plan.write_bytes(original + b" ")
        run("Changed frozen plan is rejected", False)
        plan.write_bytes(original)
        prepared_only = False
        run("Unrun generation cannot pass full acceptance verification", False)
        report = {"scope": "Prepared-only evidence in temporary copies; no language acceptance or model calls", "checks": checks, "newInferenceCalls": 0}
        (ROOT / RELATIVE / "verifier-boundary-checks.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
        raise SystemExit(0)
    acceptance = temporary / RELATIVE / "acceptance.json"
    original = acceptance.read_bytes()
    data = json.loads(original)
    case = next(c for c in data["cases"] if c["accepted"])
    review = temporary / RELATIVE / case["review"]
    old_review = review.read_bytes()
    reviewed = json.loads(old_review)
    document = json.loads((temporary / RELATIVE / case["document"]).read_text())
    reviewed["issues"].append({"severity": "needs_review", "path": "/sections/0/title",
                               "quote": document["sections"][0]["title"],
                               "description": "Synthetic pending issue in temporary copy only"})
    reviewed["verdict"] = "needs_review"
    case["semantic"] = "needs_review"
    case["accepted"] = False
    data["counts"]["semanticPassed"] -= 1
    data["counts"]["semanticNeedsReview"] += 1
    data["counts"]["accepted"] -= 1
    review.write_text(json.dumps(reviewed))
    acceptance.write_text(json.dumps(data))
    run("Pending finding remains valid only when excluded from acceptance", True)
    case["accepted"] = True
    acceptance.write_text(json.dumps(data))
    run("Pending case cannot be accepted", False)
    reviewed["verdict"] = "passed"
    case["semantic"] = "passed"
    review.write_text(json.dumps(reviewed))
    acceptance.write_text(json.dumps(data))
    run("Verdict alone cannot hide a pending finding", False)
    acceptance.write_bytes(original)
    review.write_bytes(old_review)

    data = json.loads(original)
    case = next(c for c in data["cases"] if c["accepted"] and
                json.loads((temporary / RELATIVE / c["review"]).read_text())["targets"])
    review = temporary / RELATIVE / case["review"]
    old_review = review.read_bytes()
    reviewed = json.loads(old_review)
    reviewed["targets"][0]["result"] = "not_exercised"
    case["targetCoverage"] = "not_exercised"
    case["accepted"] = False
    data["counts"]["targetCoveragePassed"] -= 1
    data["counts"]["accepted"] -= 1
    review.write_text(json.dumps(reviewed))
    acceptance.write_text(json.dumps(data))
    run("Unexercised required target is valid only when excluded from acceptance", True)
    case["accepted"] = True
    acceptance.write_text(json.dumps(data))
    run("Unexercised required target cannot be accepted", False)
    acceptance.write_bytes(original)
    review.write_bytes(old_review)

    response = next((temporary / RELATIVE / "batch-1").rglob("*-response.json"))
    response.write_bytes(response.read_bytes() + b" ")
    run("Changed raw response is rejected", False)

report = {"scope": "Temporary copy mutations only; no model calls or original evidence changes",
          "checks": checks, "newInferenceCalls": 0}
(ROOT / RELATIVE / "verifier-boundary-checks-generation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
