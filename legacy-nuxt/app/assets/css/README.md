# CSS 样式文件说明 / CSS Stylesheet Documentation

## 📁 文件结构 / File Structure

```
app/assets/css/
├── main.css              # 主样式文件，导入所有其他样式
├── theme.css             # 主题变量和核心样式系统
├── element-plus.css      # Element Plus 组件样式覆盖
├── md-editor.css         # Markdown 编辑器样式覆盖
├── markdown-theme.css    # Markdown 动态主题样式类
└── README.md            # 本文档
```

## 📄 文件说明 / File Descriptions

### 1. `main.css` - 主样式文件

**用途**: 应用的入口样式文件，负责导入所有其他样式模块。

**内容**:
- 字体导入 (Source Sans Pro)
- 组件样式导入
- 全局基础样式

**使用**: 在 `nuxt.config.ts` 中引入此文件即可加载所有样式。

```typescript
// nuxt.config.ts
css: [
  '~/assets/css/main.css',
  '~/assets/css/theme.css'
]
```

---

### 2. `theme.css` - 主题系统

**用途**: 定义全局 CSS 变量、主题配色、核心组件样式。

**内容**:
- CSS 变量定义 (`:root` 和 `.dark`)
- 多主题配色 (purple, cyan, emerald, rose)
- 全局重置样式
- 核心组件样式 (卡片、按钮、输入框等)
- Web3 特色元素 (渐变文字、地址徽章、骨架屏等)

**主题变量**:
```css
--sloth-bg              /* 背景色 */
--sloth-card            /* 卡片背景 */
--sloth-text            /* 文字颜色 */
--sloth-primary         /* 主色调 */
--sloth-gradient-primary /* 主渐变 */
/* ... 更多变量 */
```

**主题切换**: 通过在 `<html>` 或 `<body>` 上添加类名实现：
- `.dark` - 暗黑模式
- `.theme-purple` - 紫色主题
- `.theme-cyan` - 青色主题
- `.theme-emerald` - 翠绿主题
- `.theme-rose` - 玫红主题

---

### 3. `element-plus.css` - Element Plus 组件覆盖

**用途**: 覆盖 Element Plus 组件的默认样式，适配项目主题。

**覆盖的组件**:
- MessageBox (消息框)
- Dialog (对话框)
- Select (选择器)
- Input / Textarea (输入框)
- Form (表单)
- Tooltip / Popover (提示框)
- Dropdown (下拉菜单)
- Message / Notification (消息通知)
- Radio / Checkbox / Switch (表单控件)
- DatePicker (日期选择器)
- Tabs (标签页)
- Card (卡片)
- Divider (分隔线)
- Collapse (折叠面板)

**特点**:
- 完整的暗黑模式适配
- 使用项目主题变量
- 保持 Element Plus 原有功能

---

### 4. `md-editor.css` - Markdown 编辑器样式

**用途**: 覆盖 `md-editor-v3` 组件的默认样式。

**功能**:
- 移除标题下划线
- 统一字体为 Source Sans Pro
- 暗黑模式文字颜色适配
- 代码块、引用块、表格样式优化
- 图片透明背景处理

**适用范围**: 所有 `.md-editor-preview` 内的元素。

---

### 5. `markdown-theme.css` - Markdown 动态主题类

**用途**: 提供可在 Markdown HTML 内容中使用的样式类，支持主题切换。

**样式类别**:

#### 文字颜色
- `.sloth-text` - 主文字颜色
- `.sloth-text-subtle` - 次要文字颜色
- `.sloth-text-primary` - 主题色文字
- `.sloth-text-gradient` - 渐变文字

#### 背景颜色
- `.sloth-bg` - 背景色
- `.sloth-bg-card` - 卡片背景
- `.sloth-bg-gradient` - 渐变背景

#### 组件样式
- `.sloth-card` - 卡片
- `.sloth-btn` / `.sloth-btn-primary` / `.sloth-btn-secondary` - 按钮
- `.sloth-badge` / `.sloth-badge-primary` - 徽章
- `.sloth-icon-box` - 图标盒子
- `.sloth-highlight-card` - 高亮卡片

#### 布局工具
- `.sloth-grid` - 网格布局
- `.sloth-flex` / `.sloth-flex-center` / `.sloth-flex-between` - Flex 布局
- `.sloth-gap-2` / `.sloth-gap-4` / `.sloth-gap-6` - 间距

#### 间距工具
- `.sloth-p-4` / `.sloth-p-6` - 内边距
- `.sloth-mt-4` / `.sloth-mb-4` - 外边距

#### 其他工具
- `.sloth-rounded` / `.sloth-rounded-full` - 圆角
- `.sloth-shadow` / `.sloth-shadow-hover` - 阴影
- `.sloth-text-center` - 文字居中
- `.sloth-font-bold` - 粗体

**使用示例**:
```html
<div class="sloth-card">
  <h2 class="sloth-text-gradient">标题</h2>
  <p class="sloth-text-subtle">描述文字</p>
  <button class="sloth-btn sloth-btn-primary">按钮</button>
</div>
```

---

## 🎨 使用指南 / Usage Guide

### 添加新的组件样式

如果需要为新的第三方组件添加样式覆盖：

1. 在 `app/assets/css/` 目录下创建新文件，如 `component-name.css`
2. 在 `main.css` 中添加导入：
   ```css
   @import "./component-name.css";
   ```
3. 在新文件中编写样式，使用主题变量保持一致性

### 修改主题变量

所有主题变量定义在 `theme.css` 的 `:root` 和 `.dark` 选择器中。修改这些变量会影响整个应用的外观。

### 添加新的 Markdown 样式类

在 `markdown-theme.css` 中添加新的样式类，确保：
- 使用 `.md-editor-preview` 前缀
- 使用主题变量而非硬编码颜色
- 添加 `!important` 确保优先级

---

## 🔧 维护建议 / Maintenance Tips

1. **保持模块化**: 每个文件负责特定功能，避免混杂
2. **使用主题变量**: 所有颜色、间距使用 CSS 变量，便于主题切换
3. **注释清晰**: 使用中英文双语注释，说明样式用途
4. **测试主题**: 修改后测试亮色/暗色模式和所有主题配色
5. **避免重复**: 相同的样式应提取为公共类或变量

---

## 📝 更新日志 / Changelog

### 2024-01-24
- 初始化 CSS 文件结构
- 拆分 `main.css` 为多个模块文件
- 创建 `element-plus.css` 用于 Element Plus 组件覆盖
- 创建 `md-editor.css` 用于 Markdown 编辑器样式
- 创建 `markdown-theme.css` 用于 Markdown 动态主题类
- 创建本文档

---

## 📚 相关资源 / Related Resources

- [Element Plus 文档](https://element-plus.org/)
- [md-editor-v3 文档](https://imzbf.github.io/md-editor-v3/)
- [CSS 变量 (MDN)](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Using_CSS_custom_properties)
