import { type Awaitable, type Context, Random, Schema } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import { resolve, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const name = 'filter-pro'

export type RuleAction = 'bypass' | 'block'
export type GroupOperator = 'and' | 'or'
export type CompareOperator =
  | 'eq'
  | 'ne'
  | 'includes'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
export type TargetType = 'global' | 'plugin'

export interface RuleTarget {
  type: TargetType
  value?: string
}

export interface GroupExpr {
  type: 'group'
  operator: GroupOperator
  children: RuleExpr[]
}

export interface NotExpr {
  type: 'not'
  child: RuleExpr
}

export interface CompareExpr {
  type: 'compare'
  field: string
  operator: CompareOperator
  value?: unknown
}

export type RuleExpr = GroupExpr | NotExpr | CompareExpr

export interface RuleItem {
  id: string
  name: string
  enabled: boolean
  priority: number
  action: RuleAction
  target: RuleTarget
  condition: RuleExpr
  response?: string
}

export interface Config {
  filename?: string
  debug?: boolean
}

export const Config: Schema<Config> = Schema.object({
  filename: Schema.string()
    .default('rules.json')
    .description('持久化文件名（位于 data/filterpro/ 下）。'),
  debug: Schema.boolean().default(false).description('输出规则匹配调试日志。')
})

interface RuleInput {
  id?: string
  name?: string
  enabled?: boolean
  priority?: number
  action?: RuleAction
  target?: RuleTarget
  condition?: RuleExpr
  response?: string
}

interface RuleState {
  rules: RuleItem[]
}

type FilterFn = (session: any) => boolean

interface PluginTargetOption {
  key: string
  name: string
  ident: string
  label: string
}

const kRecord = Symbol.for('koishi.loader.record')

declare module '@koishijs/plugin-console' {
  namespace Console {
    interface Services {
      'filter-pro': FilterProProvider
    }

    interface Events {
      'filter-pro/list': () => Awaitable<RuleItem[]>
      'filter-pro/targets': () => Awaitable<PluginTargetOption[]>
      'filter-pro/create': (input: RuleInput) => Awaitable<RuleItem>
      'filter-pro/update': (input: RuleInput) => Awaitable<RuleItem | null>
      'filter-pro/delete': (id: string) => Awaitable<boolean>
      'filter-pro/reorder': (ids: string[]) => Awaitable<RuleItem[]>
      'filter-pro/toggle': (payload: {
        id: string
        enabled: boolean
      }) => Awaitable<RuleItem | null>
    }
  }
}

class FilterProProvider extends DataService<RuleItem[]> {
  constructor(
    ctx: Context,
    private state: RuleState
  ) {
    super(ctx, 'filter-pro')
  }

  async get() {
    return sortRules(this.state.rules).map(cloneRule)
  }
}

function defaultExpr(): RuleExpr {
  return {
    type: 'group',
    operator: 'and',
    children: [{ type: 'compare', field: 'guildId', operator: 'eq', value: '' }]
  }
}

function cloneRule(rule: RuleItem): RuleItem {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    action: rule.action,
    target: { ...rule.target },
    condition: cloneExpr(rule.condition),
    response: rule.response
  }
}

function cloneExpr(expr: RuleExpr): RuleExpr {
  if (expr.type === 'group') {
    return {
      type: 'group',
      operator: expr.operator,
      children: expr.children.map(cloneExpr)
    }
  }
  if (expr.type === 'not') {
    return { type: 'not', child: cloneExpr(expr.child) }
  }
  return {
    type: 'compare',
    field: expr.field,
    operator: expr.operator,
    value: expr.value
  }
}

function sortRules(rules: RuleItem[]) {
  return [...rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  )
}

function normalizeExpr(input: unknown): RuleExpr {
  if (!input || typeof input !== 'object') return defaultExpr()
  const data = input as Record<string, unknown>
  if (data.type === 'group') {
    const operator: GroupOperator = data.operator === 'or' ? 'or' : 'and'
    const children = Array.isArray(data.children)
      ? data.children.map(normalizeExpr)
      : []
    return { type: 'group', operator, children }
  }
  if (data.type === 'not') {
    return { type: 'not', child: normalizeExpr(data.child) }
  }
  const allowed: CompareOperator[] = [
    'eq',
    'ne',
    'includes',
    'regex',
    'gt',
    'gte',
    'lt',
    'lte',
    'exists'
  ]
  const operator = allowed.includes(data.operator as CompareOperator)
    ? (data.operator as CompareOperator)
    : 'eq'
  return {
    type: 'compare',
    field: typeof data.field === 'string' ? data.field : 'content',
    operator,
    value: data.value
  }
}

