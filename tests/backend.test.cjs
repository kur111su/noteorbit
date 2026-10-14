'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { Repository, createExample } = require('../electron/repository.cjs');

function removeGeneratedDirectory(directory, prefix) {
  const resolved = path.resolve(directory),
    temporaryRoot = fs.realpathSync(os.tmpdir());
  assert.equal(
    path.dirname(resolved).toLowerCase(),
    temporaryRoot.toLowerCase(),
    'Cleanup must stay directly inside the system temporary directory',
  );
  assert.ok(
    path.basename(resolved).startsWith(prefix),
    'Cleanup must target only the test-generated directory',
  );
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-galaxy-test-'));
  const repo = await Repository.open(path.join(base, 'library'));
  t.after(() => {
    try {
      repo.close();
    } catch {}
    removeGeneratedDirectory(base, 'knowledge-galaxy-test-');
  });
  return { base, repo };
}

test('batch tagging saves once, preserves existing tags and remains idempotent after reopening', async (t) => {
  const { repo } = await fixture(t);
  for (const title of ['甲卷', '乙卷', '丙卷'])
    await repo.command({ type: 'create-note', title, content: title });
  await repo.command({ type: 'add-tag', name: '已有标签', color: '#123456' });
  let state = await repo.command({ type: 'add-tag', name: '批量标签', color: '#abcdef' });
  const [existing, tag] = state.tags;
  const keys = state.documents.map((doc) => doc.id);
  await repo.command({ type: 'update-document', id: keys[0], patch: { tagIds: [existing.id] } });
  const persist = repo.persist.bind(repo);
  let saves = 0;
  repo.persist = () => {
    saves++;
    persist();
  };
  state = await repo.command({ type: 'tag-documents', ids: keys, tagId: tag.id });
  assert.equal(saves, 1);
  assert.deepEqual(state.documents[0].tagIds, [existing.id, tag.id]);
  assert(state.documents.every((doc) => doc.tagIds.includes(tag.id)));
  const repeated = await repo.command({ type: 'tag-documents', ids: keys, tagId: tag.id });
  assert.deepEqual(repeated.documents, state.documents);
  const reopened = await Repository.open(repo.root);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot().documents, state.documents);
  assert.equal(reopened.readDocument(keys[0]).text, '甲卷');
});

test('invalid selections and failed batch saves cannot leave partially tagged documents', async (t) => {
  const { repo } = await fixture(t);
  await repo.command({ type: 'create-note', title: '甲', content: 'a' });
  await repo.command({ type: 'create-note', title: '乙', content: 'b' });
  const state = await repo.command({ type: 'add-tag', name: '批次', color: '#123456' });
  const keys = state.documents.map((doc) => doc.id),
    tagId = state.tags[0].id;
  for (const command of [
    { type: 'tag-documents', ids: [], tagId },
    { type: 'tag-documents', ids: [keys[0], keys[0]], tagId },
    { type: 'tag-documents', ids: [keys[0], 'missing'], tagId },
    { type: 'tag-documents', ids: keys, tagId: 'missing' },
  ]) {
    await assert.rejects(repo.command(command));
    assert.deepEqual(repo.snapshot(), state);
  }
  const persist = repo.persist;
  repo.persist = () => {
    throw new Error('simulated disk failure');
  };
  await assert.rejects(repo.command({ type: 'tag-documents', ids: keys, tagId }), /disk failure/);
  repo.persist = persist;
  assert.deepEqual(repo.snapshot(), state);
  const trashed = await repo.command({ type: 'trash-document', id: keys[1] });
  await assert.rejects(repo.command({ type: 'tag-documents', ids: keys, tagId }), /回收站/);
  assert.deepEqual(repo.snapshot(), trashed);
});

test('partial facet updates preserve other values and null clears only its own field', async (t) => {
  const { repo } = await fixture(t);
  let state = await repo.command({ type: 'create-note', title: '属性合并', content: 'original' });
  const key = state.documents[0].id;
  await repo.command({ type: 'add-facet', name: '来源', fieldType: 'text' });
  state = await repo.command({ type: 'add-facet', name: '年份', fieldType: 'number' });
  const [source, year] = state.facets;
  await repo.command({
    type: 'update-document',
    id: key,
    patch: { values: { [source.id]: '学校甲' } },
  });
  state = await repo.command({
    type: 'update-document',
    id: key,
    patch: { values: { [year.id]: 2026 } },
  });
  assert.deepEqual(state.documents[0].values, { [source.id]: '学校甲', [year.id]: 2026 });
  state = await repo.command({
    type: 'update-document',
    id: key,
    patch: { values: { [source.id]: null } },
  });
  assert.deepEqual(state.documents[0].values, { [source.id]: null, [year.id]: 2026 });
  await assert.rejects(
    repo.command({ type: 'update-document', id: key, patch: { values: { [year.id]: NaN } } }),
  );
  assert.deepEqual(repo.snapshot().documents, state.documents);
});

