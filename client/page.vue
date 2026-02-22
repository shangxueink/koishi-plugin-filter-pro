<template>
  <k-layout>
    <div class="fp-layout">
      <div class="fp-header">
        <div>
          <h2>Filter Pro</h2>
          <p>持久化目录：<code>data/filterpro</code></p>
        </div>
        <div class="actions">
          <k-button @click="createRule">新建规则</k-button>
          <k-button @click="currentRule && saveRule(currentRule)" :disabled="!currentRule">保存</k-button>
          <k-button @click="currentRule && removeRule(currentRule.id)" :disabled="!currentRule">删除</k-button>
          <k-button @click="refresh">刷新</k-button>
        </div>
      </div>

      <div class="fp-main">
      <k-card class="panel list">
        <template #header>
          <div class="panel-title">规则列表</div>
        </template>

        <div class="rule-list">
          <button
            v-for="rule in sortedRules"
            :key="rule.id"
            class="rule-item"
            :class="{ active: selectedId === rule.id }"
            @click="selectedId = rule.id"
          >
            <div class="top">
              <span class="name">{{ rule.name || '未命名规则' }}</span>
              <span class="badge" :class="rule.action">{{ actionLabel[rule.action] }}</span>
            </div>
            <div class="meta">
              <span>#{{ rule.priority }}</span>
              <span>{{ rule.target.type === 'global' ? '全局' : rule.target.value || '未指定插件' }}</span>
              <span>{{ rule.enabled ? '启用' : '停用' }}</span>
            </div>
          </button>
        </div>
      </k-card>

      <k-card class="panel editor" v-if="currentRule">
        <template #header>
          <div class="panel-title">规则编辑</div>
        </template>

        <div class="editor-body">
          <div class="editor-grid">
            <label class="field">
              <span>规则名</span>
              <input class="input" v-model="currentRule.name" placeholder="输入规则名" />
            </label>

          <label class="field">
            <span>目标</span>
            <FpSelect v-model="currentRule.target.type" :options="targetTypeOptions" />
          </label>

          <label class="field" v-if="currentRule.target.type === 'plugin'">
            <span>插件实例</span>
            <FpSelect
              :model-value="currentRule.target.value ?? ''"
              :options="pluginTargetOptions"
              @update:model-value="currentRule.target.value = $event"
            />
          </label>

          <label class="field">
            <span>动作</span>
            <FpSelect v-model="currentRule.action" :options="actionOptions" />
          </label>

          <label class="field">
            <span>优先级</span>
            <input class="input" type="number" v-model.number="currentRule.priority" />
          </label>

          <label class="field switch">
            <span>启用状态</span>
            <input
              type="checkbox"
              :checked="currentRule.enabled"
              @change="onToggle(currentRule, $event)"
            />
          </label>
        </div>

        <label class="field" v-if="currentRule.action === 'block'">
          <span>拦截响应</span>
          <input class="input" v-model="currentRule.response" placeholder="可选，留空则静默拦截" />
        </label>

        <div class="expr-wrap">
          <div class="panel-title small">条件表达式</div>
          <ExprEditor v-model="currentRule.condition" />
        </div>

        <div class="footer-actions">
            <k-button @click="move(currentRule.id, -1)">上移</k-button>
            <k-button @click="move(currentRule.id, 1)">下移</k-button>
          </div>
        </div>
      </k-card>
    </div>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { send } from '@koishijs/client'
import FpSelect from './components/fp-select.vue'
import ExprEditor from './components/expr-editor.vue'

const request = send as any

type RuleAction = 'bypass' | 'block'
type GroupOperator = 'and' | 'or'
type CompareOperator =
  | 'eq'
  | 'ne'
  | 'includes'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
type TargetType = 'global' | 'plugin'

type RuleExpr =
  | { type: 'group'; operator: GroupOperator; children: RuleExpr[] }
  | { type: 'not'; child: RuleExpr }
  | {
      type: 'compare'
      field: string
      operator: CompareOperator
      value?: unknown
    }

interface RuleItem {
  id: string
  name: string
  enabled: boolean
  priority: number
  action: RuleAction
  target: {
    type: TargetType
    value?: string
  }
  condition: RuleExpr
  response?: string
}

interface PluginTargetOption {
  key: string
  name: string
  ident: string
  label: string
}

const actionLabel: Record<RuleAction, string> = {
  bypass: '放行',
  block: '拦截'
}

const targetTypeOptions = [
  { label: '全局', value: 'global' },
  { label: '插件', value: 'plugin' }
]

