"""Explicit paths for version-specific reference probes, not browser imports.

Environment overrides change file locations, NOT supported instruction addresses.
Existing binary hashes and instruction-byte assertions remain in the probes.
"""
import os
from pathlib import Path
from .retail_paths import GAME, EXE, DLL


class _WorkspacePath:
    """Placeholder that raises a descriptive error when COD2_RE_WORKSPACE is not configured."""

    def __truediv__(self, other):
        env = os.environ.get("COD2_RE_WORKSPACE")
        if not env:
            raise RuntimeError(
                "COD2_RE_WORKSPACE environment variable is not set. "
                "Point it to your disassembly/reverse-engineering workspace "
                "containing functions/ to run native inspection probes."
            )
        return Path(env) / other

    def __fspath__(self):
        env = os.environ.get("COD2_RE_WORKSPACE")
        if not env:
            raise RuntimeError(
                "COD2_RE_WORKSPACE environment variable is not set. "
                "Point it to your disassembly/reverse-engineering workspace."
            )
        return env

    def __str__(self):
        return os.environ.get("COD2_RE_WORKSPACE", "")

    def __repr__(self):
        return f"RE_WORKSPACE({os.environ.get('COD2_RE_WORKSPACE')!r})"


# Reference native binaries used by optional reverse-engineering inspection tools.
# Defaults to the detected game executable and renderer DLL.
NATIVE_BACKUP = Path(os.environ.get("COD2_NATIVE_BACKUP", str(GAME)))
NATIVE_EXE = Path(os.environ.get("COD2_NATIVE_EXE") or os.environ.get("COD2_EXE") or str(EXE))
NATIVE_DLL = Path(os.environ.get("COD2_NATIVE_DLL") or os.environ.get("COD2_DLL") or str(DLL))

# Disassembly/reverse-engineering workspace (used only by offline inspect/native/ probes)
RE_WORKSPACE = Path(os.environ["COD2_RE_WORKSPACE"]) if "COD2_RE_WORKSPACE" in os.environ else _WorkspacePath()
