---

title: "window11 绝对音量配置笔记"

published: 2026-09-16

active: true

draft: false

pinned: false

description: "设置蓝牙耳机、电脑音量独立调节"

tags: [环境配置]

width: 0.5

category: "技术"

licenseName: "MIT"

author: "FGmagi"

sourceLink: "[fgmagi.pages.dev](https://fgmagi.pages.dev/)"

image: ''

image_model: 'up'

---

Win + R 输入 regedit
找到 HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Bluetooth\Audio\AVRCP\CT
将下面的 DisableAbsoluteVolume 值设置为1

重启蓝牙/重启电脑，若成功就不用往下看了。
若失败，或者本身DisableAbsoluteVolume就是1，那就是window出bug了，需要重启音频服务。

Win + R 输入 services.msc
依次找到并右键重启以下三项：
    Windows Audio
    Windows Audio Endpoint Builder
    Multimedia Class Scheduler

完成后若还不行就另请高明了。