const actionOptions = [
  { label: '放行（bypass）', value: 'bypass' },
  { label: '拦截（block）', value: 'block' }
]

const pluginTargetOptions = computed(() => [
  { label: '请选择插件实例', value: '' },
  ...pluginTargets.value.map((item) => ({ label: item.label, value: item.key }))
])

const rules = ref<RuleItem[]>([])
const pluginTargets = ref<PluginTargetOption[]>([])
const selectedId = ref('')

const sortedRules = computed(() =>
  [...rules.value].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  )
)
const currentRule = computed(() =>
  sortedRules.value.find((item) => item.id === selectedId.value)
)

function defaultExpr(): RuleExpr {
  return {
    type: 'group',
    operator: 'and',
    children: [{ type: 'compare', field: 'guildId', operator: 'eq', value: '' }]
  }
}

async function refresh() {
  const [data, targets] = await Promise.all([
    request('filter-pro/list') as Promise<RuleItem[]>,
    request('filter-pro/targets') as Promise<PluginTargetOption[]>
  ])
  pluginTargets.value = targets
  rules.value = data
  if (
    !selectedId.value ||
    !rules.value.some((item) => item.id === selectedId.value)
  ) {
    selectedId.value = sortedRules.value[0]?.id || ''
  }
}

async function createRule() {
  await request('filter-pro/create', {
    name: 'new-rule',
    enabled: true,
    priority: (sortedRules.value.at(-1)?.priority ?? -1) + 1,
    action: 'block',
    target: { type: 'global', value: '' },
    condition: defaultExpr(),
    response: ''
  })
  await refresh()
  selectedId.value = sortedRules.value.at(-1)?.id || selectedId.value
}

async function onToggle(rule: RuleItem, event: Event) {
  const target = event.target as HTMLInputElement | null
  rule.enabled = !!target?.checked
  await request('filter-pro/toggle', { id: rule.id, enabled: rule.enabled })
}

async function saveRule(rule: RuleItem) {
  const target =
    rule.target.type === 'global'
      ? { type: 'global' as const, value: '' }
      : { type: 'plugin' as const, value: rule.target.value || '' }

  await request('filter-pro/update', {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    action: rule.action,
    target,
    condition: rule.condition,
    response: rule.response || ''
  })
  await refresh()
}

async function removeRule(id: string) {
  await request('filter-pro/delete', id)
  await refresh()
}

async function move(id: string, offset: number) {
  const list = sortedRules.value
  const index = list.findIndex((item) => item.id === id)
  if (index < 0) return
  const target = index + offset
  if (target < 0 || target >= list.length) return
  const reordered = [...list]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  await request(
    'filter-pro/reorder',
    reordered.map((item) => item.id)
  )
  await refresh()
}

void refresh()
</script>

<style scoped>
.fp-layout {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  color: var(--k-text-normal, inherit);
  box-sizing: border-box;
  overflow: hidden;
}

.fp-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.fp-header h2 {
  margin: 0;
  font-size: 20px;
}

.fp-header p {
  margin: 4px 0 0;
  color: var(--k-text-secondary, #888);
}

.actions {
  display: flex;
  gap: 8px;
}

.fp-main {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.list,
.editor {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list :deep(.k-card-body),
.editor :deep(.k-card-body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.panel {
  background: var(--k-card-bg, transparent);
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  border-radius: 10px;
}

.panel-title {
  font-weight: 600;
}

.panel-title.small {
  margin-bottom: 8px;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-body {
  display: flex;
  flex-direction: column;
}

.rule-item {
  width: 100%;
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  background: var(--k-input-bg, transparent);
  color: var(--k-text-normal, inherit);
  border-radius: 8px;
  padding: 8px;
  text-align: left;
  cursor: pointer;
}

.rule-item.active {
  border-color: var(--k-color-primary, #4f7cff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--k-color-primary, #4f7cff) 20%, transparent);
}

.rule-item .top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rule-item .name {
  font-weight: 600;
}

.rule-item .meta {
  margin-top: 4px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--k-text-secondary, #888);
  font-size: 12px;
}

.badge {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}

.badge.bypass {
  background: color-mix(in srgb, #1abc9c 20%, transparent);
}

.badge.block {
  background: color-mix(in srgb, #e74c3c 20%, transparent);
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.switch {
  justify-content: flex-end;
}

.input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: var(--k-text-normal, inherit);
  background: var(--k-input-bg, transparent);
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  padding: 6px 10px;
}

.expr-wrap {
  margin: 8px 0 12px;
}

.footer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 980px) {
  .fp-main {
    grid-template-columns: 1fr;
  }

  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
