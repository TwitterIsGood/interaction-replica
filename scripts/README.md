# scripts

`record-demo.mjs` 用 Chrome DevTools Protocol 录一段手机尺寸的演示，再输出编码命令。

```bash
# 1. 起一个带调试端口的 Chrome，开一个空白标签页
chrome --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-rec --no-first-run

# 2. 起静态服务指向 demo 目录
cd 001-cinema-seats/demo && python -m http.server 8123

# 3. 按步骤脚本录制（每步见脚本顶部注释）
node scripts/record-demo.mjs http://127.0.0.1:8123/index.html out 001-cinema-seats/docs/steps.json

# 4. 编码成 mp4
ffmpeg -f concat -safe 0 -i out/list.txt -vf "scale=540:-2,fps=30" \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart out/demo.mp4
```

环境变量：`CDP_PORT`（默认 9333）、`VIEWPORT_W` / `VIEWPORT_H`（默认 390×844）、`SETTLE_MS`（导航后等待首帧的时间）。
