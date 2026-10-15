"""Local LibreOffice conversion, shared by extraction and preview.

LibreOffice (headless) is the one place this app renders Office
documents. It is used to:

- convert a presentation (``.ppt``/``.pptx``) to PDF for the inline
  viewer (see ``preview_service``);
- convert a legacy ``.doc`` to ``.docx`` so the text extractor can
  read it (see ``extractors``).

Everything runs as a local child process on this machine — no file is
ever sent to an external conversion service. When LibreOffice is not
installed, callers degrade gracefully instead of pretending to convert.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


class OfficeConversionError(Exception):
    """A local LibreOffice conversion could not be completed."""


# A large deck or document can take a while; allow a generous ceiling
# without hanging a worker forever.
_CONVERSION_TIMEOUT_SECONDS = 240.0
_MAX_CONVERSION_BYTES = 100 * 1024 * 1024


def find_soffice() -> str | None:
    """Locate a local LibreOffice binary, or ``None`` when absent.

    Checks an explicit override first (so a deployment image can point
    at its own install), then ``PATH``, then the usual install
    locations per platform.
    """
    for env_name in ("LIBREOFFICE_PATH", "SOFFICE_PATH"):
        configured = os.environ.get(env_name)
        if configured and Path(configured).is_file():
            return configured

    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
            / "LibreOffice"
            / "program"
            / "soffice.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
            / "LibreOffice"
            / "program"
            / "soffice.exe",
            Path(local_app_data) / "Programs" / "LibreOffice" / "program" / "soffice.exe",
        ]
    else:
        candidates = [
            Path("/usr/bin/soffice"),
            Path("/usr/bin/libreoffice"),
            Path("/usr/local/bin/soffice"),
            Path("/opt/libreoffice/program/soffice"),
            Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def conversion_available() -> bool:
    """True when this server can convert Office documents locally."""
    return find_soffice() is not None


def convert_to(
    soffice: str,
    content: bytes,
    filename: str,
    target_format: str,
) -> bytes:
    """Convert ``content`` to ``target_format`` with a local LibreOffice.

    ``target_format`` is a LibreOffice filter name such as ``pdf``,
    ``docx`` or ``txt``. The converted file's bytes are returned; the
    temporary working directory is always cleaned up.
    """
    if len(content) > _MAX_CONVERSION_BYTES:
        raise OfficeConversionError(
            "The file exceeds the 100 MB limit for server-side Office conversion."
        )

    workdir = tempfile.mkdtemp(prefix="lumio-office-")
    try:
        safe_name = Path(filename).name or "document"
        source = Path(workdir) / safe_name
        source.write_bytes(content)

        # An isolated profile avoids clashing with a running LibreOffice
        # and its single-instance lock, which is the common cause of a
        # silent no-op.
        profile = Path(workdir) / "profile"
        command = [
            soffice,
            "--headless",
            "--invisible",
            "--norestore",
            "--nolockcheck",
            f"-env:UserInstallation={profile.as_uri()}",
            "--convert-to",
            target_format,
            "--outdir",
            workdir,
            str(source),
        ]
        try:
            completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
                command,
                capture_output=True,
                text=True,
                timeout=_CONVERSION_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise OfficeConversionError(
                "The conversion took too long."
            ) from exc

        # The converted file shares the source's basename with the
        # target's extension; the isolated profile is a directory, so
        # it is filtered out by is_file().
        produced = [
            path
            for path in Path(workdir).iterdir()
            if path.is_file() and path != source
        ]
        if completed.returncode != 0 or not produced:
            output = (completed.stderr or completed.stdout or "").strip().splitlines()
            hint = output[-1] if output else f"LibreOffice did not produce a {target_format}."
            raise OfficeConversionError(f"Conversion failed ({hint}).")

        oversized = [path for path in produced if path.stat().st_size > _MAX_CONVERSION_BYTES]
        if oversized:
            raise OfficeConversionError(
                "The converted file exceeds the 100 MB inline preview limit."
            )

        wanted = "." + target_format.split(":")[0].lower()
        matching = [path for path in produced if path.suffix.lower() == wanted]
        return (matching[0] if matching else produced[0]).read_bytes()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def convert_to_pdf(soffice: str, content: bytes, filename: str) -> bytes:
    """Convert a document/presentation to PDF bytes, validating the result."""
    data = convert_to(soffice, content, filename, "pdf")
    if not data.startswith(b"%PDF"):
        raise OfficeConversionError("The conversion produced an invalid PDF.")
    return data
