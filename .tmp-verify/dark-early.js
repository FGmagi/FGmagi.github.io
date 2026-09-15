// 在解析期（<head> 之后、页面内容之前）就切到暗色：排除 CSS 过渡对测量的干扰。
document.documentElement.classList.add("dark");