function normalizeRule(input: RuleInput): RuleItem {
  const rawTarget = input.target || { type: 'global' as const }
  const rawValue =
    typeof rawTarget.value === 'string' ? rawTarget.value.trim() : ''
  const normalizedValue = rawTarget.type === 'plugin' ? rawValue : ''
  const target: RuleTarget = {
    type: rawTarget.type === 'plugin' ? 'plugin' : 'global',
    value: normalizedValue
  }
  return {
    id: input.id || Random.id(8),
    name: input.name || 'new-rule',
    enabled: input.enabled ?? true,
    priority: input.priority ?? 0,
    action: input.action || 'block',
    target,
    condition: normalizeExpr(input.condition),
    response: input.response ?? ''
  }
}

function matchTarget(
  target: RuleTarget,
  vars: Record<string, unknown>
): boolean {
  if (!target || target.type === 'global') return true
  const pluginKey = typeof vars.pluginKey === 'string' ? vars.pluginKey : ''
  const value = target.value?.trim()
  if (!value) return false
  return pluginKey === value
}

function collectPluginTargets(ctx: Context): PluginTargetOption[] {
  const result: PluginTargetOption[] = []
  const dedup = new Set<string>()
  const visited = new Set<any>()

  const walk = (cursor: any) => {
    const record: Record<string, any> | undefined = cursor?.scope?.[kRecord]
    if (!record || visited.has(record)) return
    visited.add(record)

    for (const [fullKey, fork] of Object.entries(record)) {
      const key = String(fullKey).replace(/^~/, '')
      const [name, ident = ''] = key.split(':', 2)
      if (name && name !== 'group' && !dedup.has(key)) {
        dedup.add(key)
        result.push({
          key,
          name,
          ident,
          label: ident ? `${name}:${ident}` : name
        })
      }
      walk((fork as any)?.ctx)
    }
  }

  walk(ctx.root)
  return result.sort((a, b) => a.key.localeCompare(b.key))
}

function collectPluginForks(ctx: Context): Map<string, any> {
  const result = new Map<string, any>()
  const visited = new Set<any>()

  const walk = (cursor: any) => {
    const record: Record<string, any> | undefined = cursor?.scope?.[kRecord]
    if (!record || visited.has(record)) return
    visited.add(record)

    for (const [fullKey, fork] of Object.entries(record)) {
      const key = String(fullKey).replace(/^~/, '')
      result.set(key, fork)
      walk((fork as any)?.ctx)
    }
  }

  walk(ctx.root)
  return result
}

function createPluginResolver(
  ctx: Context,
  trace?: (stage: string, payload: Record<string, unknown>) => void
) {
  let targets: PluginTargetOption[] = []
  const byScope = new Map<any, PluginTargetOption>()
  const byKey = new Map<string, PluginTargetOption>()
  const byCommand = new WeakMap<any, PluginTargetOption>()

  const resolveByScope = (scope: any): PluginTargetOption | undefined => {
    if (!scope) return
    const direct = byScope.get(scope)
    if (direct) return direct

    const loader = (ctx as any).loader
    if (loader?.paths) {
      const paths = loader.paths(scope) as string[]
      for (const rawKey of paths || []) {
        const key = String(rawKey).replace(/^~/, '')
        const found = byKey.get(key)
        if (found) return found
      }
    }
  }

  const rebuild = () => {
    targets = collectPluginTargets(ctx)
    byScope.clear()
    byKey.clear()
    for (const item of targets) {
      byKey.set(item.key, item)
    }
    trace?.('resolver:rebuild:start', {
      targetCount: targets.length,
      sample: targets.slice(0, 10).map((item) => item.key)
    })

    const visited = new Set<any>()
    const walk = (cursor: any) => {
      const record: Record<string, any> | undefined = cursor?.scope?.[kRecord]
      if (!record || visited.has(record)) return
      visited.add(record)
      for (const [fullKey, fork] of Object.entries(record)) {
        const key = String(fullKey).replace(/^~/, '')
        const target = byKey.get(key)
        if (target && (fork as any)?.ctx?.scope) {
          byScope.set((fork as any).ctx.scope, target)
        }
        walk((fork as any)?.ctx)
      }
    }
    walk(ctx.root)
    trace?.('resolver:rebuild:done', {
      targetCount: targets.length,
      scopeBindings: byScope.size
    })
  }

  const resolveByCommand = (command: any): PluginTargetOption | undefined => {
    const commandName = String(command?.name ?? '')
    const cached = byCommand.get(command)
    if (cached) {
      trace?.('resolver:resolve:cache-hit', {
        command: commandName,
        pluginKey: cached.key
      })
      return cached
    }
    const resolved = resolveByScope(command?.caller?.scope)
    if (resolved) {
      byCommand.set(command, resolved)
      trace?.('resolver:resolve:resolved', {
        command: commandName,
        pluginKey: resolved.key,
        pluginName: resolved.name
      })
    } else {
      trace?.('resolver:resolve:miss', {
        command: commandName
      })
    }
    return resolved
  }

  const bindCommand = (command: any) => {
    const resolved = resolveByScope(command?.caller?.scope)
    if (resolved) {
      byCommand.set(command, resolved)
      trace?.('resolver:bind:ok', {
        command: String(command?.name ?? ''),
        pluginKey: resolved.key,
        pluginName: resolved.name
      })
    } else {
      trace?.('resolver:bind:miss', {
        command: String(command?.name ?? '')
      })
    }
  }

  return {
    rebuild,
    list: () => targets,
    resolveByCommand,
    bindCommand
  }
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined
  const parts = path.split('.')
  let cursor: unknown = source
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeScalar(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'object') return value
  return String(value)
}

