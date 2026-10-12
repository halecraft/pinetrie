# bash keep.sh: start the drawing in the background unless it runs already.
cd "$(dirname "$0")"
if ! pgrep -f "^python3 draw.py" >/dev/null; then
  PIXELLAB_KEY=$(cat /workspace/.plans/noun-icons/key) nohup python3 draw.py prompts.json /workspace/.plans/noun-icons/candidates >> /workspace/.plans/noun-icons/run.out 2>&1 &
  echo started
fi
