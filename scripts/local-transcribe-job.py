#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from pathlib import Path


PUNCTUATION = {"。", "！", "？", "；", "!", "?", ";", ":", "：", "，", ","}
STRONG_SENTENCE_ENDINGS = {"。", "！", "？", "!", "?"}

# 语气词/口水词过滤列表
FILLER_WORDS = {
    "呃", "嗯", "啊", "哦", "哈", "噢", "嘿", "唉", "哎", "欸", "哟", "喂",
    "嗐", "哼", "咦", "哇", "呀", "嘛", "呗", "吧", "啦", "呢", "咯",
    "嗯嗯", "啊啊", "哦哦", "哦哦哦",
    "对对对", "好好好", "是是是", "嗯嗯嗯",
}
MODEL_CACHE_ALIASES = {
    "fsmn-vad": [("damo", "speech_fsmn_vad_zh-cn-16k-common-pytorch")],
    "cam++": [("damo", "speech_campplus_sv_zh-cn_16k-common")],
}


def write_status(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(
            "Usage: local-transcribe-job.py <audio-path> <status-path> [diarization-enabled]"
        )

    audio_path = Path(sys.argv[1])
    status_path = Path(sys.argv[2])
    diarization_enabled = len(sys.argv) < 4 or sys.argv[3] != "0"

    write_status(
        status_path,
        {
            "status": "processing",
            "message": "本地识别引擎正在处理。"
        },
    )

    try:
        asr_result = run_asr(audio_path)
        asr_segments = build_asr_segments(asr_result)

        speaker_segments = []
        if diarization_enabled:
            speaker_segments = run_diarization(audio_path)

        transcript, segments = build_transcript_output(asr_segments, speaker_segments, diarization_enabled)

        write_status(
            status_path,
            {
                "status": "completed",
                "message": "转写完成。",
                "transcript": transcript,
                "segments": segments,
                "rawStatus": "COMPLETED"
            },
        )
    except Exception as exc:  # noqa: BLE001
        write_status(
            status_path,
            {
                "status": "failed",
                "message": str(exc) or "本地转写失败。"
            },
        )
        raise


def run_asr(audio_path: Path):
    from funasr import AutoModel
    from funasr.register import tables

    model_name = os.environ.get("LOCAL_ASR_MODEL", "iic/SenseVoiceSmall")
    vad_model_name = os.environ.get("LOCAL_ASR_VAD_MODEL", "fsmn-vad")
    device = os.environ.get("LOCAL_ASR_DEVICE", "cpu")
    hub = os.environ.get("LOCAL_ASR_HUB", "ms")
    registered_models = set(tables.model_classes.keys())
    resolved_model_name = resolve_model_source(model_name, registered_models)
    resolved_vad_model_name = resolve_model_source(vad_model_name, registered_models)
    vad_max_single_segment_time = get_int_env("LOCAL_ASR_VAD_MAX_SINGLE_SEGMENT_MS", 30000)
    merge_length_s = get_int_env("LOCAL_ASR_VAD_MERGE_LENGTH_S", 8)

    model = AutoModel(
        model=resolved_model_name,
        vad_model=resolved_vad_model_name,
        vad_kwargs={
            "max_single_segment_time": vad_max_single_segment_time
        },
        device=device,
        trust_remote_code=True,
        hub=hub,
        disable_update=True,
    )
    try:
        result = model.generate(
            input=str(audio_path),
            cache={},
            batch_size=1,
            batch_size_s=60,
            language="auto",
            use_itn=True,
            output_timestamp=True,
            merge_vad=True,
            merge_length_s=merge_length_s,
        )
    except TypeError:
        result = model.generate(input=str(audio_path))

    if not result:
        raise RuntimeError("FunASR 没有返回识别结果。")

    return result[0]


def resolve_model_source(model_name: str, registered_models) -> str:
    normalized_name = str(model_name or "").strip()

    if not normalized_name:
        normalized_name = "SenseVoiceSmall"

    explicit_path = Path(normalized_name).expanduser()
    if explicit_path.exists():
        return str(explicit_path)

    candidate_names = []
    if normalized_name:
        candidate_names.append(normalized_name)

    short_name = normalized_name.split("/")[-1]
    if short_name and short_name not in candidate_names:
        candidate_names.append(short_name)

    cached_model_path = find_cached_model_path(candidate_names)
    if cached_model_path is not None:
        return str(cached_model_path)

    for candidate_name in candidate_names:
        if candidate_name in registered_models:
            return candidate_name

    return normalized_name


def find_cached_model_path(candidate_names):
    home_dir = Path.home()
    cache_root = home_dir / ".cache" / "modelscope" / "hub" / "models"

    if not cache_root.exists():
        return None

    for candidate_name in candidate_names:
        parts = [part for part in candidate_name.split("/") if part]

        for alias_parts in MODEL_CACHE_ALIASES.get(candidate_name, []):
            alias_path = cache_root.joinpath(*alias_parts)
            if is_valid_model_dir(alias_path):
                return alias_path

        if len(parts) >= 2:
            direct_path = cache_root.joinpath(*parts)
            if is_valid_model_dir(direct_path):
                return direct_path

        short_name = parts[-1] if parts else candidate_name
        for namespace in ("iic", "FunAudioLLM"):
            namespaced_path = cache_root / namespace / short_name
            if is_valid_model_dir(namespaced_path):
                return namespaced_path

    return None


def is_valid_model_dir(path: Path) -> bool:
    if not path.is_dir() or not (path / "config.yaml").exists():
        return False

    model_file_names = ("model.pt", "model.pb", "campplus_cn_common.bin")
    return any((path / file_name).exists() for file_name in model_file_names)


def build_asr_segments(result: dict):
    sentence_info = result.get("sentence_info") or result.get("sentences") or []

    if sentence_info:
        segments = []

        for item in sentence_info:
            if not isinstance(item, dict):
                continue

            text = str(item.get("text") or item.get("sentence") or "").strip()
            begin_time = to_int(item.get("begin_time") or item.get("start_time") or item.get("start"))
            end_time = to_int(item.get("end_time") or item.get("end"))

            if text:
                segments.append(
                    {
                        "begin_time": begin_time,
                        "end_time": end_time,
                        "text": text,
                    }
                )

        if segments:
            return segments

    timestamps = result.get("timestamp") or []
    words = result.get("words") or []
    text = (result.get("text") or "").strip()

    if not timestamps or not words or len(timestamps) != len(words):
        return [
            {
                "begin_time": None,
                "end_time": None,
                "text": text,
            }
        ] if text else []

    segments = []
    current_tokens = []
    current_token_items = []
    current_start = None
    current_end = None
    last_end = None
    max_segment_tokens = get_int_env("LOCAL_ASR_MAX_SEGMENT_TOKENS", 80)

    for index, token in enumerate(words):
        time_pair = timestamps[index]
        start_ms = to_int(time_pair[0])
        end_ms = to_int(time_pair[1])

        if current_start is None:
            current_start = start_ms

        current_end = end_ms
        current_tokens.append(str(token))
        current_token_items.append(
            {
                "text": str(token),
                "begin_time": start_ms,
                "end_time": end_ms,
            }
        )

        next_pair = timestamps[index + 1] if index + 1 < len(timestamps) else None
        next_start_ms = to_int(next_pair[0]) if next_pair else None
        should_flush = is_sentence_boundary(token)

        if next_start_ms is not None and current_end is not None and next_start_ms - current_end >= 1800:
            should_flush = True

        if len(current_tokens) >= max_segment_tokens:
            should_flush = True

        if should_flush:
            segment_text = join_tokens(current_tokens)
            if segment_text.strip():
                segments.append(
                    {
                        "begin_time": current_start,
                        "end_time": current_end,
                        "text": segment_text.strip(),
                        "tokens": current_token_items,
                    }
                )
            current_tokens = []
            current_token_items = []
            current_start = None
            current_end = None

        last_end = end_ms

    if current_tokens:
        segment_text = join_tokens(current_tokens)
        if segment_text.strip():
            segments.append(
                {
                    "begin_time": current_start,
                    "end_time": current_end or last_end,
                    "text": segment_text.strip(),
                    "tokens": current_token_items,
                }
            )

    return segments


def is_sentence_boundary(token: str) -> bool:
    return token.strip() in PUNCTUATION


def join_tokens(tokens):
    text_parts = []
    prev_ascii = False

    for token in tokens:
        token = str(token)
        if not token:
            continue

        is_punctuation = token.strip() in PUNCTUATION
        is_ascii = token.isascii() and token.isalnum()

        if not text_parts:
            text_parts.append(token)
        elif is_punctuation:
            text_parts[-1] = f"{text_parts[-1]}{token}"
        elif prev_ascii and is_ascii:
            text_parts.append(f" {token}")
        else:
            text_parts.append(token)

        prev_ascii = is_ascii

    return "".join(text_parts)


def run_diarization(audio_path: Path):
    diarize_script = Path.cwd() / "scripts" / "pyannote-diarize.py"
    output_path = audio_path.parent / "diarization.json"
    args = [sys.executable, str(diarize_script), str(audio_path), str(output_path)]
    timeout_seconds = get_int_env("LOCAL_DIARIZATION_TIMEOUT_SECONDS", 900)

    subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout_seconds)
    raw = json.loads(output_path.read_text(encoding="utf-8"))
    return normalize_speaker_segments(raw)


