# WASM CAD Viewer

一个偏务实的在线 CAD 转 PDF MVP。

当前版本先把 `DXF -> 浏览器内预览 -> 单页 PDF 导出` 跑通，保持纯前端处理，适合直接部署到 Cloudflare Pages。文件不会上传到服务端，解析和渲染都发生在用户浏览器里。

## 当前范围

- 支持本地导入 `DXF`
- 支持拖拽上传和按钮选择文件
- 支持浏览器内预览图纸
- 支持一键适配视图
- 支持把当前渲染画面导出为单页 PDF
- `DWG` 目前只保留接入位，暂未启用

## 为什么先这样做

这个项目的核心目标不是“后端批量转换”，而是做一个基于 Cloudflare 的纯前端/边缘方案：

- 文件尽量不离开用户设备
- 前端直接完成 CAD 解析和渲染
- 最终在浏览器内导出 PDF
- 部署保持简单，优先静态站点

因此第一阶段优先做 DXF。它的浏览器生态和可维护性比 DWG 友好很多，能更快验证产品方向。

## 技术选择

- 前端框架：`Vite + TypeScript`
- DXF 预览：`dxf-viewer`
- PDF 导出：`jsPDF`
- 部署目标：`Cloudflare Pages`

当前导出方式是把预览 canvas 光栅化后放进 PDF，所以它是“基于当前视图的 PDF 导出”，不是严格意义上的矢量 CAD PDF。

## 本地开发

```bash
npm install
npm run dev
```

构建生产包：

```bash
npm run build
```

本地预览构建结果：

```bash
npm run preview
```

## 部署到 Cloudflare Pages

最简单的方式是把仓库连接到 Cloudflare Pages：

- Build command: `npm run build`
- Build output directory: `dist`

也可以直接上传构建产物：

```bash
npx wrangler pages deploy dist
```

## 已知限制

- 目前只启用 `DXF`
- `DWG` 没有接入运行链路
- PDF 导出为单页截图式输出，不是矢量还原
- 大图纸仍然受浏览器内存和 WebGL 能力约束
- 不同 CAD 方言、字体、标注、填充和特殊实体可能存在兼容差异

## DWG 方向说明

后续如果要做 DWG，有两个方向值得继续评估：

- `@mlightcad/libdxfrw-web`
- `@mlightcad/libredwg-web`

这类方案的优点是可以把 DWG 解析放进 WebAssembly，继续保持浏览器侧处理。

但它们会同时带来几类现实问题：

- 体积更大，首屏和运行时成本更高
- wasm 资源加载、错误处理和兼容性更复杂
- 许可证需要单独确认，不能直接默认商用安全
- DWG 转 DXF 再渲染的链路需要额外测试样本支撑

所以当前仓库先把 DXF 的体验闭环做好，再决定是否进入 DWG 阶段。

## 下一步

- 接入真实 DXF 样本，补一批回归用例
- 优化大文件加载反馈
- 评估多页 PDF 和打印布局
- 研究 DXF 转 SVG 的可行性，争取更接近矢量导出
- 在许可证可接受的前提下验证 DWG WebAssembly 方案
