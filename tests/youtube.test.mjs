import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultYoutube, normalizeYoutube, parseYoutube, serializeYoutube, renderYoutube, YOUTUBE_MARK } from '../src/youtube.js';
import { blocks, joinBlocks, normalizeText, plainText, renderParagraphs, countChars } from '../src/text.js';
import { docFromText, textFromDoc, schema } from '../src/editor.js';

const example = () => {
  const d = defaultYoutube();
  d.image = 'data:image/png;base64,aGVsbG8=';
  d.comments[0].text = '한글과 이모지 🩵\n둘째 줄\n\n빈 줄도 보존';
  d.comments[0].replies = [{ author: '@답글', avatar: d.image, time: '방금', text: '답글\n둘째 줄', likes: '2' }];
  return d;
};

test('영상·이미지·댓글·답글은 문단 사이에서 다시 저장해도 모두 남는다', () => {
  const d = example();
  const text = '앞 문단\n\n' + serializeYoutube(d) + '\n\n뒤 문단';
  assert.equal(blocks(text).length, 3);
  assert.deepEqual(blocks(text)[1].youtube, normalizeYoutube(d));
  assert.equal(joinBlocks(blocks(text)), text);
  assert.equal(normalizeText(text), text);
  assert.equal(textFromDoc(docFromText(text)), text);
  assert.equal(docFromText(text).child(1).type, schema.nodes.youtube);
  assert.equal(textFromDoc(docFromText(serializeYoutube(d))), serializeYoutube(d));
});

test('기존 문단·말풍선·목록·표는 기존 저장 규칙을 유지한다', () => {
  const text = '평범한 문단\n줄바꿈\n\n<< 상대 말\n\n>> 내 말\n\n* * *\n\n::목록\n첫 항목\n둘째 항목\n\n::번호\n하나\n둘\n\n::표\n제목 | 값\n행 | 내용';
  assert.equal(normalizeText(text), text);
  assert.equal(textFromDoc(docFromText(text)), text);
});

test('내보내기와 글자 수에 이미지의 base64와 구조용 JSON이 새지 않는다', () => {
  const d = example(); d.image = 'data:image/jpeg;base64,' + 'A'.repeat(160000);
  const text = serializeYoutube(d), plain = plainText(text);
  assert.match(plain, /한글과 이모지/); assert.match(plain, /@답글/);
  assert.doesNotMatch(plain, /base64|::유튜브|"version"/);
  assert.ok(countChars(text).withSpace < 1000);
});

test('잘못된 블록은 지우지 않고 일반 텍스트로 남긴다', () => {
  for (const text of [YOUTUBE_MARK + '{broken}', YOUTUBE_MARK + 'null', YOUTUBE_MARK + JSON.stringify({ version: 999 })]) {
    assert.equal(parseYoutube(text), null);
    assert.equal(textFromDoc(docFromText(text)), text);
  }
});

test('사용자 입력은 HTML로 실행되지 않고 이미지 주소도 검증한다', () => {
  const d = example(); d.title = '<script>window.bad=1</script>'; d.comments[0].text = '<img src=x onerror=alert(1)>';
  d.comments[0].avatar = 'javascript:alert(1)'; d.image = 'data:image/svg+xml;base64,PHN2Zz4=';
  const html = renderYoutube(d);
  assert.doesNotMatch(html, /<script>|<img src=x|javascript:|data:image\/svg/);
  assert.match(html, /&lt;img src=x/);
  assert.match(renderParagraphs(serializeYoutube(d)), /youtube-screen/);
});

test('HTML 클립보드의 블록 원본을 복원할 수 있다', () => {
  const d = example();
  const result = schema.nodes.youtube.spec.parseDOM[0].getAttrs({ dataset: { youtube: JSON.stringify(d) } });
  assert.deepEqual(result.data, normalizeYoutube(d));
  assert.equal(schema.nodes.youtube.spec.parseDOM[0].getAttrs({ dataset: { youtube: '{bad}' } }), false);
});

test('백업 JSON으로 왕복해도 이미지와 빈 줄이 보존된다', () => {
  const d = example(), text = serializeYoutube(d);
  const backup = JSON.parse(JSON.stringify({ app: 'manuscript-archive', version: 1, works: [{ chapters: [{ text }] }] }));
  assert.deepEqual(parseYoutube(backup.works[0].chapters[0].text), normalizeYoutube(d));
});