def normalize_speaker_segments(raw):
    source = raw.get("text", []) if isinstance(raw, dict) else []
    segments = []

    for item in source:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue

        start = to_number(item[0])
        end = to_number(item[1])
        speaker_id = str(item[2])

        if start is None or end is None or end <= start:
            continue

        segments.append(
            {
                "start": start,
                "end": end,
                "speakerId": speaker_id,
            }
        )

    return sorted(segments, key=lambda item: item["start"])


def build_transcript_output(asr_segments, speaker_segments, diarization_enabled):
    if not asr_segments:
        return "", []

    labeled_segments = []

    for segment in asr_segments:
        for item in split_segment_by_speaker(segment, speaker_segments, diarization_enabled):
            text = (item.get("text") or "").strip()
            if not text:
                continue

            labeled_segments.append(
                {
                    "speakerId": item.get("speakerId"),
                    "begin_time": item.get("begin_time"),
                    "end_time": item.get("end_time"),
                    "text": text,
                }
            )

    stable_segments = assign_stable_speakers(labeled_segments)
    merged_segments = merge_labeled_segments(stable_segments)
    merged_segments = absorb_orphan_segments(merged_segments)
    merged_segments = clean_filler_segments(merged_segments)
    merged_segments = absorb_tiny_labeled_segments(merged_segments)
    lines = [format_segment(item["speakerName"], item["begin_time"], item["text"]) for item in merged_segments]

    return "\n\n".join(lines), [serialize_segment(item) for item in merged_segments]


