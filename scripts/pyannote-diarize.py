#!/usr/bin/env python3
"""
说话人分离脚本 — Pyannote 3.1
用法: pyannote-diarize.py <audio-wav-path> <output-json-path>

环境变量:
  HF_TOKEN                  HuggingFace token（必须）
  MODELSCOPE_SPEAKER_COUNT  已知说话人数量，传入可提升准确度（可选）
"""

import json
import os
import sys
from pathlib import Path


def apply_compat_patches():
    """修复 PyTorch 2.6 + speechbrain 在 Mac 上的兼容性问题。"""
    import torch
    import torch.serialization

    # PyTorch 2.6 把 weights_only 默认改为 True，导致旧格式 checkpoint 加载失败
    torch.serialization.add_safe_globals([torch.torch_version.TorchVersion])

    import lightning_fabric.utilities.cloud_io as lf_io
    def _patched_load(path, map_location=None, **kwargs):
        return torch.load(path, map_location=map_location, weights_only=False)
    lf_io._load = _patched_load

    # speechbrain 懒加载模块在 inspect.stack() 中触发 k2 导入，拦截掉
    import speechbrain.utils.importutils as iu
    _orig = iu.LazyModule.__getattr__
    def _safe_getattr(self, attr):
        if attr in ("__file__", "__spec__", "__loader__", "__path__", "__package__"):
            return None
        return _orig(self, attr)
    iu.LazyModule.__getattr__ = _safe_getattr


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: pyannote-diarize.py <audio-wav-path> <output-json-path>")

    audio_path = sys.argv[1]
    output_path = Path(sys.argv[2])

    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        raise SystemExit("错误：未设置 HF_TOKEN 环境变量")

    num_speakers_raw = os.environ.get("MODELSCOPE_SPEAKER_COUNT", "").strip()
    num_speakers = int(num_speakers_raw) if num_speakers_raw.isdigit() and int(num_speakers_raw) > 0 else None

    apply_compat_patches()

    from pyannote.audio import Pipeline
    import torch

    # use_auth_token 在新版 huggingface_hub 中已废弃，用环境变量传递
    import os as _os
    _os.environ.setdefault("HF_TOKEN", hf_token)
    _os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", hf_token)
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token,
    )

    if torch.backends.mps.is_available():
        pipeline.to(torch.device("mps"))
    elif torch.cuda.is_available():
        pipeline.to(torch.device("cuda"))

    kwargs = {}
    if num_speakers is not None:
        kwargs["num_speakers"] = num_speakers

    diarization = pipeline(audio_path, **kwargs)

    # 输出格式与 modelscope-diarize.py 完全兼容：{"text": [[start, end, speaker_id], ...]}
    segments = [
        [round(turn.start, 3), round(turn.end, 3), speaker]
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]

    output_path.write_text(
        json.dumps({"text": segments}, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
