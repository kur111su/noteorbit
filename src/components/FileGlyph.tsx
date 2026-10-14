import { BookOpen, FileImage, FileText } from 'lucide-react';
import type { LibraryDocument } from '../domain';

export default function FileGlyph({
  document,
  small = false,
}: {
  document: LibraryDocument;
  small?: boolean;
}) {
  const Icon =
    document.kind === '图片' ? FileImage : document.kind === '笔记' ? BookOpen : FileText;
  return (
    <span className={`file-glyph kind-${document.kind} ${small ? 'small' : ''}`}>
      <Icon size={small ? 17 : 23} strokeWidth={1.7} />
      {!small && <span>{document.extension.toUpperCase() || 'FILE'}</span>}
    </span>
  );
}