def assign_stable_speakers(segments):
    if not segments:
        return []

    speaker_aliases = build_speaker_aliases(segments)
    speaker_names = {}
    stable_segments = []

    for segment in segments:
        speaker_id = segment.get("speakerId")
        speaker_key = str(speaker_id) if speaker_id is not None else None
        stable_speaker_id = speaker_aliases.get(speaker_key, speaker_id)
        speaker_name = None

        if stable_speaker_id is not None:
            speaker_name = speaker_names.get(stable_speaker_id)
            if speaker_name is None:
                speaker_name = f"发言人{len(speaker_names) + 1}"
                speaker_names[stable_speaker_id] = speaker_name

        stable_segments.append(
            {
                **segment,
                "speakerId": stable_speaker_id,
                "speakerName": speaker_name,
            }
        )

    return stable_segments


def build_speaker_aliases(segments):
    metrics = collect_speaker_metrics(segments)
    max_end_time = max((to_number(segment.get("end_time")) or 0 for segment in segments), default=0)
    aliases = {}

    for index, segment in enumerate(segments):
        speaker_id = segment.get("speakerId")
        if speaker_id is None or speaker_id in aliases:
            continue

        metric = metrics.get(speaker_id, {})
        if not is_unstable_speaker(metric, max_end_time):
            continue

        neighbor_speaker = choose_neighbor_speaker_for_speaker(segments, speaker_id)
        if neighbor_speaker is not None:
            aliases[str(speaker_id)] = neighbor_speaker

    return aliases


