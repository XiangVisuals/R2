# XIANG VAULT — Cloudflare R2 光学影像图床与数字档案库

专为 [XIANGVISUALS.COM](https://xiangvisuals.com/) 打造的高速、零出口流量费（Zero Egress Fee）个人图床与摄影视觉档案系统。基于 **GitHub + Cloudflare Pages + Cloudflare Pages Functions + Cloudflare R2** 构建。

---

## 一、核心特性与设计语言

1. **100% 家族式瑞士建筑画廊美学 (`xiangvisuals.com` 统一设计语言)**
   - **极简建筑画框与切片流光开场动画 (Kinetic Frame & Slice Loader)**：与主站一脉相承的余弦插值几何开场。
   - **黄金比例动态建筑画框 Logo**：顶栏 SVG 动态视锥线画框与 `Works / Frame / Beads / File / Vault` 错峰帘幕导航。
   - **双视图引擎无缝切换**：
     - **INDEX GRID (真实宽高比瀑布流 + 悬浮快捷外链舱)**：鼠标悬停卡片即可一键复制 `URL` / `MD` / `HTML`，支持多选批量复制与批量删除。
     - **KINETIC STRIP (二阶临界阻尼流光切片带)**：完整移植主站标志性的流光手风琴物理引擎。
   - **白昼画廊 / 暗房双主题**：支持一键切换瑞士白 (`#FFFFFF`) 与暗房曜石黑 (`#08080A`)。

2. **光学取景上传工作台 (Optical Ingestion Studio)**
   - **全屏拖拽 / 剪贴板粘贴 (`⌘V` / `Ctrl+V`) / 批量并发上传**。
   - **客户端零延迟 EXIF 解析**：自动提取相机型号、镜头、焦距、光圈、快门速度、ISO 与原始像素尺寸，并写入 R2 `customMetadata` 永久保存。
   - **前端可选编码与压缩**：支持保留无损原图，或在浏览器端利用 Canvas 自动转换为高压缩比 **WebP / JPEG** 并限制最大长边（如 4K `3840px` / 2.5K `2560px`）。
   - **4 种外链格式矩阵**：支持一键复制 `Direct URL`、`Markdown`、`HTML <img>`、`BBCode`。

3. **半公开画廊安全架构 + 全球边缘永久缓存**
   - **访客只读 / 管理员鉴权**：任何人可高速浏览公开图库与复制链接；上传、修改分类、删除图片受 `ADMIN_PASSWORD` 环境变量保护。
   - **同源高速 CDN 边缘路由 (`/raw/*`)**：即使尚未为 R2 单独配置公开域名，自带的 `functions/raw/[[path]].js` 也会通过 Cloudflare Cache API 将图片缓存在全球边缘节点（`Cache-Control: public, max-age=31536000, immutable`）。

---

## 二、5 分钟免费部署指南 (GitHub + Cloudflare R2)

### 第一步：将本项目推送到您的 GitHub 仓库

在当前目录（`/Users/xiang/Desktop/R2`）执行：

```bash
git init
git add .
git commit -m "feat: initial commit of XIANG R2 Vault"
git branch -M main
git remote add origin https://github.com/<您的GitHub用户名>/<仓库名>.git
git push -u origin main
```

### 第二步：在 Cloudflare 创建 R2 存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，点击左侧菜单 **R2 Object Storage** -> **Create bucket**。
2. 输入存储桶名称，例如：`xiang-visuals-r2`，点击创建。
3. *(可选)* 如果您希望使用独立子域名作为外链前缀（例如 `https://img.xiangvisuals.com`）：
   - 进入该 R2 存储桶的 **Settings** -> **Public Access** -> **Custom Domains** -> **Connect Domain**，输入 `img.xiangvisuals.com` 即可自动添加 DNS 解析。

### 第三步：在 Cloudflare Pages 关联 GitHub 自动部署

1. 在 Cloudflare Dashboard 左侧点击 **Workers & Pages** -> **Create** -> 切换到 **Pages** 标签页 -> **Connect to Git**。
2. 选择您刚才推送的 GitHub 仓库。
3. **Build settings (构建配置)**：
   - **Framework preset**: `None`
   - **Build command**: 留空（无需构建步骤）
   - **Build output directory**: 填写 `public`
4. 点击 **Save and Deploy** 完成首次部署。

### 第四步：绑定 R2 存储桶与管理员密码

部署完成后，进入该 Cloudflare Pages 项目的 **Settings (设置)**：

1. **绑定 R2 存储桶**：
   - 进入 **Functions** -> 找到 **R2 bucket bindings** -> 点击 **Add binding**。
   - **Variable name (变量名)**：必须填写 `BUCKET`
   - **R2 bucket**：选择您创建的 `xiang-visuals-r2` 存储桶，点击保存。
2. **设置管理员上传密码**：
   - 进入 **Environment variables (环境变量)** -> 点击 **Add variable**。
   - 添加变量名：`ADMIN_PASSWORD`，值填写您的专属管理密码（用于网页端解锁上传与删除权限）。
   - *(可选)* 添加变量名：`PUBLIC_R2_DOMAIN`，值填写您的 R2 自定义加速域名（如 `https://img.xiangvisuals.com`；如果不填，系统将自动使用 `https://您的Pages域名/raw/...` 提供同等高速的 Cloudflare 边缘缓存直链）。
3. 进入 **Deployments** 页面，点击最新一次部署右侧的 **Retry deployment (重新部署)** 让绑定生效。
4. *(可选)* 在 Pages 项目的 **Custom domains** 中绑定 `vault.xiangvisuals.com` 或 `r2.xiangvisuals.com`！

---

## 三、本地开发与预览

- **快速静态预览**（自动加载内置演示摄影作品，体验完整 UI、EXIF 解析、WebP 转换与流光切片物理引擎）：
  ```bash
  python3 -m http.server 8788 --directory public
  ```
  浏览器访问 `http://localhost:8788` 即可。

- **使用 Wrangler 完整模拟本地 R2 存储桶与 Pages Functions**：
  ```bash
  npm run dev
  ```
  默认本地测试管理员密码为 `admin`。
