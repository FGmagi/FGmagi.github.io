// 裁剪截图区域后渲染 ASCII（提高局部可读性）
import sharp from "sharp";

const [file, left, top, width, height, colsArg] = process.argv.slice(2);
const cols = Number(colsArg || 150);
const meta = await sharp(file).metadata();
const w = Math.min(Number(width), meta.width - Number(left));
const h = Math.min(Number(height), meta.height - Number(top));
const rows = Math.max(8, Math.round((cols * h) / w / 2.1));
const { data, info } = await sharp(file)
	.extract({ left: Number(left), top: Number(top), width: w, height: h })
	.resize(cols, rows, { fit: "fill", kernel: "lanczos3" })
	.removeAlpha()
	.greyscale()
	.raw()
	.toBuffer({ resolveWithObject: true });
const ramp = " .:-=+*#%@";
let out = "";
for (let y = 0; y < info.height; y++) {
	let line = "";
	for (let x = 0; x < info.width; x++) {
		const v = data[y * info.width + x] / 255;
		line += ramp[Math.min(ramp.length - 1, Math.round((1 - v) * (ramp.length - 1)))];
	}
	out += line + "\n";
}
console.log(`crop ${left},${top} ${w}x${h} -> ${cols}x${rows}`);
console.log(out);
