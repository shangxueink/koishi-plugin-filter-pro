<template>
  <div class="expr-node" :class="{ 'is-group': node.type === 'group' }">
    <!-- 分组节点 -->
    <div v-if="node.type === 'group'" class="group-node">
      <div class="group-header">
        <button class="group-op-btn" @click="toggleGroupOp">
          {{ node.operator === 'and' ? '且（AND）' : '或（OR）' }}
        </button>
        <div class="group-actions">
          <button class="action-btn" @click="addChild('compare')" title="添加条件">+ 条件</button>
          <button class="action-btn" @click="addChild('group')" title="添加分组">+ 分组</button>
          <button v-if="path.length > 0" class="del-btn" @click="remove" title="删除分组">✕</button>
        </div>
      </div>
      <div class="group-children">
        <ExprNode
          v-for="(child, i) in node.children"
          :key="child.id"
          :node="child"
          :path="[...path, i]"
          @update="(e) => $emit('update', e)"
          @remove="(e) => $emit('remove', e)"
        />
      </div>
    </div>

    <!-- 比较节点 -->
    <div v-else class="compare-node">
      <FpSelect
        :model-value="node.field || 'guildId'"
        :options="fieldOptions"
        class="sel-field"
        @update:model-value="updateField"
      />
      <FpSelect
        :model-value="node.operator || 'eq'"
        :options="node.field === 'isDirect' ? boolOpOptions : opOptions"
        class="sel-op"
        @update:model-value="updateOp"
      />
      <input
        v-if="node.operator !== 'exists'"
        class="input val-input"
        :value="String(node.value ?? '')"
        @change="updateValue"
        placeholder="比较值"
      />
      <div class="node-actions">
        <button class="action-btn" @click="convertToGroup" title="转为分组">📦</button>
        <button class="del-btn" @click="remove" title="删除">✕</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import FpSelect from './fp-select.vue'

defineOptions({ name: 'ExprNode' })

interface TreeNode {
  id: string
  type: 'group' | 'compare'
  operator?: string
  field?: string
  value?: unknown
  children?: TreeNode[]
}

const props = defineProps<{
  node: TreeNode
  path: number[]
}>()

const emit = defineEmits<{
  update: [{ path: number[]; updates: Partial<TreeNode> }]
  remove: [number[]]
}>()

const fieldOptions = [
  { value: 'guildId', label: '群组ID' },
  { value: 'channelId', label: '频道ID' },
  { value: 'userId', label: '用户ID' },
  { value: 'platform', label: '平台' },
  { value: 'content', label: '消息内容' },
  { value: 'isDirect', label: '私聊' },
  { value: 'type', label: '消息类型' }
]

const opOptions = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'includes', label: '包含' },
  { value: 'regex', label: '正则' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '≤' },
  { value: 'exists', label: '存在' }
]

const boolOpOptions = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'exists', label: '存在' }
]

function toggleGroupOp() {
  emit('update', { path: props.path, updates: { operator: props.node.operator === 'and' ? 'or' : 'and' } })
}

function addChild(type: 'group' | 'compare') {
  const newChild: TreeNode = type === 'group'
    ? { id: `node-${Date.now()}`, type: 'group', operator: 'and', children: [] }
    : { id: `node-${Date.now()}`, type: 'compare', field: 'guildId', operator: 'eq', value: '' }

  const children = [...(props.node.children || []), newChild]
  emit('update', { path: props.path, updates: { children } })
}

function updateField(field: string) {
  emit('update', { path: props.path, updates: { field } })
}

function updateOp(operator: string) {
  emit('update', { path: props.path, updates: { operator } })
}

function updateValue(e: Event) {
  const value = (e.target as HTMLInputElement).value
  emit('update', { path: props.path, updates: { value } })
}

function convertToGroup() {
  const newNode: TreeNode = {
    id: `node-${Date.now()}`,
    type: 'group',
    operator: 'and',
    children: [{ ...props.node }]
  }
  emit('update', { path: props.path, updates: newNode })
}

function remove() {
  emit('remove', props.path)
}
</script>

<style scoped>
.expr-node {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-node {
  border: 2px solid var(--k-color-primary, #4f7cff);
  border-radius: 8px;
  padding: 12px;
  background: color-mix(in srgb, var(--k-color-primary, #4f7cff) 5%, transparent);
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}

.group-op-btn {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--k-color-primary, #4f7cff);
  background: var(--k-input-bg, transparent);
  color: var(--k-color-primary, #4f7cff);
  cursor: pointer;
}

.group-actions {
  display: flex;
  gap: 6px;
}

.group-children {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compare-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  background: var(--k-card-bg, transparent);
}

.sel-field { min-width: 120px; }
.sel-op { min-width: 90px; }

.val-input {
  flex: 1;
  min-width: 100px;
  color: var(--k-text-normal, inherit);
  background: var(--k-input-bg, transparent);
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
}

.node-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.action-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.35));
  border-radius: 4px;
  background: var(--k-input-bg, transparent);
  color: var(--k-text-normal, inherit);
  cursor: pointer;
}

.action-btn:hover {
  background: color-mix(in srgb, var(--k-color-primary, #4f7cff) 15%, transparent);
}

.del-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--k-text-secondary, #888);
  cursor: pointer;
  font-size: 14px;
}

.del-btn:hover {
  color: #e74c3c;
  background: color-mix(in srgb, #e74c3c 15%, transparent);
}
</style>
