import type { DocumentKind, FacetType } from '../domain';

export const kinds: DocumentKind[] = ['试卷', '解析', '笔记', '教材', '图片', '其他'];
export const facetTypes: { value: FacetType; label: string }[] = [
  { value: 'single', label: '单选' },
  { value: 'multi', label: '多选' },
  { value: 'tree', label: '层级' },
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
];
export const tagColors = [
  '#7c5cce',
  '#5b86b5',
  '#5c9b93',
  '#bc865c',
  '#b36d93',
  '#8e9b63',
  '#bd9a59',
  '#8390a7',
];

export function folderOf(path: string) {
  const parts = path.replaceAll('\\', '/').split('/');
  parts.pop();
  return parts.join('/') || '资料库根目录';
}

export function shortFolder(path: string) {
  return folderOf(path).split('/').slice(-2).join('/');
}

export function formatDate(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? '—'
    : value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '月') +
        '日';
}

export function sizeLabel(size: number) {
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
