// 본문 편집기 (ProseMirror). 쓰는 동안 말풍선이 바로 보이고, 저장은 표시가 붙은 글로 한다.
import { Schema, Fragment, Slice } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection, NodeSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, splitBlockAs, setBlockType, chainCommands, exitCode } from 'prosemirror-commands';
import { wrapInList, splitListItem, liftListItem } from 'prosemirror-schema-list';
import {
  tableNodes, tableEditing, goToNextCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn,
  deleteTable, isInTable, fixTables, TableMap, findTable,
} from 'prosemirror-tables';
import { blocks, joinBlocks, isSceneBreak } from './text.js';
import { normalizeYoutube, renderYoutube, serializeYoutube, editYoutubeScreen } from './youtube.js';

const tNodes = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {} });

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block', content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    bubble: {
      group: 'block', content: 'inline*', defining: true,
      attrs: { side: { default: 'other' } },
      parseDOM: [{ tag: 'div.bubble', getAttrs: (el) => ({ side: el.classList.contains('me') ? 'me' : 'other' }) }],
      toDOM: (n) => ['div', { class: 'bubble ' + n.attrs.side }, 0],
    },
    youtube: {
      group: 'block', atom: true, draggable: true, isolating: true,
      attrs: { data: { default: null } },
      parseDOM: [{ tag: 'section.youtube-screen[data-youtube]', getAttrs: (el) => {
        try { const d = JSON.parse(el.dataset.youtube); return d?.version === 1 ? { data: normalizeYoutube(d) } : false; } catch { return false; }
      } }],
      toDOM: (n) => {
        const host = document.createElement('div'); host.innerHTML = renderYoutube(n.attrs.data);
        return host.firstElementChild;
      },
    },
    bullet_list: {
      group: 'block', content: 'list_item+',
      parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0],
    },
    ordered_list: {
      group: 'block', content: 'list_item+',
      parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0],
    },
    list_item: {
      content: 'paragraph', defining: true,
      parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0],
    },
    table: { ...tNodes.table, toDOM: () => ['div', { class: 'table-wrap' }, ['table', ['tbody', 0]]] },
    table_row: tNodes.table_row,
    table_cell: tNodes.table_cell,
    table_header: tNodes.table_header,
    text: { group: 'inline' },
    hard_break: {
      inline: true, group: 'inline', selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {},
});

function inlineFrom(lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (i) out.push(schema.nodes.hard_break.create());
    if (line) out.push(schema.text(line));
  });
  return out;
}

const para = (t) => schema.nodes.paragraph.create(null, t ? [schema.text(t)] : []);

function nodeFromBlock(b) {
  const N = schema.nodes;
  if (b.youtube) return N.youtube.create({ data: b.youtube });
  if (b.list) {
    const items = b.items.filter((t) => t.trim());
    return N[b.list === 'ordered' ? 'ordered_list' : 'bullet_list'].create(null,
      (items.length ? items : ['']).map((t) => N.list_item.create(null, para(t))));
  }
  if (b.table) {
    return N.table.create(null, b.table.map((row, ri) => N.table_row.create(null,
      row.map((c) => (ri === 0 ? N.table_header : N.table_cell).create(null, para(c))))));
  }
  return b.bubble
    ? N.bubble.create({ side: b.bubble }, inlineFrom(b.lines))
    : N.paragraph.create(null, inlineFrom(b.lines));
}

export function docFromText(text) {
  const list = blocks(text).map(nodeFromBlock);
  if (!list.length || list[list.length - 1].type !== schema.nodes.paragraph) list.push(schema.nodes.paragraph.create());
  return schema.nodes.doc.create(null, list);
}

function linesOf(node) {
  const lines = [''];
  node.descendants((child) => {
    if (child.type === schema.nodes.hard_break) lines.push('');
    else if (child.isText) lines[lines.length - 1] += child.text;
    return true;
  });
  return lines;
}
const oneLine = (node) => linesOf(node).join(' ');