function evaluateCompare(left: unknown, expr: CompareExpr): boolean {
  if (expr.operator === 'exists') {
    return left !== undefined && left !== null
  }
  const right = expr.value
  const leftNorm = normalizeScalar(left)
  const rightNorm = normalizeScalar(right)
  if (expr.operator === 'eq') {
    return leftNorm === rightNorm
  }
  if (expr.operator === 'ne') {
    return leftNorm !== rightNorm
  }
  if (expr.operator === 'includes') {
    if (typeof leftNorm === 'string')
      return leftNorm.includes(String(rightNorm ?? ''))
    if (Array.isArray(left))
      return left.map((item) => normalizeScalar(item)).includes(rightNorm)
    return false
  }
  if (expr.operator === 'regex') {
    if (typeof leftNorm !== 'string') return false
    try {
      return new RegExp(String(rightNorm ?? '')).test(leftNorm)
    } catch {
      return false
    }
  }
  const ln = coerceNumber(left)
  const rn = coerceNumber(right)
  if (ln === null || rn === null) return false
  if (expr.operator === 'gt') return ln > rn
  if (expr.operator === 'gte') return ln >= rn
  if (expr.operator === 'lt') return ln < rn
  if (expr.operator === 'lte') return ln <= rn
  return false
}

function evaluateExpr(expr: RuleExpr, vars: Record<string, unknown>): boolean {
  if (expr.type === 'group') {
    if (!expr.children.length) return true
    if (expr.operator === 'and')
      return expr.children.every((child) => evaluateExpr(child, vars))
    return expr.children.some((child) => evaluateExpr(child, vars))
  }
  if (expr.type === 'not') {
    return !evaluateExpr(expr.child, vars)
  }
  return evaluateCompare(getByPath(vars, expr.field), expr)
}

async function readRules(file: string): Promise<RuleItem[] | null> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeRule(item))
  } catch {
    return null
  }
}

function createPersister(file: string) {
  let queue = Promise.resolve()
  return async (rules: RuleItem[]) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        await writeFile(
          file,
          JSON.stringify(rules.map(cloneRule), null, 2),
          'utf8'
        )
      })
    await queue
  }
}

