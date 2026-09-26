"""导入明确映射的设备音频；复用网站校验入口，不执行预览脚本或视觉导入。"""

import concurrent.futures
import importlib.util
import json
import math
import posixpath
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "building_site_source", Path(__file__).with_name("building-assets-site-source.py"))
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)
STATES = ("build", "remove", "uiOpen", "working", "idle")


def import_audio():
    mapping = json.loads((ROOT / "resources/device-audio-sources.json").read_text())
    anchor = site.fetch("integrity.json.sha256").decode().split()[0]
    index_bytes = site.fetch("integrity.json")
    if site.digest(index_bytes) != anchor:
        raise ValueError("Audio release anchor mismatch")
    index = json.loads(index_bytes)
    if index["schemaVersion"] != 1 or index["algorithm"] != "sha256":
        raise ValueError("Unsupported integrity schema")
    indexed = {}
    for entry in index["files"]:
        path = site.validate_path(entry["path"])
        if path in indexed:
            raise ValueError(f"Duplicate indexed path: {path}")
        indexed[path] = entry

    def download(path):
        site.validate_path(path)
        data = site.fetch(path)
        site.verify(data, indexed[path])
        return data

    root_manifest = json.loads(download("assets-manifest.json"))
    catalog = json.loads(download("audio/manifest.json"))
    if catalog["schemaVersion"] != 1 or catalog["profile"] != "endfield-building-audio-v1":
        raise ValueError("Unsupported audio schema")
    available_ids = {b["id"] for b in catalog["buildings"]}
    source_ids = sorted(set(mapping["definitions"].values()))
    if not set(source_ids) <= available_ids:
        raise ValueError(f"Missing audio definitions: {set(source_ids) - available_ids}")

    def read_building(building_id):
        path = f"audio/buildings/{building_id}/audio.json"
        value = json.loads(download(path))
        if (value["buildingId"] != building_id or value["schemaVersion"] != 1
                or value["profile"] != catalog["profile"]
                or value["sourceVersion"] != catalog["sourceVersion"]
                or value["clockModel"] != "state-entry-independent-loop"):
            raise ValueError(f"Unsupported building audio: {building_id}")
        return building_id, path, value

    clips, buildings, excluded, sources = {}, {}, [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for building_id, path, value in pool.map(read_building, source_ids):
            states = {}
            for state in STATES:
                binding = value["states"].get(state)
                if not binding or not binding["available"]:
                    continue
                selection = binding["variantSelection"]
                if (binding["stateBinding"].get("certainty") != "confirmed"
                        or binding["stateBinding"].get("state") != state
                        or binding["stateBinding"].get("trigger") != "state-entry"
                        or selection.get("certainty") != "confirmed"
                        or selection.get("mode") != "single"
                        or len(binding["variants"]) != 1):
                    excluded.append({"buildingId": building_id, "state": state,
                                     "reason": "Unconfirmed state binding or variant selection"})
                    continue
                variant = binding["variants"][0]
                if not variant["available"] or variant.get("missingMediaIds"):
                    raise ValueError(f"Incomplete declared audio: {building_id}/{state}")
                source_path = posixpath.normpath(posixpath.join(posixpath.dirname(path), variant["file"]))
                site.validate_path(source_path)
                if not source_path.startswith("audio/events/") or not source_path.endswith(".mp3"):
                    raise ValueError(f"Audio path escapes event directory: {source_path}")
                entry = indexed[source_path]
                if entry["sha256"] != variant["sha256"] or entry["bytes"] != variant["bytes"]:
                    raise ValueError(f"Audio metadata mismatch: {source_path}")
                duration = variant["durationMs"] / 1000
                loop = variant["loop"]
                start = (variant.get("loopStartMs") or 0) / 1000
                end = (variant.get("loopEndMs") or variant["durationMs"]) / 1000
                if (not math.isfinite(duration) or duration <= 0 or not isinstance(loop, bool)
                        or (loop and not 0 <= start < end <= duration)):
                    raise ValueError(f"Invalid audio duration/loop: {source_path}")
                sha = variant["sha256"]
                clips[sha] = {"path": f"device-audio/{sha}.mp3", "bytes": entry["bytes"]}
                sources.setdefault(sha, source_path)
                states[state] = {"clip": sha, "eventId": binding["eventId"], "loop": loop,
                                 "loopStart": start, "loopEnd": end, "duration": duration}
            buildings[building_id] = states

    manifest = {"schemaVersion": 1, "sourceVersion": catalog["sourceVersion"],
                "clips": dict(sorted(clips.items())),
                "definitions": {entity_id: buildings[building_id]
                                for entity_id, building_id in mapping["definitions"].items()}}
    temp_root = ROOT / ".temp/.trash"
    temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="device-audio-", dir=temp_root) as staging:
        staged = Path(staging)

        def stage_clip(item):
            sha, path = item
            target = ROOT / "public" / clips[sha]["path"]
            data = target.read_bytes() if target.exists() else download(path)
            site.verify(data, indexed[path])
            (staged / f"{sha}.mp3").write_bytes(data)

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(stage_clip, sources.items()))
        if site.fetch("integrity.json.sha256").decode().split()[0] != anchor:
            raise ValueError("Website release changed during download; retry with a fresh release")
        output = ROOT / "public/device-audio"
        output.mkdir(parents=True, exist_ok=True)
        for file in staged.iterdir():
            shutil.copyfile(file, output / file.name)
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        # 内容寻址产物仅清理由当前清单取代的音频，不触碰其他资源。
        for file in output.glob("*.mp3"):
            if file.stem not in clips:
                file.unlink()

    provenance = {"siteUrl": site.SITE_URL, "releaseId": root_manifest["releaseId"],
                  "sourceVersion": catalog["sourceVersion"], "indexSha256": anchor,
                  "definitionCount": len(manifest["definitions"]), "uniqueFiles": len(clips),
                  "totalBytes": sum(c["bytes"] for c in clips.values()),
                  "sources": sources, "excludedStates": excluded,
                  "deferredAliases": mapping["deferredAliases"]}
    (ROOT / "resources/device-audio-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({key: value for key, value in provenance.items() if key != "sources"}, ensure_ascii=False))


if __name__ == "__main__":
    import_audio()