test('SQLite persists custom facets, tags, document values and typed relations after reopening', async (t) => {
  const { base, repo } = await fixture(t);
  let state = await repo.command({
    type: 'create-note',
    title: '方程笔记',
    content: '# 解题步骤\n移项要变号。',
  });
  const doc = state.documents[0];
  assert.equal(doc.extension, 'md');
  assert.equal(repo.readDocument(doc.id).mime, 'text/markdown');
  assert.equal(
    Buffer.from(repo.readDocument(doc.id).base64, 'base64').toString('utf8'),
    repo.readDocument(doc.id).text,
  );
  state = await repo.command({ type: 'add-facet', name: '自定义专题', fieldType: 'multi' });
  state = await repo.command({
    type: 'add-option',
    facetId: state.facets[0].id,
    label: '期末复习',
  });
  state = await repo.command({ type: 'add-tag', name: '易错', color: '#aabbcc' });
  const facet = state.facets[0],
    tag = state.tags[0];
  await repo.command({
    type: 'update-document',
    id: doc.id,
    patch: { kind: '试卷', tagIds: [tag.id], values: { [facet.id]: [facet.options[0].id] } },
  });
  state = await repo.command({ type: 'add-knowledge', title: '一元一次方程', nodeType: '章节' });
  await repo.command({
    type: 'add-relation',
    source: doc.id,
    target: state.knowledge[0].id,
    typeId: state.relationTypes[0].id,
  });
  await repo.command({
    type: 'add-relation',
    source: tag.id,
    target: facet.options[0].id,
    typeId: state.relationTypes[0].id,
  });
  const before = repo.snapshot();
  const reopened = await Repository.open(path.join(base, 'library'));
  t.after(() => reopened.close());
  const after = reopened.snapshot();
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(after.facets, before.facets);
  assert.deepEqual(after.relations, before.relations);
  assert.match(reopened.readDocument(doc.id).text, /移项要变号/);
  assert.equal(
    fs
      .readFileSync(path.join(base, 'library', '.galaxy', 'catalog.sqlite'))
      .subarray(0, 15)
      .toString(),
    'SQLite format 3',
  );
});

test('renaming and moving preserve document IDs and relations; trash and restore preserve content', async (t) => {
  const { repo } = await fixture(t);
  let state = await repo.command({ type: 'create-note', title: '原笔记', content: '原始内容' });
  const key = state.documents[0].id;
  state = await repo.command({ type: 'add-knowledge', title: '章节', nodeType: '章节' });
  state = await repo.command({
    type: 'add-relation',
    source: key,
    target: state.knowledge[0].id,
    typeId: state.relationTypes[0].id,
  });
  const relationId = state.relations[0].id;
  state = await repo.command({ type: 'rename-document', id: key, fileName: '新名称.md' });
  state = await repo.command({ type: 'move-document', id: key, folder: '复习/下周' });
  assert.equal(state.documents[0].id, key);
  assert.equal(state.documents[0].path, '复习/下周/新名称.md');
  assert.equal(state.relations[0].id, relationId);
  state = await repo.command({ type: 'trash-document', id: key });
  assert.equal(state.documents[0].trashed, true);
  assert.throws(() => repo.readDocument(key), /恢复/);
  state = await repo.command({ type: 'restore-document', id: key });
  assert.equal(state.documents[0].path, '复习/下周/新名称.md');
  assert.equal(repo.readDocument(key).text, '原始内容');
  assert.equal(state.relations[0].id, relationId);
});

