import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tianxiaoxi.wowo",
  appName: "恬小溪窝窝",
  webDir: "dist",
  android: {
    // 切到后台时不暂停网页里的计时器，角色才能继续生活、给主人发消息
    backgroundColor: "#f3eef3",
  },
  plugins: {
    // 网络请求走手机原生通道：不受浏览器跨域限制，AI 和新闻都能直接请求
    CapacitorHttp: { enabled: true },
    LocalNotifications: {
      smallIcon: "ic_stat_wowo",
      iconColor: "#e8789a",
    },
    // 兜底：应用被系统杀掉后，每 15 分钟左右唤醒一次后台小程序，继续发消息
    BackgroundRunner: {
      label: "com.tianxiaoxi.wowo.check",
      src: "runners/background.js",
      event: "check",
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
