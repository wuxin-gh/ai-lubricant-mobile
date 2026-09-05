/**
 * 增量 SSE parser（RN fetch ReadableStream 与聊天/Agent 共用）。
 * 支持跨 chunk、CRLF、多 data: 行、流结尾无空行、[DONE]。
 */
export interface SseFrame {
  data: string;
  event?: string;
  id?: string;
}

export class IncrementalSseParser {
  private buffer = '';
  private stopped = false;

  constructor(private readonly onFrame: (frame: SseFrame) => void) {}

  push(chunk: string): void {
    if (this.stopped || !chunk) return;
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let sep = this.buffer.indexOf('\n\n');
    while (sep >= 0) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      this.emit(raw);
      if (this.stopped) { this.buffer = ''; return; }
      sep = this.buffer.indexOf('\n\n');
    }
  }

  finish(): void {
    if (!this.stopped && this.buffer.trim()) this.emit(this.buffer);
    this.buffer = '';
  }

  stop(): void {
    this.stopped = true;
    this.buffer = '';
  }

  private emit(raw: string): void {
    const data: string[] = [];
    let event: string | undefined;
    let id: string | undefined;
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id') id = value;
    }
    if (data.length) this.onFrame({ data: data.join('\n'), event, id });
  }
}
