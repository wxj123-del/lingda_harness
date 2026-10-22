"""Serve the locally cached Mapika decider model for DSH tool discovery.

Run this file with the dedicated Python environment created by
``scripts/start-decision-model.sh``. The service is advisory: it only ranks
the already permission-filtered candidate names sent by tool discovery.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

import torch
from decider.infer import Decider
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


MODEL_PATH = Path(os.environ.get(
    "DECISION_MODEL_PATH",
    Path.home() / ".cache/huggingface/hub/models--Mapika--decider-2b/snapshots/b37f7e1ba3fbc9238004cf531fabbee2619973fd",
))
DEVICE = os.environ.get("DECISION_MODEL_DEVICE", "mps" if torch.backends.mps.is_available() else "cpu")
PORT = int(os.environ.get("DECISION_MODEL_PORT", "8000"))


class DecideRequest(BaseModel):
    context: str = Field(min_length=1)
    schema_: dict[str, Any] = Field(alias="schema")

    model_config = {"populate_by_name": True}


app = FastAPI(title="DSH local decision model")
model: Decider | None = None
model_lock = threading.Lock()


@app.on_event("startup")
def load_model() -> None:
    global model
    if not MODEL_PATH.exists():
        raise RuntimeError(f"decision model does not exist: {MODEL_PATH}")
    dtype = torch.bfloat16 if DEVICE != "cpu" else torch.float32
    model = Decider(str(MODEL_PATH), device=DEVICE, dtype=dtype, use_graphs=False)
    print(f"[decision-model] loaded {MODEL_PATH} on {DEVICE}", flush=True)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "device": DEVICE}


@app.post("/decide")
def decide(request: DecideRequest) -> dict[str, Any]:
    if model is None:
        raise HTTPException(status_code=503, detail="decision model is still loading")
    capability = request.schema_.get("capability")
    if not isinstance(capability, dict):
        raise HTTPException(status_code=422, detail="schema.capability is required")
    options = capability.get("options")
    if not isinstance(options, list) or not 2 <= len(options) <= 255 or not all(isinstance(item, str) for item in options):
        raise HTTPException(status_code=422, detail="schema.capability.options must contain 2..255 strings")
    instructions = capability.get("instructions", "Which available tool best matches the requested capability?")
    if not isinstance(instructions, str):
        instructions = str(instructions)
    try:
        with model_lock:
            answer = model.decide(request.context, [{"question": instructions, "options": options}])[0]
    except Exception as error:  # pragma: no cover - provider errors are surfaced as HTTP failures
        raise HTTPException(status_code=503, detail=f"decision model failed: {error}") from error
    return {"capability": {
        "choice": answer["choice"],
        "confidence": answer["confidence"],
        "probabilities": answer["probs"],
    }}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("DECISION_MODEL_HOST", "127.0.0.1"), port=PORT)
