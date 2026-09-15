// 把截图降采样成 ASCII，用于在无图像查看能力时粗略观察版面。
import sharp from "sharp";

const file = process.argv[2];
const cols = Number(process.argv[3] || 100);
const meta = await sharp(file).metadata();
const rows = Math.max(10, Math.round((cols * meta.height) / meta.width / 2.1));
const { data, info } = await sharp(file)
	.resize(cols, rows, { fit: "fill", kernel: "lanczos3" })
	.removeAlpha()
	.greyscale()
	.normalise()
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
console.log(`${file} ${meta.width}x${meta.height} -> ${cols}x${rows}`);
console.log(out);