export function textFromDoc(doc) {
  const N = schema.nodes;
  const list = [];
  doc.forEach((node) => {
    if (node.type === N.youtube) list.push({ youtube: node.attrs.data });
    else if (node.type === N.bullet_list || node.type === N.ordered_list) {
      const items = [];
      node.forEach((li) => items.push(oneLine(li)));
      list.push({ list: node.type === N.ordered_list ? 'ordered' : 'bullet', items });
    } else if (node.type === N.table) {
      const rows = [];
      node.forEach((row) => { const r = []; row.forEach((cell) => r.push(oneLine(cell))); rows.push(r); });
      list.push({ table: rows });
    } else if (node.type === N.bubble) list.push({ bubble: node.attrs.side, lines: linesOf(node) });
    else list.push({ lines: linesOf(node) });
  });
  return joinBlocks(list);
}

// Enter: 말풍선 안에서는 같은 쪽 말풍선을 새로 만들고, 빈 말풍선에서 누르면 일반 문단으로 빠져나온다
const enter = (state, dispatch) => {
  if (state.selection.node?.type === schema.nodes.youtube) {
    const after = state.selection.to;
    if (dispatch) {
      let tr = state.tr;
      if (tr.doc.nodeAt(after)?.type !== schema.nodes.paragraph) tr = tr.insert(after, schema.nodes.paragraph.create());
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1))).scrollIntoView());
    }
    return true;
  }
  const { $from, empty } = state.selection;
  const node = $from.parent;
  const li = schema.nodes.list_item;
  if ($from.depth >= 2 && $from.node(-1).type === li) {
    if (empty && node.content.size === 0) return liftListItem(li)(state, dispatch);
    return splitListItem(li)(state, dispatch);
  }
  if (isInTable(state)) return goToNextCell(1)(state, dispatch) || true;
  if (node.type === schema.nodes.bubble && empty && node.content.size === 0) {
    return setBlockType(schema.nodes.paragraph)(state, dispatch);
  }
  return splitBlockAs((n) => (n.type === schema.nodes.bubble ? { type: schema.nodes.bubble, attrs: n.attrs } : { type: schema.nodes.paragraph }))(state, dispatch);
};
const hardBreak = chainCommands(exitCode, (state, dispatch) => {
  if (state.selection.node?.type === schema.nodes.youtube) return enter(state, dispatch);
  const $f = state.selection.$from;
  if (isInTable(state) || ($f.depth >= 2 && $f.node(-1).type === schema.nodes.list_item)) return true;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
  return true;
});

// * * * 문단은 장면 구분 모양으로, 비어 있으면 안내 문구
const decorations = new Plugin({
  props: {
    decorations(state) {
      const decos = [];
      state.doc.forEach((node, pos) => {
        if (node.type === schema.nodes.paragraph && isSceneBreak(node.textContent)) {
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'scene-break' }));
        }
      });
      return DecorationSet.create(state.doc, decos);
    },
    attributes(state) {
      const d = state.doc;
      return { class: 'pm' + (d.childCount === 1 && d.firstChild.content.size === 0 && d.firstChild.type === schema.nodes.paragraph ? ' is-empty' : '') };
    },
  },
});

// 목록 첫머리에서 Backspace → 일반 문단으로
function backspaceInList(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0) return false;
  if ($from.depth >= 2 && $from.node(-1).type === schema.nodes.list_item) return liftListItem(schema.nodes.list_item)(state, dispatch);
  return false;
}

// 붙여넣은 글도 같은 규칙(빈 줄 = 문단, << >> = 말풍선)으로 해석
function clipboardTextParser(text) {
  const doc = docFromText(text);
  return Slice.maxOpen(Fragment.from(doc.content));
}

