import fs from "node:fs";
import path from "node:path";
import { dataFiles } from "../config";

export interface FriendItem {
	id: number;
	title: string;
	imgurl?: string;
	desc: string;
	siteurl: string | string[];
	tags: string[];
	first?: string;
	first_color?: number | string;
	first_siteurl?: string;
	first_active?: boolean | number | string;
	first_actived?: boolean | number | string;
	second?: string;
	second_color?: number | string;
	second_siteurl?: string;
	second_active?: boolean | number | string;
	second_actived?: boolean | number | string;
}

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
	// 当前不想随机排序：直接返回原顺序的一份复制（原洗牌 for 循环因提前 return 永不执行，已移除死代码）
	const shuffled = [...friendsData];
	return shuffled;
}
