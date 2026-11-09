# interaction-replica

把网上看到的有意思的交互，用纯前端复刻一遍。

每个效果都有原始出处、原视频截帧、复刻后的录屏和三方对比，方便直接对照看差别。
没有构建步骤，每个目录都是可以直接跑起来的静态页面。

## 效果列表

| # | 效果 | 原始出处 | 技术栈 | 复刻 |
|---|------|----------|--------|------|
| 001 | [影厅选座 · 飞入座位视角](001-cinema-seats/) | [@yyyole](https://x.com/yyyole/status/2119438365435253159) | Three.js | [demo](001-cinema-seats/demo/) |

## 目录约定

```
NNN-<slug>/
├─ demo/                可直接打开的完整实现
│   ├─ index.html
│   ├─ app.js
│   ├─ styles.css
│   ├─ assets/
│   └─ vendor/
└─ docs/
    ├─ demo.mp4         复刻效果录屏
    ├─ cover.jpg        列表封面
    ├─ original-*.jpg   原视频截帧（按交互步骤编号）
    └─ compare-*.jpg    原视频 / 复刻 左右对照
```

## 本地运行

所有效果都用了 ES module + importmap，需要 http 协议，直接双击 `index.html` 会失败。

```bash
cd 001-cinema-seats/demo
python -m http.server 8123
# 打开 http://127.0.0.1:8123
```

## 关于

复刻只借鉴交互思路和视觉结构，代码是从零写的；影视素材、海报版权归原片方，仅作个人学习记录用。
原始出处的链接与版权归原作者所有。
