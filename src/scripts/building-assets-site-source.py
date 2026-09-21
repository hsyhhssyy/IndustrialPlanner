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
SOURCE_RESOLUTION = 0.5
SOURCE_PIXELS_PER_CELL = 64
LOGICAL_PIXELS_PER_CELL = 128
PROTOCOL_CORE_OPEN_IDLE_ONLY_SPRITE_IDS = frozenset({
    "item_port_sp_hub_1",
    "item_port_sp_sub_hub_1",
})


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


def validate_texture_profile(value, label):
    if (not isinstance(value, dict)
            or value.get("pixelsPerCell") != SOURCE_PIXELS_PER_CELL
            or value.get("logicalPixelsPerCell") != LOGICAL_PIXELS_PER_CELL
            or value.get("resolution") != SOURCE_RESOLUTION):
        raise ValueError(f"Unsupported 64px texture profile: {label}")
    return value


def validate_physical_rect(value, page, label):
    if (not isinstance(value, list) or len(value) != 4
            or not all(isinstance(number, (int, float)) and not isinstance(number, bool) for number in value)):
        raise ValueError(f"Invalid physicalRect: {label}")
    left, top, width, height = value
    if (left < 0 or top < 0 or width <= 0 or height <= 0
            or left + width > page["width"] or top + height > page["height"]):
        raise ValueError(f"physicalRect exceeds its page: {label}")
    return value