test('all facet value types and metadata update times survive reload and backup independently of file mtime', async (t) => {
  const { base, repo } = await fixture(t);
  const originalPath = path.join(repo.root, '历史资料.md');
  fs.writeFileSync(originalPath, '# 旧资料');
  const oldTime = new Date('2020-01-02T03:04:05.000Z');
  fs.utimesSync(originalPath, oldTime, oldTime);
  repo.scan();
  repo.persist();
  let state = repo.snapshot();
  const doc = state.documents[0];
  assert.equal(doc.updatedAt, oldTime.toISOString());
  const values = {};
  for (const fieldType of ['single', 'multi', 'tree', 'text', 'number', 'date']) {
    state = await repo.command({ type: 'add-facet', name: `自定义${fieldType}`, fieldType });
    let facet = state.facets.find((f) => f.name === `自定义${fieldType}`);
    if (['single', 'multi', 'tree'].includes(fieldType)) {
      state = await repo.command({ type: 'add-option', facetId: facet.id, label: '选项甲' });
      facet = state.facets.find((f) => f.id === facet.id);
      if (fieldType === 'tree') {
        state = await repo.command({
          type: 'add-option',
          facetId: facet.id,
          label: '子章节',
          parentId: facet.options[0].id,
        });
        facet = state.facets.find((f) => f.id === facet.id);
      }
      values[facet.id] =
        fieldType === 'single' ? facet.options[0].id : facet.options.map((o) => o.id);
    } else
      values[facet.id] =
        fieldType === 'number' ? 2026 : fieldType === 'date' ? '2026-10-13' : '来源学校';
  }
  state = await repo.command({
    type: 'update-document',
    id: doc.id,
    patch: { title: '显示标题', values },
  });
  const changed = state.documents.find((d) => d.id === doc.id);
  assert.deepEqual(changed.values, values);
  assert.equal(changed.path, '历史资料.md');
  assert.ok(Date.parse(changed.updatedAt) > oldTime.getTime());
  assert.equal(changed.fileModifiedAt, undefined);
  const dateFacet = state.facets.find((f) => f.type === 'date');
  await assert.rejects(
    repo.command({
      type: 'update-document',
      id: doc.id,
      patch: { values: { ...values, [dateFacet.id]: '2026-02-31' } },
    }),
    /有效/,
  );
  const reopened = await Repository.open(repo.root);
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.snapshot().documents.find((d) => d.id === doc.id),
    changed,
  );
  assert.equal(fs.statSync(originalPath).mtime.toISOString(), oldTime.toISOString());
  const archive = path.join(base, 'metadata.zip');
  await repo.backup(archive);
  const restored = await Repository.restoreBackup(archive, path.join(base, 'metadata-restored'));
  t.after(() => restored.close());
  assert.deepEqual(
    restored.snapshot().documents.find((d) => d.id === doc.id),
    changed,
  );
  assert.equal(
    fs.statSync(path.join(restored.root, '历史资料.md')).mtime.toISOString(),
    oldTime.toISOString(),
  );
  state = await repo.command({
    type: 'update-document',
    id: doc.id,
    patch: { values: Object.fromEntries(Object.keys(values).map((key) => [key, null])) },
  });
  assert.ok(
    Object.values(state.documents.find((d) => d.id === doc.id).values).every((v) => v === null),
  );
});

test('note titles stay readable while filenames are sanitized and duplicates receive safe suffixes', async (t) => {
  const { repo } = await fixture(t);
  await repo.command({ type: 'create-note', title: '专题/方程:复习', content: 'first' });
  const state = await repo.command({
    type: 'create-note',
    title: '专题/方程:复习',
    content: 'second',
  });
  assert.equal(state.documents.length, 2);
  assert.ok(state.documents.every((d) => d.title === '专题/方程:复习' && d.extension === 'md'));
  assert.deepEqual(state.documents.map((d) => d.path).sort(), [
    '笔记/专题_方程_复习 (1).md',
    '笔记/专题_方程_复习.md',
  ]);
  assert.deepEqual(state.documents.map((d) => repo.readDocument(d.id).text).sort(), [
    'first',
    'second',
  ]);
});

test('imports deduplicate by content and never overwrite same-name files', async (t) => {
  const { base, repo } = await fixture(t);
  const sources = path.join(base, 'sources');
  fs.mkdirSync(sources);
  const one = path.join(sources, '练习.txt');
  fs.writeFileSync(one, '相同内容');
  const otherFolder = path.join(sources, 'another');
  fs.mkdirSync(otherFolder);
  const two = path.join(otherFolder, '练习.txt');
  fs.writeFileSync(two, '不同内容');
  await repo.importFiles([one, one]);
  let state = await repo.importFiles([two]);
  assert.equal(state.documents.length, 2);
  assert.deepEqual(state.documents.map((d) => d.path).sort(), [
    '导入/练习 (1).txt',
    '导入/练习.txt',
  ]);
  assert.equal(fs.readFileSync(path.join(repo.root, '导入', '练习.txt'), 'utf8'), '相同内容');
  state = await repo.importFiles([one, two]);
  assert.equal(state.documents.length, 2);
});

