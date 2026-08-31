import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FriendItem {
	id: number;
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags: string[];
}

// 26.08.31修改，内容为：friendsData 改为从 public/data/friends.json 读取（fs 读取 + JSON.parse），删除硬编码数组，保证单一数据源
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const friendsJsonPath = path.join(
	__dirname,
	"../../public/data/friends.json",
);
export const friendsData: FriendItem[] = JSON.parse(
	fs.readFileSync(friendsJsonPath, "utf-8"),
);

// 获取所有友情链接数据
export function getFriendsList(): FriendItem[] {
	return friendsData;
}

// 获取随机排序的友情链接数据
export function getShuffledFriendsList(): FriendItem[] {
	const shuffled = [...friendsData];

	return shuffled; //不想随机……
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}
