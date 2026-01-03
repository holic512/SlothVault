<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElDialog, ElButton, ElSlider, ElIcon } from 'element-plus'
import { Plus, ZoomIn, ZoomOut, RefreshLeft, RefreshRight, Upload, Close } from '@element-plus/icons-vue'

interface Props {
  modelValue?: string | null
  uploadUrl?: string
  size?: number
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  uploadUrl: '/api/admin/mm/project/avatar',
  size: 100,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'uploaded': [data: { url: string; id: string }]
}>()

// 状态
const cropperDialogVisible = ref(false)
const uploading = ref(false)
const originalImage = ref<string | null>(null)
const croppedImage = ref<string | null>(null)

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

  // 验证文件类型
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    ElMessage.error('仅支持 JPG、PNG、GIF、WebP 格式')
    return
  }

  // 验证文件大小（原始文件最大 10MB）
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error('图片大小不能超过 10MB')
    return
  }

  // 读取文件
  const reader = new FileReader()
  reader.onload = (event) => {
    originalImage.value = event.target?.result as string
    resetCropParams()
    cropperDialogVisible.value = true
  }
  reader.readAsDataURL(file)

  // 清空 input 以便重复选择同一文件
  input.value = ''
}

// 重置裁剪参数
function resetCropParams() {
  scale.value = 1
  rotation.value = 0
  offsetX.value = 0
  offsetY.value = 0
}

// 加载图片到 canvas
function loadImageToCanvas() {
  if (!originalImage.value || !canvasRef.value) return

  const img = new Image()
  img.onload = () => {
    imageRef.value = img
    drawCanvas()
  }
  img.src = originalImage.value
}

// 绘制 canvas
function drawCanvas() {
  const canvas = canvasRef.value
  const img = imageRef.value
  if (!canvas || !img) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const canvasSize = 300
  canvas.width = canvasSize
  canvas.height = canvasSize

  // 启用抗锯齿
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 清空画布
  ctx.clearRect(0, 0, canvasSize, canvasSize)

  // 绘制背景网格（透明度指示）
  drawCheckerboard(ctx, canvasSize)

  // 保存状态
  ctx.save()

  // 移动到画布中心
  ctx.translate(canvasSize / 2, canvasSize / 2)

  // 应用旋转（基于中心点）
  ctx.rotate((rotation.value * Math.PI) / 180)

  // 计算图片绘制尺寸（保持比例，让短边填满画布）
  const imgRatio = img.width / img.height
  let baseWidth, baseHeight

  if (imgRatio > 1) {
    // 横向图片：高度填满
    baseHeight = canvasSize
    baseWidth = baseHeight * imgRatio
  } else {
    // 纵向图片：宽度填满
    baseWidth = canvasSize
    baseHeight = baseWidth / imgRatio
  }

  // 应用缩放
  const drawWidth = baseWidth * scale.value
  const drawHeight = baseHeight * scale.value

  // 绘制图片（以中心点为基准，加上偏移）
  ctx.drawImage(
    img,
    -drawWidth / 2 + offsetX.value * scale.value,
    -drawHeight / 2 + offsetY.value * scale.value,
    drawWidth,
    drawHeight
  )

  // 恢复状态
  ctx.restore()

  // 绘制圆形裁剪遮罩
  drawCircleMask(ctx, canvasSize)

  // 更新预览
  updatePreview()
}

// 绘制棋盘格背景
function drawCheckerboard(ctx: CanvasRenderingContext2D, size: number) {
  const tileSize = 10
  for (let x = 0; x < size; x += tileSize) {
    for (let y = 0; y < size; y += tileSize) {
      ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? '#f0f0f0' : '#ffffff'
      ctx.fillRect(x, y, tileSize, tileSize)
    }
  }
}

// 绘制圆形遮罩
function drawCircleMask(ctx: CanvasRenderingContext2D, size: number) {
  ctx.globalCompositeOperation = 'destination-in'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // 绘制圆形边框
  ctx.strokeStyle = 'var(--sloth-primary, #3b82f6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.stroke()
}

