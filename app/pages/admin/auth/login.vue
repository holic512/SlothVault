<script setup>
const {t} = useI18n()
const router = useRouter()
const userStore = useUserStore()

const form = reactive({
  username: '',
  password: '',
  remember: false
})
const loading = ref(false)
const errorText = ref('')

// 检查管理员是否存在
onMounted(async () => {
  try {
    const res = await $fetch('/api/admin/auth/check')
    if (!res?.data?.exists) {
      // 如果管理员不存在，跳转到初始化页面
      await router.push('/admin/auth/init')
    }
  } catch (e) {
    console.error('Failed to check admin status', e)
    // 如果检查失败，可能需要处理错误，这里暂时保持不动或显示错误
  }
})

async function onSubmit() {
  if (!form.username || !form.password) {
    errorText.value = t('AdminLogin.status.required')
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const res = await $fetch('/api/admin/auth/login', {
      method: 'POST',
      body: {
        username: form.username,
        password: form.password,
        remember: form.remember
      },
    })
    if (res?.code === 0) {
      userStore.setUsername(res.data.username)
      await router.push('/admin/mm')
    } else {
      errorText.value = t('AdminLogin.status.error')
    }
  } catch (e) {
    errorText.value = t('AdminLogin.status.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="ambient-glow glow-1"></div>
  <div class="ambient-glow glow-2"></div>

  <div class="page-wrapper">
    <nav class="navbar">
      <div class="sloth-container navbar-inner">
        <div class="brand">
          <img src="/logo.png" class="brand-icon" alt="Logo"/>
          <span class="brand-text">Sloth<span class="sloth-text-gradient">Vault</span></span>
        </div>
        <ThemeToggle/>
      </div>
    </nav>

    <main class="login-container">
      <div class="sloth-card login-card animate-entry">

        <header class="login-header">
          <div class="sloth-badge-hash hero-badge">{{ t('AdminLogin.hero.badge') }}</div>
          <h1 class="login-title">{{ t('AdminLogin.hero.title') }}</h1>
          <p class="login-desc">{{ t('AdminLogin.hero.desc') }}</p>
        </header>

        <form @submit.prevent="onSubmit" class="login-form">
          <div class="form-group">
            <label class="form-label" for="username">{{ t('AdminLogin.form.username') }}</label>
            <div class="input-wrapper">
              <input
                  id="username"
                  v-model="form.username"
                  type="text"
                  class="form-input"
                  :placeholder="t('AdminLogin.form.username')"
                  autocomplete="username"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="password">{{ t('AdminLogin.form.password') }}</label>
            <div class="input-wrapper">
              <input
                  id="password"
                  v-model="form.password"
                  type="password"
                  class="form-input"
                  :placeholder="t('AdminLogin.form.password')"
                  autocomplete="current-password"
              />
            </div>
          </div>

          <div class="form-extras">
            <label class="remember-me">
              <input type="checkbox" v-model="form.remember" class="custom-checkbox"/>
              <span>{{ t('AdminLogin.form.remember') }}</span>
            </label>
          </div>

          <div class="form-actions">
            <transition name="fade">
              <div class="error-message" v-if="errorText">
                {{ errorText }}
              </div>
            </transition>

            <button class="sloth-btn sloth-btn-primary full-width" type="submit" :disabled="loading">
              <span v-if="loading" class="spinner"></span>
              <span v-else>{{ t('AdminLogin.form.submit') }}</span>
            </button>
          </div>
        </form>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 布局容器 */
.page-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  height: 64px;
  background: transparent;
  z-index: 50;
}

.navbar-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  padding: 0 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}

.brand-icon {
  width: 32px;
  height: 32px;
}

/* 登录主容器 */
.login-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  position: relative;
  z-index: 10;
}

.login-card {
  width: 100%;
  max-width: 480px;
  padding: 48px 40px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 24px;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.05),
  0 0 0 1px rgba(255, 255, 255, 0.3) inset;
}

.dark .login-card {
  background: rgba(30, 30, 30, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.hero-badge {
  display: inline-block;
  margin-bottom: 16px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--sloth-primary);
  background: var(--sloth-primary-bg, rgba(var(--sloth-primary-rgb), 0.1));
  border: 1px solid var(--sloth-primary);
}

.login-title {
  font-size: 1.75rem;
  font-weight: 800;
  margin-bottom: 8px;
  background: linear-gradient(135deg, var(--sloth-text) 0%, var(--sloth-text-subtle) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.dark .login-title {
  color: var(--sloth-text);
}

.login-desc {
  color: var(--sloth-text-subtle);
  font-size: 0.95rem;
  line-height: 1.5;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--sloth-text);
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  font-size: 1rem;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
  border-radius: 12px;
  transition: all 0.2s ease;
  color: var(--sloth-text);
}

.form-input:focus {
  outline: none;
  border-color: var(--sloth-primary);
  box-shadow: 0 0 0 3px var(--sloth-primary-dim, rgba(59, 130, 246, 0.15));
  background: var(--sloth-bg-active, #fff);
}

.dark .form-input:focus {
  background: var(--sloth-bg);
}

.form-extras {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.remember-me {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--sloth-text-subtle);
  user-select: none;
}

.custom-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--sloth-primary);
  cursor: pointer;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sloth-btn {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.2s;
  border: none;
}

.full-width {
  width: 100%;
}

.sloth-btn-primary {
  background: var(--sloth-primary);
  color: #fff;
  box-shadow: 0 4px 12px var(--sloth-primary-shadow, rgba(0, 0, 0, 0.2));
}

.sloth-btn-primary:hover:not(:disabled) {
  background: var(--sloth-primary-hover, var(--sloth-primary));
  filter: brightness(1.1);
}

.sloth-btn-primary:active:not(:disabled) {
  transform: scale(0.98);
}

.sloth-btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.error-message {
  color: var(--sloth-accent, #ef4444);
  font-size: 0.875rem;
  text-align: center;
  background: rgba(239, 68, 68, 0.1);
  padding: 8px;
  border-radius: 8px;
}

.ambient-glow {
  position: fixed;
  border-radius: 50%;
  filter: blur(100px);
  z-index: -1;
  opacity: 0.5;
  pointer-events: none;
}

.glow-1 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, var(--sloth-primary) 0%, transparent 70%);
  top: -200px;
  left: -200px;
}

.glow-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, var(--sloth-accent) 0%, transparent 70%);
  bottom: -100px;
  right: -100px;
  opacity: 0.3;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.animate-entry {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .login-card {
    padding: 32px 24px;
  }

  .login-title {
    font-size: 1.5rem;
  }

  .glow-1, .glow-2 {
    opacity: 0.3;
  }
}
</style>
