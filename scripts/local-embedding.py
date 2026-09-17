"""Pinned offline ONNX inference for the bounded enrichment worker."""
import hashlib
import json
import pathlib
import socket
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
import tokenizers

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
FILES = {
    "onnx/model.onnx": "6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452",
    "tokenizer.json": "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
}

def deny_network(*args, **kwargs):
    raise RuntimeError("network_forbidden_in_local_embedding")

socket.socket = deny_network
socket.create_connection = deny_network
socket.getaddrinfo = deny_network
root = pathlib.Path(sys.argv[1])
for name, expected in FILES.items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
        raise RuntimeError("local_model_integrity_mismatch")
if (ort.__version__, np.__version__, tokenizers.__version__) != ("1.27.0", "2.5.1", "0.22.2"):
    raise RuntimeError("local_runtime_version_mismatch")
request = json.load(sys.stdin)
text = request["text"]
if not isinstance(text, str) or not text.strip():
    raise ValueError("missing_embedding_text")
vocabulary = Tokenizer.from_file(str(root / "tokenizer.json"))
vocabulary.no_truncation()
original_count = len(vocabulary.encode(text).ids)
vocabulary.enable_truncation(max_length=256)
encoded = vocabulary.encode(text)
inputs = {
    "input_ids": np.asarray([encoded.ids], dtype=np.int64),
    "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
    "token_type_ids": np.asarray([encoded.type_ids], dtype=np.int64),
}
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(root / "onnx/model.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
hidden = session.run(["last_hidden_state"], inputs)[0]
mask = inputs["attention_mask"][..., None].astype(np.float32)
pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
vector = pooled[0] / max(float(np.linalg.norm(pooled[0])), 1e-12)
sys.stdout.write(json.dumps({
    "execution": "local", "model": MODEL, "revision": REVISION,
    "modelDigest": FILES["onnx/model.onnx"], "vocabularyDigest": FILES["tokenizer.json"],
    "runtime": {"onnxruntime": ort.__version__, "numpy": np.__version__, "tokenizers": tokenizers.__version__},
    "pooling": "attention-mask-mean-l2", "maxWordPieces": 256,
    "inputWordPieces": original_count, "usedWordPieces": len(encoded.ids),
    "truncated": original_count > 256, "dimensions": 384,
    "vector": vector.tolist(),
}, allow_nan=False))