def collect_speaker_metrics(segments):
    metrics = {}

    for segment in segments:
        speaker_id = segment.get("speakerId")
        if speaker_id is None:
            continue

        metric = metrics.setdefault(
            speaker_id,
            {
                "count": 0,
                "duration_ms": 0,
                "chars": 0,
                "first_start": None,
            },
        )
        metric["count"] += 1
        metric["duration_ms"] += get_segment_duration_ms(segment)
        metric["chars"] += len(str(segment.get("text") or "").strip())
        begin_time = to_number(segment.get("begin_time"))
        if begin_time is not None and (metric["first_start"] is None or begin_time < metric["first_start"]):
            metric["first_start"] = begin_time

    return metrics


def is_unstable_speaker(metric, max_end_time):
    count = int(metric.get("count") or 0)
    duration_ms = int(metric.get("duration_ms") or 0)
    chars = int(metric.get("chars") or 0)
    first_start = to_number(metric.get("first_start")) or 0

    if chars <= 2:
        return True
    if duration_ms <= get_int_env("LOCAL_SPEAKER_MIN_TOTAL_DURATION_MS", 700) and chars <= 6:
        return True
    if count == 1 and duration_ms <= get_int_env("LOCAL_SPEAKER_SINGLE_TURN_MAX_DURATION_MS", 900) and chars <= 6:
        return True
    if (
        max_end_time > 0
        and first_start >= max_end_time * 0.45
        and count <= 3
        and duration_ms <= get_int_env("LOCAL_SPEAKER_LATE_SHORT_MAX_DURATION_MS", 3600)
        and chars <= get_int_env("LOCAL_SPEAKER_LATE_SHORT_MAX_CHARS", 30)
    ):
        return True
    return False


def choose_neighbor_speaker_for_speaker(segments, speaker_id):
    votes = {}

    for index, segment in enumerate(segments):
        if segment.get("speakerId") != speaker_id:
            continue

        previous_speaker = find_previous_speaker(segments, index, speaker_id)
        next_speaker = find_next_speaker(segments, index, speaker_id)

        if previous_speaker is not None and previous_speaker == next_speaker:
            votes[previous_speaker] = votes.get(previous_speaker, 0) + 3
            continue

        if previous_speaker is not None:
            votes[previous_speaker] = votes.get(previous_speaker, 0) + 2
        if next_speaker is not None:
            votes[next_speaker] = votes.get(next_speaker, 0) + 1

    if not votes:
        return None

    return sorted(votes.items(), key=lambda item: item[1], reverse=True)[0][0]


def choose_neighbor_speaker(segments, index, speaker_id):
    previous_speaker = find_previous_speaker(segments, index, speaker_id)
    next_speaker = find_next_speaker(segments, index, speaker_id)

    if previous_speaker is not None and previous_speaker == next_speaker:
        return previous_speaker
    if previous_speaker is not None:
        return previous_speaker
    return next_speaker


def find_previous_speaker(segments, index, speaker_id):
    for previous_index in range(index - 1, -1, -1):
        candidate = segments[previous_index].get("speakerId")
        if candidate is not None and candidate != speaker_id:
            return candidate
    return None


def find_next_speaker(segments, index, speaker_id):
    for next_index in range(index + 1, len(segments)):
        candidate = segments[next_index].get("speakerId")
        if candidate is not None and candidate != speaker_id:
            return candidate
    return None


def serialize_segment(segment):
    return {
        "speakerId": segment.get("speakerId"),
        "speakerName": segment.get("speakerName"),
        "beginTime": to_int(segment.get("begin_time")),
        "endTime": to_int(segment.get("end_time")),
        "timestamp": format_timestamp(segment.get("begin_time")),
        "text": (segment.get("text") or "").strip(),
    }