test('rejects path traversal, executable extension changes and invalid entity/value references', async (t) => {
  const { repo } = await fixture(t);
  let state = await repo.command({ type: 'create-note', title: '安全测试', content: 'safe' });
  const key = state.documents[0].id;
  for (const folder of [
    '../escape',
    'C:/escape',
    '.galaxy',
    'folder/../../escape',
    '\\server\\share',
    'con',
  ]) {
    await assert.rejects(repo.command({ type: 'move-document', id: key, folder }), /路径|目录/);
  }
  await assert.rejects(
    repo.command({ type: 'rename-document', id: key, fileName: 'unsafe.exe' }),
    /文件类型/,
  );
  await assert.rejects(
    repo.command({
      type: 'add-relation',
      source: key,
      target: 'missing',
      typeId: state.relationTypes[0].id,
    }),
    /端点/,
  );
  await assert.rejects(
    repo.command({
      type: 'add-relation',
      source: key,
      target: key,
      typeId: state.relationTypes[0].id,
    }),
    /自身/,
  );
  await assert.rejects(
    repo.command({ type: 'update-document', id: key, patch: { tagIds: ['missing'] } }),
    /标签/,
  );
  await assert.rejects(
    repo.command({ type: 'update-document', id: key, patch: { values: { missing: 'value' } } }),
    /分类/,
  );
  await assert.rejects(
    repo.command({ type: 'save-layout', positions: { [key]: { x: Infinity, y: 0, z: 0 } } }),
    /坐标/,
  );
  await assert.rejects(repo.command({ type: 'unexpected-action' }), /不支持/);
  assert.equal(repo.readDocument(key).text, 'safe');
});

test('missing original files are marked without deleting metadata and relations', async (t) => {
  const { repo } = await fixture(t);
  let state = await repo.command({
    type: 'create-note',
    title: '丢失笔记',
    content: 'keep metadata',
  });
  const doc = state.documents[0];
  fs.unlinkSync(path.join(repo.root, doc.path));
  state = repo.snapshot();
  assert.equal(state.documents.length, 1);
  assert.equal(state.documents[0].missing, true);
  assert.throws(() => repo.readDocument(doc.id));
});

test('metadata and file changes roll back together when catalog persistence fails', async (t) => {
  const { base, repo } = await fixture(t);
  let state = await repo.command({
    type: 'create-note',
    title: '保留原内容',
    content: 'original content',
  });
  const key = state.documents[0].id,
    originalPath = path.join(repo.root, state.documents[0].path);
  const catalogPath = path.join(repo.root, '.galaxy', 'catalog.sqlite'),
    catalogBefore = fs.readFileSync(catalogPath);
  const before = repo.snapshot(),
    persist = repo.persist;
  repo.persist = () => {
    throw new Error('simulated disk failure');
  };
  const commands = [
    { type: 'add-tag', name: '不应保留', color: '#123456' },
    { type: 'create-note', title: '失败笔记', content: 'must be removed' },
    { type: 'save-note', id: key, content: 'must be rolled back' },
    { type: 'rename-document', id: key, fileName: '失败改名.md' },
    { type: 'move-document', id: key, folder: '失败移动' },
    { type: 'trash-document', id: key },
    { type: 'save-layout', positions: { [key]: { x: 1, y: 2, z: 3 } } },
  ];
  for (const command of commands) {
    await assert.rejects(repo.command(command), /simulated disk failure/);
    assert.deepEqual(repo.snapshot(), before);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'original content');
    assert.deepEqual(fs.readFileSync(catalogPath), catalogBefore);
  }
  assert.equal(fs.existsSync(path.join(repo.root, '笔记', '失败笔记.md')), false);
  const source = path.join(base, 'import.txt');
  fs.writeFileSync(source, 'import must roll back');
  await assert.rejects(repo.importFiles([source]), /simulated disk failure/);
  assert.deepEqual(repo.snapshot(), before);
  assert.equal(fs.existsSync(path.join(repo.root, '导入', 'import.txt')), false);
  repo.persist = persist;
  state = await repo.command({ type: 'trash-document', id: key });
  const trashed = repo.snapshot();
  repo.persist = () => {
    throw new Error('simulated disk failure');
  };
  await assert.rejects(
    repo.command({ type: 'restore-document', id: key }),
    /simulated disk failure/,
  );
  assert.deepEqual(repo.snapshot(), trashed);
  assert.equal(fs.existsSync(path.join(repo.root, state.documents[0].path)), true);
  repo.persist = persist;
});

