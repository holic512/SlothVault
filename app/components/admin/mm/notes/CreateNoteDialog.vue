<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'

export type CategoryDto = {
  id: string
  categoryName: string
}

interface Props {
  modelValue: boolean
  categories: CategoryDto[]
  defaultCategoryId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'create': [payload: { categoryId: string; noteTitle: string; weight: number; status: number }]
}>()

const { t } = useI18n()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = reactive({
  categoryId: '',
  noteTitle: '',
  weight: 0,
  status: 1,
})

watch(
  () => props.modelValue,
  (val) => {
    visible.value = val
    if (val) {
      form.categoryId = props.defaultCategoryId || props.categories?.[0]?.id || ''
      form.noteTitle = ''
      form.weight = 0
      form.status = 1
    }
  }
)

watch(visible, (val) => emit('update:modelValue', val))

const rules = computed(() => ({
  categoryId: [{ required: true, message: t('AdminMM.notes.content.dialogs.categoryRequired'), trigger: 'change' }],
  noteTitle: [{ required: true, message: t('AdminMM.notes.validation.noteTitleRequired'), trigger: 'blur' }],
}))

async function submit() {
  const elForm = formRef.value
  if (!elForm) return
  const ok = await elForm.validate().catch(() => false)
  if (!ok) return

  submitting.value = true
  try {
    emit('create', {
      categoryId: form.categoryId,
      noteTitle: form.noteTitle,
      weight: form.weight,
      status: form.status,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('AdminMM.notes.content.dialogs.createNoteTitle')"
    width="480px"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item :label="t('AdminMM.notes.filters.selectCategory')" prop="categoryId">
        <el-select v-model="form.categoryId" filterable style="width: 100%">
          <el-option v-for="c in categories" :key="c.id" :label="c.categoryName" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('AdminMM.notes.dialog.noteTitle')" prop="noteTitle">
        <el-input v-model="form.noteTitle" maxlength="255" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('AdminMM.notes.dialog.weight')">
        <el-input-number v-model="form.weight" :min="-9999" :max="9999" controls-position="right" style="width: 100%" />
      </el-form-item>
      <el-form-item :label="t('AdminMM.notes.dialog.status')">
        <el-select v-model="form.status" style="width: 100%">
          <el-option :label="t('AdminMM.notes.status.enabled')" :value="1" />
          <el-option :label="t('AdminMM.notes.status.disabled')" :value="0" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('AdminMM.notes.dialog.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t('AdminMM.notes.actions.create') }}</el-button>
    </template>
  </el-dialog>
</template>

