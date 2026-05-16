import json
import sys
from pathlib import Path

from modelscope.pipelines import pipeline as modelscope_pipeline
from modelscope.utils.constant import Tasks


def to_plain_json(value):
    if isinstance(value, dict):
        return {str(key): to_plain_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_plain_json(item) for item in value]
    if hasattr(value, "item"):
        return value.item()
    return value


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: modelscope-diarize.py <audio-wav-path> <output-json-path>")

    audio_path = sys.argv[1]
    output_path = Path(sys.argv[2])
    model_id = resolve_model_path("iic/speech_campplus_speaker-diarization_common")

    patch_nested_pipeline_local_cache()
    diarization_pipeline = modelscope_pipeline(task=Tasks.speaker_diarization, model=model_id)
    result = diarization_pipeline(audio_path)

    output_path.write_text(json.dumps(to_plain_json(result), ensure_ascii=False), encoding="utf-8")


def resolve_model_path(model_id: str) -> str:
    explicit_path = Path(model_id).expanduser()
    if explicit_path.exists():
        return str(explicit_path)

    cache_root = Path.home() / ".cache" / "modelscope" / "hub" / "models"
    parts = [part for part in model_id.split("/") if part]

    if len(parts) >= 2:
        candidate_path = cache_root.joinpath(*parts)
        if candidate_path.exists():
            return str(candidate_path)

    return model_id


def patch_nested_pipeline_local_cache() -> None:
    from modelscope.pipelines.audio import segmentation_clustering_pipeline

    if getattr(segmentation_clustering_pipeline, "_meeting_ai_local_cache_patched", False):
        return

    def pipeline_with_local_cache(*args, **kwargs):
        model = kwargs.get("model")
        if isinstance(model, str):
            kwargs["model"] = resolve_model_path(model)
        return modelscope_pipeline(*args, **kwargs)

    segmentation_clustering_pipeline.pipeline = pipeline_with_local_cache
    segmentation_clustering_pipeline._meeting_ai_local_cache_patched = True


if __name__ == "__main__":
    main()
