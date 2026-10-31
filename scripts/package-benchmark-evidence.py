#!/usr/bin/env python3
"""Package preserved benchmark results without rerunning or changing observations.

Usage: python scripts/package-benchmark-evidence.py --output-dir=docs/evidence \
    --run baseline=data/benchmark-baseline/results.json \
    --run release=data/benchmark-release/results.json

Only the explicitly supplied result JSON files are read. Failed runs remain failed.
The gzip archive contains every sanitized source field, including original summaries,
observations, completion state, diagnostics, metadata and server-job records.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any


THRESHOLD_MS = 2000
CREDENTIAL_KEYS = {"password", "csrftoken", "resettoken"}
TOKEN_URL = re.compile(r"(\btoken(?:=|%3d))[0-9a-f]+", re.IGNORECASE)


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[synthetic credential omitted]"
            if key.replace("_", "").casefold() in CREDENTIAL_KEYS
            else sanitize(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return TOKEN_URL.sub(r"\1[synthetic-token-omitted]", value)
    return value


def reject_constant(value: str) -> None:
    raise ValueError(f"Non-finite JSON number {value!r} is not valid evidence.")


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key {key!r} would discard evidence.")
        result[key] = value
    return result


def positive_finite(value: Any, location: str) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{location} must be a positive finite recorded number.")
    try:
        valid = math.isfinite(value) and value > 0
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f"{location} must be positive and finite; got {value!r}.")
    return value


def statistics(values: list[float | int]) -> dict[str, Any] | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    # Conventional median: the arithmetic mean of the two middle values for even n.
    # This form avoids overflowing the sum of two individually finite durations.
    median = ordered[middle] if len(ordered) % 2 else ordered[middle - 1] + (ordered[middle] - ordered[middle - 1]) / 2
    return {
        "count": len(ordered),
        "medianMs": median,
        "p95Ms": ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)],
        "maxMs": ordered[-1],
        "breaches": sum(value >= THRESHOLD_MS for value in ordered),
    }


def observations_from(payload: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError(f"Run {label!r} is not a result JSON object.")
    if not isinstance(payload.get("metadata"), dict):
        raise ValueError(f"Run {label!r} has no metadata object.")
    if not isinstance(payload.get("completion"), dict):
        raise ValueError(f"Run {label!r} has no preserved completion object.")
    rows = payload.get("observations")
    if not isinstance(rows, list):
        raise ValueError(f"Run {label!r} has no observations array.")
    for index, row in enumerate(rows):
        location = f"run {label!r} observations[{index}]"
        if not isinstance(row, dict):
            raise ValueError(f"{location} must be an object.")
        for field in ("kind", "id"):
            if not isinstance(row.get(field), str) or not row[field]:
                raise ValueError(f"{location}.{field} must be a nonempty string.")
        positive_finite(row.get("milliseconds"), f"{location}.milliseconds")
    return rows


def group_summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[(row["kind"], row["id"])].append(row)
    return [
        {
            "kind": kind,
            "id": identifier,
            **statistics([row["milliseconds"] for row in grouped]),
            "errors": sum(bool(row.get("error")) for row in grouped),
            "roles": sorted({row["role"] for row in grouped if isinstance(row.get("role"), str)}),
        }
        for (kind, identifier), grouped in sorted(groups.items())
    ]


def batch_summary(batch: Any, label: str) -> dict[str, Any] | None:
    if batch is None:
        return None
    if not isinstance(batch, dict):
        raise ValueError(f"Run {label!r} metadata.batch is not an object.")
    for key in ("acknowledgmentMs", "completionMs"):
        if key in batch:
            positive_finite(batch[key], f"run {label!r} metadata.batch.{key}")
    probes = batch.get("probes")
    if probes is not None and not isinstance(probes, list):
        raise ValueError(f"Run {label!r} metadata.batch.probes is not an array.")
    for index, probe in enumerate(probes or []):
        if not isinstance(probe, dict):
            raise ValueError(f"Run {label!r} batch probe {index} is not an object.")
        positive_finite(probe.get("milliseconds"), f"run {label!r} batch.probes[{index}].milliseconds")
    # Include actual source fields only; absent batch phases are never invented.
    result = {key: batch[key] for key in ("acknowledgmentMs", "completionMs", "run", "replaySameRun", "duplicatePeriods", "before", "after") if key in batch}
    result["probeStatistics"] = statistics([probe["milliseconds"] for probe in probes or []])
    result["probeStatuses"] = dict(sorted(Counter(str(probe["status"]) for probe in probes or [] if "status" in probe).items()))
    result["probeBreaches"] = [dict(index=index, observation=probe) for index, probe in enumerate(probes or []) if probe["milliseconds"] >= THRESHOLD_MS]
    result["probeErrors"] = [dict(index=index, observation=probe) for index, probe in enumerate(probes or []) if probe.get("error")]
    result["durationBoundary"] = "Batch completion is throughput duration, not a page-response SLO. Acknowledgment and concurrent GET probes are recorded separately."
    return result


def atomic_write(path: Path, data: bytes) -> None:
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False) as stream:
            temporary = stream.name
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def encode(value: Any, *, pretty: bool = False) -> bytes:
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2 if pretty else None, separators=None if pretty else (",", ":")) + "\n").encode("utf-8")


def package(output_directory: Path, specifications: list[str]) -> dict[str, Any]:
    packaged_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    raw_runs: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    all_breaches: list[dict[str, Any]] = []
    all_errors: list[dict[str, Any]] = []
    labels: set[str] = set()
    for specification in specifications:
        if "=" not in specification:
            raise ValueError("Each --run must be LABEL=PATH.")
        label, supplied = specification.split("=", 1)
        if not label.strip() or label != label.strip() or not supplied:
            raise ValueError("Run labels must be nonempty without surrounding whitespace, and paths must be supplied.")
        if label in labels:
            raise ValueError(f"Repeated run label {label!r} would obscure evidence.")
        labels.add(label)
        source_path = Path(supplied).expanduser().resolve(strict=True)
        if source_path.is_dir():
            source_path = (source_path / "results.json").resolve(strict=True)
        source_bytes = source_path.read_bytes()
        original = json.loads(source_bytes.decode("utf-8-sig"), parse_constant=reject_constant, object_pairs_hook=unique_object)
        observations_from(original, label)
        payload = sanitize(original)
        rows = payload["observations"]
        metadata = payload["metadata"]
        completion = payload["completion"]
        source_hash = hashlib.sha256(source_bytes).hexdigest()
        raw_runs.append({"label": label, "sourcePath": str(source_path), "sourceSha256": source_hash, "data": payload})
        breaches = [{"run": label, "scope": "observation", "observationIndex": index, "observation": row} for index, row in enumerate(rows) if row["milliseconds"] >= THRESHOLD_MS]
        errors = [{"run": label, "scope": "observation", "observationIndex": index, "observation": row} for index, row in enumerate(rows) if row.get("error")]
        if completion.get("error") or completion.get("state") == "failed":
            errors.append({"run": label, "scope": "completion", "completion": completion})
        batch = batch_summary(metadata.get("batch"), label)
        if batch is not None:
            breaches.extend({"run": label, "scope": "batch-probe", **row} for row in batch["probeBreaches"])
            errors.extend({"run": label, "scope": "batch-probe", **row} for row in batch["probeErrors"])
            if "acknowledgmentMs" in batch and batch["acknowledgmentMs"] >= THRESHOLD_MS:
                breaches.append({"run": label, "scope": "batch-acknowledgment", "milliseconds": batch["acknowledgmentMs"]})
            recorded_run = batch.get("run")
            if isinstance(recorded_run, dict) and (recorded_run.get("status") == "failed" or recorded_run.get("error")):
                errors.append({"run": label, "scope": "batch-run", "runResult": recorded_run})
        all_breaches.extend(breaches)
        all_errors.extend(errors)
        counts = {
            "observations": len(rows),
            "groups": len({(row["kind"], row["id"]) for row in rows}),
            "byKind": dict(sorted(Counter(row["kind"] for row in rows).items())),
            "recordedObservationErrors": sum(bool(row.get("error")) for row in rows),
            "observationBreaches": sum(row["milliseconds"] >= THRESHOLD_MS for row in rows),
            "allRecordedErrors": len(errors),
            "allResponseBreaches": len(breaches),
        }
        runs.append({
            "label": label,
            "sourcePath": str(source_path),
            "sourceSha256": source_hash,
            "state": completion.get("state"),
            "completion": completion,
            "metadata": metadata,
            "counts": counts,
            "summary": group_summary(rows),
            "breaches": breaches,
            "errors": errors,
            "batchSummary": batch,
        })
    raw = encode(sanitize({"schemaVersion": 1, "packagedAt": packaged_at, "runs": raw_runs}))
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    output_directory = output_directory.expanduser().resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    archive_path = output_directory / "P8_RAW.json.gz"
    results_path = output_directory / "P8_RESULTS.json"
    result = {
        "schemaVersion": 1,
        "packagedAt": packaged_at,
        "protocol": {
            "thresholdMs": THRESHOLD_MS,
            "breachRule": "milliseconds >= 2000; no baseline, failed run or outlier is discarded",
            "median": "Conventional median; arithmetic mean of the two middle values for even sample counts",
            "p95": "Nearest rank: sorted[ceil(0.95*n)-1]",
            "boundary": "Preserved per-run metadata defines each timer; API, rendered pages, actions, concurrency and batch throughput remain distinct",
            "errors": "Recorded observation errors, completion errors and batch-probe errors; expected denied-role HTTP statuses are not inferred to be failures",
            "redaction": "password/csrfToken/resetToken keys and hexadecimal token URL parameters are redacted recursively again",
            "times": "Original observed numbers are preserved without rounding, conversion, trimming or imputed samples",
        },
        "rawArchive": {"path": archive_path.name, "sha256": hashlib.sha256(compressed).hexdigest(), "uncompressedSha256": hashlib.sha256(raw).hexdigest(), "compressedBytes": len(compressed), "uncompressedBytes": len(raw)},
        "counts": {"runs": len(runs), "observations": sum(run["counts"]["observations"] for run in runs), "allResponseBreaches": len(all_breaches), "allRecordedErrors": len(all_errors)},
        "runs": runs,
        "allBreaches": all_breaches,
        "allErrors": all_errors,
    }
    atomic_write(archive_path, compressed)
    atomic_write(results_path, encode(sanitize(result), pretty=True))
    return {"resultsPath": str(results_path), "archivePath": str(archive_path), "rawSha256": result["rawArchive"]["sha256"], "counts": result["counts"], "states": {run["label"]: run["state"] for run in runs}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", type=Path, default=Path("docs/evidence"))
    parser.add_argument("--run", action="append", required=True, metavar="LABEL=PATH")
    arguments = parser.parse_args()
    try:
        result = package(arguments.output_dir, arguments.run)
    except (OSError, ValueError, TypeError, KeyError) as error:
        # Avoid echoing arbitrary source content or token-bearing paths on failure.
        print(f"Evidence packaging failed: {sanitize(str(error))}", file=sys.stderr)
        return 1
    print(json.dumps(sanitize(result), indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
