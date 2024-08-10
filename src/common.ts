export enum FileStatus {
  Init = 'Init',             // 还未处理,等待提取
  Extract = 'Extract',      // 已提取，等待embedding
  Embedding = 'Embedding', // 已完成处理
  Ignore = 'Ignore',      // 忽略,无需处理
  UnsupportedFormat = 'UnsupportedFormat', // 不支持的格式
  ContentPolicy = 'ContentPolicy', // 内容政策拦截
}

export const replacePlaceholders = (template: string, ...args: any[]) => {
  return template.replace(/{(\d+)}/g, (match, index) => {
    return typeof args[index] !== 'undefined' ? args[index] : match;
  });
};
