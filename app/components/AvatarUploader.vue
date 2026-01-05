<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElDialog, ElButton, ElSlider, ElIcon } from 'element-plus'
import { Plus, ZoomIn, ZoomOut, RefreshLeft, RefreshRight, Upload, Close } from '@element-plus/icons-vue'

interface Props {
  modelValue?: string | null
  uploadUrl?: string
  size?: number
  disabled?: boolean
  borderRadius?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  uploadUrl: '/api/admin/mm/project/avatar',
  size: 100,
  disabled: false,
  borderRadius: 8,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'uploaded': [data: { url: string; id: string }]
}>()

// 状态
const cropperDialogVisible = ref(false)
const uploading = ref(false)
const originalImage = ref<string | null>(null)

// 裁剪参数
const scale = ref(1)
const rotation = ref(0)
const offsetX = ref(0)
const offsetY = ref(0)

// Canvas refs
const canvasRef = ref<HTMLCanvasElement | null>(null)
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)

// 拖拽状态
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartOffsetX = ref(0)
const dragStartOffsetY = ref(0)

const currentAvatar = computed(() => props.modelValue)

// 选择文件
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    ElMessage.error('仅支持 JPG、PNG、GIF、WebP 格式')
    return
  }

  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error('图片大小不能超过 10MB')
    return
  }

  const reader = new FileReader()
  reader.onload = (event) => {
    originalImage.value = event.target?.result as string
    resetCropParams()
    cropperDialogVisible.value = true
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function resetCropParams() {
  scale.value = 1
  rotation.value = 0
  offsetX.value = 0
  offsetY.value = 0
}

function loadImageToCanvas() {
  if (!originalImage.value || !canvasRef.value) return

  const img = new Image()
  img.onload = () => {
    imageRef.value = img
    drawCanvas()
  }
  img.src = originalImage.value
}

// 核心绘制逻辑，可选是否绘制棋盘格背景
function drawImageToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  canvasSize: number,
  withCheckerboard: boolean = true
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = canvasSize
  canvas.height = canvasSize

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 清除画布（保持透明）
  ctx.clearRect(0, 0, canvasSize, canvasSize)

  // 仅在预览时绘制棋盘格背景
  if (withCheckerboard) {
    const tileSize = 10
    for (let x = 0; x < canvasSize; x += tileSize) {
      for (let y = 0; y < canvasSize; y += tileSize) {
        ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? '#f0f0f0' : '#ffffff'
        ctx.fillRect(x, y, tileSize, tileSize)
      }
    }
  }

  ctx.save()
  ctx.translate(canvasSize / 2, canvasSize / 2)
  ctx.rotate((rotation.value * Math.PI) / 180)

  const imgRatio = img.width / img.height
  let baseWidth, baseHeight

  if (imgRatio > 1) {
    baseHeight = canvasSize
    baseWidth = baseHeight * imgRatio
  } else {
    baseWidth = canvasSize
    baseHeight = baseWidth / imgRatio
  }

  const drawWidth = baseWidth * scale.value
  const drawHeight = baseHeight * scale.value

  ctx.drawImage(
    img,
    -drawWidth / 2 + offsetX.value * scale.value,
    -drawHeight / 2 + offsetY.value * scale.value,
    drawWidth,
    drawHeight
  )

  ctx.restore()
}

function drawCanvas() {
  const canvas = canvasRef.value
  const img = imageRef.value
  if (!canvas || !img) return

  // 预览时绘制棋盘格背景
  drawImageToCanvas(canvas, img, 300, true)
  updatePreview()
}

function updatePreview() {
  const canvas = canvasRef.value
  const previewCanvas = previewCanvasRef.value
  if (!canvas || !previewCanvas) return

  const previewCtx = previewCanvas.getContext('2d')
  if (!previewCtx) return

  const previewSize = 80
  previewCanvas.width = previewSize
  previewCanvas.height = previewSize

  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'
  previewCtx.clearRect(0, 0, previewSize, previewSize)
  previewCtx.drawImage(canvas, 0, 0, previewSize, previewSize)
}

function startDrag(e: MouseEvent) {
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragStartOffsetX.value = offsetX.value
  dragStartOffsetY.value = offsetY.value
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return

  const dx = e.clientX - dragStartX.value
  const dy = e.clientY - dragStartY.value

  offsetX.value = dragStartOffsetX.value + dx / scale.value
  offsetY.value = dragStartOffsetY.value + dy / scale.value

  drawCanvas()
}

function endDrag() {
  isDragging.value = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.max(0.5, Math.min(3, scale.value + delta))
  drawCanvas()
}

