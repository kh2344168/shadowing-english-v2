"""Local, bounded contracts. No site account/session secrets enter this process."""
import hashlib
import json
import math
import re
import wave
from pathlib import Path
from urllib.parse import urlsplit

PROTOCOL = 1
PROFILE = "shadowing-v2-1"
MAX_SOURCE = 100_000_000
MAX_AUDIO = 2_000_000
MAX_DURATION = 600
DEFAULT_SETTINGS = {"profile": PROFILE, "leadingMs": 150, "trailingMs": 100}
JOB_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")


class Invalid(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def origin_ok(value):
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 for char in value):
        return False
    try:
        parsed = urlsplit(value)
        parsed.port  # Reject malformed or out-of-range ports.
    except ValueError:
        return False
    return (not parsed.username and not parsed.password and parsed.path == ""
            and not parsed.query and not parsed.fragment and bool(parsed.hostname)
            and (parsed.scheme == "https" or
                 parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")))


def link(value):
    if (not isinstance(value, dict) or value.get("schemaVersion") != 1
            or value.get("protocolVersion") != PROTOCOL or not origin_ok(value.get("origin"))
            or not isinstance(value.get("userId"), str) or not 1 <= len(value["userId"]) <= 128
            or not isinstance(value.get("token"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", value["token"])):
        raise Invalid("invalid_link")
    return {**{key: value[key] for key in
               ("schemaVersion", "protocolVersion", "origin", "userId", "token")},
            "settings": settings(value.get("settings", DEFAULT_SETTINGS))}


def settings(value):
    if not isinstance(value, dict) or value.get("profile") != PROFILE:
        raise Invalid("unsupported_profile")
    for key in ("leadingMs", "trailingMs"):
        if type(value.get(key)) is not int or not 0 <= value[key] <= 1000:
            raise Invalid("invalid_padding")
    return {key: value[key] for key in DEFAULT_SETTINGS}


def text(value, maximum, minimum=0):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise Invalid("invalid_text")
    return value.strip()


def request(value):
    if (not isinstance(value, dict) or not isinstance(value.get("requestId"), str)
            or not JOB_ID.fullmatch(value["requestId"])):
        raise Invalid("invalid_request")
    lines = value.get("lines")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 20:
        raise Invalid("invalid_lines")
    lines = [text(re.sub(r"^(?:[AB]|Teacher|Student):\s*", "", line), 1000, 1)
             if isinstance(line, str) else text(line, 1000, 1) for line in lines]
    lines = [' '.join(line.split()) for line in lines]
    extension = value.get("extension")
    if extension not in (".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".webm"):
        raise Invalid("unsupported_media")
    return {"requestId": value["requestId"], "title": text(value.get("title"), 160, 2),
            "description": text(value.get("description", ""), 1000), "lines": lines,
            "extension": extension, "settings": settings(value.get("settings"))}


def signature(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def save_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def cut_audio(root, segments):
    """PCM16 mono 16kHz clips; input is already converted by ffmpeg."""
    root = Path(root)
    with wave.open(str(root / "source.wav"), "rb") as audio:
        if audio.getparams()[:3] != (1, 2, 16000):
            raise Invalid("invalid_normalized_audio")
        duration = audio.getnframes() / 16000
        if not 0 < duration <= MAX_DURATION:
            raise Invalid("media_too_long")
        if not isinstance(segments, list) or not 1 <= len(segments) <= 20:
            raise Invalid("invalid_lines")
        # Validate the complete edit before changing any existing clip.
        prepared = []
        previous_start = -1
        for index, segment in enumerate(segments):
            if not isinstance(segment, dict):
                raise Invalid("invalid_bounds")
            start, end = segment.get("start"), segment.get("end")
            if (type(start) not in (int, float) or type(end) not in (int, float)
                    or not math.isfinite(start) or not math.isfinite(end)
                    or not 0 <= start < end <= duration or start < previous_start):
                raise Invalid("invalid_bounds")
            previous_start = start
            name = f"segment-{index + 1:02}.wav"
            frames = round(end * 16000) - round(start * 16000)
            if frames * 2 + 44 > MAX_AUDIO:
                raise Invalid("segment_too_long")
            if frames < 1:
                raise Invalid("invalid_bounds")
            prepared.append((name, round(start * 16000) / 16000, round(end * 16000) / 16000,
                             frames, text(segment.get("text"), 1000, 1)))
        result = []
        for name, start, end, frames, spoken_text in prepared:
            audio.setpos(round(start * 16000))
            data = audio.readframes(frames)
            with wave.open(str(root / name), "wb") as target:
                target.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                target.writeframes(data)
            raw = (root / name).read_bytes()
            result.append({"text": spoken_text,
                           "start": start, "end": end,
                           "audioFile": name, "bytes": len(raw),
                           "sha256": hashlib.sha256(raw).hexdigest()})
    return result, duration