export function apply(ctx: Context, config: Config = {}) {
  const baseDir =
    (ctx as unknown as { baseDir?: string }).baseDir || process.cwd()
  const dataDir = join(baseDir, 'data', 'filterpro')
  const dataFile = join(dataDir, config.filename || 'rules.json')
  const state: RuleState = { rules: [] }
  const persist = createPersister(dataFile)
  const logger = ctx.logger('filter-pro')
  const debug = !!config.debug

  const trace = (stage: string, payload: Record<string, unknown>) => {
    if (!debug) return
    // Native-filter mode: keep only native filter hit logs.
    if (stage !== 'native-filter:evaluate') return
    if (!payload?.matched) return
    logger.info('[trace:%s] %s', stage, JSON.stringify(payload))
  }

  const pluginResolver = createPluginResolver(ctx, trace)
  const originalFilters = new Map<any, FilterFn>()
  const injectedFilters = new Map<any, FilterFn>()

  const buildVars = (session: any, extras: Record<string, unknown> = {}) => ({
    platform: String(session.platform ?? ''),
    selfId: String(session.selfId ?? ''),
    userId: String(session.userId ?? ''),
    channelId: String(session.channelId ?? ''),
    guildId: String(session.guildId ?? ''),
    isDirect: session.isDirect,
    content: String(session.content ?? ''),
    type: String(session.type ?? ''),
    event: session.event,
    author: session.author,
    quote: session.quote,
    ...extras
  })

  const evaluatePluginRules = (pluginKey: string, session: any) => {
    const vars = buildVars(session, { pluginKey })
    for (const rule of sortRules(state.rules)) {
      if (!rule.enabled) continue
      if (rule.target.type !== 'plugin') continue
      if ((rule.target.value || '').trim() !== pluginKey) continue
      const matched = evaluateExpr(rule.condition, vars)
      trace('native-filter:evaluate', {
        pluginKey,
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action,
        matched
      })
      if (!matched) continue
      return rule.action === 'bypass'
    }
    return true
  }

  const initialize = async () => {
    await mkdir(dataDir, { recursive: true })
    const loaded = await readRules(dataFile)
    if (loaded) {
      state.rules = loaded
      return
    }
    state.rules = []
    await persist(state.rules)
  }

  const ready = initialize().catch((error) => {
    ctx
      .logger('filter-pro')
      .warn('failed to initialize persistent rules: %s', String(error))
    state.rules = []
  })

  const refreshPluginTargets = async () => {
    await ready
    pluginResolver.rebuild()
    const commands = (ctx as any)?.$commander?._commandList
    if (Array.isArray(commands)) {
      trace('resolver:bind-existing:start', {
        commandCount: commands.length
      })
      for (const command of commands) {
        pluginResolver.bindCommand(command)
      }
      trace('resolver:bind-existing:done', {
        commandCount: commands.length
      })
    } else {
      trace('resolver:bind-existing:skip', {
        reason: '$commander not available'
      })
    }
  }

  const applyNativeFilterInjection = async () => {
    await refreshPluginTargets()

    // unwrap previously injected wrappers first
    for (const [hostCtx, wrapped] of injectedFilters.entries()) {
      if (hostCtx?.filter !== wrapped) continue
      const original = originalFilters.get(hostCtx)
      if (original) hostCtx.filter = original
    }
    injectedFilters.clear()

    const forks = collectPluginForks(ctx)
    const activeKeys = new Set(
      state.rules
        .filter(
          (rule) =>
            rule.enabled && rule.target.type === 'plugin' && !!rule.target.value
        )
        .map((rule) => (rule.target.value || '').trim())
    )

    trace('native-filter:sync:start', {
      activeTargetCount: activeKeys.size,
      discoveredForks: forks.size
    })

    for (const [pluginKey, fork] of forks.entries()) {
      const hostCtx = (fork as any)?.parent
      if (!hostCtx || typeof hostCtx.filter !== 'function') continue

      if (!originalFilters.has(hostCtx)) {
        originalFilters.set(hostCtx, hostCtx.filter)
      } else {
        // runtime reload may rewrite base filter; keep latest base
        originalFilters.set(hostCtx, hostCtx.filter)
      }
      const original = originalFilters.get(hostCtx)

      if (!activeKeys.has(pluginKey)) {
        hostCtx.filter = original
        continue
      }

      const wrapped: FilterFn = (session: any) => {
        if (!original(session)) return false
        return evaluatePluginRules(pluginKey, session)
      }
      hostCtx.filter = wrapped
      injectedFilters.set(hostCtx, wrapped)
    }

    trace('native-filter:sync:done', {
      activeTargetCount: activeKeys.size
    })
  }

  void refreshPluginTargets()
  void applyNativeFilterInjection()
  ctx.on('ready', applyNativeFilterInjection)
  ctx.on('internal/fork', applyNativeFilterInjection)
  ctx.on('internal/before-update', applyNativeFilterInjection)
  ctx.on('internal/update', applyNativeFilterInjection)
  ctx.on('internal/runtime', applyNativeFilterInjection)
  ctx.on('dispose', () => {
    for (const [hostCtx, wrapped] of injectedFilters.entries()) {
      if (hostCtx?.filter !== wrapped) continue
      const original = originalFilters.get(hostCtx)
      if (original) hostCtx.filter = original
    }
    injectedFilters.clear()
  })
  ctx.on('command-added', (command) => {
    pluginResolver.bindCommand(command)
    trace('command:added', {
      command: String((command as any)?.name ?? '')
    })
  })

  ctx.middleware(async (session, next) => {
    await ready
    const vars: Record<string, unknown> = buildVars(session)

    trace('message:incoming', {
      platform: vars.platform,
      userId: vars.userId,
      channelId: vars.channelId,
      guildId: vars.guildId,
      isDirect: vars.isDirect,
      content: vars.content,
      ruleCount: state.rules.length
    })

    for (const rule of sortRules(state.rules)) {
      if (!rule.enabled) continue
      if (rule.target.type !== 'global') continue
      if (!matchTarget(rule.target, vars)) {
        trace('message:skip-target', {
          ruleId: rule.id,
          ruleName: rule.name,
          target: rule.target,
          pluginKey: vars.pluginKey
        })
        continue
      }
      const matched = evaluateExpr(rule.condition, vars)
      trace('message:evaluate', {
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action,
        matched,
        expr: rule.condition
      })
      if (!matched) continue
      if (rule.action === 'bypass') {
        trace('message:action', {
          ruleId: rule.id,
          action: 'bypass'
        })
        return next()
      }
      if (rule.response) {
        trace('message:action', {
          ruleId: rule.id,
          action: 'block',
          response: rule.response
        })
        return rule.response
      }
      trace('message:action', {
        ruleId: rule.id,
        action: 'block',
        response: ''
      })
      return ''
    }

    trace('message:pass', {
      reason: 'no-rule-matched'
    })

    return next()
  }, true)

  ctx.before('command/execute', async (argv) => {
    await ready
    const plugin = pluginResolver.resolveByCommand(argv.command)
    const vars: Record<string, unknown> = buildVars(argv.session, {
      commandName: String(argv.command.name ?? ''),
      pluginKey: plugin?.key,
      pluginName: plugin?.name
    })

    trace('command:incoming', {
      command: vars.commandName,
      pluginKey: vars.pluginKey,
      pluginName: vars.pluginName,
      isDirect: vars.isDirect,
      guildId: vars.guildId,
      content: vars.content,
      ruleCount: state.rules.length
    })

    trace('command:pass', {
      reason: 'native-filter-mode'
    })
  })

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist')
    })

    const provider = new FilterProProvider(ctx, state)
    const authority = 3
    const addListener = (ctx.console.addListener as any).bind(ctx.console)

    const refresh = async () => {
      await persist(state.rules)
      await applyNativeFilterInjection()
      provider.refresh()
    }

    addListener(
      'filter-pro/list',
      async () => {
        await ready
        return provider.get()
      },
      { authority }
    )

    addListener(
      'filter-pro/targets',
      async () => {
        await refreshPluginTargets()
        return pluginResolver.list()
      },
      { authority }
    )

    addListener(
      'filter-pro/create',
      async (input: RuleInput) => {
        await ready
        const rule = normalizeRule(input || {})
        state.rules.push(rule)
        await refresh()
        return cloneRule(rule)
      },
      { authority }
    )

    addListener(
      'filter-pro/update',
      async (input: RuleInput) => {
        await ready
        if (!input?.id) return null
        const index = state.rules.findIndex((item) => item.id === input.id)
        if (index < 0) return null
        const prev = state.rules[index]
        state.rules[index] = normalizeRule({ ...prev, ...input, id: prev.id })
        await refresh()
        return cloneRule(state.rules[index])
      },
      { authority }
    )

    addListener(
      'filter-pro/delete',
      async (id: string) => {
        await ready
        const index = state.rules.findIndex((item) => item.id === id)
        if (index < 0) return false
        state.rules.splice(index, 1)
        await refresh()
        return true
      },
      { authority }
    )

    addListener(
      'filter-pro/reorder',
      async (ids: string[]) => {
        await ready
        if (!Array.isArray(ids)) return provider.get()
        const rank = new Map(ids.map((id, index) => [id, index]))
        state.rules.sort((a, b) => {
          const ai = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER
          const bi = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER
          return (ai as number) - (bi as number)
        })
        for (let i = 0; i < state.rules.length; i++) state.rules[i].priority = i
        await refresh()
        return provider.get()
      },
      { authority }
    )

    addListener(
      'filter-pro/toggle',
      async (payload: { id: string; enabled: boolean }) => {
        await ready
        if (!payload?.id) return null
        const item = state.rules.find((rule) => rule.id === payload.id)
        if (!item) return null
        item.enabled = !!payload.enabled
        await refresh()
        return cloneRule(item)
      },
      { authority }
    )
  })
}
