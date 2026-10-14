import type { ReactNode } from 'react';
import { Search, Trash2 } from 'lucide-react';
import type { LibraryDocument } from '../domain';
import type { WorkspaceIndex } from '../lib/workspace';
import { formatDate, shortFolder } from '../lib/format';
import FileGlyph from './FileGlyph';

interface Props {
  documents: LibraryDocument[];
  index: WorkspaceIndex;
  checked: string[];
  selectedId: string;
  busy: boolean;
  sort: string;
  trash: boolean;
  hasFilters: boolean;
  onCheckedChange: (ids: string[]) => void;
  onSelect: (id: string) => void;
  onPreview: (doc: LibraryDocument) => void;
  onSort: (sort: string) => void;
  onClearFilters: () => void;
  onBatchTag: (id: string) => Promise<void>;
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export default function DocumentList({
  documents,
  index,
  checked,
  selectedId,
  busy,
  sort,
  trash,
  hasFilters,
  onCheckedChange,
  onSelect,
  onPreview,
  onSort,
  onClearFilters,
  onBatchTag,
}: Props) {
  const checkedIds = new Set(checked);
  return (
    <>
      <div className="list-toolbar">
        <div>
          {checked.length ? (
            <>
              <span className="selection-count">已选 {checked.length} 份</span>
              <select
                aria-label="批量添加标签"
                defaultValue=""
                disabled={busy}
                onChange={(event) => {
                  const tagId = event.target.value;
                  event.target.value = '';
                  if (tagId) void onBatchTag(tagId);
                }}
              >
                <option value="">添加标签</option>
                {[...index.tags.values()].map((tag) => (
                  <option value={tag.id} key={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <button className="text-button" onClick={() => onCheckedChange([])}>
                取消
              </button>
            </>
          ) : (
            <span className="results-count">{documents.length} 份资料</span>
          )}
        </div>
        <select
          className="sort-select"
          aria-label="排序方式"
          value={sort}
          onChange={(event) => onSort(event.target.value)}
        >
          <option value="updated">最近更新</option>
          <option value="title">名称排序</option>
        </select>
      </div>
      <div className="document-table-head">
        <label>
          <input
            type="checkbox"
            aria-label="选择所有显示资料"
            disabled={busy || trash}
            checked={documents.length > 0 && documents.every((doc) => checkedIds.has(doc.id))}
            onChange={(event) =>
              onCheckedChange(event.target.checked ? documents.map((doc) => doc.id) : [])
            }
          />
        </label>
        <span>名称</span>
        <span className="table-tags">标签</span>
        <span className="table-date">更新</span>
      </div>
      <div className="document-list">
        {documents.map((doc) => (
          <div
            role="button"
            tabIndex={0}
            key={doc.id}
            className={`document-row ${selectedId === doc.id ? 'selected' : ''}`}
            onClick={() => onSelect(doc.id)}
            onDoubleClick={() => {
              if (!doc.trashed) onPreview(doc);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelect(doc.id);
            }}
          >
            <label onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                aria-label={`选择${doc.title}`}
                disabled={busy || trash}
                checked={checkedIds.has(doc.id)}
                onChange={(event) =>
                  onCheckedChange(
                    event.target.checked
                      ? [...checked, doc.id]
                      : checked.filter((id) => id !== doc.id),
                  )
                }
              />
            </label>
            <FileGlyph document={doc} small />
            <div className="document-name">
              <strong>
                {doc.title}
                {doc.missing && <span className="missing-mark">文件丢失</span>}
              </strong>
              <small title={doc.path}>
                {shortFolder(doc.path)}
                <span>· {doc.extension.toUpperCase()}</span>
              </small>
            </div>
            <div className="row-tags">
              {doc.tagIds.slice(0, 2).map((id) => {
                const tag = index.tags.get(id);
                return (
                  tag && (
                    <span
                      key={id}
                      className="tag-chip"
                      style={{ '--tag-color': tag.color } as React.CSSProperties}
                    >
                      {tag.name}
                    </span>
                  )
                );
              })}
              {doc.tagIds.length > 2 && (
                <span className="extra-tags">+{doc.tagIds.length - 2}</span>
              )}
            </div>
            <span className="row-date">{formatDate(doc.updatedAt)}</span>
          </div>
        ))}
        {!documents.length && (
          <Empty
            icon={trash ? <Trash2 size={25} /> : <Search size={25} />}
            title={trash ? '回收站为空' : hasFilters ? '无匹配资料' : '暂无资料'}
          >
            {hasFilters ? (
              <button className="text-button" onClick={onClearFilters}>
                清除筛选
              </button>
            ) : trash ? null : (
              '导入文件或新建笔记'
            )}
          </Empty>
        )}
      </div>
    </>
  );
}