def split_segment_by_speaker(segment, speaker_segments, diarization_enabled):
    text = (segment.get("text") or "").strip()
    if not text:
        return []

    start = to_number(segment.get("begin_time"))
    end = to_number(segment.get("end_time"))

    if not diarization_enabled:
        return [
            {
                "speakerId": None,
                "begin_time": start,
                "end_time": end,
                "text": text,
            }
        ]

    tokens = segment.get("tokens") or []
    if not tokens or not speaker_segments:
        return [
            {
                "speakerId": find_speaker(start, end, speaker_segments),
                "begin_time": start,
                "end_time": end,
                "text": text,
            }
        ]

    groups = []
    current_group = None

    for token in tokens:
        token_text = str(token.get("text") or "")
        if not token_text:
            continue

        token_start = to_number(token.get("begin_time"))
        token_end = to_number(token.get("end_time"))
        speaker_id = find_speaker(token_start, token_end, speaker_segments)
        if is_sentence_boundary(token_text) and current_group is not None:
            speaker_id = current_group["speakerId"]

        if current_group is None or current_group["speakerId"] != speaker_id:
            if current_group is not None:
                groups.append(current_group)
            current_group = {
                "speakerId": speaker_id,
                "begin_time": token_start,
                "end_time": token_end,
                "tokens": [token_text],
            }
            continue

        current_group["tokens"].append(token_text)
        current_group["end_time"] = token_end

    if current_group is not None:
        groups.append(current_group)

    groups = refine_speaker_groups(groups)
    if not groups:
        return [
            {
                "speakerId": find_speaker(start, end, speaker_segments),
                "begin_time": start,
                "end_time": end,
                "text": text,
            }
        ]

    return render_speaker_groups(groups)


def render_speaker_groups(groups):
    return [
        {
            "speakerId": group["speakerId"],
            "begin_time": group["begin_time"],
            "end_time": group["end_time"],
            "text": join_tokens(group["tokens"]),
        }
        for group in groups
    ]


def refine_speaker_groups(groups):
    refined_groups = merge_adjacent_same_speaker_groups(groups)
    refined_groups = smooth_speaker_groups(refined_groups)
    refined_groups = merge_adjacent_same_speaker_groups(refined_groups)
    refined_groups = absorb_tiny_turn_groups(refined_groups)
    refined_groups = merge_adjacent_same_speaker_groups(refined_groups)
    return refined_groups


def merge_adjacent_same_speaker_groups(groups):
    if not groups:
        return []

    merged = [dict(groups[0], tokens=list(groups[0]["tokens"]))]

    for group in groups[1:]:
        current_group = dict(group, tokens=list(group["tokens"]))
        previous_group = merged[-1]

        if previous_group.get("speakerId") == current_group.get("speakerId"):
            append_group(previous_group, current_group)
            continue

        merged.append(current_group)

    return merged


def absorb_tiny_turn_groups(groups):
    if len(groups) < 3:
        return groups

    min_chars = get_int_env("LOCAL_ASR_MIN_TURN_CHARS", 3)
    min_duration_ms = get_int_env("LOCAL_ASR_MIN_TURN_DURATION_MS", 320)
    refined_groups = [dict(group, tokens=list(group["tokens"])) for group in groups]
    index = 0

    while index < len(refined_groups):
        group = refined_groups[index]
        text = join_tokens(group["tokens"]).strip()

        if not text:
            refined_groups.pop(index)
            continue

        duration_ms = get_group_duration_ms(group)
        previous_group = refined_groups[index - 1] if index > 0 else None
        next_group = refined_groups[index + 1] if index + 1 < len(refined_groups) else None
        is_tiny_group = len(text) <= min_chars or (duration_ms is not None and duration_ms <= min_duration_ms)

        if (
            is_tiny_group
            and not ends_with_strong_sentence(text)
            and previous_group is not None
            and next_group is not None
            and previous_group.get("speakerId") == next_group.get("speakerId")
            and previous_group.get("speakerId") != group.get("speakerId")
        ):
            append_group(previous_group, group)
            refined_groups.pop(index)
            continue

        index += 1

    return refined_groups


