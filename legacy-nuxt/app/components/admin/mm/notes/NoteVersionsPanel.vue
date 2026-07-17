<script setup lang="ts">
import { ElButton } from 'element-plus'
import { PlusIcon, StarIcon, TrashIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/vue/24/solid'

export type NoteContentDto = {
  id: string
  noteInfoId: string
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

interface Props {
  loading: boolean
  contentList: NoteContentDto[]
  selectedContentId: string | null
  formatTime: (dateStr: string) => string
}

defineProps<Props>()

const emit = defineEmits<{
  'new-version': []
  'refresh': []
  'select': [item: NoteContentDto]
  'set-primary': [item: NoteContentDto]
  'delete': [item: NoteContentDto]
}>()

const { t } = useI18n()
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      <h3 class="panel-title">{{ t('AdminMM.notes.content.sidebarTitle') }}</h3>
      <div class="panel-actions">
        <el-button text class="icon-btn" :title="t('AdminMM.notes.content.actions.refresh')" @click="emit('refresh')">
          <ArrowPathIcon class="icon" />
        </el-button>
        <el-button type="primary" size="small" @click="emit('new-version')">
          <PlusIcon class="btn-icon" />
          {{ t('AdminMM.notes.content.newVersion') }}
        </el-button>
      </div>
    </div>

    <div class="list" v-loading="loading">
      <div
        v-for="item in contentList"
        :key="item.id"
        class="item"
        :class="{ 'is-active': selectedContentId === item.id, 'is-primary': item.isPrimary }"
        @click="emit('select', item)"
      >
        <div class="info">
          <div class="name">
            <StarIconSolid v-if="item.isPrimary" class="primary-icon" />
            <span>{{ item.versionNote || t('AdminMM.notes.content.unnamedVersion') }}</span>
          </div>
          <div class="time">{{ formatTime(item.updatedAt) }}</div>
        </div>
        <div class="actions" @click.stop>
          <button
            v-if="!item.isPrimary"
            class="action-btn"
            :title="t('AdminMM.notes.content.setPrimary')"
            @click="emit('set-primary', item)"
          >
            <StarIcon class="action-icon" />
          </button>
          <button
            class="action-btn action-delete"
            :title="t('AdminMM.notes.content.delete')"
            @click="emit('delete', item)"
          >
            <TrashIcon class="action-icon" />
          </button>
        </div>
      </div>

      <div v-if="contentList.length === 0 && !loading" class="empty-tip">
        {{ t('AdminMM.notes.content.emptyTip') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--sloth-card-border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
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

.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
  background: transparent;
}

.item:hover {
  background: var(--sloth-bg-hover);
}

.item.is-active {
  background: var(--sloth-primary-dim);
}

.item.is-primary .name {
  color: var(--sloth-primary);
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--sloth-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.primary-icon {
  width: 14px;
  height: 14px;
  color: var(--sloth-primary);
  flex-shrink: 0;
}

.time {
  font-size: 11px;
  color: var(--sloth-text-subtle);
  margin-top: 2px;
}

.actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.item:hover .actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sloth-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.action-btn:hover {
  background: var(--sloth-bg-hover);
  color: var(--sloth-primary);
}

.action-btn.action-delete:hover {
  color: #ef4444;
}

.action-icon {
  width: 14px;
  height: 14px;
}

.empty-tip {
  text-align: center;
  padding: 20px;
  color: var(--sloth-text-subtle);
  font-size: 13px;
}

.btn-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}
</style>

