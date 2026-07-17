<script setup>
const {t} = useI18n()
const router = useRouter()
const userStore = useUserStore()
const { setPageTitle } = usePageTitle()

// 设置页面标题
setPageTitle('adminLogin')

const STORAGE_KEY = 'admin_remembered_username'

const form = reactive({
  username: '',
  password: '',
  rememberUsername: false,
  stayLoggedIn: false
})
const loading = ref(false)
const errorText = ref('')

// 检查管理员是否存在 & 读取记住的用户名
onMounted(async () => {
  // 读取记住的用户名
  const savedUsername = localStorage.getItem(STORAGE_KEY)
  if (savedUsername) {
    form.username = savedUsername
    form.rememberUsername = true
  }

  try {
    const res = await $fetch('/api/admin/auth/check')
    if (!res?.data?.exists) {
      await router.push('/admin/auth/init')
    }
  } catch (e) {
    console.error('Failed to check admin status', e)
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
        stayLoggedIn: form.stayLoggedIn
      },
    })
    if (res?.code === 0) {
      // 处理记住账号
      if (form.rememberUsername) {
        localStorage.setItem(STORAGE_KEY, form.username)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
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
  <div class="page-wrapper">
    <nav class="navbar">
      <div class="navbar-inner">
        <div class="brand">
          <img src="/logo.png" class="brand-icon" alt="Logo"/>
          <span class="brand-text">SlothVault</span>
        </div>
        <ThemeToggle/>
      </div>
    </nav>

    <main class="login-container">
      <div class="login-card">
        <header class="login-header">
          <h1 class="login-title">{{ t('AdminLogin.hero.title') }}</h1>
          <p class="login-subtitle">{{ t('AdminLogin.hero.desc') }}</p>
        </header>

        <form @submit.prevent="onSubmit" class="login-form">
          <transition name="error-slide">
            <div class="error-message" v-if="errorText">
              {{ errorText }}
            </div>
          </transition>

          <div class="form-group">
            <input
                id="username"
                v-model="form.username"
                type="text"
                class="form-input"
                :placeholder="t('AdminLogin.form.username')"
                autocomplete="username"
                required
            />
          </div>

          <div class="form-group">
            <input
                id="password"
                v-model="form.password"
                type="password"
                class="form-input"
                :placeholder="t('AdminLogin.form.password')"
                autocomplete="current-password"
                required
            />
          </div>

          <div class="form-options">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.rememberUsername" class="checkbox-input"/>
              <span class="checkbox-text">{{ t('AdminLogin.form.rememberUsername') }}</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.stayLoggedIn" class="checkbox-input"/>
              <span class="checkbox-text">{{ t('AdminLogin.form.stayLoggedIn') }}</span>
            </label>
          </div>

          <button class="submit-btn" type="submit" :disabled="loading">
            <span v-if="loading" class="loading-spinner"></span>
            <span v-else>{{ t('AdminLogin.form.submit') }}</span>
          </button>
        </form>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Apple-inspired minimalist design */
.page-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(to bottom, #fafafa 0%, #ffffff 100%);
}

.dark .page-wrapper {
  background: linear-gradient(to bottom, #000000 0%, #0a0a0a 100%);
}

/* Navbar - Transparent */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  background: transparent;
  z-index: 100;
}

.navbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  padding: 0 32px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 19px;
  letter-spacing: -0.024em;
  color: var(--sloth-text, #1d1d1f);
  transition: opacity 0.2s ease;
}

.brand:hover {
  opacity: 0.7;
}

.dark .brand {
  color: #f5f5f7;
}

.brand-icon {
  width: 28px;
  height: 28px;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.brand:hover .brand-icon {
  transform: scale(1.05) rotate(-5deg);
}

.brand-text {
  font-weight: 600;
}

/* Login Container */
.login-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 80px 20px 60px;
}

.login-card {
  width: 100%;
  max-width: 340px;
  animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Header */
.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.1;
  color: var(--sloth-text, #1d1d1f);
  margin: 0 0 8px 0;
  background: linear-gradient(135deg, #1d1d1f 0%, #4a4a4a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.dark .login-title {
  background: linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.login-subtitle {
  font-size: 15px;
  line-height: 1.52941;
  font-weight: 400;
  letter-spacing: -0.022em;
  color: #86868b;
  margin: 0;
}

.dark .login-subtitle {
  color: #86868b;
}

/* Form */
.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.error-message {
  padding: 10px 14px;
  background: rgba(255, 59, 48, 0.08);
  border: 1px solid rgba(255, 59, 48, 0.2);
  border-radius: 8px;
  color: #d70015;
  font-size: 13px;
  line-height: 1.46667;
  letter-spacing: -0.016em;
  text-align: center;
  font-weight: 500;
}

.dark .error-message {
  background: rgba(255, 69, 58, 0.12);
  border-color: rgba(255, 69, 58, 0.3);
  color: #ff453a;
}

.form-group {
  position: relative;
}

.form-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  font-size: 15px;
  line-height: 1.23536;
  letter-spacing: -0.022em;
  font-weight: 400;
  color: var(--sloth-text, #1d1d1f);
  background: rgba(0, 0, 0, 0.03);
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.dark .form-input {
  color: #f5f5f7;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.form-input::placeholder {
  color: #86868b;
  font-weight: 400;
}

.dark .form-input::placeholder {
  color: #6e6e73;
}

.form-input:hover {
  border-color: rgba(0, 0, 0, 0.24);
  background: rgba(0, 0, 0, 0.04);
}

.dark .form-input:hover {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.08);
}

.form-input:focus {
  background: #ffffff;
  border-color: #0071e3;
  box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.12);
  transform: translateY(-1px);
}

.dark .form-input:focus {
  background: rgba(255, 255, 255, 0.1);
  border-color: #0a84ff;
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.18);
}

/* Checkboxes */
.form-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 2px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.2s ease;
}

.checkbox-label:hover {
  opacity: 0.7;
}

.checkbox-input {
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  accent-color: #0071e3;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.checkbox-input:hover {
  transform: scale(1.1);
}

.dark .checkbox-input {
  accent-color: #0a84ff;
}

.checkbox-text {
  font-size: 13px;
  line-height: 1.46667;
  letter-spacing: -0.016em;
  font-weight: 400;
  color: var(--sloth-text, #1d1d1f);
}

.dark .checkbox-text {
  color: #f5f5f7;
}

/* Submit Button */
.submit-btn {
  width: 100%;
  height: 44px;
  margin-top: 8px;
  padding: 0 14px;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.23536;
  letter-spacing: -0.022em;
  color: #ffffff;
  background: linear-gradient(180deg, #0077ed 0%, #0071e3 100%);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 113, 227, 0.25),
              0 1px 2px rgba(0, 0, 0, 0.1);
}

.dark .submit-btn {
  background: linear-gradient(180deg, #409cff 0%, #0a84ff 100%);
  box-shadow: 0 2px 8px rgba(10, 132, 255, 0.3),
              0 1px 2px rgba(0, 0, 0, 0.2);
}

.submit-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #0080ff 0%, #0077ed 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 113, 227, 0.35),
              0 2px 4px rgba(0, 0, 0, 0.15);
}

.dark .submit-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #5eb0ff 0%, #409cff 100%);
  box-shadow: 0 4px 12px rgba(10, 132, 255, 0.4),
              0 2px 4px rgba(0, 0, 0, 0.25);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 1px 4px rgba(0, 113, 227, 0.2),
              0 1px 2px rgba(0, 0, 0, 0.1);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 1px 4px rgba(0, 113, 227, 0.15);
}

/* Loading Spinner */
.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(255, 255, 255, 0.25);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error Slide Animation */
.error-slide-enter-active,
.error-slide-leave-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.error-slide-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.95);
}

.error-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

/* Responsive */
@media (max-width: 640px) {
  .navbar-inner {
    padding: 0 20px;
  }

  .login-container {
    padding: 72px 20px 40px;
  }

  .login-card {
    max-width: 100%;
  }

  .login-title {
    font-size: 26px;
  }

  .login-subtitle {
    font-size: 14px;
  }

  .form-input {
    height: 42px;
    font-size: 15px;
  }

  .submit-btn {
    height: 42px;
    font-size: 15px;
  }
}

@media (max-width: 374px) {
  .login-title {
    font-size: 24px;
  }

  .checkbox-text {
    font-size: 12px;
  }

  .brand {
    font-size: 17px;
  }
}
</style>
