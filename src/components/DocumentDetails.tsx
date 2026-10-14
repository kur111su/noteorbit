import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DocumentKind,
  Facet,
  FacetValue,
  LibraryCommand,
  LibraryDocument,
  WorkspaceState,
} from '../domain';
import type { WorkspaceIndex } from '../lib/workspace';
import { kinds, sizeLabel } from '../lib/format';
import type { EditModalType } from './EditModal';
import FileGlyph from './FileGlyph';

interface Props {
  state: WorkspaceState;
  index: WorkspaceIndex;
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCommand: (command: LibraryCommand, message?: string) => Promise<boolean>;
  onPreview: (doc: LibraryDocument) => void;
  onOpenOriginal: (doc: LibraryDocument) => Promise<void>;
  onEditModal: (modal: EditModalType) => void;
  onFilterFacet: (facetId: string, optionId: string) => void;
  onFilterTag: (tagId: string) => void;
}

export default function DocumentDetails({
  state,
  index,
  selectedId,
  busy,
  onSelect: setSelectedId,
  onCommand: command,
  onPreview: setPreview,
  onOpenOriginal: openOriginal,
  onEditModal: setModal,
  onFilterFacet,
  onFilterTag,
}: Props) {
  const selectedDocument = index.documents.get(selectedId);
  const selectedKnowledge = index.knowledge.get(selectedId);
  const selectedTag = index.tags.get(selectedId);
  const selectedOption = index.options.get(selectedId);
  const relations = index.relations.get(selectedId) || [];
  const nodeName = (id: string) => index.nodeNames.get(id) || '未知资料';
  const docMenu = selectedDocument && !selectedDocument.trashed;
  const [editingProperties, setEditingProperties] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDocumentMenuOpen(false);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  function setFacetValue(document: LibraryDocument, facet: Facet, value: FacetValue) {
    void command({
      type: 'update-document',
      id: document.id,
      patch: { values: { [facet.id]: value } },
    });
  }
  return (
    <aside className="detail-panel">
      <div className="detail-topline">
        <span>属性与关联</span>
        <div className="detail-top-actions">
          {docMenu && (
            <div className="more-wrapper">
              <button
                className="icon-button"
                aria-label="文件操作"
                title="文件操作"
                aria-expanded={documentMenuOpen}
                onClick={() => setDocumentMenuOpen(!documentMenuOpen)}
              >
                <MoreHorizontal size={17} />
              </button>
              {documentMenuOpen && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="关闭文件菜单"
                    onClick={() => setDocumentMenuOpen(false)}
                  />
                  <div className="dropdown-menu">
                    <button
                      onClick={() => {
                        setDocumentMenuOpen(false);
                        setModal('rename');
                      }}
                    >
                      重命名文件
                    </button>
                    <button
                      onClick={() => {
                        setDocumentMenuOpen(false);
                        setModal('move');
                      }}
                    >
                      移动文件
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setDocumentMenuOpen(false);
                        void command(
                          { type: 'trash-document', id: selectedDocument.id },
                          '已移入回收站',
                        );
                      }}
                    >
                      <Trash2 size={14} />
                      移入回收站
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button className="icon-button" aria-label="关闭详情" onClick={() => setSelectedId('')}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="detail-scroll">
        {selectedDocument ? (
          <>
            <div className="detail-title">
              <div className="detail-file-meta">
                <FileGlyph document={selectedDocument} small />
                <span>
                  {selectedDocument.extension.toUpperCase()}
                  <i>·</i>
                  {sizeLabel(selectedDocument.size)}
                </span>
              </div>
              <h2>{selectedDocument.title}</h2>
              <p title={selectedDocument.path}>{selectedDocument.path}</p>
            </div>
            {selectedDocument.trashed ? (
              <button
                className="primary-button full"
                disabled={busy}
                onClick={() =>
                  void command({ type: 'restore-document', id: selectedDocument.id }, '资料已恢复')
                }
              >
                <RotateCcw size={15} />
                恢复资料
              </button>
            ) : (
              <div className="detail-actions">
                <button className="primary-button" onClick={() => setPreview(selectedDocument)}>
                  <BookOpen size={15} />
                  预览资料
                </button>
                <button
                  className="secondary-button"
                  aria-label="打开原文件"
                  onClick={() => void openOriginal(selectedDocument)}
                  title="打开原文件"
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>
            )}
            {!selectedDocument.trashed && (
              <>
                <section className="detail-section">
                  <div className="detail-section-title">
                    <h3>属性</h3>
                    <button
                      className="text-button"
                      aria-label="编辑分类属性"
                      aria-expanded={editingProperties}
                      onClick={() => setEditingProperties(!editingProperties)}
                    >
                      {editingProperties ? '完成' : '编辑'}
                    </button>
                  </div>
                  {editingProperties ? (
                    <div className="property-list">
                      <div className="property-row">
                        <label htmlFor="document-title">名称</label>
                        <input
                          id="document-title"
                          disabled={busy}
                          key={`${selectedDocument.id}-${selectedDocument.title}`}
                          defaultValue={selectedDocument.title}
                          onBlur={(event) => {
                            const title = event.target.value.trim();
                            if (title && title !== selectedDocument.title)
                              void command({
                                type: 'update-document',
                                id: selectedDocument.id,
                                patch: { title },
                              });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      </div>
                      <div className="property-row">
                        <label htmlFor="document-kind">类型</label>
                        <select
                          id="document-kind"
                          value={selectedDocument.kind}
                          disabled={busy}
                          onChange={(event) =>
                            void command({
                              type: 'update-document',
                              id: selectedDocument.id,
                              patch: { kind: event.target.value as DocumentKind },
                            })
                          }
                        >
                          {kinds.map((kind) => (
                            <option key={kind}>{kind}</option>
                          ))}
                        </select>
                      </div>
                      {state.facets.map((facet) => (
                        <div
                          className={`property-row ${facet.type === 'multi' || facet.type === 'tree' ? 'multivalue-row' : ''}`}
                          key={facet.id}
                        >
                          <label htmlFor={`facet-${facet.id}`}>{facet.name}</label>
                          {facet.type === 'multi' || facet.type === 'tree' ? (
                            <div
                              className={`multi-values ${facet.type === 'tree' ? 'tree-values' : ''}`}
                            >
                              {facet.options.map((option) => {
                                const values = Array.isArray(selectedDocument.values[facet.id])
                                  ? (selectedDocument.values[facet.id] as string[])
                                  : [];
                                const label =
                                  facet.type === 'tree'
                                    ? index.labels.get(option.id) || option.id
                                    : option.label;
                                return (
                                  <button
                                    className={`${values.includes(option.id) ? 'chosen' : ''} ${option.parentId ? 'child-option' : ''}`}
                                    aria-label={`${facet.name}：${label}`}
                                    aria-pressed={values.includes(option.id)}
                                    key={option.id}
                                    disabled={busy}
                                    onClick={() =>
                                      setFacetValue(
                                        selectedDocument,
                                        facet,
                                        values.includes(option.id)
                                          ? values.filter((id) => id !== option.id)
                                          : [...values, option.id],
                                      )
                                    }
                                  >
                                    {values.includes(option.id) && <Check size={11} />}
                                    {label}
                                  </button>
                                );
                              })}
                              {!facet.options.length && <span className="muted">暂无选项</span>}
                            </div>
                          ) : facet.type === 'single' ? (
                            <select
                              id={`facet-${facet.id}`}
                              value={String(selectedDocument.values[facet.id] || '')}
                              disabled={busy}
                              onChange={(event) =>
                                setFacetValue(selectedDocument, facet, event.target.value || null)
                              }
                            >
                              <option value="">未设置</option>
                              {facet.options.map((option) => (
                                <option value={option.id} key={option.id}>
                                  {index.labels.get(option.id) || option.id}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`facet-${facet.id}`}
                              type={
                                facet.type === 'number'
                                  ? 'number'
                                  : facet.type === 'date'
                                    ? 'date'
                                    : 'text'
                              }
                              key={`${selectedDocument.id}-${facet.id}-${selectedDocument.values[facet.id]}`}
                              defaultValue={String(selectedDocument.values[facet.id] ?? '')}
                              placeholder="未设置"
                              disabled={busy}
                              onBlur={(event) => {
                                const raw = event.target.value.trim();
                                const value = !raw
                                  ? null
                                  : facet.type === 'number'
                                    ? Number(raw)
                                    : raw;
                                if (value !== (selectedDocument.values[facet.id] ?? null))
                                  setFacetValue(selectedDocument, facet, value);
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <dl className="property-summary">
                      <div>
                        <dt>类型</dt>
                        <dd>{selectedDocument.kind}</dd>
                      </div>
                      {state.facets
                        .filter((facet) => {
                          const value = selectedDocument.values[facet.id];
                          return (
                            value !== null &&
                            value !== undefined &&
                            value !== '' &&
                            (!Array.isArray(value) || value.length > 0)
                          );
                        })
                        .map((facet) => (
                          <div key={facet.id}>
                            <dt>{facet.name}</dt>
                            <dd>
                              {(Array.isArray(selectedDocument.values[facet.id])
                                ? (selectedDocument.values[facet.id] as string[])
                                : [selectedDocument.values[facet.id]]
                              ).map((value, valueIndex) => (
                                <span key={valueIndex}>
                                  {index.labels.get(String(value)) || String(value)}
                                </span>
                              ))}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                </section>
                <section className="detail-section">
                  <div className="detail-section-title">
                    <h3>标签</h3>
                    <button
                      className="text-button"
                      aria-label="编辑资料标签"
                      aria-expanded={editingTags}
                      onClick={() => setEditingTags(!editingTags)}
                    >
                      {editingTags ? '完成' : '编辑'}
                    </button>
                  </div>
                  {editingTags ? (
                    <>
                      <div className="detail-tag-picker">
                        {state.tags.map((tag) => (
                          <button
                            className={`tag-chip ${selectedDocument.tagIds.includes(tag.id) ? 'chosen' : 'unchosen'}`}
                            style={{ '--tag-color': tag.color } as React.CSSProperties}
                            key={tag.id}
                            disabled={busy}
                            aria-pressed={selectedDocument.tagIds.includes(tag.id)}
                            onClick={() =>
                              void command({
                                type: 'update-document',
                                id: selectedDocument.id,
                                patch: {
                                  tagIds: selectedDocument.tagIds.includes(tag.id)
                                    ? selectedDocument.tagIds.filter((id) => id !== tag.id)
                                    : [...selectedDocument.tagIds, tag.id],
                                },
                              })
                            }
                          >
                            {selectedDocument.tagIds.includes(tag.id) && <Check size={11} />}
                            {tag.name}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button create-tag-link"
                        onClick={() => setModal('tag')}
                      >
                        <Plus size={12} />
                        新建标签
                      </button>
                    </>
                  ) : (
                    <div className="detail-tag-picker tag-summary">
                      {selectedDocument.tagIds.map((id) => {
                        const tag = index.tags.get(id);
                        return (
                          tag && (
                            <span
                              className="tag-chip"
                              style={{ '--tag-color': tag.color } as React.CSSProperties}
                              key={id}
                            >
                              {tag.name}
                            </span>
                          )
                        );
                      })}
                      {!selectedDocument.tagIds.length && (
                        <button className="text-button muted" onClick={() => setEditingTags(true)}>
                          添加标签
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          <div className="node-detail">
            <span className="detail-kind">
              {selectedKnowledge?.type || (selectedTag ? '标签' : selectedOption?.facetName)}
            </span>
            <h2>{selectedKnowledge?.title || selectedTag?.name || selectedOption?.label}</h2>
            {selectedKnowledge?.description && <p>{selectedKnowledge.description}</p>}
            {selectedOption && (
              <button
                className="secondary-button full"
                onClick={() => {
                  onFilterFacet(selectedOption.facetId, selectedOption.id);
                }}
              >
                查看资料
                <ArrowUpRight size={14} />
              </button>
            )}
            {selectedTag && (
              <button
                className="secondary-button full"
                onClick={() => {
                  onFilterTag(selectedTag.id);
                }}
              >
                查看资料
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        )}
        <section className="detail-section">
          <div className="detail-section-title">
            <h3>
              关联 <span className="tiny-count">{relations.length}</span>
            </h3>
            {!selectedDocument?.trashed && (
              <button
                className="icon-button"
                aria-label="添加关联"
                title="添加关联"
                onClick={() => setModal('relation')}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          <div className="relations-list">
            {relations.map((relation) => {
              const outgoing = relation.source === selectedId;
              const otherId = outgoing ? relation.target : relation.source;
              return (
                <div className="relation-item" key={relation.id}>
                  <button onClick={() => setSelectedId(otherId)}>
                    <span
                      className="relation-direction"
                      title={outgoing ? '指向关联对象' : '来自关联对象'}
                    >
                      {outgoing ? '→' : '←'}{' '}
                      {index.relationTypes.get(relation.typeId)?.name || '关联'}
                    </span>
                    <strong>{nodeName(otherId)}</strong>
                  </button>
                  <button
                    className="remove-relation icon-button"
                    title="解除关联"
                    aria-label={`解除与${nodeName(otherId)}的关联`}
                    disabled={busy}
                    onClick={() =>
                      void command({ type: 'remove-relation', id: relation.id }, '关联已解除')
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {!relations.length && <span className="muted">暂无关联</span>}
          </div>
        </section>
      </div>
    </aside>
  );
}
