export interface Photo {
	id?: string;
	src: string;
	alt?: string;
	title?: string;
	thumbnail?: string;
	tags?: string[];
	description?: string;
	date?: string;
	location?: string;
	width?: number;
	height?: number;
	/** 构建期内部去重键（不渲染）：本地图片=文件内容 md5；外链图片=规范化 URL 键（懒加载/防流量折衷，不下载内容） */
	hash?: string;
}

/**
 * 相册顶层清单对象（albumsDir/info.json 顶层数组中的每一项，即一个相册）。
 * 字段均有默认值，详情见 album-scanner.ts 的默认解析逻辑。
 */
export interface AlbumInfo {
	title?: string; // 相册标题（数组模式下必填；默认取匹配的本地文件夹名）
	photo_urls?: string[]; // 外链单图 url 数组（可选，默认 []）
	photo_dir_urls?: string[]; // 外链图片文件夹 url 数组（可选，默认 []；构建期自动读取其下图片直链）
	cover?: string; // 封面文件名（可选；默认取名为 cover 的图片，多个取第一个；无则回退该相册首张照片）
	description?: string; // 相册描述（可选，默认 ""）
	date?: string; // 相册日期 YYYY-MM-DD（可选，默认当前日期）
	location?: string; // 拍摄地点（可选，默认 ""）
	tags?: string[]; // 相册标签（可选，默认 []）
	layout?: "grid" | "masonry"; // 布局（可选 grid|masonry，默认 grid；非法值夹紧为 grid）
	columns?: number; // 列数（可选 2-4，默认 3，越界夹紧）
	hidden?: boolean; // 是否隐藏（可选，默认 false；hidden=true 不渲染）
}

// 数组模式相册字段默认值
export const ALBUM_DEFAULT_COLUMNS = 3; // 默认列数
export const ALBUM_MIN_COLUMNS = 2; // 列数下限
export const ALBUM_MAX_COLUMNS = 4; // 列数上限
export const ALBUM_DEFAULT_LAYOUT: AlbumInfo["layout"] = "grid"; // 默认布局
export const ALBUM_COVER_NAME_PREFIX = "cover"; // 默认封面文件名前缀（去扩展名后大小写不敏感以它开头即视为封面）

export interface AlbumGroup {
	id: string;
	title: string;
	description?: string;
	cover: string;
	date: string;
	location?: string;
	tags?: string[];
	layout?: "grid" | "masonry";
	columns?: number;
	photos: Photo[];
}
