import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import type { FacetType, LibraryCommand, LibraryDocument, WorkspaceState } from '../domain';
import { facetTypes, tagColors } from '../lib/format';
import { optionLabels } from '../lib/workspace';
import { useDialogFocus } from './useDialogFocus';
export type EditModalType =
  | 'note'
  | 'tag'
  | 'facet'
  | 'option'
  | 'knowledge'
  | 'relation'
  | 'relationType'
  | 'rename'
  | 'move';

export default function EditModal({
  modal,
  state,
  document,
  optionFacetId,
  selectedId,
  nodeCandidates,
  busy,
  onClose,
  onSubmit,
}: {
  modal: EditModalType;
  state: WorkspaceState;
  document?: LibraryDocument;
  optionFacetId: string;
  selectedId: string;
  nodeCandidates: { id: string; label: string; group: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (command: LibraryCommand) => Promise<void>;
}) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [name, setName] = useState(
    modal === 'rename' ? document?.path.replaceAll('\\', '/').split('/').pop() || '' : '',
  );
  const [color, setColor] = useState(tagColors[0]);
  const [fieldType, setFieldType] = useState<FacetType>('single');
  const eligibleFacets = state.facets.filter((facet) =>
    ['single', 'multi', 'tree'].includes(facet.type),
  );
  const [facetId, setFacetId] = useState(
    eligibleFacets.some((facet) => facet.id === optionFacetId)
      ? optionFacetId
      : eligibleFacets[0]?.id || '',
  );
  const [parentId, setParentId] = useState('');
  const [nodeType, setNodeType] = useState<'章节' | '知识点' | '专题'>('知识点');
  const [source, setSource] = useState(
    nodeCandidates.some((node) => node.id === selectedId)
      ? selectedId
      : nodeCandidates[0]?.id || '',
  );
  const [target, setTarget] = useState('');
  const [relationType, setRelationType] = useState(state.relationTypes[0]?.id || '');
  const [content, setContent] = useState('');
  const [folder, setFolder] = useState('');
  const [formError, setFormError] = useState('');
  const title: Record<EditModalType, string> = {
    note: '新建笔记',
    tag: '创建标签',
    facet: '创建分类维度',
    option: '添加分类选项',
    knowledge: '添加知识节点',
    relation: '建立关联',
    relationType: '创建关系类型',
    rename: '重命名文件',
    move: '移动文件',
  };
  const currentFacet = state.facets.find((facet) => facet.id === facetId);
  const labels = useMemo(
    () => new Map(state.facets.flatMap((facet) => [...optionLabels(facet)])),
    [state.facets],
  );
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError('');
    if (modal === 'relation') {
      if (!source || !target || !relationType) {
        setFormError('请选择两个节点和关系类型。');
        return;
      }
      if (source === target) {
        setFormError('请选择两个不同的节点。');
        return;
      }
      await onSubmit({ type: 'add-relation', source, target, typeId: relationType });
      return;
    }
    if (modal === 'move') {
      if (document)
        await onSubmit({ type: 'move-document', id: document.id, folder: folder.trim() });
      return;
    }
    if (!name.trim()) {
      setFormError('请填写名称。');
      return;
    }
    if (modal === 'note') await onSubmit({ type: 'create-note', title: name.trim(), content });
    if (modal === 'tag') await onSubmit({ type: 'add-tag', name: name.trim(), color });
    if (modal === 'facet') await onSubmit({ type: 'add-facet', name: name.trim(), fieldType });
    if (modal === 'option') {
      if (!eligibleFacets.some((facet) => facet.id === facetId)) {
        setFormError('请先创建单选、多选或层级分类。');
        return;
      }
      await onSubmit({
        type: 'add-option',
        facetId,
        label: name.trim(),
        ...(parentId ? { parentId } : {}),
      });
    }
    if (modal === 'knowledge')
      await onSubmit({ type: 'add-knowledge', title: name.trim(), nodeType });
    if (modal === 'relationType') await onSubmit({ type: 'add-relation-type', name: name.trim() });
    if (modal === 'rename' && document)
      await onSubmit({ type: 'rename-document', id: document.id, fileName: name.trim() });
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title">{title[modal]}</h2>
          <button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {modal === 'option' && (
            <label className="form-field">
              分类维度
              <select
                value={facetId}
                disabled={!eligibleFacets.length}
                required
                onChange={(event) => {
                  setFacetId(event.target.value);
                  setParentId('');
                }}
              >
                {!eligibleFacets.length && <option value="">没有可添加选项的分类</option>}
                {eligibleFacets.map((facet) => (
                  <option key={facet.id} value={facet.id}>
                    {facet.name}
                  </option>
                ))}
              </select>
              {!eligibleFacets.length && <small>请先创建一个单选、多选或层级分类。</small>}
            </label>
          )}
          {modal !== 'relation' && modal !== 'move' && (
            <label className="form-field">
              {modal === 'rename' ? '文件名（包含扩展名）' : modal === 'note' ? '笔记标题' : '名称'}
              <input
                autoFocus
                value={name}
                maxLength={180}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  modal === 'tag'
                    ? '例如：待打印'
                    : modal === 'facet'
                      ? '例如：难度'
                      : modal === 'knowledge'
                        ? '例如：一元一次方程'
                        : '填写名称…'
                }
                required
              />
            </label>
          )}
          {modal === 'move' && (
            <label className="form-field">
              目标文件夹
              <input
                autoFocus
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="例如：数学/七年级/期末"
              />
              <small>填写库内相对路径；留空移到资料库根目录。</small>
            </label>
          )}
          {modal === 'note' && (
            <label className="form-field">
              笔记内容
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="支持 Markdown，例如 # 标题"
                rows={5}
              />
            </label>
          )}
          {modal === 'tag' && (
            <div className="form-field">
              标签颜色
              <div className="color-picker">
                {tagColors.map((value) => (
                  <button
                    type="button"
                    aria-label={`选择颜色 ${value}`}
                    aria-pressed={value === color}
                    className={color === value ? 'selected' : ''}
                    style={{ background: value }}
                    key={value}
                    onClick={() => setColor(value)}
                  >
                    {value === color && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="tag-preview">
                <span className="tag-chip" style={{ '--tag-color': color } as React.CSSProperties}>
                  {name || '标签预览'}
                </span>
              </div>
            </div>
          )}
          {modal === 'facet' && (
            <label className="form-field">
              分类形式
              <select
                value={fieldType}
                onChange={(event) => setFieldType(event.target.value as FacetType)}
              >
                {facetTypes.map((type) => (
                  <option value={type.value} key={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <small>
                {fieldType === 'multi'
                  ? '同一份资料可以选择多个选项。'
                  : fieldType === 'tree'
                    ? '选项可以包含子选项，形成层级结构。'
                    : fieldType === 'single'
                      ? '同一份资料选择一个选项。'
                      : '在资料详情中直接填写内容。'}
              </small>
            </label>
          )}
          {modal === 'option' && currentFacet?.type === 'tree' && (
            <label className="form-field">
              上级选项
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">无，创建为顶层选项</option>
                {currentFacet.options.map((option) => (
                  <option value={option.id} key={option.id}>
                    {labels.get(option.id) || option.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {modal === 'knowledge' && (
            <label className="form-field">
              节点类型
              <select
                value={nodeType}
                onChange={(event) => setNodeType(event.target.value as typeof nodeType)}
              >
                <option>知识点</option>
                <option>章节</option>
                <option>专题</option>
              </select>
            </label>
          )}
          {modal === 'relation' && (
            <>
              <label className="form-field">
                起点
                <select value={source} onChange={(event) => setSource(event.target.value)} required>
                  <option value="">选择节点</option>
                  {nodeCandidates.map((node) => (
                    <option value={node.id} key={node.id}>
                      [{node.group}] {node.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                关系类型
                <select
                  value={relationType}
                  onChange={(event) => setRelationType(event.target.value)}
                  required
                >
                  <option value="">选择关系类型</option>
                  {state.relationTypes.map((type) => (
                    <option value={type.id} key={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                终点
                <select value={target} onChange={(event) => setTarget(event.target.value)} required>
                  <option value="">选择关联节点</option>
                  {nodeCandidates
                    .filter((node) => node.id !== source)
                    .map((node) => (
                      <option value={node.id} key={node.id}>
                        [{node.group}] {node.label}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="primary-button"
              disabled={busy || (modal === 'option' && !eligibleFacets.length)}
              type="submit"
            >
              {busy && <LoaderCircle className="spin" size={15} />}
              {modal === 'relation' ? '建立关联' : '保存'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
