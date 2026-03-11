export interface FriendItem {
	id: number;
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags: string[];
}

export const friendsData: FriendItem[] = [
	{
		id: 3,
		title: "真红小站",
		imgurl: "https://www.google.com/s2/favicons?domain=www.shinnku.com&sz=128",
		desc: "直链，资源齐全，伟大无需多言",
		siteurl: "https://www.shinnku.com/",
		tags: ["acg", "资源网站"],
	},
	{
		id: 4,
		title: "z-library",
		imgurl: "https://www.google.com/s2/favicons?domain=z-library.sk&sz=128",
		desc: "全球最大的电子图书馆（至少目前链接有效）",
		siteurl: "https://z-library.sk",
		tags: ["资源网站"],
	},
	{
		id: 5,
		title: "acg导航",
		imgurl: "https://www.google.com/s2/favicons?domain=https://www.acgdh.cc/&sz=128",
		desc: "acg导航网站，要梯子",
		siteurl: "https://www.acgdh.cc/",
		tags: ["acg", "资源网站"],
	},
	{
		id: 6,
		title: "萌幻之乡",
		imgurl: "https://www.google.com/s2/favicons?domain=https://www.mhh1.com/&sz=128",
		desc: "不确定是否真的，但确实能下，百度网盘资源",
		siteurl: "https://www.mhh1.com/",
		tags: ["acg", "资源网站"],
	},
	{
		id: 7,
		title: "白嫖者联盟",
		imgurl: "",//"https://www.google.com/s2/favicons?domain=https://like.gamer520.com/&sz=128",
		desc: "单机游戏，问就老佛爷已经付过钱了，可惜百度网盘",
		siteurl: "https://like.gamer520.com/",
		tags: ["资源网站"],
	},
	{
		id: 10,
		title: "Mizuki Docs",
		imgurl: "http://q.qlogo.cn/headimg_dl?dst_uin=3231515355&spec=640&img_type=jpg",
		desc: "Mizuki User Manual",
		siteurl: "https://docs.mizuki.mysqil.com",
		tags: ["代码"],
	},
	{
		id: 11,
		title: "GitHub",
		imgurl: "https://avatars.githubusercontent.com/u/9919?v=4&s=640",
		desc: "Where the world builds software",
		siteurl: "https://github.com",
		tags: ["代码"],
	},
];

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