def smooth_speaker_groups(groups):
    smoothed = [dict(group, tokens=list(group["tokens"])) for group in groups]
    index = 0

    while index < len(smoothed):
        group = smoothed[index]
        text = join_tokens(group["tokens"]).strip()

        if not text:
            smoothed.pop(index)
            continue

        if is_punctuation_only(text):
            if index > 0:
                append_group(smoothed[index - 1], group)
                smoothed.pop(index)
                continue
            if index + 1 < len(smoothed):
                prepend_group(smoothed[index + 1], group)
                smoothed.pop(index)
                continue

        if len(text) <= 2 and len(smoothed) > 1 and not ends_with_strong_sentence(text):
            previous_group = smoothed[index - 1] if index > 0 else None
            next_group = smoothed[index + 1] if index + 1 < len(smoothed) else None

            if previous_group is not None and next_group is not None and previous_group.get("speakerId") == next_group.get("speakerId"):
                append_group(previous_group, group)
                smoothed.pop(index)
                continue

            if index + 1 < len(smoothed):
                prepend_group(smoothed[index + 1], group)
                smoothed.pop(index)
                continue
            if index > 0:
                append_group(smoothed[index - 1], group)
                smoothed.pop(index)
                continue

        index += 1

    return smoothed


def append_group(target, source):
    target["tokens"].extend(source["tokens"])
    target["end_time"] = source.get("end_time")


def prepend_group(target, source):
    target["tokens"] = list(source["tokens"]) + list(target["tokens"])
    target["begin_time"] = source.get("begin_time")


def get_group_duration_ms(group):
    begin_time = to_number(group.get("begin_time"))
    end_time = to_number(group.get("end_time"))
    if begin_time is None or end_time is None:
        return None
    return max(0, int(end_time - begin_time))


def get_segment_duration_ms(segment):
    begin_time = to_number(segment.get("begin_time"))
    end_time = to_number(segment.get("end_time"))
    if begin_time is None or end_time is None:
        return 0
    return max(0, int(end_time - begin_time))


def is_punctuation_only(text):
    return bool(text) and all(char in PUNCTUATION for char in text)


def merge_labeled_segments(segments):
    if not segments:
        return []

    max_gap_ms = get_int_env("LOCAL_ASR_MERGE_GAP_MS", 1200)
    max_chars = get_int_env("LOCAL_ASR_MERGE_MAX_CHARS", 100)
    merged = []

    for segment in segments:
        if not merged:
            merged.append(dict(segment))
            continue

        previous = merged[-1]

        if should_merge_segments(previous, segment, max_gap_ms, max_chars):
            previous["text"] = merge_text(previous["text"], segment["text"])
            previous["end_time"] = segment.get("end_time")
            continue

        merged.append(dict(segment))

    return merged


def should_merge_segments(previous, current, max_gap_ms, max_chars):
    previous_text = str(previous.get("text") or "").strip()
    current_text = str(current.get("text") or "").strip()
    if not previous_text or not current_text:
        return False

    if ends_with_strong_sentence(previous_text):
        return False

    previous_end = to_number(previous.get("end_time"))
    current_start = to_number(current.get("begin_time"))
    if previous_end is not None and current_start is not None:
        gap_ms = current_start - previous_end
        if gap_ms < -300 or gap_ms > max_gap_ms:
            return False

    if previous.get("speakerName") != current.get("speakerName"):
        return False

    return len(previous_text) + len(current_text) <= max_chars


def ends_with_strong_sentence(text):
    stripped = text.rstrip()
    return bool(stripped) and stripped[-1] in STRONG_SENTENCE_ENDINGS


def merge_text(previous_text, current_text):
    previous_text = str(previous_text or "").rstrip()
    current_text = str(current_text or "").lstrip()

    if not previous_text:
        return current_text
    if not current_text:
        return previous_text
    if previous_text[-1].isascii() and current_text[0].isascii() and previous_text[-1].isalnum() and current_text[0].isalnum():
        return f"{previous_text} {current_text}"
    return f"{previous_text}{current_text}"


