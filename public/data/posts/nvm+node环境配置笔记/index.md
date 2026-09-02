---

title: "nvm+node环境配置笔记"

published: 2026-09-01

active: true

draft: false

pinned: false

description: ""

tags: [环境配置,技术]

width: 0.5

category: "技术"

licenseName: "MIT"

author: "FGmagi"

sourceLink: "[fgmagi.pages.dev](https://fgmagi.pages.dev/)"

image: './image/cover.webp'

image_model: 'up'

---

windows系统 node 18.20.8 配置笔记

## 省流版

1.从 github 下载nvm安装包

使用稳定版本，v1.1.12：
https://github.com/nvm-windows/nvm/releases/tag/1.1.12

2.安装nvm

安装过程中需要指定nvm安装文件夹、node符号链接路径。

3.检查环境变量

检查环境变量是否包含这四项，没有手动补充。
path：%NVM_HOME%
path：%NVM_SYMLINK%
NVM_HOME: 写入nvm路径
NVM_SYMLINK: 写入node链接路径

4.下载各版本node

设置镜像，安装各版本node（17、18为例，要以终端管理员运行）
nvm node_mirror https://npmmirror.com/mirrors/node/
nvm npm_mirror https://npmmirror.com/mirrors/npm/
nvm install 17.9.1
nvm install 18.20.8

5.配置

nvm list（查询当前安装了哪些node版本）
nvm alias default 18.20.8（设置默认node版本号）
where nvm（查询nvm安装路径）
where node（查询当前启用的node路径）

6.使用方式
在终端命令调用之前，
nvm use 17.9.1（切换到17.9.1版本，不指定则使用默认node版本18.20.8）

其实单一node版本的情况下，设置个默认值就不用管那么多了，多版本就麻烦了。
在ide中有更便捷的方式，自行百度吧。

## 详细版

1.nvm 安装，从github下载 nvm

一般来说，在生产环境中，node会存在多个版本，需要用nvm进行管理。

使用稳定版本，v1.1.12：
https://github.com/nvm-windows/nvm/releases/tag/1.1.12
该链接限定为windows平台的，linux不用这个。

强烈建议直接下setup安装包，这种涉及一堆环境变量修改的东西，鬼知道绿色版会出些什么bug。不像后面注册表环境污染什么的，就老老实实下安装包得了。

安装时，应当指定nvm路径与node链接路径。

这里要解释一下，nvm本体+所有node都放在nvm路径下，会是一个挺大的文件夹。

而node链接路径是个很神奇的东西，后面再讲。（理论上放nvm路径之下的子文件夹或许也行？不过没试过，不确定会不会有什么冲突，愿意的可以试一试。）

2.环境变量设置

来到了最容易出错的地方了——

一般来说，在安装nvm时，勾选了写入path之后，安装包就会自动配好环境变量的。如果没配好，最建议的方式是干脆把nvm卸载了，然后重新安装。
（安装的程序一定要是调用uninstall.exe来卸载，不然鬼知道注册表会留下些什么东西！）

但是，众所周知，配环境的时候什么bug都会有，所以，还是要记录一下手动配置的方法（主要是用于乱搞，导致环境污染了之后知道该怎么修复的……）

一般来说，nvm安装时，会自动写入四个环境变量

path：%NVM_HOME%
path：%NVM_SYMLINK%
NVM_HOME: 写入nvm路径
NVM_SYMLINK: 写入node链接路径
nvm路径和node链接路径就是上一步，安装时要指定的路径。

安装后，如果以上环境变量不对，要么卸载重新安装，要么手动填写。

如果还是出现诸如安装错误、卸载不成功之类的。就让everything全删了，然后问一下ai，手动清一下注册表、环境变量，清完之后，再执行安装，再正确卸载，再重新安装，一般就好了。

还是解决不了我也就没办法了的说……

3.node安装与设置

如果环境变量配置成功了的话，那恭喜你，接下来基本上不太可能出错了。

设置镜像，安装各版本node（17、18为例，要以终端管理员运行）

nvm node_mirror https://npmmirror.com/mirrors/node/

nvm npm_mirror https://npmmirror.com/mirrors/npm/

nvm install 17.9.1

nvm install 18.20.8

设置默认node版本，以后nvm use default就是代表切换到18的环境
nvm alias default 18.20.8
nvm use default

至此，nvm与node的安装就完成了。

如果你的nvm安装了多个node：
那么可以调用nvm use 17.9.1，表示切换到17.9版本

nvm list，查询当前安装的所有node版本。

5.nvm版本管理的使用与原理解释

项目中，每次创建终端时，都会产生终端的环境变量表path，

path = 系统环境变量 + 用户环境变量 + 临时path

在调用nvm use 18.20.8，就会将node 18.20.8的路径添加到临时path中
（一般该路径是在nvm路径之下的18.20.8文件夹）

临时path生命周期，仅限终端存在的时间内。因此，理论上，每次打开终端，都需要重新调用nvm use 18.20.8。

显然这可太麻烦了，因此，对于bat程序，可以选择在开头写上nvm use 18.20.8。

不想记版本号的话，可以在项目根目录添加.nvmrc文件，里面写上18.20.8。后续调用nvm use，不填版本号，也会自动检索.nvmrc，补全版本号了。

6.node符号链接

在调用nvm alias default 18.20.8之后，会在此前指定的node链接路径，产生一个指向18.20.8的符号链接。

实际上就是设置了个默认的node版本号，如果终端内没用nvm指定任何node版本，那默认就调用这个default版本。

所有node的本体，都安装在nvm路径之下，node的链接路径是给电脑调用、切换配置方便的，链接不占空间，不用担心。
