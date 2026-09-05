import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { deleteUserTaskTerminal, listUserTaskTerminals, openUserTaskTerminal, type UserTaskTerminal } from '@/api/task';
import { base64DecodeToString, base64Encode } from '@/messages/base64';
import { EmptyView } from '@/components/ui';
import { Icons } from '@/components/Icons';
import { spacing, useTheme } from '@/theme';

export function TaskTerminalPanel({ taskId }: { taskId: string }) {
  const t = useTheme();
  const socketRef = useRef<WebSocket | null>(null);
  const [terminals, setTerminals] = useState<UserTaskTerminal[]>([]);
  const [terminalId, setTerminalId] = useState('mobile');
  const [connected, setConnected] = useState(false);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void listUserTaskTerminals(taskId).then(setTerminals).catch((e) => setError((e as Error)?.message || '终端列表加载失败'));
    return () => { socketRef.current?.close(); socketRef.current = null; };
  }, [taskId]);

  const connect = () => {
    if (!terminalId.trim()) return;
    socketRef.current?.close();
    setOutput('');
    setError('');
    const socket = openUserTaskTerminal(taskId, terminalId.trim());
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onmessage = (event: { data?: unknown }) => {
      if (typeof event.data !== 'string') return;
      try {
        const frame = JSON.parse(event.data) as { type?: string; data?: string };
        if (frame.type === 'data') setOutput((value) => value + base64DecodeToString(frame.data || ''));
        else if (frame.type === 'error') setError(frame.data || '终端连接失败');
        else if (frame.type === 'connected') setConnected(true);
      } catch {
        setOutput((value) => value + String(event.data));
      }
    };
    socket.onerror = () => setError('终端连接失败');
    socket.onclose = () => { setConnected(false); if (socketRef.current === socket) socketRef.current = null; };
  };

  const disconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  };

  const send = () => {
    const command = input;
    if (!command || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'data', data: base64Encode(`${command}\r`) }));
    setInput('');
  };

  const closeTerminal = () => {
    Alert.alert('关闭终端', '这会终止该终端及其前台进程。', [
      { text: '取消', style: 'cancel' },
      { text: '关闭', style: 'destructive', onPress: async () => {
        try {
          socketRef.current?.send(JSON.stringify({ type: 'close', data: '' }));
          await deleteUserTaskTerminal(taskId, terminalId);
          disconnect();
          setTerminals((rows) => rows.filter((row) => row.id !== terminalId));
        } catch (e) { setError((e as Error)?.message || '关闭终端失败'); }
      } },
    ]);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: spacing.pad, paddingTop: 12, paddingBottom: 16, gap: 9 }}>
      <Text style={{ color: t.tx3, fontSize: 11.5 }}>轻量终端仅提供文本命令输入，不解析完整 ANSI/xterm 控制序列。</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={terminalId} onChangeText={setTerminalId} editable={!connected} placeholder="terminal id" placeholderTextColor={t.tx3} autoCapitalize="none" style={{ flex: 1, backgroundColor: t.bg3, borderRadius: 12, paddingHorizontal: 12, color: t.tx, fontFamily: 'monospace' }} />
        <Pressable onPress={connected ? disconnect : connect} style={{ paddingHorizontal: 16, minHeight: 44, borderRadius: 12, backgroundColor: connected ? t.bg3 : t.ac, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: connected ? t.tx : t.acInk, fontWeight: '700' }}>{connected ? '断开' : '连接'}</Text></Pressable>
      </View>
      {terminals.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{terminals.map((row) => <Pressable key={row.id} onPress={() => !connected && setTerminalId(row.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: terminalId === row.id ? t.acGhost : t.bg3 }}><Text style={{ color: terminalId === row.id ? t.acTx : t.tx2, fontSize: 11.5 }}>{row.id}</Text></Pressable>)}</ScrollView> : null}
      <ScrollView style={{ flex: 1, backgroundColor: '#0b0d10', borderRadius: 14 }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={{ color: '#a7f3d0', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }}>{output || (connected ? '已连接，等待输出…' : '尚未连接')}</Text>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={send} editable={connected} placeholder="输入命令" placeholderTextColor={t.tx3} autoCapitalize="none" style={{ flex: 1, backgroundColor: t.bg3, borderRadius: 12, paddingHorizontal: 12, color: t.tx, fontFamily: 'monospace' }} />
        <Pressable disabled={!connected || !input} onPress={send} style={{ width: 48, minHeight: 44, borderRadius: 12, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center', opacity: connected && input ? 1 : 0.4 }}><Icons.arrowRight size={18} color={t.acInk} sw={2.3} /></Pressable>
        {connected ? <Pressable onPress={closeTerminal} style={{ width: 48, minHeight: 44, borderRadius: 12, backgroundColor: t.red, alignItems: 'center', justifyContent: 'center' }}><Icons.trash size={17} color="#fff" sw={2} /></Pressable> : null}
      </View>
      {error ? <Text style={{ color: t.red, fontSize: 12 }}>{error}</Text> : null}
      {!connected && !terminals.length && error ? <EmptyView icon="terminal" title="终端暂不可用" subtitle={error} /> : null}
    </View>
  );
}
