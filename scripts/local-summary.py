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

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model_name = os.environ.get("LOCAL_LLM_MODEL", "qwen/Qwen2.5-3B-Instruct")
    model_path = resolve_model_path(model_name)

    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        device_map=device,
        trust_remote_code=True,
    ).eval()

    response = generate_response(model, tokenizer, prompt_text)
    output_path.write_text(json.dumps({"text": response}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve_model_path(model_name: str) -> str:
    """支持 ModelScope ID、HuggingFace ID 和本地路径。"""
    if os.path.isabs(model_name) or os.path.exists(model_name):
        return model_name

    try:
        from modelscope import snapshot_download
        return snapshot_download(model_name)
    except Exception:
        pass

    return model_name


def generate_response(model, tokenizer, prompt_text: str) -> str:
    import torch

    messages = [{"role": "user", "content": prompt_text}]

    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = tokenizer([text], return_tensors="pt").to(model.device)
        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=3000,
                temperature=0.2,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id,
            )
        new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
        return tokenizer.decode(new_ids, skip_special_tokens=True).strip()

    # 兼容旧模型
    if hasattr(model, "chat"):
        response, _ = model.chat(tokenizer, prompt_text, history=None)
        return str(response).strip()

    inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output_ids = model.generate(**inputs, max_new_tokens=3000, temperature=0.2, do_sample=True)
    return tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()


if __name__ == "__main__":
    main()