// 更新预览
function updatePreview() {
  const canvas = canvasRef.value
  const previewCanvas = previewCanvasRef.value
  if (!canvas || !previewCanvas) return

  const previewCtx = previewCanvas.getContext('2d')
  if (!previewCtx) return

  const previewSize = 80
  previewCanvas.width = previewSize
  previewCanvas.height = previewSize

  // 启用抗锯齿
  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'

  previewCtx.clearRect(0, 0, previewSize, previewSize)
  previewCtx.drawImage(canvas, 0, 0, previewSize, previewSize)
}

// 拖拽开始
function startDrag(e: MouseEvent) {
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragStartOffsetX.value = offsetX.value
  dragStartOffsetY.value = offsetY.value
}

// 拖拽中
function onDrag(e: MouseEvent) {
  if (!isDragging.value) return

  // 拖拽距离不受缩放影响，直接计算像素偏移
  const dx = e.clientX - dragStartX.value
  const dy = e.clientY - dragStartY.value

  offsetX.value = dragStartOffsetX.value + dx / scale.value
  offsetY.value = dragStartOffsetY.value + dy / scale.value

  drawCanvas()
}

// 拖拽结束
function endDrag() {
  isDragging.value = false
}

// 滚轮缩放
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.max(0.5, Math.min(3, scale.value + delta))
  drawCanvas()
}

// 裁剪并上传
async function cropAndUpload() {
  const canvas = canvasRef.value
  if (!canvas) return

  uploading.value = true

  try {
    // 创建输出 canvas（固定 200x200 输出尺寸）
    const outputCanvas = document.createElement('canvas')
    const outputSize = 200
    outputCanvas.width = outputSize
    outputCanvas.height = outputSize

    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) throw new Error('无法创建 canvas context')

    // 启用抗锯齿
    outputCtx.imageSmoothingEnabled = true
    outputCtx.imageSmoothingQuality = 'high'

    // 绘制裁剪后的图像
    outputCtx.drawImage(canvas, 0, 0, outputSize, outputSize)

    // 转换为 Blob（使用 PNG 格式以支持透明背景）
    const blob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob(
        (b) => {
          if (b) resolve(b)
          else reject(new Error('转换失败'))
        },
        'image/png'
      )
    })

    // 创建 FormData
    const formData = new FormData()
    formData.append('file', blob, 'avatar.png')

    // 上传
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

// 监听弹窗关闭时清理
watch(cropperDialogVisible, (visible) => {
  if (!visible) {
    originalImage.value = null
    croppedImage.value = null
    imageRef.value = null
  }
})
</script>

<template>
  <div class="avatar-uploader-wrapper">
    <!-- 当前头像显示 -->
    <div
      class="avatar-display"
      :style="{ width: `${size}px`, height: `${size}px` }"
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

    <!-- 删除按钮 -->
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

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      style="display: none"
      @change="handleFileSelect"
    />

    <!-- 裁剪弹窗 -->
    <el-dialog
      v-model="cropperDialogVisible"
      title="裁剪头像"
      width="480px"
      :close-on-click-modal="false"
      append-to-body
      @opened="loadImageToCanvas"
    >
      <div class="cropper-container">
        <!-- 裁剪区域 -->
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

        <!-- 预览 -->
        <div class="preview-area">
          <div class="preview-label">预览</div>
          <canvas ref="previewCanvasRef" class="preview-canvas" />
        </div>
      </div>

      <!-- 控制栏 -->
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
  border-radius: 50%;
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

/* 裁剪弹窗样式 */
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
  border-radius: 50%;
  cursor: move;
  border: 3px solid var(--sloth-primary, #3b82f6);
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
  border-radius: 50%;
  border: 2px solid var(--sloth-card-border, #e5e7eb);
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

/* Element Plus 适配 */
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
