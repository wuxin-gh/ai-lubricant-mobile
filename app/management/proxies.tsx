/**
 * 代理池：复用管理端全量 GET/PUT 接口，支持新增、编辑、二次确认删除。
 * 后端无单条端点，新增/编辑/删除均为「读当前列表 → 改 → 全量回写」；
 * 未变更条目必须原样带回 id（含 node 模式 node_id），否则后端重算 id 会让账号引用失效。
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { addAdminProxy, deleteAdminProxy, editAdminProxy, getAdminProxies, type ProxyEntry } from '@/api/management';
import { AdminScreen, AdminSheet, LabeledInput, SectionCard } from '@/components/admin-ui';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';

const MODE_LABEL: Record<string, string> = { network: '网络代理', url_prefix: '前缀转发', direct: '强制直连', node: '节点转发' };
type EditableMode = 'network' | 'url_prefix' | 'direct';

export default function ProxiesScreen() {
  const t = useTheme();
  const [rows, setRows] = useState<ProxyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 新增/编辑共用表单
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProxyEntry | null>(null); // null=新建
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<EditableMode>('network');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await getAdminProxies()); }
    catch (e) { setError((e as Error)?.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditTarget(null); setName(''); setUrl(''); setMode('network'); setUsername(''); setPassword('');
    setOpen(true);
  };
  const openEdit = (row: ProxyEntry) => {
    setEditTarget(row);
    setName(row.name); setUrl(row.url ?? ''); setMode((['network', 'url_prefix', 'direct'].includes(row.mode) ? row.mode : 'network') as EditableMode); setUsername(row.username ?? ''); setPassword(row.password ?? '');
    setOpen(true);
  };

  const submit = useCallback(async () => {
    if (!name.trim() || (mode !== 'direct' && !url.trim()) || saving) return;
    setSaving(true);
    try {
      const input = { name: name.trim(), mode, url: url.trim(), username: username.trim(), password };
      if (editTarget) await editAdminProxy(editTarget.id, input);
      else await addAdminProxy(input);
      setOpen(false);
      await load();
    } catch (e) { Alert.alert(editTarget ? '更新失败' : '新增失败', (e as Error)?.message || '请稍后重试'); }
    finally { setSaving(false); }
  }, [editTarget, load, mode, name, password, saving, url, username]);

  const remove = (row: ProxyEntry) => {
    Alert.alert('删除代理', `确定删除“${row.name}”？引用它的渠道账号可能失去代理。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteAdminProxy(row.id); setRows((old) => old.filter((x) => x.id !== row.id)); }
        catch (e) { Alert.alert('删除失败', (e as Error)?.message || '请稍后重试'); }
      } },
    ]);
  };

  return (
    <>
      <AdminScreen active="proxies" loading={loading} error={error} onRetry={load}>
        <Pressable onPress={openCreate} style={({ pressed }) => [{ height: 46, borderRadius: 15, backgroundColor: t.ac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, pressed && { opacity: 0.75 }]}>
          <Icons.plus size={17} color={t.acInk} sw={2.2} /><Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>新增代理</Text>
        </Pressable>
        <SectionCard title={`代理池 (${rows.length})`}>
          {rows.map((row, i) => (
            <View key={row.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: t.line }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.acGhost, alignItems: 'center', justifyContent: 'center' }}>
                <Icons.globe size={18} color={t.acTx} sw={1.9} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '700' }}>{row.name}</Text>
                <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>{MODE_LABEL[row.mode] || row.mode}{row.node_id ? ` · ${row.node_id.slice(0, 8)}` : ''}</Text>
                {row.url ? <Text numberOfLines={1} style={{ color: t.tx2, fontSize: 11, marginTop: 3, fontFamily: 'monospace' }}>{row.url}</Text> : null}
              </View>
              {row.mode !== 'node' ? <Pressable onPress={() => openEdit(row)} hitSlop={8} style={{ padding: 6 }}><Icons.edit size={16} color={t.tx2} sw={1.9} /></Pressable> : null}
              <Pressable onPress={() => remove(row)} hitSlop={8} style={{ padding: 6 }}><Icons.trash size={16} color={t.red} sw={1.9} /></Pressable>
            </View>
          ))}
          {!rows.length ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>暂无代理配置</Text> : null}
        </SectionCard>
      </AdminScreen>

      <AdminSheet visible={open} title={editTarget ? '编辑代理' : '新增代理'} onClose={() => setOpen(false)} submitLabel={saving ? '保存中…' : '保存'} submitting={saving} onSubmit={submit} submitDisabled={!name.trim() || (mode !== 'direct' && !url.trim())}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>模式</Text>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {(['network', 'url_prefix', 'direct'] as const).map((m) => <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, height: 36, borderRadius: 11, backgroundColor: mode === m ? t.ac : t.bg3, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 11, fontWeight: '700', color: mode === m ? t.acInk : t.tx2 }}>{MODE_LABEL[m]}</Text></Pressable>)}
          </View>
        </View>
        <LabeledInput label="名称" value={name} onChangeText={setName} placeholder="代理名称" />
        {mode !== 'direct' ? <LabeledInput label="URL" value={url} onChangeText={setUrl} placeholder={mode === 'network' ? 'http://host:port' : 'https://prefix.example.com'} keyboardType="url" /> : null}
        {mode !== 'direct' ? <>
          <LabeledInput label="用户名（可选）" value={username} onChangeText={setUsername} placeholder="留空表示无认证" />
          <LabeledInput label="密码（可选）" value={password} onChangeText={setPassword} placeholder="留空表示无认证" secureTextEntry />
        </> : null}
        {editTarget ? <Text style={{ color: t.amber, fontSize: 11.5 }}>编辑会以表单中的值覆盖原配置；未填的认证字段会清空，请按需填写。</Text> : null}
      </AdminSheet>
    </>
  );
}
