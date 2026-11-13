# 恬静小窝

AI 驱动的生活模拟游戏（安卓）。把喜欢的角色接进一间小公寓：他们由 AI 决定去哪里、做什么、说什么，会用家具、彼此相处、闹矛盾又和好，也会想起你、给你发手机通知。

功能的完整说明见 [docs/功能说明.md](docs/功能说明.md)。

## 安装

装 `android/app/build/outputs/apk/debug/app-debug.apk`（或者别人发给你的安装包）。第一次打开会引导你开通知、后台运行这些权限。

## 自己打包

需要 Node.js 20+、JDK 21、Android SDK（`ANDROID_HOME` 指向它）。

```bash
git clone https://github.com/mrhaa666-sketch/tian-xiaoxi-wowo.git
cd tian-xiaoxi-wowo
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

安装包在 `android/app/build/outputs/apk/debug/app-debug.apk`。

开发时可以 `npm run dev`，在电脑浏览器里预览画面（手机才有的功能，比如通知、后台常驻、小组件，在电脑上不会启用）。

## 接入 AI

默认是「本地模拟」模式：不联网、不花钱，角色按简单规则生活。要让角色真正由 AI 驱动，打开「设置」：

- **Claude**：填 Anthropic 的 API Key。
- **DeepSeek**、或者其他兼容 OpenAI 格式的服务：填服务地址、Key 和模型名。
- **长期记忆的向量模型**（可选）：兼容 OpenAI `/embeddings` 接口的服务，比如硅基流动的 `BAAI/bge-m3`。

花费控制：

- 角色只在「有事发生」或「手上的事做完了」时才问 AI，走路、用家具都在本地完成。
- 可以设每分钟最多调用几次、每天最多调用几次、每天最多花多少钱；设置里能看到每天的用量。

API Key 只保存在手机上，只会发给你选择的 AI 服务。

## 角色包、家具包、房间包

- 角色包格式：[docs/角色包格式.md](docs/角色包格式.md)
- 家具包和房间包格式：[docs/家具包和房间包格式.md](docs/家具包和房间包格式.md)

## 项目结构

```
src/
  core/      数据结构、时间和节日、网络、日志、存档备份
  world/     地图和楼层、寻路、家具目录、标签、礼物、预设房间、家具包
  sim/       角色、需求、一起做事、关系事件、天气温度、宠物、存档
  ai/        AI 接入、提示词、调度、长期记忆、用量、本地模拟
  render/    画面（PixiJS）、立绘、天气效果
  ui/        界面
  platform/  安卓：通知、后台常驻、小组件、权限
android/     安卓工程（Capacitor）
tools/       立绘处理、角色包和家具包打包工具
```
