import { putFile, getFileBlob } from "../api";

const ASSET_PATH = "/data/storage/petal/siyuan-plugin-copilot/assets";

/**
 * 计算数据的 SHA-256 哈希值
 */
export async function calculateHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 保存资源文件到插件存储目录
 * @param data 文件数据（Blob 或 ArrayBuffer）
 * @param fileName 原始文件名
 * @returns 返回保存在 SiYuan 中的路径
 */
export async function saveAsset(data: Blob | ArrayBuffer, fileName: string): Promise<string> {
    const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const hash = await calculateHash(arrayBuffer);
    const ext = fileName.split('.').pop() || 'png';
    const filePath = `${ASSET_PATH}/${hash}.${ext}`;

    try {
        // 尝试检查文件是否已存在
        const existing = await getFileBlob(filePath);
        if (existing && existing.size > 0) {
            return filePath;
        }
    } catch (e) {
        // 文件不存在，继续保存
    }

    const blob = data instanceof Blob ? data : new Blob([arrayBuffer]);
    await putFile(filePath, false, blob);
    return filePath;
}

/**
 * 从 SiYuan 路径加载资源并转换为 Base64 或 Blob URL
 * @param path SiYuan 中的资源路径
 * @returns 返回可用于 img src 的字符串
 */
export async function loadAsset(path: string): Promise<string | null> {
    try {
        const blob = await getFileBlob(path);
        if (!blob) return null;
        return URL.createObjectURL(blob);
    } catch (e) {
        console.error('Failed to load asset:', path, e);
        return null;
    }
}

/**
 * 将 Base64 转换为 Blob
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteString = atob(base64.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
}
