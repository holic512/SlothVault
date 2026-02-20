<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'

type NoteInfo = {
  id: string
  noteTitle: string
  weight: number
  status: number
}

interface Props {
  modelValue: boolean
  note: NoteInfo | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [payload: { noteTitle: string; weight: number; status: number }]
}>()

const { t } = useI18n()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = reactive({
  noteTitle: '',
  weight: 0,
  status: 1,
})

watch(
  () => props.modelValue,
  (val) => {
    visible.value = val
    if (val && props.note) {
      form.noteTitle = props.note.noteTitle
      form.weight = props.note.weight
      form.status = props.note.status
    }
  }
)

watch(visible, (val) => emit('update:modelValue', val))

const rules = {
  noteTitle: [{ required: true, message: t('AdminMM.notes.validation.noteTitleRequired'), trigger: 'blur' }],
}

async function submit() {
  const elForm = formRef.value
  if (!elForm) return
  const ok = await elForm.validate().catch(() => false)
  if (!ok) return

  submitting.value = true
  try {
    emit('save', {
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
    :title="t('AdminMM.notes.content.dialogs.editNoteTitle')"
    width="460px"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
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
      <el-button type="primary" :loading="submitting" @click="submit">{{ t('AdminMM.notes.dialog.save') }}</el-button>
    </template>
  </el-dialog>
</template>

