/**
 * 工具（MCP）选择器：内置服务 + 平台/个人服务，工具类可再收窄到具体实例。
 *
 * 对齐 Web McpGrantPicker 的两段式交互：选服务 → 若该服务有 ``required_param``
 * （cdp-bridge 要浏览器、邮箱要账户、设备控制要设备）接着勾它支持的实例 → 确认。
 * 已选项以卡片列出，工具类可重开实例勾选调整。
 *
 * 组件不做网络请求：候选由父层注入（``authorization/options`` 的结果）。
 * 产出 ``PickerGrant[]``（``service`` 行 + ``param`` 行），提交时经
 * ``grantDraftToPayload`` 合成 ``{service_id, param_key, param_values}``。
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Icons } from '@/components/Icons';
import { useTheme } from '@/theme';
import type { PickerGrant, PickerResource } from '@/features/task/taskCreateModel';

const SERVICE_KEY = 'service';

const SOURCE_LABEL: Record<string, string> = {
  builtin: '内置',
  admin: '平台',
  upstream: '个人',
};

/** param 类型目录项（服务端 param_kind_catalog 派生：key=required_param，resource_type=实例类型）。 */
export interface PickerParamKind {
  key: string;
  label: string;
  resource_type: string;
}

/**
 * 某 param 类型下的可选实例（对齐 Web ``instanceCandidates``）。
 *
 * 实例有两处来源：直接就是 ``builtin_resource`` 的资源，以及服务条目 ``children``
 * 里 ``child_kind`` 匹配的子项。按 ``resource_type``（不是 required_param）匹配 ——
 * ``builtin_resource`` 自己带的是 ``cdp_client`` 这类类型，与 param key 不同名。
 */
function instanceCandidates(
  resources: PickerResource[],
  kind: PickerParamKind | undefined,
): { id: string; name: string }[] {
  if (!kind) return [];
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const r of resources) {
    if (r.resource_kind === 'builtin_resource' && r.resource_type === kind.resource_type) {
      const id = String(r.resource_id);
      if (!seen.has(id)) { seen.add(id); out.push({ id, name: r.name }); }
      continue;
    }
    for (const child of r.children || []) {
      if (child.child_kind === kind.resource_type && !seen.has(String(child.child_id))) {
        seen.add(String(child.child_id));
        out.push({ id: String(child.child_id), name: child.name });
      }
    }
  }
  return out;
}

