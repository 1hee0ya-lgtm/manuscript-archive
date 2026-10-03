// 본문 편집기 (ProseMirror). 쓰는 동안 말풍선이 바로 보이고, 저장은 표시가 붙은 글로 한다.
import { Schema, Fragment, Slice } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, splitBlockAs, setBlockType, chainCommands, exitCode } from 'prosemirror-commands';
import { blocks, joinBlocks, isSceneBreak } from './text.js';

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

export function docFromText(text) {
  const list = blocks(text).map((b) => (b.bubble
    ? schema.nodes.bubble.create({ side: b.bubble }, inlineFrom(b.lines))
    : schema.nodes.paragraph.create(null, inlineFrom(b.lines))));
  if (!list.length) list.push(schema.nodes.paragraph.create());
  return schema.nodes.doc.create(null, list);
}

function linesOf(node) {
  const lines = [''];
  node.forEach((child) => {
    if (child.type === schema.nodes.hard_break) lines.push('');
    else lines[lines.length - 1] += child.text || '';
  });
  return lines;
}

export function textFromDoc(doc) {
  const list = [];
  doc.forEach((node) => {
    list.push(node.type === schema.nodes.bubble ? { bubble: node.attrs.side, lines: linesOf(node) } : { lines: linesOf(node) });
  });
  return joinBlocks(list);
}

// Enter: 말풍선 안에서는 같은 쪽 말풍선을 새로 만들고, 빈 말풍선에서 누르면 일반 문단으로 빠져나온다
const enter = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const node = $from.parent;
  if (node.type === schema.nodes.bubble && empty && node.content.size === 0) {
    return setBlockType(schema.nodes.paragraph)(state, dispatch);
  }
  return splitBlockAs((n) => (n.type === schema.nodes.bubble ? { type: schema.nodes.bubble, attrs: n.attrs } : { type: schema.nodes.paragraph }))(state, dispatch);
};
const hardBreak = chainCommands(exitCode, (state, dispatch) => {
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

// 붙여넣은 글도 같은 규칙(빈 줄 = 문단, << >> = 말풍선)으로 해석
function clipboardTextParser(text) {
  const doc = docFromText(text);
  return Slice.maxOpen(Fragment.from(doc.content));
}

export function createBodyEditor(mount, { onChange, onSelection, placeholder }) {
  const plugins = [
    history(),
    keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, Enter: enter, 'Shift-Enter': hardBreak }),
    keymap(baseKeymap),
    decorations,
  ];
  let text = '';
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: docFromText(''), plugins }),
    clipboardTextParser,
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
    // 현재 문단의 종류: 'paragraph' | 'other' | 'me'
    currentKind() {
      const n = view.state.selection.$from.parent;
      return n.type === schema.nodes.bubble ? n.attrs.side : 'paragraph';
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
