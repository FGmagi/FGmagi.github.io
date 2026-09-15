// 截图辅助：隐藏全屏壁纸，让版面在 ASCII 里可读（不改动站点源码）。
(function () {
	function clean() {
		var fs = document.querySelector("[data-fullscreen-wallpaper]");
		if (fs) fs.style.display = "none";
		var tw = document.querySelector(".top-gradient-highlight");
		if (tw) tw.style.display = "none";
		document.body.classList.remove("wallpaper-transparent");
		document.body.classList.add("no-banner-mode");
		document.body.style.background = "#ffffff";
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", clean);
	} else {
		clean();
	}
	setTimeout(clean, 1200);
})();
