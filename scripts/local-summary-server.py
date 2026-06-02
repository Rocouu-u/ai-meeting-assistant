#!/usr/bin/env python3
"""
本地 LLM 持久化服务 — 模型只加载一次，复用于所有请求
端口: LOCAL_LLM_SERVER_PORT（默认 18321）
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def apply_compat_patches():
    import torch, torch.serialization
    torch.serialization.add_safe_globals([torch.torch_version.TorchVersion])

    try:
        import lightning_fabric.utilities.cloud_io as lf_io
        def _patched_load(path, map_location=None, **kwargs):
            return torch.load(path, map_location=map_location, weights_only=False)
        lf_io._load = _patched_load
    except ImportError:
        pass

    try:
        import speechbrain.utils.importutils as iu
        _orig = iu.LazyModule.__getattr__
        def _safe_getattr(self, attr):
            if attr in ("__file__", "__spec__", "__loader__", "__path__", "__package__"):
                return None
            return _orig(self, attr)
        iu.LazyModule.__getattr__ = _safe_getattr
    except ImportError:
        pass


def load_model():
    apply_compat_patches()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from modelscope import snapshot_download

    model_name = os.environ.get("LOCAL_LLM_MODEL", "qwen/Qwen2.5-3B-Instruct")

    if os.path.isabs(model_name) or os.path.exists(model_name):
        model_path = model_name
    else:
        try:
            model_path = snapshot_download(model_name)
        except Exception:
            model_path = model_name

    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    print(f"[LLM server] 加载模型 {model_name}，设备: {device}", flush=True)

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        device_map=device,
        trust_remote_code=True,
    ).eval()

    print("[LLM server] 模型加载完成", flush=True)
    return model, tokenizer


def generate(model, tokenizer, prompt_text: str) -> str:
    import torch

    messages = [{"role": "user", "content": prompt_text}]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer([text], return_tensors="pt").to(model.device)

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=1500,
            temperature=0.2,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_ids, skip_special_tokens=True).strip()


def make_handler(model, tokenizer):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # 静默日志

        def do_GET(self):
            if self.path == "/health":
                self._respond(200, {"status": "ok"})
            else:
                self._respond(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/generate":
                self._respond(404, {"error": "not found"})
                return

            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                prompt = data.get("prompt", "")
                if not prompt:
                    self._respond(400, {"error": "prompt required"})
                    return
                result = generate(model, tokenizer, prompt)
                self._respond(200, {"text": result})
            except Exception as e:
                self._respond(500, {"error": str(e)})

        def _respond(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main():
    port = int(os.environ.get("LOCAL_LLM_SERVER_PORT", "18321"))
    model, tokenizer = load_model()

    server = HTTPServer(("127.0.0.1", port), make_handler(model, tokenizer))
    print(f"[LLM server] 监听 127.0.0.1:{port}", flush=True)
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
