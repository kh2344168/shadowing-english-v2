"""Separate process: model memory is released on completion/cancel. English script is required."""
import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import wave
from pathlib import Path

from contracts import Invalid, MAX_DURATION, cut_audio, save_json


def progress(root, phase, percent):
    save_json(root / "progress.json", {"phase": phase, "percent": percent})


def align(root, model_root):
    data = json.loads((root / "request.json").read_text(encoding="utf-8"))
    progress(root, "decoding", 10)
    process = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-threads", "2", "-protocol_whitelist", "file,pipe", "-i",
                              str(root / ("input" + data["extension"])), "-vn", "-ac", "1",
                              "-ar", "16000", "-c:a", "pcm_s16le", "-t", "601",
                              str(root / "source.wav")], capture_output=True, timeout=120)
    if process.returncode:
        raise Invalid("media_decode_failed")
    with wave.open(str(root / "source.wav"), "rb") as source:
        duration = source.getnframes() / source.getframerate()
    if not 0 < duration <= MAX_DURATION:
        raise Invalid("media_too_long")
    progress(root, "aligning", 30)
    # Suppress library transcript/path output. Only safe structured status is exposed to the site.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        import whisperx
        audio = whisperx.load_audio(str(root / "source.wav"))
        model, metadata = whisperx.load_align_model(language_code="en", device="cpu",
                                                    model_dir=str(model_root))
        transcript = [{"text": " ".join(data["lines"]), "start": 0, "end": duration}]
        result = whisperx.align(transcript, model, metadata, audio, "cpu",
                                return_char_alignments=False)
    words = result.get("word_segments", [])
    expected = sum(len(line.split()) for line in data["lines"])
    expected_words = ' '.join(data['lines']).split()
    if len(words) != expected or [word.get('word') for word in words] != expected_words:
        raise Invalid("script_alignment_mismatch")
    segments = []
    offset = 0
    for line in data["lines"]:
        count = len(line.split())
        matched = words[offset:offset + count]
        offset += count
        # No fallback to the original whole-file timestamps for an unaligned line.
        timed = [word for word in matched if "start" in word and "end" in word]
        if not timed or 'start' not in matched[0] or 'end' not in matched[-1]:
            raise Invalid("line_has_no_timing")
        start = float(max(0, timed[0]["start"] - data["settings"]["leadingMs"] / 1000))
        end = float(min(duration, timed[-1]["end"] + data["settings"]["trailingMs"] / 1000))
        segments.append({"text": line, "start": start, "end": end})
    progress(root, "cutting", 85)
    clips, duration = cut_audio(root, segments)
    save_json(root / "manifest.json", {"schemaVersion": 1, "profile": "shadowing-v2-1",
              "jobId": root.name, "title": data["title"], "description": data["description"],
              "duration": duration, "reviewRequired": True, "segments": clips})
    progress(root, "complete", 100)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--warmup", action="store_true")
    args = parser.parse_args()
    os.environ["HF_HOME"] = str(args.models / "huggingface")
    threads = str(max(1, min(4, os.cpu_count() or 1)))
    os.environ['OMP_NUM_THREADS'] = threads
    os.environ['MKL_NUM_THREADS'] = threads
    os.environ['NLTK_DATA'] = str(args.models / 'nltk')
    import nltk
    nltk.data.path.insert(0, str(args.models / 'nltk'))
    if args.warmup:
        (args.models / 'nltk').mkdir(parents=True, exist_ok=True)
        if not nltk.download('punkt_tab', download_dir=str(args.models / 'nltk'), quiet=True):
            raise Invalid('language_data_unavailable')
        nltk.data.load('tokenizers/punkt_tab/english.pickle')
        import whisperx
        whisperx.load_align_model(language_code="en", device="cpu", model_dir=str(args.models))
        return
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    try:
        nltk.data.load('tokenizers/punkt_tab/english.pickle')
        align(args.root, args.models)
    except Exception as error:
        code = error.code if isinstance(error, Invalid) else "engine_failed"
        save_json(args.root / "failure.json", {"error": code})
        # No traceback/transcript/library stderr is forwarded to frontend diagnostics.
        sys.exit(1)


if __name__ == "__main__":
    main()
