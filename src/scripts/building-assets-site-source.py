"""固定网站发布，按项目已确认映射下载原始交付；只写入指定暂存目录。"""

import argparse
import concurrent.futures
import hashlib
import json
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITE_URL = "https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "%" in value:
        raise ValueError(f"Invalid indexed path: {value!r}")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or value.startswith("/"):
        raise ValueError(f"Invalid indexed path: {value}")
    if any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError(f"Invalid indexed path: {value}")
    return value


def fetch(name, base_url=SITE_URL):
    url = urllib.parse.urljoin(base_url, validate_path(name))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                if response.url != url:
                    raise ValueError(f"Unexpected redirect: {url} -> {response.url}")
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            if attempt == 2:
                raise
            delay = error.headers.get("Retry-After", "5")
            time.sleep(float(delay) if delay.isdigit() else 5)
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(5)


def verify(data, entry):
    if len(data) != entry["bytes"] or digest(data) != entry["sha256"]:
        raise ValueError(f"Integrity mismatch: {entry['path']}")


def prepare_source(batch, selected_ids=None, base_url=SITE_URL):
    batch = Path(batch).resolve()
    source = batch / "site"
    source.mkdir(parents=True, exist_ok=True)
    anchor = fetch("integrity.json.sha256", base_url)
    index_bytes = fetch("integrity.json", base_url)
    index_hash = digest(index_bytes)
    if index_hash != anchor.decode().split()[0]:
        raise ValueError("Root integrity anchor mismatch")
    if (source / "integrity.json").exists() and digest((source / "integrity.json").read_bytes()) != index_hash:
        raise ValueError("Batch belongs to another website release; start a new batch directory")
    index = json.loads(index_bytes)
    if index["schemaVersion"] != 1 or index["algorithm"] != "sha256":
        raise ValueError("Unsupported integrity schema")
    indexed = {}
    for entry in index["files"]:
        name = validate_path(entry["path"])
        if name in indexed or not isinstance(entry["bytes"], int) or entry["bytes"] < 0:
            raise ValueError(f"Invalid or duplicate index entry: {name}")
        if len(entry["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in entry["sha256"]):
            raise ValueError(f"Invalid index digest: {name}")
        indexed[name] = entry
    if index["fileCount"] != len(indexed) or index["totalBytes"] != sum(e["bytes"] for e in indexed.values()):
        raise ValueError("Root index counts differ")
    (source / "integrity.json").write_bytes(index_bytes)
    (source / "integrity.json.sha256").write_bytes(anchor)

    def download(name):
        entry = indexed[name]
        target = source / name
        if target.exists():
            data = target.read_bytes()
            verify(data, entry)
            return data
        cached = originals.get(entry["sha256"])
        data = cached.read_bytes() if cached else fetch(name, base_url)
        verify(data, entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return data

    # 原始素材按摘要复用；缓存命中仍重新验证实际字节，不信任文件名或 mtime。
    originals = {}
    manifest = json.loads(download("assets-manifest.json"))
    release = json.loads(download("release.json"))
    for document in (manifest, release):
        if document["schemaVersion"] != 1 or any(document[key] != index[key] for key in ("releaseId", "sourceVersion")):
            raise ValueError("Website release metadata differs from root index")
    buildings = {b["id"]: b for b in manifest["buildings"]}
    if manifest["buildingCount"] != len(buildings):
        raise ValueError("Building count differs")
    root_buildings = {b["id"]: b for b in index["buildings"]}
    if set(buildings) != set(root_buildings):
        raise ValueError("Building index coverage differs")
    mapping = json.loads(Path("resources/building-top-view-v15.json").read_text())
    entries = mapping["entries"]
    if selected_ids:
        unknown = set(selected_ids) - {e["entityId"] for e in entries}
        if unknown:
            raise ValueError(f"Entities have no approved mapping: {sorted(unknown)}")
        entries = [e for e in entries if e["entityId"] in selected_ids]
    views = sorted({e["sourcePath"] for e in entries})
    selected_buildings = {v.split("/")[0] for v in views}
    if not selected_ids:
        selected_buildings.add("logistics")
    missing = selected_buildings - set(buildings)
    if missing:
        raise ValueError(f"Mapped buildings missing from website: {sorted(missing)}")
    prefixes = [f"buildings/{v}/" for v in views]
    if "logistics" in selected_buildings:
        prefixes.append("buildings/logistics/")
    names = {"assets-manifest.json", "release.json"}
    for building_id in selected_buildings:
        building = buildings[building_id]
        if any(building[k] != root_buildings[building_id][k] for k in ("contentHash", "integrity")):
            raise ValueError(f"Building summary differs: {building_id}")
        integrity = building["integrity"]
        scoped = json.loads(download(integrity))
        if scoped["schemaVersion"] != 1 or scoped["algorithm"] != "sha256" or scoped["building"] != building_id:
            raise ValueError(f"Invalid building integrity schema: {building_id}")
        if scoped["fileCount"] != len(scoped["files"]) or scoped["totalBytes"] != sum(e["bytes"] for e in scoped["files"]):
            raise ValueError(f"Building integrity counts differ: {building_id}")
        if scoped["contentHash"] != building["contentHash"]:
            raise ValueError(f"Building content hash differs: {building_id}")
        parent = str(Path(integrity).parent)
        for scoped_entry in scoped["files"]:
            full_name = f"{parent}/{validate_path(scoped_entry['path'])}"
            root_entry = indexed.get(full_name)
            if root_entry is None or any(scoped_entry[k] != root_entry[k] for k in ("bytes", "sha256")):
                raise ValueError(f"Building integrity differs: {full_name}")
        names.update([integrity, f"buildings/{building_id}/variants.json"])
    for name in indexed:
        if not name.endswith((".json", ".webp")) or "/preview/" in name:
            continue
        # 项目消费 contract2 分层交付；预览器的另一套烘焙图集不属于导入分支。
        if name.startswith("buildings/logistics/baked/") or name in (
            "buildings/logistics/logistics-baked.json", "buildings/logistics/logistics-files.json",
        ):
            continue
        if any(name.startswith(prefix) for prefix in prefixes):
            names.add(name)
    for view in views:
        if f"buildings/{view}/package.json" not in names:
            raise ValueError(f"Mapped view missing: {view}")
    required_hashes = {indexed[name]["sha256"] for name in names}
    for folder in ["device-sprite-animation", "device-sprite-original", "building-port-effects", "logistics-materials"]:
        for file in (Path("resources") / folder).rglob("*"):
            if file.is_file() and file.suffix in (".webp", ".json"):
                file_hash = digest(file.read_bytes())
                if file_hash in required_hashes:
                    originals[file_hash] = file
    print(f"Pinned {index['releaseId']}: {len(entries)} mappings, {len(views)} views, {len(names)} files, {len(originals)} cached hashes", flush=True)
    completed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(download, name): name for name in sorted(names)}
        for future in concurrent.futures.as_completed(futures):
            name = futures[future]
            future.result()
            completed.append(name)
            if len(completed) % 100 == 0:
                print(f"Verified {len(completed)}/{len(names)} source files", flush=True)
    if fetch("integrity.json.sha256", base_url) != anchor:
        raise ValueError("Website release changed during download")
    receipt = {
        "schemaVersion": 1, "siteUrl": base_url, "releaseId": index["releaseId"],
        "sourceVersion": index["sourceVersion"], "indexSha256": index_hash,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": [{k: e[k] for k in ("entityId", "spriteId", "sourcePath", "animated")} for e in entries],
        "logistics": "logistics" in selected_buildings,
        "unmappedBuildings": sorted(set(buildings) - selected_buildings),
        "files": [{**indexed[name], "localPath": f"site/{name}"} for name in sorted(names)],
    }
    (batch / "source-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(f"Source ready: {batch / 'source-receipt.json'}", flush=True)
    return receipt


def prepare_metadata(batch):
    """无损保留网站 JSON 的大整数；将网站页面与已确认动画阶段关联到同批原件。"""
    batch = Path(batch).resolve()
    receipt = json.loads((batch / "source-receipt.json").read_text())
    release = validate_path(receipt["releaseId"])
    if "/" in release:
        raise ValueError("Release ID must be a single directory name")
    stage = batch / "stage"
    if (stage / "public").exists():
        raise ValueError("Published stage already exists; metadata cannot be changed after publishing")
    source = batch / "site"
    canonical = f"resources/building-assets-site/{release}"
    root = stage / canonical
    index_bytes = (source / "integrity.json").read_bytes()
    if digest(index_bytes) != receipt["indexSha256"]:
        raise ValueError("Staged root index differs from pinned receipt")
    indexed = {e["path"]: e for e in json.loads(index_bytes)["files"]}
    for entry in receipt["files"]:
        name = validate_path(entry["path"])
        verify((source / name).read_bytes(), indexed[name])
    for name in [e["path"] for e in receipt["files"]] + ["integrity.json", "integrity.json.sha256"]:
        target = root / name
        original = source / name
        if target.exists():
            if digest(target.read_bytes()) != digest(original.read_bytes()):
                raise ValueError(f"Previously staged original changed: {name}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
    mapping_file = Path("resources/building-top-view-v15.json")
    mapping = json.loads(mapping_file.read_text())
    history = root / "_import"
    history.mkdir(exist_ok=True)
    previous_mapping = Path(canonical) / "_import/previous-mapping.json"
    shutil.copyfile(previous_mapping if previous_mapping.exists() else mapping_file, history / "previous-mapping.json")
    shutil.copyfile(batch / "source-receipt.json", history / "source-receipt.json")
    provenance = {k: receipt[k] for k in ("siteUrl", "releaseId", "sourceVersion", "indexSha256")}
    provenance["root"] = canonical
    mapping["historicalSource"] = {**mapping.get("historicalSource", {}), **{k: mapping.pop(k) for k in ("sourceArchive", "sourceArchiveSha256", "incrementalFixes", "orientationConflicts", "validationStatus") if k in mapping}}
    mapping["sourceSite"] = provenance
    selected = {e["entityId"] for e in receipt["entries"]}
    views = []
    animations = []
    statics = []
    seen = set()
    for entry in mapping["entries"]:
        if entry["entityId"] not in selected:
            continue
        directory = f"buildings/{validate_path(entry['sourcePath'])}"
        package = json.loads((root / directory / "package.json").read_text())
        spatial = json.loads((root / directory / "spatial.json").read_text())
        if package["schemaVersion"] != 1 or spatial["schemaVersion"] != 1 or spatial["imageAxes"] != {"x": "+sourceX", "y": "+sourceZ"}:
            raise ValueError(f"Unsupported view coordinates: {directory}")
        width, height = (spatial["framePixels"][key] for key in ("width", "height"))
        rect = spatial["footprintRectCells"]
        canvas = spatial["canvasCells"]
        entry["spriteOffset"] = {"x": -rect["left"], "y": rect["top"] + rect["height"] - canvas["height"], **canvas}
        entry["historicalSource"] = entry.get("historicalSource") or {"package": entry.get("package"), "sourceArchiveSha256": entry["sourceMetadata"].get("sourceArchiveSha256")}
        entry["package"] = f"{directory}/package.json"
        entry["packageSha256"] = indexed[entry["package"]]["sha256"]
        entry["sourceMetadata"] = {
            "sourceSite": provenance, "spatial": spatial, "package": package,
            "publishedTransform": {"operation": "flip-top-bottom per frame", "sourceImageAxisY": "+sourceZ", "resultImageAxisY": "+projectY", "coordinateRule": "projectY = depth - 1 - sourceZ"},
        }
        if directory not in seen:
            views.append({"buildingId": directory.split('/')[1], "view": directory.split('/')[-1], "directory": directory,
                          "spatial": f"{directory}/spatial.json", "ports": f"{directory}/{package['portMetadata']}",
                          "occlusion": f"{directory}/{package['occlusionMetadata']}", "effects": f"{directory}/{package['effectResources']}"})
            seen.add(directory)
        sources = {}
        source_phases = {}
        declared_static_phases = []
        frame_rates = set()
        for phase in package["animations"]:
            phase_root = f"{directory}/animations/{validate_path(phase)}"
            sheet = json.loads((root / phase_root / "spritesheet.json").read_text())
            animation = json.loads((root / phase_root / "animation.json").read_text())
            if animation.get("static") is True:
                declared_static_phases.append(phase)
            frame_rates.add(animation["fps"])
            if sheet["cellWidth"] != width or sheet["cellHeight"] != height or sheet["frameCount"] != len(animation["frames"]):
                raise ValueError(f"Animation frame metadata differs: {phase_root}")
            ranges = []
            for page in sheet["pages"]:
                name = f"{phase}_{page['index']:03d}"
                durations = [f["durationMs"] for f in animation["frames"][page["frameStart"]:page["frameStart"] + page["frameCount"]]]
                if len(durations) != page["frameCount"] or not all(isinstance(d, (int, float)) and d > 0 for d in durations):
                    raise ValueError(f"Invalid animation durations: {phase_root}/{name}")
                source_path = f"{phase_root}/{validate_path(page.get('image', page.get('file')))}"
                source_hash = indexed[source_path]["sha256"]
                if page.get("sha256", source_hash) != source_hash:
                    raise ValueError(f"Spritesheet digest differs: {source_path}")
                if page["width"] % width or page["height"] % height:
                    raise ValueError(f"Page is not an integer frame grid: {source_path}")
                rows, columns = page["height"] // height, page["width"] // width
                # 部分交付的 rows 表示使用行数，页面仍保留透明尾行；按物理尺寸建源网格。
                if not (0 < page.get("rows", rows) <= rows) or page.get("columns", columns) != columns or page["frameCount"] > page.get("rows", rows) * columns:
                    raise ValueError(f"Page grid dimensions differ: {source_path}")
                sources[name] = {"file": f"{name}.webp", "rows": rows, "columns": columns,
                                 "frameCount": page["frameCount"], "frameDurationsMs": durations, "sourcePath": source_path, "sha256": source_hash}
                ranges.append({"source": name, "startFrame": 0, "frameCount": page["frameCount"]})
            source_phases[phase] = ranges
        if entry["animated"]:
            previous_path = Path("resources/device-sprite-animation") / entry["spriteId"] / "manifest.json"
            previous = json.loads(previous_path.read_text())
            phases = ("open", "open_idle", "close", "close_idle")
            if all(phase in source_phases for phase in phases):
                clips = {phase: source_phases[phase] for phase in phases}
                selection = "website-explicit-phases"
            else:
                if set(sources) != set(previous["sources"]) or any(sources[k]["frameCount"] != v["frameCount"] for k, v in previous["sources"].items()):
                    raise ValueError(f"Confirmed clip ranges no longer match website frames: {entry['spriteId']}")
                clips = previous["clips"]
                for ranges in clips.values():
                    for item in ranges:
                        source_item = sources[item["source"]]
                        start, count = item["startFrame"], item["frameCount"]
                        times = source_item["frameDurationsMs"][start:start + count]
                        if len(times) != count or (item.get("frameDurationsMs") is not None and item["frameDurationsMs"] != times):
                            raise ValueError(f"Confirmed clip timing differs: {entry['spriteId']}")
                selection = "validated-existing-ranges"
            if len(frame_rates) != 1:
                raise ValueError(f"Animation phases have different frame rates: {directory}")
            manifest = {"schemaVersion": 1, "frameWidth": width, "frameHeight": height, "fps": frame_rates.pop(),
                        "pageRows": min(previous["pageRows"], 4095 // height), "pageColumns": min(previous["pageColumns"], 4095 // width),
                        "sources": sources, "clips": clips, "frameTransform": "flip-top-bottom", "coordinateTransform": "projectY = depth - 1 - sourceZ",
                        "clipSelection": selection, "sourceSite": {**provenance, "relativeRoot": f"../../building-assets-site/{release}"}}
            output = stage / "resources/device-sprite-animation" / entry["spriteId"] / "manifest.json"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            previous_animation = Path(canonical) / "_import" / f"{entry['spriteId']}-previous-animation.json"
            shutil.copyfile(previous_animation if previous_animation.exists() else previous_path, history / previous_animation.name)
            animations.append(entry["spriteId"])
        else:
            phase = next((p for p in ("static", "bind_pose", "close_idle") if p in source_phases), None)
            if phase is None and len(declared_static_phases) == 1:
                phase = declared_static_phases[0]
            if phase is None:
                raise ValueError(f"No declared static frame: {directory}")
            page = sources[source_phases[phase][0]["source"]]
            statics.append({"spriteId": entry["spriteId"], "sourcePath": page["sourcePath"], "width": width, "height": height})
    if receipt["logistics"]:
        directory = "buildings/logistics"
        collection = json.loads((root / directory / "collection.json").read_text())
        height_meta = json.loads((root / directory / collection["heightMetadata"]).read_text())
        for component in height_meta["components"]:
            view_dir = str(Path(component["spatial"]).parent)
            views.append({"buildingId": component["id"], "view": "top", "directory": f"{directory}/{view_dir}",
                          "spatial": f"{directory}/{component['spatial']}", "occlusion": f"{directory}/{component['occlusion']}", "ports": None, "effects": None})
    target_mapping = stage / "resources/building-top-view-v15.json"
    target_mapping.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n")
    plan = {"schemaVersion": 1, "sourceSite": provenance, "entries": receipt["entries"], "views": views, "animations": sorted(set(animations)), "statics": statics, "logistics": receipt["logistics"]}
    (batch / "import-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    print(f"Metadata prepared: {len(animations)} animations, {len(statics)} static sprites, {len(views)} height views", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True)
    parser.add_argument("--entity", action="append", dest="entities")
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    if args.metadata_only:
        prepare_metadata(args.batch)
    else:
        prepare_source(args.batch, args.entities)
