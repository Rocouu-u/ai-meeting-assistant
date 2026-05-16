#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("Usage: local-summary.py <prompt-path> <output-path>")

    prompt_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    prompt_text = prompt_path.read_text(encoding="utf-8")

    from transformers import AutoModelForCausalLM, AutoTokenizer

    model_name = os.environ.get("LOCAL_LLM_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
    device_map = os.environ.get("LOCAL_LLM_DEVICE_MAP", "auto")

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        device_map=device_map,
        trust_remote_code=True,
    ).eval()

    response = generate_response(model, tokenizer, prompt_text)
    output_path.write_text(json.dumps({"text": response}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def generate_response(model, tokenizer, prompt_text: str) -> str:
    if hasattr(model, "chat"):
        response, _ = model.chat(tokenizer, prompt_text, history=None)
        return str(response).strip()

    inputs = tokenizer(prompt_text, return_tensors="pt")
    output_ids = model.generate(**inputs, max_new_tokens=2000, temperature=0.2)
    text = tokenizer.decode(output_ids[0], skip_special_tokens=True)
    return text.strip()


if __name__ == "__main__":
    main()