def prepare_source(batch, selected_ids=None, base_url=SITE_URL, logistics_only=False):
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
    # AI-CORRECTION 2026-09-19: 仓库不再保存网站原件，下载批次不得依赖 resources 中的历史素材缓存。
    originals = {}
    manifest = json.loads(download("assets-manifest.json"))
    release = json.loads(download("release.json"))
    if (manifest.get("schemaVersion") != 2
            or manifest.get("defaultPixelsPerCell") != SOURCE_PIXELS_PER_CELL
            or manifest.get("preview") != {"pixelsPerCell": SOURCE_PIXELS_PER_CELL, "root": "./"}):
        raise ValueError("Unsupported 64px asset manifest")
    if release.get("schemaVersion") != 1:
        raise ValueError("Unsupported release schema")
    for document in (manifest, release):
        if any(document.get(key) != index[key] for key in ("releaseId", "sourceVersion")):
            raise ValueError("Website release metadata differs from root index")
    buildings = {b["id"]: b for b in manifest["buildings"]}
    if manifest["buildingCount"] != len(buildings):
        raise ValueError("Building count differs")
    root_buildings = {b["id"]: b for b in index["buildings"]}
    if set(buildings) != set(root_buildings):
        raise ValueError("Building index coverage differs")
    mapping = json.loads(Path("resources/building-top-view-v15.json").read_text())
    entries = mapping["entries"]
    if logistics_only:
        if selected_ids:
            raise ValueError("Logistics scope cannot be combined with entity selection")
        entries = []
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
        # AI-CORRECTION 2026-09-14: 用户已授权烘焙物流接入，JSON/WebP 闭包现在包含烘焙图集与协议。
        # AI-REMOVED 2026-09-14:
        # Reason: 排除烘焙文件会使新增播放器缺少原件。
        # Trigger: 用户授权网站烘焙物流接入。
        # Evidence: logistics-baked.json 声明 pages 与 fluidPlayback。
        # Replacement: 下方按已选前缀完整收集。
        # Risk: Low; Human Review: Required
        # Original code:
        # if name.startswith("buildings/logistics/baked/") or name in (
        #     "buildings/logistics/logistics-baked.json", "buildings/logistics/logistics-files.json",
        # ):
        #     continue
        if any(name.startswith(prefix) for prefix in prefixes):
            names.add(name)
    for view in views:
        if f"buildings/{view}/package.json" not in names:
            raise ValueError(f"Mapped view missing: {view}")
    required_hashes = {indexed[name]["sha256"] for name in names}
    # AI-REMOVED 2026-09-19:
    # Reason: 网站原件只允许存在于本次 .temp/.trash 批次，仓库内不再维护展开素材或跨批次缓存。
    # Trigger: 用户要求移除本地展开素材，降低 Git 体积与变更压力。
    # Evidence: prepare_source 已按网站完整性索引下载并逐文件校验；项目运行时只消费 public 发布产物。
    # Replacement: 上方批次内 originals 缓存；首次命中前直接从固定网站发布下载。
    # Risk: 网站不可用时无法重发历史版本。
    # Human Review: Required
    #
    # Original code:
    # for folder in ["device-sprite-animation", "device-sprite-original", "building-port-effects", "logistics-materials"]:
    #     for file in (Path("resources") / folder).rglob("*"):
    #         if file.is_file() and file.suffix in (".webp", ".json"):
    #             file_hash = digest(file.read_bytes())
    #             if file_hash in required_hashes:
    #                 originals[file_hash] = file
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
    for name in sorted(names):
        if not name.endswith(".json"):
            continue
        document = json.loads((source / name).read_text())
        profile = document.get("textureProfile") if isinstance(document, dict) else None
        if profile is not None:
            validate_texture_profile(profile, name)
        if name.endswith("/package.json") and profile is None:
            raise ValueError(f"Missing 64px texture profile: {name}")
    if fetch("integrity.json.sha256", base_url) != anchor:
        raise ValueError("Website release changed during download")
    receipt = {
        "schemaVersion": 1, "siteUrl": base_url, "releaseId": index["releaseId"],
        "sourceVersion": index["sourceVersion"], "indexSha256": index_hash,
        "sourceResolution": SOURCE_RESOLUTION,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": [{k: e[k] for k in ("entityId", "spriteId", "sourcePath", "animated")} for e in entries],
        "logistics": "logistics" in selected_buildings,
        "scope": "logistics" if logistics_only else "entities" if selected_ids else "buildings",
        "unmappedBuildings": sorted(set(buildings) - selected_buildings),
        "files": [{**indexed[name], "localPath": f"site/{name}"} for name in sorted(names)],
    }
    (batch / "source-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(f"Source ready: {batch / 'source-receipt.json'}", flush=True)
    return receipt


def create_status_playback(package, source_phases, sprite_id):
    """将网站片段与 statusControl 规范化为项目运行时唯一播放路由。"""
    clip_ids = set(source_phases)
    status_clips = {}
    source_statuses = {}
    clip_options = {}
    fallback_candidates = []
    status_control = package.get("statusControl")
    runtime_status_by_code = {
        "IDLE": "idle",
        "RUNNING": "normal",
        "BLOCKED": "blocked",
        "NO_POWER": "no-power",
        "NOT_IN_POWER_NET": "not-in-power-net",
    }
    if status_control is not None:
        if not isinstance(status_control, dict) or not isinstance(status_control.get("codes"), list):
            raise ValueError(f"Invalid statusControl: {sprite_id}")
        seen_status_keys = set()
        for item in status_control["codes"]:
            animation = item.get("animation") if isinstance(item, dict) else None
            code = item.get("code") if isinstance(item, dict) else None
            status_key = item.get("statusKey") if isinstance(item, dict) else None
            if (not isinstance(code, str) or not code or not code.replace("_", "").isalnum()
                    or not code[0].isalpha() or code != code.upper()
                    or not isinstance(status_key, int) or status_key <= 0
                    or status_key in seen_status_keys or not isinstance(animation, dict)):
                raise ValueError(f"Invalid statusControl entry: {sprite_id}")
            clip = animation.get("clip")
            playing = animation.get("playing")
            restart = animation.get("restart")
            if clip not in clip_ids or not isinstance(playing, bool) or not isinstance(restart, bool):
                raise ValueError(f"Invalid statusControl animation: {sprite_id}/{code}")
            seen_status_keys.add(status_key)
            source_statuses[code] = {
                "statusKey": status_key,
                "clip": clip,
                "playing": playing,
                "restart": restart,
            }
            option = {"playing": playing, "restart": restart}
            if clip in clip_options and clip_options[clip] != option:
                raise ValueError(f"Conflicting statusControl playback: {sprite_id}/{clip}")
            clip_options[clip] = option
            runtime_status = runtime_status_by_code.get(code)
            if runtime_status is not None:
                if runtime_status in status_clips and status_clips[runtime_status] != clip:
                    raise ValueError(f"Duplicate runtime status animation: {sprite_id}/{runtime_status}")
                status_clips[runtime_status] = clip
            if code == "CLOSED":
                fallback_candidates.append(clip)

    if "open_idle" in clip_ids:
        status_clips.setdefault("normal", "open_idle")
    if "close_idle" in clip_ids:
        fallback_candidates.append("close_idle")
    if "static" in clip_ids and not fallback_candidates:
        fallback_candidates.append("static")
        clip_options.setdefault("static", {"playing": False, "restart": False})

    fallback_candidates = list(dict.fromkeys(fallback_candidates))
    if len(fallback_candidates) != 1:
        raise ValueError(f"Animation requires exactly one fallback clip: {sprite_id}/{fallback_candidates}")
    fallback_clip = fallback_candidates[0]
    normal_clip = status_clips.get("normal")
    open_transition = "open" if normal_clip == "open_idle" and "open" in clip_ids else None
    close_transition = "close" if fallback_clip == "close_idle" and "close" in clip_ids else None
    if "open" in clip_ids and open_transition is None:
        raise ValueError(f"Open transition has no open_idle target: {sprite_id}")
    if "close" in clip_ids and close_transition is None:
        raise ValueError(f"Close transition has no close_idle target: {sprite_id}")
    static_clip = open_transition or normal_clip or fallback_clip
    return {
        "fallbackClip": fallback_clip,
        "staticClip": static_clip,
        "statusClips": status_clips,
        "openTransitionClip": open_transition,
        "closeTransitionClip": close_transition,
        "clipOptions": clip_options,
        "sourceStatuses": source_statuses,
    }


def resolve_animation_delivery(package, sources, source_phases, sprite_id):
    """协议核心只发布并播放 open_idle；其他设备继续遵循网站 status 路由。"""
    if sprite_id not in PROTOCOL_CORE_OPEN_IDLE_ONLY_SPRITE_IDS:
        return {
            "sources": sources,
            "clips": source_phases,
            "playback": create_status_playback(package, source_phases, sprite_id),
            "clipSelection": "website-status-driven-phases",
        }
    ranges = source_phases.get("open_idle")
    if not ranges:
        raise ValueError(f"Protocol core requires open_idle animation: {sprite_id}")
    selected_source_names = {frame_range["source"] for frame_range in ranges}
    selected_sources = {
        name: source for name, source in sources.items() if name in selected_source_names
    }
    if set(selected_sources) != selected_source_names:
        raise ValueError(f"Protocol core open_idle references unknown sources: {sprite_id}")
    return {
        "sources": selected_sources,
        "clips": {"open_idle": ranges},
        "playback": {
            "fallbackClip": "open_idle",
            "staticClip": "open_idle",
            "statusClips": {
                status: "open_idle" for status in (
                    "closed", "idle", "normal", "blocked", "no-power", "not-in-power-net"
                )
            },
            "openTransitionClip": None,
            "closeTransitionClip": None,
            "clipOptions": {"open_idle": {"playing": True, "restart": False}},
            "sourceStatuses": {},
        },
        "clipSelection": "protocol-core-open-idle-only",
    }


def delivery_is_animated(package, phase_static_flags):
    """网站 statusControl 与非静态轨道均要求进入动画发布链。"""
    return package.get("statusControl") is not None or any(not is_static for is_static in phase_static_flags)


def prepare_metadata(batch):
    """无损读取网站 JSON 的大整数；将网站页面与已确认动画阶段关联到临时批次原件。"""
    batch = Path(batch).resolve()
    receipt = json.loads((batch / "source-receipt.json").read_text())
    source_resolution = receipt.get("sourceResolution")
    if source_resolution != SOURCE_RESOLUTION:
        raise ValueError("Pinned source is not the supported 64px resolution")
    release = validate_path(receipt["releaseId"])
    if "/" in release:
        raise ValueError("Release ID must be a single directory name")
    stage = batch / "stage"
    if (stage / "public").exists():
        raise ValueError("Published stage already exists; metadata cannot be changed after publishing")
    source = batch / "site"
    source_root = "site"
    root = batch / source_root
    index_bytes = (source / "integrity.json").read_bytes()
    if digest(index_bytes) != receipt["indexSha256"]:
        raise ValueError("Staged root index differs from pinned receipt")
    indexed = {e["path"]: e for e in json.loads(index_bytes)["files"]}
    for entry in receipt["files"]:
        name = validate_path(entry["path"])
        verify((source / name).read_bytes(), indexed[name])
    # AI-REMOVED 2026-09-19:
    # Reason: 同一批网站原件不再复制到 stage/resources，避免暂存重复并阻止 apply 将展开素材写入仓库。
    # Trigger: 用户要求网站素材包只存在于 .temp/.trash。
    # Evidence: source 指向 batch/site，下载阶段已经完成逐文件大小与 SHA-256 校验。
    # Replacement: root 直接指向 batch/site；发布器通过 import-plan.sourceRoot 显式读取。
    # Risk: 批次目录清理后不能离线重发。
    # Human Review: Required
    #
    # Original code:
    # canonical = f"resources/building-assets-site/{release}"
    # root = stage / canonical
    # for name in [e["path"] for e in receipt["files"]] + ["integrity.json", "integrity.json.sha256"]:
    #     target = root / name
    #     original = source / name
    #     if target.exists():
    #         if digest(target.read_bytes()) != digest(original.read_bytes()):
    #             raise ValueError(f"Previously staged original changed: {name}")
    #     else:
    #         target.parent.mkdir(parents=True, exist_ok=True)
    #         shutil.copyfile(original, target)
    mapping_file = Path("resources/building-top-view-v15.json")
    mapping = json.loads(mapping_file.read_text())
    history = batch / "history"
    history.mkdir(exist_ok=True)
    receipt_history_suffix = ""
    if receipt.get("scope") == "entities":
        selection_hash = digest("|".join(sorted(e["entityId"] for e in receipt["entries"])).encode())[:16]
        receipt_history_suffix = f".entities-{selection_hash}"
    shutil.copyfile(
        mapping_file,
        history / f"previous-mapping{receipt_history_suffix}.json",
    )
    shutil.copyfile(
        batch / "source-receipt.json",
        history / f"source-receipt{receipt_history_suffix}.json",
    )
    provenance = {k: receipt[k] for k in (
        "siteUrl", "releaseId", "sourceVersion", "indexSha256", "sourceResolution"
    )}
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
        validate_texture_profile(package.get("textureProfile"), f"{directory}/package.json")
        validate_texture_profile(spatial.get("textureProfile"), f"{directory}/spatial.json")
        width, height = (spatial["framePixels"][key] for key in ("width", "height"))
        physical_width_value = width * source_resolution
        physical_height_value = height * source_resolution
        if not all(isinstance(value, (int, float)) and value > 0 and value.is_integer()
                   for value in (physical_width_value, physical_height_value)):
            raise ValueError(f"View has fractional physical frame dimensions: {directory}")
        physical_width = int(physical_width_value)
        physical_height = int(physical_height_value)
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
        phase_static_flags = []
        frame_rates = set()
        for phase in package["animations"]:
            phase_root = f"{directory}/animations/{validate_path(phase)}"
            sheet = json.loads((root / phase_root / "spritesheet.json").read_text())
            animation = json.loads((root / phase_root / "animation.json").read_text())
            validate_texture_profile(sheet.get("textureProfile"), f"{phase_root}/spritesheet.json")
            validate_texture_profile(animation.get("textureProfile"), f"{phase_root}/animation.json")
            phase_static_flags.append(animation.get("static") is True)
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
                if page.get("resolution") != source_resolution:
                    raise ValueError(f"Page resolution differs: {source_path}")
                rows, columns = page.get("rows"), page.get("columns")
                if (not isinstance(rows, int) or rows <= 0 or not isinstance(columns, int) or columns <= 0
                        or page["width"] != columns * physical_width
                        or page["height"] != rows * physical_height):
                    raise ValueError(f"Page is not a physical frame grid: {source_path}")
                # 部分交付的 rows 表示使用行数，页面仍保留透明尾行；按物理尺寸建源网格。
                if page["frameCount"] > rows * columns:
                    raise ValueError(f"Page grid dimensions differ: {source_path}")
                page_frames = sheet.get("frames", [])[page["frameStart"]:page["frameStart"] + page["frameCount"]]
                if len(page_frames) != page["frameCount"]:
                    raise ValueError(f"Page frame range differs: {source_path}")
                for local_index, frame in enumerate(page_frames):
                    physical_rect = validate_physical_rect(frame.get("physicalRect"), page, f"{source_path}#{local_index}")
                    expected = [local_index % columns * physical_width,
                                local_index // columns * physical_height,
                                physical_width, physical_height]
                    if physical_rect != expected or frame.get("page") != page["index"] or frame.get("localIndex") != local_index:
                        raise ValueError(f"Physical frame grid differs: {source_path}#{local_index}")
                sources[name] = {"file": f"{name}.webp", "rows": rows, "columns": columns,
                                 "frameCount": page["frameCount"], "frameDurationsMs": durations,
                                 "physicalFrameWidth": physical_width, "physicalFrameHeight": physical_height,
                                 "sourcePath": source_path, "sha256": source_hash}
                ranges.append({"source": name, "startFrame": 0, "frameCount": page["frameCount"]})
            source_phases[phase] = ranges
        entry["animated"] = delivery_is_animated(package, phase_static_flags)
        if entry["animated"]:
            entry["closeIdleMode"] = entry.get("closeIdleMode") or (
                "hold-last" if "close_idle" in source_phases else "loop"
            )
            previous_path = Path("resources/device-sprite-animation") / entry["spriteId"] / "manifest.json"
            previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
            delivery = resolve_animation_delivery(
                package, sources, source_phases, entry["spriteId"]
            )
            if len(frame_rates) != 1:
                raise ValueError(f"Animation phases have different frame rates: {directory}")
            manifest = {"schemaVersion": 2, "frameWidth": width, "frameHeight": height, "fps": frame_rates.pop(),
                        "sourceResolution": source_resolution,
                        "pageRows": min(previous.get("pageRows", 7), 4095 // height),
                        "pageColumns": min(previous.get("pageColumns", 5), 4095 // width),
                        "sources": delivery["sources"], "clips": delivery["clips"], "frameTransform": "flip-top-bottom", "coordinateTransform": "projectY = depth - 1 - sourceZ",
                        "playback": delivery["playback"], "clipSelection": delivery["clipSelection"],
                        "sourceSite": provenance}
            output = stage / "resources/device-sprite-animation" / entry["spriteId"] / "manifest.json"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            previous_animation = history / f"{entry['spriteId']}-previous-animation.json"
            if previous_path.exists():
                shutil.copyfile(previous_path, previous_animation)
            animations.append(entry["spriteId"])
        else:
            phase = next((p for p in ("static", "bind_pose", "close_idle") if p in source_phases), None)
            if phase is None and len(declared_static_phases) == 1:
                phase = declared_static_phases[0]
            if phase is None:
                raise ValueError(f"No declared static frame: {directory}")
            page = sources[source_phases[phase][0]["source"]]
            statics.append({"spriteId": entry["spriteId"], "sourcePath": page["sourcePath"],
                            "width": width, "height": height, "physicalWidth": physical_width,
                            "physicalHeight": physical_height, "sourceResolution": source_resolution})
    if receipt["logistics"]:
        directory = "buildings/logistics"
        collection = json.loads((root / directory / "collection.json").read_text())
        height_meta = json.loads((root / directory / collection["heightMetadata"]).read_text())
        for component in height_meta["components"]:
            view_dir = str(Path(component["spatial"]).parent)
            views.append({"buildingId": component["id"], "view": "top", "directory": f"{directory}/{view_dir}",
                          "spatial": f"{directory}/{component['spatial']}", "occlusion": f"{directory}/{component['occlusion']}", "ports": None, "effects": None})
    target_mapping = stage / "resources/building-top-view-v15.json"
    if receipt.get("scope") != "logistics":
        target_mapping.parent.mkdir(parents=True, exist_ok=True)
        target_mapping.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n")
    normalized_entries = [{key: entry[key] for key in ("entityId", "spriteId", "sourcePath", "animated")}
                          for entry in mapping["entries"] if entry["entityId"] in selected]
    if len(normalized_entries) != len(receipt["entries"]):
        raise ValueError("Normalized mapping coverage differs from pinned receipt")
    plan = {"schemaVersion": 1, "sourceSite": provenance, "sourceRoot": source_root,
            "sourceResolution": source_resolution, "entries": normalized_entries, "views": views,
            "animations": sorted(set(animations)), "statics": statics, "logistics": receipt["logistics"]}
    plan["scope"] = receipt.get("scope", "buildings")
    plan["receiptHistorySuffix"] = receipt_history_suffix
    (batch / "import-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    print(f"Metadata prepared: {len(animations)} animations, {len(statics)} static sprites, {len(views)} height views", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True)
    parser.add_argument("--entity", action="append", dest="entities")
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--logistics-only", action="store_true")
    args = parser.parse_args()
    if args.metadata_only:
        prepare_metadata(args.batch)
    else:
        prepare_source(args.batch, args.entities, logistics_only=args.logistics_only)
