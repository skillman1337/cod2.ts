"""Path helpers shared by local commands and flattened Pyodide deployments.

Importing this module performs no extraction and does not read retail binaries.
"""
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parent


def tool_script(relative: str) -> Path:
    """Resolve a canonical tool path, or its deployed flat browser equivalent."""
    if relative.startswith("/") or relative.startswith("\\"):
        raise ValueError(f"Unsafe tool path: {relative!r}")
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative:
        raise ValueError(f"Unsafe tool path: {relative!r}")
    if not path.parts or path.parts[0] == "archive":
        raise ValueError("Archived source is not an executable tool")
    canonical = TOOLS / path
    if canonical.is_file():
        return canonical
    # Browser STAGES retain stable flat virtual filenames for compatibility.
    flat = TOOLS / path.name
    if path.parts[0] == "assets" and flat.is_file():
        return flat
    raise FileNotFoundError(f"Tool not found: {canonical}")
