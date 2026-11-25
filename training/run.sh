#!/usr/bin/env bash
set -eu
gpu_python="$1"
export_python="$2"
export OMP_NUM_THREADS=2 PYTHONDONTWRITEBYTECODE=1
if [ -z "${CUDA_VISIBLE_DEVICES:-}" ]; then
  CUDA_VISIBLE_DEVICES="$(nvidia-smi --query-gpu=uuid,memory.free,utilization.gpu --format=csv,noheader,nounits | awk -F', ' '$2>4096 {print $3+0, $1}' | sort -n | head -1 | cut -d' ' -f2)"
  export CUDA_VISIBLE_DEVICES
fi
test -n "$CUDA_VISIBLE_DEVICES"
printf '%s\n' "$CUDA_VISIBLE_DEVICES" > out/device.txt
"$gpu_python" -u src/train.py --data data --out out
"$export_python" -u src/export.py --data data --out out
touch out/complete
