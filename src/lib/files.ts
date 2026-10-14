export const supportedExtensions = [
  'pdf',
  'doc',
  'docx',
  'md',
  'markdown',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
];
export const maxFileBytes = 200 * 1024 * 1024;
export const isTextNote = (extension: string) => ['md', 'markdown', 'txt'].includes(extension);
export const isImage = (extension: string) =>
  ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);