export function McpGrantPicker({
  grants,
  onChange,
  resources,
  paramKinds,
  disabled,
}: {
  grants: PickerGrant[];
  onChange: (grants: PickerGrant[]) => void;
  resources: PickerResource[];
  paramKinds: PickerParamKind[];
  disabled?: boolean;
}) {
  const t = useTheme();
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [instancePickerFor, setInstancePickerFor] = useState<PickerResource | null>(null);

  const services = useMemo(
    () => resources.filter((r) => r.resource_kind === 'service' && !r.stdio),
    [resources],
  );
  const serviceById = useMemo(() => {
    const map = new Map<string, PickerResource>();
    for (const s of services) map.set(String(s.resource_id), s);
    return map;
  }, [services]);
  const paramKindByKey = useMemo(() => {
    const map = new Map<string, PickerParamKind>();
    for (const kind of paramKinds) map.set(kind.key, kind);
    return map;
  }, [paramKinds]);

  /** 已选服务行（grant_key=service）。 */
  const pickedServices = grants.filter((g) => g.grant_key === SERVICE_KEY);

  const addService = (service: PickerResource) => {
    setServicePickerOpen(false);
    onChange([...grants, { grant_key: SERVICE_KEY, grant_value: String(service.resource_id) }]);
    // 工具类服务：立刻接着选实例（不选 = 默认全量，但引导用户明确选择）。
    if (service.required_param) setInstancePickerFor(service);
  };

  /** 移除服务：连同它名下的实例行一起清掉（实例从属于服务）。 */
  const removeService = (serviceId: string) => {
    const paramKey = serviceById.get(serviceId)?.required_param || '';
    onChange(grants.filter((g) => {
      if (g.grant_key === SERVICE_KEY && g.grant_value === serviceId) return false;
      if (paramKey && g.grant_key === paramKey) return false;
      return true;
    }));
  };

  const toggleInstance = (paramKey: string, instanceId: string) => {
    const exists = grants.some((g) => g.grant_key === paramKey && g.grant_value === instanceId);
    onChange(exists
      ? grants.filter((g) => !(g.grant_key === paramKey && g.grant_value === instanceId))
      : [...grants, { grant_key: paramKey, grant_value: instanceId }]);
  };

  return (
    <View style={{ gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: t.tx3, letterSpacing: 0.3 }}>
          本次任务挂载的工具
        </Text>
        <Pressable
          disabled={disabled}
          onPress={() => setServicePickerOpen(true)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, height: 30, borderRadius: 10, backgroundColor: t.acGhost }, (pressed || disabled) && { opacity: 0.6 }]}
        >
          <Icons.plus size={13} color={t.acTx} sw={2.4} />
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.acTx }}>添加服务</Text>
        </Pressable>
      </View>

      {pickedServices.length === 0 ? (
        <Text style={{ fontSize: 11.5, color: t.tx3, lineHeight: 16 }}>
          未挂载。内置服务（浏览器控制 / 邮箱 / 设备控制）与团队授权的 MCP 都在这里添加。
        </Text>
      ) : (
        pickedServices.map((grant) => {
          const service = serviceById.get(grant.grant_value);
          const paramKey = service?.required_param || '';
          const kind = paramKindByKey.get(paramKey);
          const chosen = paramKey ? grants.filter((g) => g.grant_key === paramKey) : [];
          const candidates = instanceCandidates(resources, kind);
          return (
            <View key={`svc-${grant.grant_value}`} style={{ borderRadius: 13, borderWidth: 1, borderColor: t.line2, backgroundColor: t.bg3, padding: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icons.cube size={14} color={t.acTx} sw={1.9} />
                <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13.5, fontWeight: '700' }}>
                  {service?.name || `服务 #${grant.grant_value}`}
                </Text>
                {service?.source ? (
                  <Text style={{ fontSize: 10, color: t.tx3 }}>{SOURCE_LABEL[service.source] || service.source}</Text>
                ) : null}
                <Pressable onPress={() => removeService(grant.grant_value)} hitSlop={8} style={{ padding: 3 }}>
                  <Icons.trash size={14} color={t.tx3} sw={1.9} />
                </Pressable>
              </View>
              {paramKey ? (
                <Pressable
                  onPress={() => service && setInstancePickerFor(service)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={{ flex: 1, color: chosen.length ? t.acTx : t.tx3, fontSize: 11.5 }}>
                    {chosen.length ? `已选 ${chosen.length} 个实例` : `未指定实例（默认全部 ${candidates.length} 个）`}
                  </Text>
                  <Icons.edit size={12} color={t.tx3} sw={1.9} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      {/* 服务候选 */}
      <Modal visible={servicePickerOpen} transparent animationType="slide" onRequestClose={() => setServicePickerOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={() => setServicePickerOpen(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ flex: 1, color: t.tx, fontSize: 17, fontWeight: '800' }}>选择 MCP 服务</Text>
            <Pressable onPress={() => setServicePickerOpen(false)} hitSlop={8}><Icons.x size={19} color={t.tx2} sw={2.1} /></Pressable>
          </View>
          <FlatList
            data={services.filter((s) => !grants.some((g) => g.grant_key === SERVICE_KEY && g.grant_value === String(s.resource_id)))}
            keyExtractor={(item) => String(item.resource_id)}
            style={{ maxHeight: 420 }}
            ListEmptyComponent={<Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 26, fontSize: 13 }}>没有更多可添加的服务</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => addService(item)}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: t.bg3, marginBottom: 7 }, pressed && { opacity: 0.75 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: t.tx, fontSize: 14, fontWeight: '600' }}>{item.name}</Text>
                  <Text numberOfLines={1} style={{ color: t.tx3, fontSize: 11, marginTop: 2 }}>
                    {[SOURCE_LABEL[item.source || ''] || item.source, item.tool_count ? `${item.tool_count} 个工具` : '', item.required_param ? '需选实例' : '']
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Icons.chevron size={15} color={t.tx3} />
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* 实例候选（工具类服务的 required_param） */}
      <Modal visible={instancePickerFor !== null} transparent animationType="slide" onRequestClose={() => setInstancePickerFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.38)' }} onPress={() => setInstancePickerFor(null)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: t.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.tx, fontSize: 17, fontWeight: '800' }}>选择实例</Text>
              <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 3 }}>
                不选 = 使用该服务下的全部实例
              </Text>
            </View>
            <Pressable onPress={() => setInstancePickerFor(null)} hitSlop={8}><Icons.x size={19} color={t.tx2} sw={2.1} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingTop: 6, paddingBottom: 10 }}>
            {instancePickerFor ? (() => {
              const paramKey = instancePickerFor.required_param || '';
              const candidates = instanceCandidates(resources, paramKindByKey.get(paramKey));
              if (candidates.length === 0) {
                return <Text style={{ color: t.tx3, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>该服务下还没有可选的实例</Text>;
              }
              return candidates.map((instance) => {
                const on = grants.some((g) => g.grant_key === paramKey && g.grant_value === instance.id);
                return (
                  <Pressable
                    key={instance.id}
                    onPress={() => toggleInstance(paramKey, instance.id)}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 11, borderRadius: 12, backgroundColor: on ? t.acGhost : t.bg3, marginBottom: 6 }, pressed && { opacity: 0.75 }]}
                  >
                    <View style={{
                      width: 18, height: 18, borderRadius: 6, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center',
                      borderColor: on ? t.ac : t.line2, backgroundColor: on ? t.ac : 'transparent',
                    }}>
                      {on ? <Icons.check size={11} color={t.acInk} sw={3.2} /> : null}
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, color: t.tx, fontSize: 13 }}>{instance.name}</Text>
                  </Pressable>
                );
              });
            })() : null}
          </ScrollView>
          <Pressable
            onPress={() => setInstancePickerFor(null)}
            style={{ height: 46, borderRadius: 14, backgroundColor: t.ac, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: t.acInk, fontWeight: '800', fontSize: 14 }}>完成</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
