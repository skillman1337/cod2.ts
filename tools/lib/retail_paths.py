"""Shared input paths for retail asset tools; setup_assets.py sets these explicitly.

Dynamic path resolution relies on standard environment variables, local project
directories, and standard operating system installation locations.
"""
import os
from pathlib import Path
import shutil
import sys

try:
    from .project import ROOT
except Exception:
    ROOT = Path(__file__).resolve().parents[2]


def _find_registry_install_path() -> Path | None:
    """Attempt to detect Call of Duty 2 installation from Windows Registry."""
    if sys.platform != "win32":
        return None
    try:
        import winreg

        subkeys = [
            r"SOFTWARE\Activision\Call of Duty 2",
            r"SOFTWARE\WOW6432Node\Activision\Call of Duty 2",
        ]
        for subkey in subkeys:
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(hive, subkey) as key:
                        val, _ = winreg.QueryValueEx(key, "InstallPath")
                        candidate = Path(val)
                        if candidate.is_dir():
                            return candidate
                except (FileNotFoundError, OSError):
                    pass
    except Exception:
        pass
    return None


def _detect_game_dir() -> Path:
    """Resolve the retail Call of Duty 2 directory."""
    # 1. Explicit environment variable override
    env_game = os.environ.get("COD2_GAME")
    if env_game:
        return Path(env_game)

    # 2. Local workspace directory if present (e.g. retail/)
    local_retail = ROOT / "retail"
    if local_retail.is_dir():
        return local_retail

    # 3. Windows registry lookup
    reg_path = _find_registry_install_path()
    if reg_path:
        return reg_path

    # 4. Standard platform default
    if sys.platform == "win32":
        prog_files = (
            os.environ.get("ProgramFiles(x86)")
            or os.environ.get("ProgramFiles")
            or "C:/Program Files (x86)"
        )
        return Path(prog_files) / "Activision" / "Call of Duty 2"
    return ROOT / "retail"


def _detect_main_dir(game: Path) -> Path:
    env_main = os.environ.get("COD2_MAIN")
    if env_main:
        return Path(env_main)
    main_candidate = game / "main"
    if main_candidate.is_dir():
        return main_candidate
    return game


def _detect_binary(game: Path, filename: str, env_var: str) -> Path:
    env_bin = os.environ.get(env_var)
    if env_bin:
        return Path(env_bin)
    candidate = game / filename
    if candidate.is_file():
        return candidate
    in_bin = game / "bin" / filename
    if in_bin.is_file():
        return in_bin
    return candidate


GAME = _detect_game_dir()
MAIN = _detect_main_dir(GAME)
EXE = _detect_binary(GAME, "CoD2MP_s.exe", "COD2_EXE")
DLL = _detect_binary(GAME, "gfx_d3d_mp_x86_s.dll", "COD2_DLL")
CPP = os.environ.get("COD2_CPP") or shutil.which("gcc") or shutil.which("clang") or "gcc"
CXX = os.environ.get("COD2_CXX") or shutil.which("g++") or shutil.which("clang++") or "g++"
