import { ArrowUpRight, ChevronRight, GitBranch, Layers3, Plus } from 'lucide-react';
import type { WorkspaceState } from '../domain';
import type { WorkspaceIndex } from '../lib/workspace';
import { facetTypes } from '../lib/format';
import type { EditModalType } from './EditModal';

interface Props {
  state: WorkspaceState;
  index: WorkspaceIndex;
  onEditModal: (modal: EditModalType) => void;
  onAddOption: (id: string) => void;
  onFilterTag: (id: string) => void;
  onSelectKnowledge: (id: string) => void;
}
export default function OrganizeView({
  state,
  index,
  onEditModal: setModal,
  onAddOption,
  onFilterTag,
  onSelectKnowledge,
}: Props) {
  return (
    <div className="organize-page">
      <section className="organize-section">
        <div className="section-title">
          <h2>
            分类维度 <span className="section-count">{state.facets.length}</span>
          </h2>
        </div>
        <div className="facet-grid">
          {state.facets.map((facet) => (
            <details className="facet-card" key={facet.id}>
              <summary>
                <span className="category-symbol">
                  <Layers3 size={16} />
                </span>
                <h3>{facet.name}</h3>
                <span className="facet-type">
                  {facetTypes.find((type) => type.value === facet.type)?.label}
                </span>
                <span className="option-count">
                  {facet.options.length ? `${facet.options.length} 项` : '—'}
                </span>
                {['single', 'multi', 'tree'].includes(facet.type) && (
                  <button
                    className="text-button"
                    onClick={(event) => {
                      event.preventDefault();
                      onAddOption(facet.id);
                    }}
                  >
                    <Plus size={13} />
                    添加选项
                  </button>
                )}
                <ChevronRight className="disclosure-arrow" size={15} />
              </summary>
              <div className="option-chips">
                {facet.options.map((option) => (
                  <span key={option.id} title={index.labels.get(option.id) || option.id}>
                    {option.parentId && <GitBranch size={11} />}
                    {option.label}
                  </span>
                ))}
                {!facet.options.length && (
                  <span className="muted">
                    {['text', 'number', 'date'].includes(facet.type)
                      ? '在资料属性中填写'
                      : '暂无选项'}
                  </span>
                )}
              </div>
            </details>
          ))}
          {!state.facets.length && <div className="empty-inline">暂无分类</div>}
        </div>
      </section>
      <section className="organize-section">
        <div className="section-title">
          <h2>
            标签 <span className="section-count">{state.tags.length}</span>
          </h2>
          <button className="secondary-button compact" onClick={() => setModal('tag')}>
            <Plus size={14} />
            新建标签
          </button>
        </div>
        <div className="tag-management">
          {state.tags.map((tag) => (
            <button
              key={tag.id}
              style={{ '--tag-color': tag.color } as React.CSSProperties}
              onClick={() => {
                onFilterTag(tag.id);
              }}
            >
              <span className="tag-dot" style={{ background: tag.color }} />
              <strong>{tag.name}</strong>
              <span>{index.tagCounts.get(tag.id) || 0}</span>
            </button>
          ))}
          {!state.tags.length && <span className="muted">暂无标签</span>}
        </div>
      </section>
      <details className="organize-section expandable-section">
        <summary className="section-title">
          <h2>
            <ChevronRight className="disclosure-arrow" size={16} />
            知识节点 <span className="section-count">{state.knowledge.length}</span>
          </h2>
          <button
            className="secondary-button compact"
            onClick={(event) => {
              event.preventDefault();
              setModal('knowledge');
            }}
          >
            <Plus size={14} />
            添加节点
          </button>
        </summary>
        <div className="knowledge-grid">
          {state.knowledge.map((node) => (
            <button
              key={node.id}
              onClick={() => {
                onSelectKnowledge(node.id);
              }}
            >
              <GitBranch size={15} />
              <strong>{node.title}</strong>
              <small>{node.type}</small>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
        {!state.knowledge.length && <span className="muted">暂无节点</span>}
      </details>
      <details className="organize-section expandable-section">
        <summary className="section-title">
          <h2>
            <ChevronRight className="disclosure-arrow" size={16} />
            关系类型 <span className="section-count">{state.relationTypes.length}</span>
          </h2>
          <button
            className="secondary-button compact"
            onClick={(event) => {
              event.preventDefault();
              setModal('relationType');
            }}
          >
            <Plus size={14} />
            新建关系类型
          </button>
        </summary>
        <div className="option-chips">
          {state.relationTypes.map((type) => (
            <span key={type.id}>{type.name}</span>
          ))}
        </div>
      </details>
    </div>
  );
}
