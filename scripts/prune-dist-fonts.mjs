import fs from "node:fs";
import path from "node:path";

const distFontDir = path.join(process.cwd(), "dist", "assets", "font");
if (!fs.existsSync(distFontDir)) process.exit(0);
for (const name of fs.readdirSync(distFontDir)) {
	if (!/\.(?:ttf|otf)$/i.test(name)) continue;
	fs.rmSync(path.join(distFontDir, name), { force: true });
	console.log(`[fonts] removed development-only ${name} from dist`);
}