export function createBodyEditor(mount, { onChange, onSelection, placeholder, onMessage }) {
  const plugins = [
    history(),
    keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, Enter: enter, 'Shift-Enter': hardBreak,
      Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1), Backspace: backspaceInList,
    }),
    keymap(baseKeymap),
    decorations,
    tableEditing(),
  ];
  let text = '';
  let destroyed = false;
  const sizeProblem = (data, old) => {
    const bytes = (t) => new TextEncoder().encode(t).length;
    return bytes(text) - (old ? bytes(serializeYoutube(old)) : 0) + bytes(serializeYoutube(data)) > 900000
      ? '이 원고의 사진 용량이 커요. 사진이나 댓글을 줄이거나 다른 회차에 나누어 넣어 주세요.' : '';
  };
  const youtubeNodeView = (initial, editor, getPos) => {
    let node = initial, alive = true;
    const dom = document.createElement('div');
    dom.className = 'yt-node'; dom.contentEditable = 'false';
    const draw = () => {
      dom.innerHTML = renderYoutube(node.attrs.data) + '<div class="yt-node-actions"><button type="button" class="small" data-yt-edit>내용 편집</button><button type="button" class="small ghost danger" data-yt-remove>화면 지우기</button></div>';
    };
    draw();
    dom.addEventListener('click', async (e) => {
      if (!editor.editable) return;
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-yt-edit')) {
        const original = node;
        const result = await editYoutubeScreen(node.attrs.data, { validate: (d) => sizeProblem(d, original.attrs.data) });
        if (!result || !alive || destroyed) return;
        const pos = getPos();
        if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos) !== original) return onMessage?.('편집 중 원고가 바뀌었어요. 화면을 다시 열어 수정해 주세요.');
        editor.dispatch(editor.state.tr.setNodeMarkup(pos, null, { data: result }).scrollIntoView()); editor.focus();
      } else if (b.hasAttribute('data-yt-remove')) {
        const pos = getPos(); if (typeof pos !== 'number') return;
        editor.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView()); editor.focus();
      }
    });
    return {
      dom,
      update(next) { if (next.type !== schema.nodes.youtube) return false; node = next; draw(); return true; },
      selectNode() { dom.classList.add('ProseMirror-selectednode'); },
      deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
      stopEvent(e) { return e.target instanceof Element && !!e.target.closest('button, summary'); },
      ignoreMutation() { return true; },
      destroy() { alive = false; },
    };
  };
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: docFromText(''), plugins }),
    clipboardTextParser,
    clipboardTextSerializer(slice) {
      let hasYoutube = false;
      slice.content.descendants((n) => { if (n.type === schema.nodes.youtube) hasYoutube = true; });
      return hasYoutube ? textFromDoc(slice.content) : slice.content.textBetween(0, slice.content.size, '\n\n', (n) => n.type === schema.nodes.hard_break ? '\n' : '');
    },
    nodeViews: { youtube: youtubeNodeView },
    attributes: { 'aria-label': '본문', 'data-placeholder': placeholder || '', spellcheck: 'false' },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged) { text = textFromDoc(next.doc); onChange && onChange(); }
      if (onSelection) onSelection();
    },
  });

  const api = {
    view,
    get value() { return text; },
    set value(t) {
      const doc = docFromText(t);
      const hadFocus = view.hasFocus();
      const pos = Math.min(view.state.selection.from, doc.content.size);
      let state = EditorState.create({ doc, plugins });
      { const fix = fixTables(state); if (fix) state = state.apply(fix); }
      try { state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.max(1, pos))))); } catch { /* 처음 위치 */ }
      view.updateState(state);
      text = textFromDoc(doc);
      if (hadFocus) view.focus();
      if (onSelection) onSelection();
    },
    set disabled(v) { view.setProps({ editable: () => !v }); },
    set hidden(v) { mount.hidden = v; },
    get hidden() { return mount.hidden; },
    focus() { view.focus(); },
    destroy() { destroyed = true; view.destroy(); },
    // 현재 위치의 종류: 'paragraph' | 'other' | 'me' | 'bullet' | 'ordered' | 'table'
    currentKind() {
      const st = view.state;
      if (st.selection.node?.type === schema.nodes.youtube) return 'youtube';
      if (isInTable(st)) return 'table';
      const $f = st.selection.$from;
      for (let d = $f.depth; d > 0; d--) {
        const t = $f.node(d).type;
        if (t === schema.nodes.bullet_list) return 'bullet';
        if (t === schema.nodes.ordered_list) return 'ordered';
      }
      const n = $f.parent;
      return n.type === schema.nodes.bubble ? n.attrs.side : 'paragraph';
    },
    async insertYoutube() {
      if (!view.editable || destroyed) return;
      const selected = view.state.selection.node?.type === schema.nodes.youtube ? view.state.selection.node : null;
      const pos = view.state.selection.from;
      const result = await editYoutubeScreen(selected?.attrs.data, { validate: (d) => sizeProblem(d, selected?.attrs.data) });
      if (!result || destroyed) return;
      if (selected) {
        if (view.state.doc.nodeAt(pos) !== selected) return onMessage?.('편집 중 원고가 바뀌었어요. 화면을 다시 열어 수정해 주세요.');
        view.dispatch(view.state.tr.setNodeMarkup(pos, null, { data: result }));
      } else {
        const N = schema.nodes, st = view.state, node = N.youtube.create({ data: result });
        const { $from } = st.selection;
        const empty = $from.depth === 1 && $from.parent.type === N.paragraph && $from.parent.content.size === 0;
        const at = empty ? $from.before(1) : $from.depth >= 1 ? $from.after(1) : st.selection.to;
        let tr = empty ? st.tr.replaceWith(at, $from.after(1), node) : st.tr.insert(at, node);
        const after = at + node.nodeSize;
        if (after >= tr.doc.content.size || tr.doc.nodeAt(after)?.type !== N.paragraph) tr = tr.insert(after, N.paragraph.create());
        tr = tr.setSelection(NodeSelection.create(tr.doc, at));
        view.dispatch(tr.scrollIntoView());
      }
      view.focus();
    },
    // 목록 켜기/끄기/바꾸기
    toggleList(kind) {
      const N = schema.nodes;
      const type = kind === 'ordered' ? N.ordered_list : N.bullet_list;
      const cur = api.currentKind();
      const st = view.state;
      if (cur === 'table') return;
      if (cur === kind) {
        liftListItem(N.list_item)(st, view.dispatch);
      } else if (cur === 'bullet' || cur === 'ordered') {
        const $f = st.selection.$from;
        for (let d = $f.depth; d > 0; d--) {
          const n = $f.node(d);
          if (n.type === N.bullet_list || n.type === N.ordered_list) {
            view.dispatch(st.tr.setNodeMarkup($f.before(d), type));
            break;
          }
        }
      } else {
        // 말풍선이면 먼저 일반 문단으로
        if (cur === 'other' || cur === 'me') setBlockType(N.paragraph)(st, view.dispatch);
        wrapInList(type)(view.state, view.dispatch);
      }
      view.focus();
    },
    // 표 넣기 (첫 줄은 제목줄)
    insertTable(rows, cols) {
      const N = schema.nodes;
      if (isInTable(view.state)) return;
      const table = N.table.create(null, Array.from({ length: rows }, (_, r) => N.table_row.create(null,
        Array.from({ length: cols }, () => (r === 0 ? N.table_header : N.table_cell).create(null, N.paragraph.create())))));
      const st = view.state;
      const { $from } = st.selection;
      const top = $from.depth >= 1 ? $from.after(1) : st.doc.content.size;
      const isEmptyPara = $from.depth === 1 && $from.parent.type === N.paragraph && $from.parent.content.size === 0;
      let tr = st.tr;
      let at;
      if (isEmptyPara) { tr = tr.replaceWith($from.before(1), $from.after(1), table); at = $from.before(1); }
      else { tr = tr.insert(top, table); at = top; }
      const after = at + table.nodeSize;
      if (after >= tr.doc.content.size || tr.doc.nodeAt(after)?.type !== N.paragraph) tr = tr.insert(after, N.paragraph.create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(at + 4)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    tableCommand(name) {
      const st = view.state;
      if (!isInTable(st)) return;
      const t = findTable(st.selection.$from);
      const map = t ? TableMap.get(t.node) : null;
      if (name === 'delCol' && map && map.width <= 2) return 'min-cols';
      if (name === 'delRow' && map && map.height <= 1) return 'min-rows';
      const cmd = { addRow: addRowAfter, addCol: addColumnAfter, delRow: deleteRow, delCol: deleteColumn, delTable: deleteTable }[name];
      if (cmd) cmd(st, view.dispatch);
      view.focus();
      return null;
    },
    // 말풍선 켜기/끄기 (같은 말풍선이면 일반 문단으로 되돌림)
    toggleBubble(side) {
      const cmd = api.currentKind() === side
        ? setBlockType(schema.nodes.paragraph)
        : setBlockType(schema.nodes.bubble, { side });
      cmd(view.state, view.dispatch);
      view.focus();
    },
  };
  return api;
}