test('backup and restore retain all documents, classifications, trash, relations and layout', async (t) => {
  const { base, repo } = await fixture(t);
  let state = await repo.command({ type: 'create-note', title: '资料甲', content: '甲的内容' });
  const first = state.documents[0].id;
  state = await repo.command({ type: 'create-note', title: '资料乙', content: '乙的内容' });
  const second = state.documents.find((d) => d.id !== first).id;
  await repo.command({ type: 'add-tag', name: '备份标签', color: '#112233' });
  await repo.command({
    type: 'add-relation',
    source: first,
    target: second,
    typeId: state.relationTypes[0].id,
  });
  await repo.command({ type: 'save-layout', positions: { [first]: { x: 15, y: -2, z: 30 } } });
  await repo.command({ type: 'trash-document', id: second });
  const archive = path.join(base, 'backup.zip');
  await repo.backup(archive);
  const restored = await Repository.restoreBackup(archive, path.join(base, 'restored'));
  t.after(() => restored.close());
  const original = repo.snapshot(),
    after = restored.snapshot();
  assert.deepEqual(after.documents, original.documents);
  assert.deepEqual(after.tags, original.tags);
  assert.deepEqual(after.relations, original.relations);
  assert.deepEqual(after.graphLayout, original.graphLayout);
  assert.equal(restored.readDocument(first).text, '甲的内容');
  await restored.command({ type: 'restore-document', id: second });
  assert.equal(restored.readDocument(second).text, '乙的内容');
  await assert.rejects(Repository.restoreBackup(archive, restored.root), /已存在/);
  await assert.rejects(repo.backup(archive), /已存在/);
});

test('restore rejects zip traversal and damaged payload before creating destination', async (t) => {
  const { base, repo } = await fixture(t);
  await repo.command({ type: 'create-note', title: '校验资料', content: 'original' });
  const good = path.join(base, 'good.zip');
  await repo.backup(good);
  const traversal = await JSZip.loadAsync(fs.readFileSync(good));
  traversal.file('../outside.txt', 'escape');
  const bad = path.join(base, 'traversal.zip');
  fs.writeFileSync(bad, await traversal.generateAsync({ type: 'nodebuffer' }));
  const dest = path.join(base, 'must-not-exist');
  await assert.rejects(Repository.restoreBackup(bad, dest), /不安全路径/);
  assert.equal(fs.existsSync(dest), false);
  const damaged = await JSZip.loadAsync(fs.readFileSync(good));
  const payload = Object.keys(damaged.files).find(
    (name) => name.startsWith('files/') && !damaged.files[name].dir,
  );
  damaged.file(payload, 'tampered');
  const damagedFile = path.join(base, 'damaged.zip');
  fs.writeFileSync(damagedFile, await damaged.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(Repository.restoreBackup(damagedFile, dest), /校验/);
  assert.equal(fs.existsSync(dest), false);
});

test('example library contains at least 20 real files and valid persisted relationships', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-galaxy-example-'));
  const repo = await createExample(path.join(base, '示例资料库'));
  t.after(() => {
    repo.close();
    removeGeneratedDirectory(base, 'knowledge-galaxy-example-');
  });
  const state = repo.snapshot();
  assert.equal(state.library.isExample, true);
  assert.ok(state.documents.length >= 20);
  assert.ok(state.relations.length >= 10);
  assert.ok(state.facets.length >= 3);
  assert.ok(state.documents.every((doc) => !doc.missing));
  assert.ok(state.documents.every((doc) => !doc.extension.startsWith('.')));
  const pdf = state.documents.find((d) => d.extension === 'pdf');
  assert.ok(pdf);
  const result = repo.readDocument(pdf.id);
  assert.equal(result.mime, 'application/pdf');
  assert.equal(result.text, undefined);
  assert.equal(Buffer.from(result.base64, 'base64').subarray(0, 8).toString(), '%PDF-1.4');
});
