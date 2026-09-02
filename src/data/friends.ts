import fs from "node:fs";
import path from "node:path";
import { dataFiles } from "../config";

export interface FriendItem {
	id: number;
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags: string[];
}

// 26.09.02 [7]：friendsData 路径改读 config（dataFiles.friendsJson，基于 process.cwd()，与 anime.astro 一致）
const friendsJsonPath = path.join(process.cwd(), dataFiles.friendsJson);
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