def absorb_tiny_labeled_segments(segments):
    """处理有说话人但内容极短（核心文字≤3字）的段：
    - 与前一段同一说话人 → 合并到前一段尾部
    - 不同说话人 → 直接丢弃（≤3字的插话几乎都是语气噪声）
    """
    import re
    if not segments:
        return segments
    result = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        core = re.sub(r'[。！？!?，,、\s]', '', text)
        if len(core) <= 3 and result:
            prev = result[-1]
            if prev.get("speakerName") == seg.get("speakerName"):
                # 同一说话人：追加到上一段
                prev["text"] = merge_text(prev["text"], text)
                prev["end_time"] = seg.get("end_time") or prev.get("end_time")
            # 不同说话人：丢弃，不合并到别人的发言里
        else:
            result.append(dict(seg))
    return result


def absorb_orphan_segments(segments):
    """把无说话人的极短片段（≤8字）合并到相邻有说话人的片段，减少断行。"""
    if not segments:
        return segments

    result = list(segments)
    changed = True
    while changed:
        changed = False
        new = []
        i = 0
        while i < len(result):
            seg = result[i]
            text = (seg.get("text") or "").strip()
            if seg.get("speakerName") is None and len(text) <= 8:
                # 优先合并到前一个有说话人的段
                if new and new[-1].get("speakerName") is not None:
                    prev = new[-1]
                    prev["text"] = merge_text(prev["text"], text)
                    prev["end_time"] = seg.get("end_time") or prev.get("end_time")
                    changed = True
                    i += 1
                    continue
                # 否则合并到后一个
                if i + 1 < len(result) and result[i + 1].get("speakerName") is not None:
                    nxt = result[i + 1]
                    nxt["text"] = merge_text(text, nxt["text"])
                    nxt["begin_time"] = seg.get("begin_time") or nxt.get("begin_time")
                    changed = True
                    i += 1
                    continue
            new.append(seg)
            i += 1
        result = new

    return result


def clean_filler_segments(segments):
    """移除纯语气词片段，并清理段内首尾语气词。"""
    cleaned = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        # 去除首尾标点后判断是否纯语气词
        core = text.rstrip("。！？!?，,、").strip()
        if core in FILLER_WORDS:
            continue
        # 清理段首语气词（单字+标点 或 单字）
        import re
        text = re.sub(r'^([呃嗯啊哦哈噢嘿唉哎欸哟喂嗐哼咦哇呀嘛呗])[，,、\s]*', '', text)
        if text.strip():
            seg = dict(seg)
            seg["text"] = text.strip()
            cleaned.append(seg)
    return cleaned


def format_segment(speaker_name, start_ms, text):
    prefix = f"[{format_timestamp(start_ms)}] " if start_ms is not None else ""
    if speaker_name:
        return f"{prefix}{speaker_name}：{text}"
    return f"{prefix}{text}"


def find_speaker(start_ms, end_ms, speaker_segments):
    if start_ms is None or end_ms is None or not speaker_segments:
        return None

    start = start_ms / 1000.0
    end = end_ms / 1000.0
    boundary_lead = get_int_env("LOCAL_DIARIZATION_BOUNDARY_LEAD_MS", 180) / 1000.0
    best_speaker = None
    best_overlap = 0.0

    for index, segment in enumerate(speaker_segments):
        segment_start = segment["start"] if index == 0 else max(0.0, segment["start"] - boundary_lead)
        segment_end = segment["end"]
        overlap = max(0.0, min(end, segment_end) - max(start, segment_start))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = segment["speakerId"]

    return best_speaker


def format_timestamp(milliseconds):
    if milliseconds is None:
        return "00:00:00"

    total_seconds = max(0, int(milliseconds / 1000))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def to_int(value):
    try:
        return int(float(value))
    except Exception:  # noqa: BLE001
        return None


def to_number(value):
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return None


def get_int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except Exception:  # noqa: BLE001
        return default


if __name__ == "__main__":
    main()
