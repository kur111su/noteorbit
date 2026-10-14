import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ForceGraph3D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { Focus, Maximize2, Move3D, RotateCcw, Save, Search, Sparkles, X } from 'lucide-react';
import type { WorkspaceState } from '../domain';
import './GalaxyView.css';

type Position = { x: number; y: number; z: number };
type GalaxyNode = {
  id: string;
  title: string;
  kind: 'document' | 'knowledge' | 'facet' | 'tag';
  subtitle: string;
  color: string;
  group: string;
  degree: number;
  center: Position;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};
type GalaxyLink = {
  id: string;
  source: string | NodeObject<GalaxyNode>;
  target: string | NodeObject<GalaxyNode>;
  name: string;
  derived: boolean;
};
type NodeVisual = {
  group: Group;
  core: Mesh<SphereGeometry, MeshBasicMaterial>;
  halo: Mesh<SphereGeometry, MeshBasicMaterial>;
  label?: SpriteText;
  node: NodeObject<GalaxyNode>;
};
type Props = {
  state: WorkspaceState;
  visibleDocumentIds?: string[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onSaveLayout?: (positions: Record<string, Position>) => void | Promise<void | boolean>;
};

const PALETTE = [
  '#8c78c6',
  '#6f9ec2',
  '#62a69c',
  '#c79b65',
  '#b77e9b',
  '#8897bc',
  '#91a773',
  '#b48b75',
];
const KIND_COLORS: Record<GalaxyNode['kind'], string> = {
  document: '#8c78c6',
  knowledge: '#62a69c',
  facet: '#c79b65',
  tag: '#6f9ec2',
};
const KIND_LABELS: Record<GalaxyNode['kind'], string> = {
  document: '文档',
  knowledge: '知识',
  facet: '分类',
  tag: '标签',
};
const finitePosition = (node: Partial<Position>): node is Position =>
  Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z);
const endpointId = (endpoint: GalaxyLink['source']) =>
  typeof endpoint === 'string' ? endpoint : endpoint.id;
