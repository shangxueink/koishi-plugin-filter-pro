<template>
  <div class="expr-editor">
    <ExprNode :node="root" :path="[]" @update="(e) => updateNode(e.path, e.updates)" @remove="removeNode" />
    <div class="preview-section">
      <div class="preview-title">表达式预览</div>
      <code class="preview-code">{{ previewText || '（条件为空，此条规则视为无效/关闭）' }}</code>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import ExprNode from './expr-node.vue'

defineOptions({ name: 'ExprEditor' })

type GroupOperator = 'and' | 'or'
type CompareOperator = 'eq' | 'ne' | 'includes' | 'regex' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists'

type RuleExpr =
  | { type: 'group'; operator: GroupOperator; children: RuleExpr[] }
  | { type: 'not'; child: RuleExpr }
  | { type: 'compare'; field: string; operator: CompareOperator; value?: unknown }

interface TreeNode {
  id: string
  type: 'group' | 'compare'
  operator?: string
  field?: string
  value?: unknown
  children?: TreeNode[]
}

const props = defineProps<{ modelValue: RuleExpr }>()
const emit = defineEmits<(e: 'update:modelValue', value: RuleExpr) => void>()

let idCounter = 0
const newId = () => `node-${++idCounter}`

// 转换 RuleExpr 到 TreeNode
function toTree(expr: RuleExpr): TreeNode {
  if (expr.type === 'compare') {
    return {
      id: newId(),
      type: 'compare',
      field: expr.field,
      operator: expr.operator,
      value: expr.value
    }
  }
  if (expr.type === 'group') {
    return {
      id: newId(),
      type: 'group',
      operator: expr.operator,
      children: expr.children.map(toTree)
    }
  }
  return { id: newId(), type: 'compare', field: 'guildId', operator: 'eq', value: '' }
}

// 转换 TreeNode 到 RuleExpr
function fromTree(node: TreeNode): RuleExpr {
  if (node.type === 'compare') {
    return {
      type: 'compare',
      field: node.field || 'guildId',
      operator: (node.operator || 'eq') as CompareOperator,
      value: node.operator === 'exists' ? undefined : node.value
    }
  }
  if (node.type === 'group' && node.children) {
    return {
      type: 'group',
      operator: (node.operator || 'and') as GroupOperator,
      children: node.children.map(fromTree)
    }
  }
  return { type: 'compare', field: 'guildId', operator: 'eq', value: '' }
}

const root = ref<TreeNode>(toTree(props.modelValue))

watch(() => props.modelValue, (val) => {
  root.value = toTree(val)
}, { deep: true })

function updateNode(path: number[], updates: Partial<TreeNode>) {
  const node = getNodeByPath(root.value, path)
  if (node) Object.assign(node, updates)
  emitChange()
}

function removeNode(path: number[]) {
  if (path.length === 0) return
  const parentPath = path.slice(0, -1)
  const parent = getNodeByPath(root.value, parentPath) as TreeNode
  if (parent?.children) {
    parent.children.splice(path[path.length - 1], 1)
    emitChange()
  }
}

function getNodeByPath(node: TreeNode, path: number[]): TreeNode | null {
  if (path.length === 0) return node
  if (!node.children) return null
  const child = node.children[path[0]]
  return child ? getNodeByPath(child, path.slice(1)) : null
}

function emitChange() {
  emit('update:modelValue', fromTree(root.value))
}

// 预览
function buildPreview(expr: RuleExpr): string {
  if (expr.type === 'compare') {
    const val = expr.value === undefined ? '' : JSON.stringify(expr.value)
    return `(${expr.field} ${expr.operator} ${val})`
  }
  if (expr.type === 'group') {
    const sep = expr.operator === 'and' ? ' AND ' : ' OR '
    const inner = expr.children.map(buildPreview).join(sep)
    return expr.children.length > 1 ? `(${inner})` : inner
  }
  return ''
}

const previewText = computed(() => buildPreview(fromTree(root.value)))
</script>

<style scoped>
.expr-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-section {
  border-top: 1px solid var(--k-card-border, rgba(127, 127, 127, 0.2));
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--k-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.preview-code {
  display: block;
  font-family: 'Consolas', 'Monaco', 'Fira Code', monospace;
  font-size: 13px;
  background: color-mix(in srgb, #000 35%, transparent);
  padding: 10px 14px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--k-text-normal, inherit);
  line-height: 1.6;
}
</style>
