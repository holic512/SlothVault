<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'

type CategoryInfo = {
  id: string
  categoryName: string
  weight: number
  status: number
}

interface Props {
  modelValue: boolean
  category: CategoryInfo | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [payload: { categoryName: string; weight: number; status: number }]
}>()

const { t } = useI18n()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = reactive({
  categoryName: '',
  weight: 0,
  status: 1,
})

watch(
  () => props.modelValue,
  (val) => {
    visible.value = val
    if (val && props.category) {
      form.categoryName = props.category.categoryName
      form.weight = props.category.weight
      form.status = props.category.status
    }
  }
)

watch(visible, (val) => emit('update:modelValue', val))

const rules = {
  categoryName: [{ required: true, message: t('AdminMM.categories.validation.categoryNameRequired'), trigger: 'blur' }],
}

async function submit() {
  const elForm = formRef.value
  if (!elForm) return
  const ok = await elForm.validate().catch(() => false)
  if (!ok) return

  submitting.value = true
  try {
    emit('save', {
      categoryName: form.categoryName,
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
    :title="t('AdminMM.notes.content.dialogs.editCategoryTitle')"
    width="460px"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item :label="t('AdminMM.categories.dialog.categoryName')" prop="categoryName">
        <el-input v-model="form.categoryName" maxlength="255" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('AdminMM.categories.dialog.weight')">
        <el-input-number v-model="form.weight" :min="-9999" :max="9999" controls-position="right" style="width: 100%" />
      </el-form-item>
      <el-form-item :label="t('AdminMM.categories.dialog.status')">
        <el-select v-model="form.status" style="width: 100%">
          <el-option :label="t('AdminMM.categories.status.enabled')" :value="1" />
          <el-option :label="t('AdminMM.categories.status.disabled')" :value="0" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('AdminMM.categories.dialog.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t('AdminMM.categories.dialog.save') }}</el-button>
    </template>
  </el-dialog>
</template>