const safeText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
function hash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}
function seedPosition(id: string, radius = 90): Position {
  const angle = (hash(id) / 4294967296) * Math.PI * 2;
  const height = (hash(`${id}:z`) / 4294967296) * 2 - 1;
  const ring = Math.sqrt(1 - height * height) * radius;
  return { x: Math.cos(angle) * ring, y: height * radius, z: Math.sin(angle) * ring };
}
function checkWebGL() {
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class GraphBoundary extends Component<
  { children: ReactNode; onRetry: () => void; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <div className="galaxy-empty">
        <Move3D size={24} />
        <h3>无法显示图谱</h3>
        <p>请开启硬件加速，并确认设备支持 WebGL 2。</p>
        <button type="button" onClick={this.props.onRetry}>
          重试
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function GalaxyView({
  state,
  visibleDocumentIds,
  selectedId,
  onSelect,
  onSaveLayout,
}: Props) {
  const graphRef = useRef<ForceGraphMethods<GalaxyNode, GalaxyLink> | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Record<string, Position>>({});
  const persistedPositionsRef = useRef<Record<string, Position>>({});
  const pinnedIdsRef = useRef(new Set<string>());
  const fitTimerRef = useRef<number | undefined>(undefined);
  const libraryIdentity = `${state.library.mode}:${state.library.path}`;
  const libraryIdentityRef = useRef(libraryIdentity);
  const nodeVisualsRef = useRef(new Map<string, NodeVisual>());
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [webgl, setWebgl] = useState(checkWebGL);
  const [retryKey, setRetryKey] = useState(0);
  const [focusId, setFocusId] = useState(selectedId);
  const [hoverId, setHoverId] = useState<string>();
  const [showFacets, setShowFacets] = useState(true);
  const [showTags, setShowTags] = useState(false);
  const [groupBy, setGroupBy] = useState('connections');
  const positionsGroupRef = useRef(groupBy);
  const [depth, setDepth] = useState('all');
  const [query, setQuery] = useState('');
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [ignoreSavedLayout, setIgnoreSavedLayout] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const visibleKey = useMemo(
    () => (visibleDocumentIds ? [...new Set(visibleDocumentIds)].sort().join('\u0000') : undefined),
    [visibleDocumentIds],
  );

  useEffect(() => {
    setFocusId(selectedId);
  }, [selectedId]);
  useEffect(() => {
    setIgnoreSavedLayout(false);
    setHoverId(undefined);
    setDepth('all');
  }, [libraryIdentity]);
  useEffect(() => {
    if (
      groupBy.startsWith('facet:') &&
      !state.facets.some((facet) => `facet:${facet.id}` === groupBy && facet.options.length)
    ) {
      pinnedIdsRef.current.clear();
      setGroupBy('connections');
    }
  }, [state.facets, groupBy]);
  useEffect(() => {
    if (!savedMessage) return;
    const timer = window.setTimeout(() => setSavedMessage(''), 4200);
    return () => window.clearTimeout(timer);
  }, [savedMessage]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fullGraph = useMemo(() => {
    const libraryChanged = libraryIdentityRef.current !== libraryIdentity;
    if (libraryChanged) {
      positionsRef.current = {};
      persistedPositionsRef.current = {};
      pinnedIdsRef.current.clear();
      libraryIdentityRef.current = libraryIdentity;
    }
    const visible = visibleDocumentIds ? new Set(visibleDocumentIds) : null;
    const documents = state.documents.filter(
      (item) => !item.trashed && (!visible || visible.has(item.id)),
    );
    const documentIds = new Set(documents.map((item) => item.id));
    const documentsById = new Map(documents.map((item) => [item.id, item]));
    const facetsById = new Map(state.facets.map((facet) => [facet.id, facet]));
    const allOptionNodes = state.facets.flatMap((facet) =>
      facet.options.map((option) => ({ facet, option })),
    );
    const optionsByFacet = new Map(
      state.facets.map((facet) => [facet.id, new Set(facet.options.map((option) => option.id))]),
    );
    const tagsById = new Map(state.tags.map((tag) => [tag.id, tag]));
    const relationNames = new Map(state.relationTypes.map((type) => [type.id, type.name]));
    const candidateIds = new Set([
      ...documentIds,
      ...state.knowledge.map((node) => node.id),
      ...allOptionNodes.map(({ option }) => option.id),
      ...tagsById.keys(),
    ]);
    const explicitRelations = state.relations.filter(
      (link) => candidateIds.has(link.source) && candidateIds.has(link.target),
    );
    const explicitlyUsed = new Set(explicitRelations.flatMap((link) => [link.source, link.target]));
    const optionIds = new Set<string>();
    const tagIds = new Set<string>();
    const links: GalaxyLink[] = [];
    if (showFacets) {
      for (const item of documents)
        for (const [facetId, value] of Object.entries(item.values)) {
          const facet = facetsById.get(facetId);
          if (!facet) continue;
          const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
          for (const id of values)
            if (optionsByFacet.get(facet.id)?.has(id)) {
              optionIds.add(id);
              links.push({
                id: `classification:${item.id}:${facet.id}:${id}`,
                source: item.id,
                target: id,
                name: facet.name,
                derived: true,
              });
            }
        }
    }
    if (showTags)
      for (const item of documents)
        for (const id of item.tagIds)
          if (tagsById.has(id)) {
            tagIds.add(id);
            links.push({
              id: `tagging:${item.id}:${id}`,
              source: item.id,
              target: id,
              name: '标记',
              derived: true,
            });
          }
    const selectedFacet = state.facets.find((facet) => `facet:${facet.id}` === groupBy);
    const groupLabels = new Map(selectedFacet?.options.map((option) => [option.id, option.label]));
    const grouping = (id: string, defaultLabel: string) => {
      const item = documentsById.get(id);
      if (!item) return defaultLabel;
      if (selectedFacet) {
        const value = item.values[selectedFacet.id];
        const first = Array.isArray(value) ? value[0] : value;
        return groupLabels.get(String(first)) || '未分类';
      }
      if (groupBy === 'tags')
        return item.tagIds.map((id) => tagsById.get(id)).find(Boolean)?.name || '无标签';
      return defaultLabel;
    };
    const nodes: GalaxyNode[] = [
      ...documents.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.kind,
        kind: 'document' as const,
        color: KIND_COLORS.document,
        group: grouping(item.id, '文档'),
        degree: 0,
        center: { x: 0, y: 0, z: 0 },
      })),
      ...state.knowledge.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.type,
        kind: 'knowledge' as const,
        color: KIND_COLORS.knowledge,
        group: '知识节点',
        degree: 0,
        center: { x: 0, y: 0, z: 0 },
      })),
      ...allOptionNodes
        .filter(({ option }) => optionIds.has(option.id) || explicitlyUsed.has(option.id))
        .map(({ facet, option }) => ({
          id: option.id,
          title: option.label,
          subtitle: facet.name,
          kind: 'facet' as const,
          color: KIND_COLORS.facet,
          group: facet.id === selectedFacet?.id ? option.label : '分类选项',
          degree: 0,
          center: { x: 0, y: 0, z: 0 },
        })),
      ...state.tags
        .filter((tag) => tagIds.has(tag.id) || explicitlyUsed.has(tag.id))
        .map((tag) => ({
          id: tag.id,
          title: tag.name,
          subtitle: '标签',
          kind: 'tag' as const,
          color: tag.color || KIND_COLORS.tag,
          group: groupBy === 'tags' ? tag.name : '标签',
          degree: 0,
          center: { x: 0, y: 0, z: 0 },
        })),
    ];
    const availableIds = new Set(nodes.map((item) => item.id));
    for (const link of explicitRelations)
      if (availableIds.has(link.source) && availableIds.has(link.target)) {
        links.push({
          id: link.id,
          source: link.source,
          target: link.target,
          name: relationNames.get(link.typeId) || '关联',
          derived: false,
        });
      }
    const neighbors = new Map<string, Set<string>>();
    for (const node of nodes) neighbors.set(node.id, new Set());
    for (const link of links) {
      neighbors.get(endpointId(link.source))?.add(endpointId(link.target));
      neighbors.get(endpointId(link.target))?.add(endpointId(link.source));
    }
    // A filtered graph keeps the visible files and their connected context. The full library also shows independent knowledge nodes.
    const isFiltered =
      !!visible && documentIds.size < state.documents.filter((item) => !item.trashed).length;
    const reachable = new Set(documentIds);
    if (isFiltered) {
      const queue = [...documentIds];
      for (let index = 0; index < queue.length; index++)
        for (const neighbor of neighbors.get(queue[index]) || []) {
          if (!reachable.has(neighbor)) {
            reachable.add(neighbor);
            queue.push(neighbor);
          }
        }
    }
    const includedNodes = isFiltered ? nodes.filter((node) => reachable.has(node.id)) : nodes;
    const includedIds = new Set(includedNodes.map((node) => node.id));
    const includedLinks = links.filter(
      (link) =>
        includedIds.has(endpointId(link.source)) && includedIds.has(endpointId(link.target)),
    );
    const includedNeighbors = new Map([...neighbors].filter(([id]) => includedIds.has(id)));
    const groupNames = [...new Set(includedNodes.map((node) => node.group))];
    const groupIndices = new Map(groupNames.map((name, index) => [name, index]));
    for (const node of includedNodes) {
      node.degree = neighbors.get(node.id)?.size || 0;
      const groupIndex = groupIndices.get(node.group)!;
      node.center =
        groupBy === 'connections'
          ? { x: 0, y: 0, z: 0 }
          : seedPosition(`group:${groupIndex}:${node.group}`, 145 + groupNames.length * 5);
      if (groupBy !== 'connections') node.color = PALETTE[groupIndex % PALETTE.length];
      const savedCandidate =
        (!ignoreSavedLayout || libraryChanged) && groupBy === 'connections'
          ? state.graphLayout?.[node.id]
          : undefined;
      const saved = savedCandidate && finitePosition(savedCandidate) ? savedCandidate : undefined;
      const previousSaved = persistedPositionsRef.current[node.id];
      const savedChanged =
        saved &&
        (!previousSaved ||
          saved.x !== previousSaved.x ||
          saved.y !== previousSaved.y ||
          saved.z !== previousSaved.z);
      const cached =
        positionsGroupRef.current === groupBy ? positionsRef.current[node.id] : undefined;
      const seed = seedPosition(node.id, groupBy === 'connections' ? 105 : 38);
      const position = (savedChanged ? saved : cached || saved) || {
        x: seed.x + node.center.x,
        y: seed.y + node.center.y,
        z: seed.z + node.center.z,
      };
      Object.assign(node, position);
      if (saved || pinnedIdsRef.current.has(node.id))
        Object.assign(node, { fx: position.x, fy: position.y, fz: position.z });
    }
    return {
      nodes: includedNodes,
      links: includedLinks,
      neighbors: includedNeighbors,
      groups: groupNames.map((name, index) => ({ name, color: PALETTE[index % PALETTE.length] })),
    };
  }, [
    state,
    visibleKey,
    showFacets,
    showTags,
    groupBy,
    layoutRevision,
    ignoreSavedLayout,
    libraryIdentity,
  ]);
  useEffect(() => {
    persistedPositionsRef.current = state.graphLayout || {};
  }, [state.graphLayout]);

  const graphData = useMemo(() => {
    if (depth === 'all' || !focusId || !fullGraph.neighbors.has(focusId)) return fullGraph;
    const included = new Set([focusId]);
    for (let level = 0; level < Number(depth); level++)
      for (const id of [...included])
        for (const neighbor of fullGraph.neighbors.get(id) || []) included.add(neighbor);
    return {
      nodes: fullGraph.nodes.filter((node) => included.has(node.id)),
      links: fullGraph.links.filter(
        (link) => included.has(endpointId(link.source)) && included.has(endpointId(link.target)),
      ),
    };
  }, [fullGraph, depth, focusId]);
  const topologyKey = useMemo(
    () =>
      `${fullGraph.nodes
        .map((node) => node.id)
        .sort()
        .join('\u0000')}|${fullGraph.links
        .map((link) => link.id)
        .sort()
        .join('\u0000')}`,
    [fullGraph],
  );
  const focusNode = fullGraph.nodes.find((node) => node.id === focusId);
  const emphasized = hoverId || focusId;
  const emphasizedIds = useMemo(
    () => new Set(emphasized ? [emphasized, ...(fullGraph.neighbors.get(emphasized) || [])] : []),
    [emphasized, fullGraph],
  );
  const searchResults = query.trim()
    ? fullGraph.nodes
        .filter((node) =>
          `${node.title} ${node.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, 7)
    : [];
  const importantIds = useMemo(
    () =>
      new Set(
        fullGraph.nodes
          .filter((node) => node.kind !== 'document' && node.degree >= 2)
          .sort((a, b) => b.degree - a.degree)
          .slice(0, 8)
          .map((node) => node.id),
      ),
    [fullGraph],
  );
  const visualStateRef = useRef({ emphasized, emphasizedIds, importantIds });
  visualStateRef.current = { emphasized, emphasizedIds, importantIds };

  useEffect(() => {
    if (hoverId && !fullGraph.neighbors.has(hoverId)) setHoverId(undefined);
    if (focusId && !fullGraph.neighbors.has(focusId)) {
      setFocusId(undefined);
      setDepth('all');
    }
  }, [fullGraph, focusId, hoverId]);

  const recordPositions = useCallback(() => {
    positionsGroupRef.current = groupBy;
    for (const node of graphData.nodes)
      if (finitePosition(node)) positionsRef.current[node.id] = { x: node.x, y: node.y, z: node.z };
  }, [graphData, groupBy]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !webgl || !graphData.nodes.length) return;
    const clusterForce = (alpha: number) => {
      for (const node of graphData.nodes) {
        if (!finitePosition(node)) continue;
        node.vx = (node.vx || 0) + (node.center.x - node.x) * alpha * 0.065;
        node.vy = (node.vy || 0) + (node.center.y - node.y) * alpha * 0.065;
        node.vz = (node.vz || 0) + (node.center.z - node.z) * alpha * 0.065;
      }
    };
    graph.d3Force('cluster', groupBy === 'connections' ? null : clusterForce);
    graph.d3Force('charge')?.strength?.(-65);
    graph.d3Force('link')?.distance?.((link: GalaxyLink) => (link.derived ? 34 : 58));
    graph.d3ReheatSimulation();
    const controls = graph.controls() as {
      enableDamping?: boolean;
      dampingFactor?: number;
      minDistance?: number;
      maxDistance?: number;
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 18;
    controls.maxDistance = 2200;
    const renderer = graph.renderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    const handleLoss = (event: Event) => {
      event.preventDefault();
      setWebgl(false);
    };
    const ownerDocument = canvas.ownerDocument;
    let activePointer:
      { id: number; type: string; x: number; y: number; updatedAt: number } | undefined;
    let normalizingPointer = false;
    const rememberPointer = (event: PointerEvent) => {
      if (event.isTrusted)
        activePointer = {
          id: event.pointerId,
          type: event.pointerType,
          x: event.clientX,
          y: event.clientY,
          updatedAt: performance.now(),
        };
    };
    const updatePointer = (event: PointerEvent) => {
      if (event.isTrusted && activePointer?.id === event.pointerId) rememberPointer(event);
    };
    const releasePointer = (event: PointerEvent) => {
      if (event.isTrusted && activePointer?.id === event.pointerId) activePointer = undefined;
    };
    const normalizePointerUp = (event: PointerEvent) => {
      if (event.isTrusted) {
        updatePointer(event);
        return;
      }
      if (
        normalizingPointer ||
        event.target !== ownerDocument ||
        event.bubbles ||
        event.pointerId !== 0 ||
        event.pointerType !== 'touch' ||
        !activePointer ||
        performance.now() - activePointer.updatedAt > 5000
      )
        return;
      // 3d-force-graph's dragend omits pointerId; Three 0.186 OrbitControls needs the real pointer to end its gesture.
      event.stopImmediatePropagation();
      normalizingPointer = true;
      try {
        ownerDocument.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: activePointer.id,
            pointerType: activePointer.type,
            clientX: activePointer.x,
            clientY: activePointer.y,
          }),
        );
      } finally {
        normalizingPointer = false;
      }
    };
    canvas.addEventListener('webglcontextlost', handleLoss);
    canvas.addEventListener('pointerdown', rememberPointer, true);
    canvas.addEventListener('pointermove', updatePointer, true);
    ownerDocument.addEventListener('pointerup', normalizePointerUp, true);
    ownerDocument.addEventListener('pointerup', releasePointer);
    ownerDocument.addEventListener('pointercancel', releasePointer);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLoss);
      canvas.removeEventListener('pointerdown', rememberPointer, true);
      canvas.removeEventListener('pointermove', updatePointer, true);
      ownerDocument.removeEventListener('pointerup', normalizePointerUp, true);
      ownerDocument.removeEventListener('pointerup', releasePointer);
      ownerDocument.removeEventListener('pointercancel', releasePointer);
    };
  }, [graphData, groupBy, webgl, retryKey]);

  // A focus change inside a local graph must not be followed by an automatic full-map zoom.
  useEffect(() => {
    if (!webgl || !fullGraph.nodes.length) return;
    fitTimerRef.current = window.setTimeout(() => graphRef.current?.zoomToFit(900, 70), 420);
    return () => window.clearTimeout(fitTimerRef.current);
  }, [topologyKey, groupBy, layoutRevision, depth, libraryIdentity, webgl, retryKey]);

  const updateNodeVisual = useCallback((visual: NodeVisual) => {
    const {
      emphasized: currentId,
      emphasizedIds: activeIds,
      importantIds: hubs,
    } = visualStateRef.current;
    const { node, core, halo, group } = visual;
    const active = activeIds.has(node.id);
    const faded = !!currentId && !active;
    const radius = (node.kind === 'document' ? 1.6 : 1.9) + Math.min(node.degree, 12) * 0.08;
    core.scale.setScalar(radius * (node.id === currentId ? 1.1 : 1));
    core.material.color.set(node.color);
    core.material.opacity = faded ? 0.24 : 1;
    halo.visible = node.id === currentId;
    halo.material.color.set(node.color);
    halo.scale.setScalar(radius * 1.9);
    const showLabel = node.id === currentId || (!currentId && hubs.has(node.id));
    if (showLabel) {
      const labelKey = `${node.title}:${node.id === currentId}`;
      if (!visual.label) {
        visual.label = new SpriteText();
        visual.label.fontFace = 'Microsoft YaHei, sans-serif';
        visual.label.backgroundColor = '#ffffff';
        visual.label.padding = [0.8, 1.5];
        visual.label.borderRadius = 1;
        group.add(visual.label);
      }
      if (visual.label.userData.labelKey !== labelKey) {
        visual.label.text = node.title.length > 22 ? `${node.title.slice(0, 22)}…` : node.title;
        visual.label.textHeight = node.id === currentId ? 4.3 : 3.9;
        visual.label.color = node.id === currentId ? '#3d354c' : '#625d6b';
        visual.label.userData.labelKey = labelKey;
      }
      visual.label.position.set(0, -(radius + 3.7), 0);
    } else if (visual.label) {
      group.remove(visual.label);
      visual.label.material.map?.dispose();
      visual.label.material.dispose();
      visual.label = undefined;
    }
  }, []);
  // Keep this accessor stable: changing it makes the graph library rebuild every WebGL node.
  const nodeObject = useCallback(
    (node: NodeObject<GalaxyNode>) => {
      const group = new Group();
      const core = new Mesh(
        new SphereGeometry(1, 12, 10),
        new MeshBasicMaterial({ color: node.color, transparent: true }),
      );
      const halo = new Mesh(
        new SphereGeometry(1, 12, 10),
        new MeshBasicMaterial({
          color: node.color,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
        }),
      );
      halo.renderOrder = -1;
      group.add(halo, core);
      const visual: NodeVisual = { group, core, halo, node };
      nodeVisualsRef.current.set(node.id, visual);
      updateNodeVisual(visual);
      return group;
    },
    [updateNodeVisual],
  );
  useEffect(() => {
    const visibleNodes = new Map(graphData.nodes.map((node) => [node.id, node]));
    for (const [id, visual] of nodeVisualsRef.current) {
      const node = visibleNodes.get(id);
      if (!node) nodeVisualsRef.current.delete(id);
      else {
        visual.node = node;
        updateNodeVisual(visual);
      }
    }
  }, [graphData, emphasized, emphasizedIds, importantIds, updateNodeVisual]);

  const focusOn = useCallback(
    (node: NodeObject<GalaxyNode>) => {
      window.clearTimeout(fitTimerRef.current);
      setFocusId(node.id);
      setHoverId(undefined);
      setQuery('');
      onSelect(node.id);
      if (!finitePosition(node)) return;
      const camera = graphRef.current?.camera().position;
      let delta = camera
        ? { x: camera.x - node.x, y: camera.y - node.y, z: camera.z - node.z }
        : { x: 0, y: 0, z: 1 };
      const length = Math.hypot(delta.x, delta.y, delta.z) || 1;
      delta = { x: delta.x / length, y: delta.y / length, z: delta.z / length };
      graphRef.current?.cameraPosition(
        { x: node.x + delta.x * 145, y: node.y + delta.y * 145, z: node.z + delta.z * 145 },
        { x: node.x, y: node.y, z: node.z },
        1000,
      );
    },
    [onSelect],
  );
  const resetLayout = () => {
    positionsRef.current = {};
    pinnedIdsRef.current.clear();
    setIgnoreSavedLayout(true);
    setLayoutRevision((value) => value + 1);
    setSavedMessage('已重新排列，可再次保存');
  };
  const saveLayout = async () => {
    recordPositions();
    const entityIds = new Set([
      ...state.documents.map((node) => node.id),
      ...state.knowledge.map((node) => node.id),
      ...state.tags.map((node) => node.id),
      ...state.facets.flatMap((facet) => facet.options.map((node) => node.id)),
    ]);
    const positions = Object.fromEntries(
      Object.entries({ ...(state.graphLayout || {}), ...positionsRef.current }).filter(
        ([id, position]) => entityIds.has(id) && finitePosition(position),
      ),
    );
    setSaving(true);
    try {
      const result = onSaveLayout?.(positions);
      if (result) {
        if ((await result) === false) {
          setSavedMessage('布局未保存，请重试');
          return;
        }
        setIgnoreSavedLayout(false);
        setSavedMessage('布局已保存');
      } else setSavedMessage('布局保存请求已提交');
    } catch {
      setSavedMessage('布局未保存，请重试');
    } finally {
      setSaving(false);
    }
  };
  const retry = () => {
    setWebgl(checkWebGL());
    setRetryKey((value) => value + 1);
  };
  const grouped = groupBy !== 'connections';
  const linkedCount = focusId ? fullGraph.neighbors.get(focusId)?.size || 0 : 0;
  const emptyFiltered =
    !!visibleDocumentIds && state.documents.some((documentItem) => !documentItem.trashed);

  return (
    <section className="galaxy-view" aria-label="3D 知识星系">
      <div className="galaxy-toolbar">
        <div className="galaxy-search">
          <Search size={14} />
          <input
            aria-label="搜索星系节点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && searchResults[0]) focusOn(searchResults[0]);
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="搜索节点"
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
          {query.trim() && (
            <div className="galaxy-search-results">
              {searchResults.length ? (
                searchResults.map((node) => (
                  <button type="button" key={node.id} onClick={() => focusOn(node)}>
                    <i style={{ background: node.color }} />
                    <span>
                      {node.title}
                      <small>{node.subtitle}</small>
                    </span>
                    <Focus size={14} />
                  </button>
                ))
              ) : (
                <p>没有找到相关节点</p>
              )}
            </div>
          )}
        </div>
        <select
          aria-label="星团分组方式"
          value={groupBy}
          onChange={(event) => {
            pinnedIdsRef.current.clear();
            setGroupBy(event.target.value);
            setSavedMessage('');
          }}
          title="分组只改变布局和颜色"
        >
          <option value="connections">自然布局</option>
          {state.facets
            .filter((facet) => facet.options.length)
            .map((facet) => (
              <option key={facet.id} value={`facet:${facet.id}`}>
                按{facet.name}
              </option>
            ))}
          <option value="tags">按标签</option>
        </select>
        <div className="galaxy-display-toggles">
          <label>
            <input
              type="checkbox"
              checked={showFacets}
              onChange={(event) => setShowFacets(event.target.checked)}
            />
            分类
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTags}
              onChange={(event) => setShowTags(event.target.checked)}
            />
            标签
          </label>
        </div>
        <div className="galaxy-toolbar-end">
          <button
            type="button"
            title="查看全图"
            onClick={() => {
              setDepth('all');
              setFocusId(undefined);
              setHoverId(undefined);
              graphRef.current?.zoomToFit(900, 70);
            }}
          >
            <Maximize2 size={14} />
            <span>全图</span>
          </button>
          <button type="button" title="重新布局" onClick={resetLayout}>
            <RotateCcw size={14} />
            <span>重排</span>
          </button>
          {onSaveLayout && (
            <button
              type="button"
              title="保存布局"
              onClick={() => void saveLayout()}
              disabled={!graphData.nodes.length || !webgl || saving}
            >
              <Save size={14} />
              <span>{saving ? '保存中…' : '保存布局'}</span>
            </button>
          )}
        </div>
      </div>
      <div className="galaxy-canvas" ref={canvasRef}>
        {!graphData.nodes.length ? (
          <div className="galaxy-empty">
            <Sparkles size={24} />
            <h3>{emptyFiltered ? '没有匹配的节点' : '暂无节点'}</h3>
            <p>{emptyFiltered ? '调整或清除筛选。' : '导入资料或添加知识节点。'}</p>
          </div>
        ) : !webgl ? (
          <div className="galaxy-empty">
            <Move3D size={24} />
            <h3>无法显示图谱</h3>
            <p>请开启硬件加速，并确认设备支持 WebGL 2。</p>
            <button type="button" onClick={retry}>
              重试
            </button>
          </div>
        ) : (
          <GraphBoundary key={retryKey} onRetry={retry} onFailure={() => setWebgl(false)}>
            <ForceGraph3D<GalaxyNode, GalaxyLink>
              ref={graphRef}
              graphData={graphData}
              width={size.width}
              height={size.height}
              controlType="orbit"
              numDimensions={3}
              backgroundColor="#ffffff"
              showNavInfo={false}
              nodeThreeObject={nodeObject}
              nodeLabel={(node) => `${safeText(node.title)} · ${safeText(node.subtitle)}`}
              nodeVal={(node) => (node.kind === 'document' ? 1.5 : 3)}
              linkLabel={(link) => safeText(link.name)}
              linkColor={(link) =>
                emphasized
                  ? endpointId(link.source) === emphasized || endpointId(link.target) === emphasized
                    ? '#8768c5'
                    : '#eae8ee'
                  : link.derived
                    ? '#cdd0d8'
                    : '#a2a8b6'
              }
              linkOpacity={0.76}
              linkWidth={(link) =>
                emphasized &&
                (endpointId(link.source) === emphasized || endpointId(link.target) === emphasized)
                  ? 0.65
                  : link.derived
                    ? 0.22
                    : 0.3
              }
              linkDirectionalParticles={(link) =>
                !link.derived &&
                (endpointId(link.source) === emphasized || endpointId(link.target) === emphasized)
                  ? 2
                  : 0
              }
              linkDirectionalParticleWidth={0.7}
              linkDirectionalParticleSpeed={0.003}
              linkDirectionalParticleColor={() => '#7c5cce'}
              d3AlphaDecay={0.035}
              d3VelocityDecay={0.32}
              cooldownTicks={180}
              onEngineTick={recordPositions}
              onEngineStop={recordPositions}
              onNodeClick={focusOn}
              onNodeHover={(node) => setHoverId(node?.id)}
              onBackgroundClick={() => {
                setFocusId(undefined);
                setDepth('all');
              }}
              onNodeDragEnd={(node) => {
                node.fx = node.x;
                node.fy = node.y;
                node.fz = node.z;
                pinnedIdsRef.current.add(node.id);
                recordPositions();
                setSavedMessage('星点已固定，保存可保留位置');
              }}
            />
          </GraphBoundary>
        )}
        {!!graphData.nodes.length && webgl && (
          <>
            <div className="galaxy-stats">
              <span>{graphData.nodes.length} 节点</span>
              <span>·</span>
              <span>{graphData.links.length} 关联</span>
            </div>
            {focusNode && (
              <div className="galaxy-focus-card">
                <div>
                  <i style={{ background: focusNode.color }} />
                  <small>
                    {focusNode.subtitle} · {linkedCount} 个关联
                  </small>
                  <button
                    type="button"
                    aria-label="取消星点聚焦"
                    onClick={() => {
                      setFocusId(undefined);
                      setDepth('all');
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <strong>{focusNode.title}</strong>
                <div className="galaxy-focus-actions">
                  <button
                    type="button"
                    title="聚焦节点"
                    aria-label="聚焦节点"
                    onClick={() => focusOn(focusNode)}
                  >
                    <Focus size={14} />
                  </button>
                  <select
                    aria-label="显示关联层数"
                    value={depth}
                    onChange={(event) => setDepth(event.target.value)}
                  >
                    <option value="all">全部节点</option>
                    <option value="1">一层关联</option>
                    <option value="2">两层关联</option>
                  </select>
                </div>
              </div>
            )}
            <div className="galaxy-legend">
              {grouped
                ? fullGraph.groups.slice(0, 8).map((group) => (
                    <span key={group.name}>
                      <i style={{ background: group.color }} />
                      {group.name}
                    </span>
                  ))
                : Object.entries(KIND_COLORS)
                    .filter(([kind]) => graphData.nodes.some((node) => node.kind === kind))
                    .map(([kind, color]) => (
                      <span key={kind}>
                        <i style={{ background: color }} />
                        {KIND_LABELS[kind as GalaxyNode['kind']]}
                      </span>
                    ))}
              {grouped && fullGraph.groups.length > 8 && (
                <span>+{fullGraph.groups.length - 8} 组</span>
              )}
            </div>
          </>
        )}
        {savedMessage && (
          <div className="galaxy-toast" role="status">
            {savedMessage}
          </div>
        )}
      </div>
    </section>
  );
}
