import React from 'react';
import { Text, View } from 'react-native';
import type { UserTaskSummary } from '@/api/task';
import { Icons, providerIconForUrl } from '@/components/Icons';
import { ModelIcon } from '@/components/ModelIcon';
import { Card, Chip, StatusLine } from '@/components/ui';
import { modelDisplayName, taskDisplayName, taskTime } from '@/utils/format';
import { useTheme } from '@/theme';

/** 状态行：准备期优先显示节点上报的具体步骤（琥珀色，与详情页一致），
 *  派发失败显式点名；否则回落到 status 的四态映射。 */
function TaskStatusLine({ task }: { task: UserTaskSummary }) {
  const t = useTheme();
  const stage = task.runtime_stage;
  if (stage?.preparing) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
        <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: t.amber }} />
        <Text numberOfLines={1} style={{ color: t.amber, fontSize: 13, fontWeight: '600', flexShrink: 1 }}>
          {`准备中 · ${stage.label || '准备运行环境'}`}
        </Text>
      </View>
    );
  }
  if (task.workspace_state === 'dispatch_failed') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: t.red }} />
        <Text numberOfLines={1} style={{ color: t.red, fontSize: 13, fontWeight: '600' }}>派发失败</Text>
      </View>
    );
  }
  return <StatusLine status={task.status} />;
}

export function TaskCard({ task, onPress }: { task: UserTaskSummary; onPress?: () => void }) {
  const t = useTheme();
  const model = task.models?.[0] || task.model_id || '';
  const repo = task.repo_url;
  const RepoIcon = Icons[providerIconForUrl(task.repo_url || undefined)] ?? Icons.git;

  return (
    <Card onPress={onPress} style={{ paddingHorizontal: 19, paddingTop: 18, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TaskStatusLine task={task} />
        {taskTime(task) ? <Text style={{ color: t.tx3, fontSize: 12.5 }}>{taskTime(task)}</Text> : null}
      </View>

      <Text numberOfLines={2} style={{ marginTop: 11, fontSize: 17.5, fontWeight: '600', lineHeight: 23, letterSpacing: -0.3, color: t.tx }}>
        {taskDisplayName(task)}
      </Text>

      {repo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 }}>
          <RepoIcon size={13} color={t.tx3} sw={1.7} />
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.tx3, fontFamily: 'monospace', flexShrink: 1 }}>{repo}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {model ? (
          <Chip style={{ flexShrink: 1 }}>
            <ModelIcon model={model} size={14} />
            <Text numberOfLines={1} style={{ color: t.tx2, fontSize: 12, fontWeight: '500', flexShrink: 1 }}>{modelDisplayName({ model })}</Text>
          </Chip>
        ) : <View />}
        <Text style={{ fontFamily: 'monospace', fontSize: 12, color: t.tx3, flexShrink: 0 }}>{task.provider}</Text>
      </View>
    </Card>
  );
}
