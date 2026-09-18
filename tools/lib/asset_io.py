"""Shared archive lookup and compact JSON output for asset exporters.

Archive order and case-folding intentionally match the original exporters:
lexically later IWDs override earlier entries; lookups are case-insensitive.
No archive contents are unpacked to disk by this module.
"""
import json
from pathlib import Path
from typing import Any
from zipfile import ZipFile

ArchiveIndex = dict[str, tuple[Path, str]]


def index_iwds(main: Path) -> ArchiveIndex:
    entries: ArchiveIndex = {}
    for archive in sorted(Path(main).glob("*.iwd")):
        with ZipFile(archive) as stream:
            for name in stream.namelist():
                entries[name.lower()] = (archive, name)
    return entries


def read_iwd(entries: ArchiveIndex, name: str) -> bytes:
    archive, original_name = entries[name.lower()]
    with ZipFile(archive) as stream:
        return stream.read(original_name)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
