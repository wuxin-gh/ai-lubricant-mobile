import { IncrementalSseParser } from '../sse';

describe('IncrementalSseParser', () => {
  it('parses frames split across chunks', () => {
    const frames: string[] = [];
    const p = new IncrementalSseParser((f) => frames.push(f.data));
    p.push('data: {"type":"con');
    p.push('tent","text":"hi"}\n\n');
    expect(frames).toEqual(['{"type":"content","text":"hi"}']);
  });

  it('parses multiple CRLF frames and joins multiline data', () => {
    const frames: Array<{ data: string; event?: string; id?: string }> = [];
    const p = new IncrementalSseParser((f) => frames.push(f));
    p.push('event: message\r\nid: 7\r\ndata: first\r\ndata: second\r\n\r\ndata: last\r\n\r\n');
    expect(frames).toEqual([
      { event: 'message', id: '7', data: 'first\nsecond' },
      { data: 'last', event: undefined, id: undefined },
    ]);
  });

  it('flushes a final unterminated frame', () => {
    const frames: string[] = [];
    const p = new IncrementalSseParser((f) => frames.push(f.data));
    p.push('data: final');
    expect(frames).toEqual([]);
    p.finish();
    expect(frames).toEqual(['final']);
  });

  it('stops after DONE when consumer calls stop', () => {
    const frames: string[] = [];
    let p: IncrementalSseParser;
    p = new IncrementalSseParser((f) => {
      frames.push(f.data);
      if (f.data === '[DONE]') p.stop();
    });
    p.push('data: a\n\ndata: [DONE]\n\ndata: ignored\n\n');
    expect(frames).toEqual(['a', '[DONE]']);
  });
});
