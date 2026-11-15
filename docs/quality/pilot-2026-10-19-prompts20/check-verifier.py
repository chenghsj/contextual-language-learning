"""Check integrity and nonblocking observations in temporary copies; no inference."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
RELATIVE = Path("docs/quality/pilot-2026-10-19-prompts20")
checks = []
with tempfile.TemporaryDirectory(prefix="cll-evidence-check-") as temporary:
    temporary = Path(temporary)
    for child in ROOT.iterdir():
        if child.name != "docs":
            (temporary / child.name).symlink_to(child, target_is_directory=child.is_dir())
    (temporary / "docs/quality").mkdir(parents=True)
    shutil.copytree(ROOT / RELATIVE, temporary / RELATIVE)
    for child in (ROOT / "docs/quality").iterdir():
        if child.name != RELATIVE.name:
            (temporary / "docs/quality" / child.name).symlink_to(child, target_is_directory=child.is_dir())

    def run(name, success, command=None):
        command = command or ["node", "--import", "tsx", str(RELATIVE / "verify.mts")]
        result = subprocess.run(command, cwd=temporary, capture_output=True, text=True)
        assert (result.returncode == 0) == success, (name, result.stderr)
        checks.append({"name": name, "exitCode": result.returncode, "matchedExpectation": True})
        return json.loads(result.stdout) if success else None

    baseline = run("Saved evidence verifies without an AI acceptance score", True)
    assert baseline["contentQuality"] == "not_scored"
    assert "accepted" not in baseline["observations"]
    report = temporary / RELATIVE / "validation.json"
    original = report.read_bytes()
    data = json.loads(original)
    case = data["cases"][0]
    document = json.loads((temporary / RELATIVE / case["document"]).read_text())
    case["editorialNotes"].append({"kind": "editorial_observation", "path": "/sections/0/title",
        "quote": document["sections"][0]["title"], "blocking": False,
        "note": "Another reviewer prefers different wording; temporary test only"})
    report.write_text(json.dumps(data))
    run("Reviewer wording preference does not block verification", True)
    case["editorialNotes"][-1]["blocking"] = True
    report.write_text(json.dumps(data))
    run("A subjective note cannot silently become a hard gate", False)
    report.write_bytes(original)

    data = json.loads(original)
    target = next(c for c in data["cases"] if c["teachingTargets"])["teachingTargets"][0]
    target["observation"] = "not_exercised"
    report.write_text(json.dumps(data))
    result = run("Missing optional teaching remains an observation, not a case failure", True)
    assert result["observations"]["teachingTargetsNotExercised"] == 1
    target["observation"] = "exercised"
    target["quote"] = "This quote is absent from the generated document"
    report.write_text(json.dumps(data))
    run("A claimed exercised target still needs actual source evidence", False)
    report.write_bytes(original)

    response = next((temporary / RELATIVE / "batch-1").rglob("*-response.json"))
    old = response.read_bytes()
    response.write_bytes(old + b" ")
    run("Changed raw response is rejected", False)
    response.write_bytes(old)
    plan = temporary / RELATIVE / "plan.json"
    old = plan.read_bytes()
    plan.write_bytes(old + b" ")
    run("Changed frozen plan is rejected", False)
    plan.write_bytes(old)

    entry = next(c for c in json.loads(original)["cases"] if c["case"].startswith("en-"))
    lesson = json.loads((temporary / RELATIVE / entry["document"]).read_text())
    script = str(ROOT / "apps/local-host/scripts/check-v7-case-coverage.ts")
    fixture = temporary / "coverage-fixture.json"
    without_items = json.loads(json.dumps(lesson))
    without_items["reusableItems"] = []
    fixture.write_text(json.dumps(without_items))
    result = run("No reusable items is not a correctness failure", True,
        ["node", "--import", "tsx", script, str(fixture)])
    assert result["observations"]["reusableTargets"] == 0

    response_unit = next(u for s in lesson["sections"] for u in s["utterances"] if "c4" in u["cueIds"])
    response_unit["decision"] = "explained"
    response_unit["pointIds"].append("response-usage")
    lesson["points"].append({"id": "response-usage", "utteranceIds": [response_unit["id"]],
        "category": "usage", "presentation": "extended", "title": "Sure 的肯定回應",
        "explanation": "此處用於答應對方稍等的請求。", "sourceCueIds": ["c4"],
        "sourceSpans": response_unit["sourceSpans"], "contextCueIds": []})
    fixture.write_text(json.dumps(lesson))
    result = run("Valid teaching on a short response is not labelled filler and rejected", True,
        ["node", "--import", "tsx", script, str(fixture)])
    assert result["observations"]["responseTeachingObserved"] is True

    lesson["source"]["title"] = "unrecognized-case"
    fixture.write_text(json.dumps(lesson))
    run("Fixed-case identity remains a hard check", False,
        ["node", "--import", "tsx", script, str(fixture)])

result = {"scope": "Integrity and coverage/advisory behavior in temporary copies; original model evidence unchanged",
    "checks": checks, "newModelCalls": 0}
(ROOT / RELATIVE / "verification-checks.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
