import { logger } from '../shared/logger';
import type { Attachment } from '../shared/types';
import type { FileInfo } from './fileLimitChecker';

const MODULE = 'FM';

export class FileManager {
  // [BUG-FIX] F12 - Promise.allSettled 替代 Promise.all，单个文件读取出错不影响其他文件
  static async filesToAttachments(files: File[]): Promise<Attachment[]> {
    const traceId = crypto.randomUUID();
    const results = await Promise.allSettled(
      files.map(
        (file) =>
          new Promise<Attachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              logger.debug(MODULE, traceId, '转换文件: ' + file.name);
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                size: file.size,
                data: reader.result as string,
                compressed: false,
              });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const attachments: Attachment[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        attachments.push(result.value);
      } else {
        logger.error(MODULE, traceId, '文件转换失败: ' + (files[i]?.name ?? 'unknown') + ' - ' + (result.reason?.message ?? String(result.reason)));
      }
    }
    return attachments;
  }

  static toFileInfos(attachments: Attachment[]): FileInfo[] {
    return attachments.map(a => ({ name: a.name, size: a.size, type: a.type }));
  }

  static attachmentToBlob(attachment: Attachment): Blob {
    const byteString = atob(attachment.data.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: attachment.type });
  }
}
