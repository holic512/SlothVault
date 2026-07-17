<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElOption, ElSelect, ElTag, ElTree } from 'element-plus'
import { EllipsisHorizontalIcon, PlusIcon, ArrowPathIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'

export type ProjectVersionDto = {
  id: string
  projectId: string
  version: string
  project?: { id: string; projectName: string } | null
}

export type NavTreeNode = {
  id: string
  type: 'category' | 'note'
  label: string
  categoryId?: string
  noteId?: string
  weight?: number
  contentCount?: number
  noteCount?: number
  children?: NavTreeNode[]
}

type MenuCommand =
  | 'refresh'
  | 'createNote'
  | 'editNote'
  | 'editCategory'

interface Props {
  projectVersions: ProjectVersionDto[]
  modelValue: string
  keyword: string
  loading: boolean
  treeData: NavTreeNode[]
  currentKey: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:keyword': [value: string]
  'refresh': []
  'node-click': [node: NavTreeNode]
  'menu': [payload: { command: MenuCommand; node?: NavTreeNode }]
}>()

const { t } = useI18n()

const treeRef = ref<InstanceType<typeof ElTree> | null>(null)

watch(
  () => props.keyword,
  (val) => {
    treeRef.value?.filter(val)
  }
)

function projectVersionLabel(pv: ProjectVersionDto) {
  const name = pv.project?.projectName ? `${pv.project.projectName} / ` : ''
  return `${name}${pv.version}`
}

const selectValue = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val),
})

const keywordValue = computed({
  get: () => props.keyword,
  set: (val: string) => emit('update:keyword', val),
})

function filterNode(value: string, data: NavTreeNode) {
  if (!value) return true
  return data.label.toLowerCase().includes(value.toLowerCase())
}

function handleMenuCommand(command: MenuCommand, node?: NavTreeNode) {
  emit('menu', { command, node })
}
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      <h3 class="panel-title">{{ t('AdminMM.notes.content.navTitle') }}</h3>
      <div class="panel-actions">
        <el-button text class="icon-btn" :title="t('AdminMM.notes.content.actions.refresh')" @click="emit('refresh')">
          <ArrowPathIcon class="icon" />
        </el-button>
        <el-dropdown trigger="click" @command="(c) => handleMenuCommand(c as any)">
          <el-button text class="icon-btn" :title="t('AdminMM.notes.content.actions.more')">
            <EllipsisHorizontalIcon class="icon" />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="createNote">
                <PlusIcon class="menu-icon" />
                {{ t('AdminMM.notes.content.actions.createNote') }}
              </el-dropdown-item>
              <el-dropdown-item command="editCategory">
                <PencilSquareIcon class="menu-icon" />
                {{ t('AdminMM.notes.content.actions.editCategory') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="controls">
      <el-select
        v-model="selectValue"
        filterable
        class="control"
        :placeholder="t('AdminMM.notes.content.navSelectVersion')"
      >
        <el-option
          v-for="pv in projectVersions"
          :key="pv.id"
          :label="projectVersionLabel(pv)"
          :value="pv.id"
        />
      </el-select>

      <el-input
        v-model="keywordValue"
        clearable
        class="control"
        :placeholder="t('AdminMM.notes.content.navSearchPlaceholder')"
      />
    </div>

    <div class="tree-area" v-loading="loading">
      <el-tree
        ref="treeRef"
        :data="treeData"
        node-key="id"
        highlight-current
        default-expand-all
        :expand-on-click-node="false"
        :current-node-key="currentKey"
        :filter-node-method="filterNode"
        @node-click="(node) => emit('node-click', node)"
      >
        <template #default="{ data }">
          <div class="node" :class="`node--${data.type}`">
            <span class="node-label">{{ data.label }}</span>
            <div class="node-meta">
              <el-tag
                v-if="data.type === 'note' && typeof data.contentCount === 'number'"
                size="small"
                type="info"
                effect="plain"
              >
                {{ data.contentCount }}
              </el-tag>
              <el-tag
                v-else-if="data.type === 'category' && typeof data.noteCount === 'number'"
                size="small"
                type="info"
                effect="plain"
              >
                {{ data.noteCount }}
              </el-tag>

              <el-dropdown
                v-if="data.type === 'note' || data.type === 'category'"
                trigger="click"
                @command="(c) => handleMenuCommand(c as any, data)"
              >
                <button class="node-menu" type="button" :title="t('AdminMM.notes.content.actions.more')">
                  <EllipsisHorizontalIcon class="node-menu-icon" />
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="data.type === 'note'" command="editNote">
                      <PencilSquareIcon class="menu-icon" />
                      {{ t('AdminMM.notes.content.actions.editNote') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="data.type === 'category'" command="editCategory">
                      <PencilSquareIcon class="menu-icon" />
                      {{ t('AdminMM.notes.content.actions.editCategory') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="data.type === 'category'" command="createNote">
                      <PlusIcon class="menu-icon" />
                      {{ t('AdminMM.notes.content.actions.createNote') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </template>
      </el-tree>

      <div v-if="!loading && treeData.length === 0" class="empty-tip">
        {{ t('AdminMM.notes.content.navEmptyTip') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--sloth-text);
  letter-spacing: 0.2px;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  padding: 6px;
  border-radius: 8px;
  color: var(--sloth-text-secondary);
}

.icon-btn:hover {
  background: var(--sloth-bg-hover);
  color: var(--sloth-text);
}

.icon {
  width: 18px;
  height: 18px;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.control {
  width: 100%;
}

.tree-area {
  flex: 1;
  overflow: auto;
  padding: 8px 8px 10px;
}

.node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 2px 2px 2px 0;
}

.node-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--sloth-text);
}

.node-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.node-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sloth-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

:deep(.el-tree-node__content:hover) .node-menu {
  opacity: 1;
}

.node-menu:hover {
  background: var(--sloth-bg-hover);
  color: var(--sloth-text);
}

.node-menu-icon {
  width: 16px;
  height: 16px;
}

.menu-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
}

.empty-tip {
  text-align: center;
  padding: 16px 10px;
  color: var(--sloth-text-subtle);
  font-size: 13px;
}

/* Apple-like flat tweaks */
:deep(.el-tree-node__content) {
  border-radius: 8px;
  padding: 6px 8px;
}

:deep(.el-tree-node__content:hover) {
  background: var(--sloth-bg-hover);
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--sloth-primary-dim);
}
</style>