async function cropAndUpload() {
  const img = imageRef.value
  if (!img) return

  uploading.value = true

  try {
    const outputCanvas = document.createElement('canvas')
    const outputSize = 1024
    
    // 导出时不绘制棋盘格背景，保持透明通道
    drawImageToCanvas(outputCanvas, img, outputSize, false)

    const blob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob(
        (b) => {
          if (b) resolve(b)
          else reject(new Error('转换失败'))
        },
        'image/png'
      )
    })

    const formData = new FormData()
    formData.append('file', blob, 'avatar.png')

    const response = await $fetch<{ code: number; message: string; data: any }>(
      props.uploadUrl,
      {
        method: 'POST',
        body: formData,
      }
    )

    if (response.code !== 0) {
      throw new Error(response.message || '上传失败')
    }

    const { url, id } = response.data
    emit('update:modelValue', url)
    emit('uploaded', { url, id })

    ElMessage.success('头像上传成功')
    cropperDialogVisible.value = false
  } catch (err: any) {
    ElMessage.error(err.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

watch(cropperDialogVisible, (visible) => {
  if (!visible) {
    originalImage.value = null
    imageRef.value = null
  }
})
</script>

<template>
  <div class="avatar-uploader-wrapper">
    <div
      class="avatar-display"
      :style="{ 
        width: `${size}px`, 
        height: `${size}px`,
        borderRadius: `${borderRadius}px`
      }"
      @click="!disabled && ($refs.fileInput as HTMLInputElement)?.click()"
    >
      <img v-if="currentAvatar" :src="currentAvatar" class="avatar-image" alt="头像" />
      <div v-else class="avatar-placeholder">
        <el-icon :size="size / 3"><Plus /></el-icon>
      </div>
      <div v-if="!disabled" class="avatar-overlay">
        <el-icon :size="20"><Upload /></el-icon>
        <span>{{ currentAvatar ? '更换' : '上传' }}</span>
      </div>
    </div>

    <el-button
      v-if="currentAvatar && !disabled"
      type="danger"
      size="small"
      circle
      class="delete-btn"
      @click.stop="emit('update:modelValue', null)"
    >
      <el-icon><Close /></el-icon>
    </el-button>

    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      style="display: none"
      @change="handleFileSelect"
    />

    <el-dialog
      v-model="cropperDialogVisible"
      title="裁剪图片"
      width="480px"
      :close-on-click-modal="false"
      append-to-body
      @opened="loadImageToCanvas"
    >
      <div class="cropper-container">
        <div class="cropper-area">
          <canvas
            ref="canvasRef"
            class="cropper-canvas"
            @mousedown="startDrag"
            @mousemove="onDrag"
            @mouseup="endDrag"
            @mouseleave="endDrag"
            @wheel="onWheel"
          />
        </div>

        <div class="preview-area">
          <div class="preview-label">预览</div>
          <canvas ref="previewCanvasRef" class="preview-canvas" />
        </div>
      </div>

      <div class="cropper-controls">
        <div class="control-group">
          <span class="control-label">缩放</span>
          <el-button size="small" circle @click="scale = Math.max(0.5, scale - 0.1); drawCanvas()">
            <el-icon><ZoomOut /></el-icon>
          </el-button>
          <el-slider
            v-model="scale"
            :min="0.5"
            :max="3"
            :step="0.1"
            style="width: 120px"
            @input="drawCanvas"
          />
          <el-button size="small" circle @click="scale = Math.min(3, scale + 0.1); drawCanvas()">
            <el-icon><ZoomIn /></el-icon>
          </el-button>
        </div>

        <div class="control-group">
          <span class="control-label">旋转</span>
          <el-button size="small" circle @click="rotation -= 90; drawCanvas()">
            <el-icon><RefreshLeft /></el-icon>
          </el-button>
          <el-button size="small" circle @click="rotation += 90; drawCanvas()">
            <el-icon><RefreshRight /></el-icon>
          </el-button>
          <el-button size="small" @click="resetCropParams(); drawCanvas()">重置</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="cropperDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="cropAndUpload">
          确认上传
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.avatar-uploader-wrapper {
  position: relative;
  display: inline-block;
}

.avatar-display {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border: 2px dashed var(--sloth-card-border, #e5e7eb);
  background: var(--sloth-bg, #f9fafb);
  transition: all 0.2s ease;
}

.avatar-display:hover {
  border-color: var(--sloth-primary, #3b82f6);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sloth-text-subtle, #9ca3af);
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.avatar-display:hover .avatar-overlay {
  opacity: 1;
}

.delete-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  z-index: 1;
}

.cropper-container {
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: flex-start;
}

.cropper-area {
  position: relative;
}

.cropper-canvas {
  width: 300px;
  height: 300px;
  border-radius: 8px;
  cursor: move;
  background: var(--sloth-bg, #f9fafb);
}

.preview-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.preview-label {
  font-size: 13px;
  color: var(--sloth-text-subtle, #6b7280);
}

.preview-canvas {
  width: 80px;
  height: 80px;
  border-radius: 8px;
}

.cropper-controls {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-label {
  font-size: 13px;
  color: var(--sloth-text-subtle, #6b7280);
  width: 40px;
}

:deep(.el-slider) {
  --el-slider-main-bg-color: var(--sloth-primary, #3b82f6);
}

:deep(.el-dialog) {
  --el-dialog-bg-color: var(--sloth-card, #ffffff);
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--sloth-card-border, #e5e7eb);
}

:deep(.el-dialog__footer) {
  border-top: 1px solid var(--sloth-card-border, #e5e7eb);
}
</style>
