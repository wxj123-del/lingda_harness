#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${DECISION_MODEL_PYTHON:-/tmp/dsh-decider-venv-20260929/bin/python}
MODEL_ROOT=${DECISION_MODEL_ROOT:-"$HOME/.cache/huggingface/hub/models--Mapika--decider-2b/snapshots/b37f7e1ba3fbc9238004cf531fabbee2619973fd"}

if [ ! -x "$PYTHON" ]; then
  printf '%s\n' "Missing $PYTHON. Create the environment with:" >&2
  printf '%s\n' "uv venv /tmp/dsh-decider-venv-20260929 --python 3.11" >&2
  printf '%s\n' "uv pip install --python /tmp/dsh-decider-venv-20260929/bin/python -r $ROOT/scripts/decision-model-requirements.txt" >&2
  exit 1
fi

export PYTHONPATH="$MODEL_ROOT:$ROOT${PYTHONPATH:+:$PYTHONPATH}"
export DECISION_MODEL_PATH="$MODEL_ROOT"
exec "$PYTHON" "$ROOT/scripts/serve-decision-model.py"
