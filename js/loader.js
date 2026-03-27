// js/loader.js

// 当前加载的人群和语言
let currentCrowd = null;
let currentLang = 'de';

// 加载语言文件
async function loadLanguage(lang) {
    try {
        // 使用相对路径，确保与 CDN = './' 一致
        const response = await fetch(`lang/${lang}.json`);
        if (!response.ok) {
            throw new Error(`语言文件加载失败: ${response.status} ${response.statusText}`);
        }
        window.LANG = await response.json();
        console.log(`[语言加载成功] ${lang}.json 已加载，包含 ${Object.keys(window.LANG).length} 个键`);
    } catch (error) {
        console.error(`[语言加载失败] 无法加载 lang/${lang}.json:`, error);
        // 防止后续代码崩溃，设置一个空对象
        window.LANG = window.LANG || {};
    }
}

// 设置语言
function setLanguage(lang) {
    currentLang = lang;
    // 存储语言偏好
    localStorage.setItem('preferred_lang', lang);
    
    // 如果已经加载了人群，重新加载以应用新语言
    if (currentCrowd) {
        loadCrowd(currentCrowd);
    } else {
        // 如果还没有加载任何人群，也可以选择在这里预加载语言
        loadLanguage(lang).catch(err => console.warn('预加载语言失败，但不影响后续', err));
    }
}

// 加载指定人群的脚本
async function loadCrowd(crowd) {
    // 如果已经加载了同一个人群，不做任何事
    if (crowd === currentCrowd) {
        console.log(`Already loaded ${crowd}`);
        return;
    }

    // 显示加载提示
    document.getElementById('app').innerHTML = '<div style="text-align:center; padding:50px;">加载中...</div>';

    try {
        // 关键步骤1：彻底清理旧脚本的影响
        await cleanupPreviousScript();

        // 关键步骤2：加载当前语言文件
        console.log(`[加载人群前] 准备加载语言: ${currentLang}`);
        await loadLanguage(currentLang);

        // 关键步骤3：动态加载新脚本
        const scriptUrl = `js/main_${crowd}.js`;
        await loadScript(scriptUrl);

        // 关键步骤4：初始化新脚本
        // 通知新加载的脚本，当前选择的语言
        if (window.Router) {
            window.Router.lang = currentLang;
            console.log(`已将 Router.lang 设置为 ${currentLang}`);
        }

        // 如果新脚本有初始化函数，调用它
        if (window.initCrowdModule) {
            console.log(`调用 ${crowd} 的 initCrowdModule()`);
            window.initCrowdModule();
        } else {
            console.warn(`警告：${crowd} 模块没有定义 window.initCrowdModule`);
        }

        // 更新当前人群
        currentCrowd = crowd;

        console.log(`Successfully loaded ${crowd} module`);
    } catch (error) {
        console.error(`Failed to load ${crowd}:`, error);
        document.getElementById('app').innerHTML = `
            <div style="color:red; text-align:center; padding:50px;">
                加载失败: ${error.message}<br>
                <button onclick="loadCrowd('${crowd}')">重试</button>
            </div>
        `;
    }
}

// 动态加载脚本的Promise封装
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`无法加载脚本: ${src}`));
        document.head.appendChild(script);
    });
}

// 清理上一个脚本的影响
async function cleanupPreviousScript() {
    // 1. 找到并移除所有之前动态加载的脚本标签
    const scripts = document.querySelectorAll('script[src^="js/main_"]');
    scripts.forEach(script => script.remove());

    // 2. 清除全局变量（核心！）——注意：这里不再删除 'LANG'
    const globalsToClear = [
        'Router', 'RULE', 'CALC', 'FA_INFO', 'POSTAL_DB', 'moduleCache'
    ];
    
    globalsToClear.forEach(varName => {
        delete window[varName];
    });

    // 3. 退出全屏模式（如果之前进入过）
    if (window.FullscreenManager) {
        window.FullscreenManager.exit();
    }

    // 4. 移除家庭模块的激活类
    const app = document.getElementById('app');
    if (app) {
        app.classList.remove('family-module-active', 'fullscreen-mode');
    }

    // 5. 移除body的全屏类
    document.body.classList.remove('module-fullscreen');

    // 6. 恢复原始页面元素的显示（如果有隐藏）
    const header = document.querySelector('.site-header');
    const crowdSelector = document.getElementById('crowd-selector');
    const footer = document.querySelector('.site-footer');
    
    if (header) header.style.display = '';
    if (crowdSelector) crowdSelector.style.display = '';
    if (footer) footer.style.display = '';

    // 7. 清空app容器
    if (app) app.innerHTML = '';

    // 8. 等待一小段时间，确保所有异步清理完成
    await new Promise(resolve => setTimeout(resolve, 50));
}

// 初始化：检查URL参数和本地存储
window.addEventListener('DOMContentLoaded', async () => {
    // 新增：拦截 styles.css 的 404 请求（临时规避）
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (url.includes('styles.css')) {
            console.warn('跳过加载 styles.css（冗余文件）');
            return Promise.resolve(new Response('', { status: 200 }));
        }
        return originalFetch.apply(this, arguments);
    };

    // 从本地存储恢复语言
    const savedLang = localStorage.getItem('preferred_lang');
    if (savedLang) {
        currentLang = savedLang;
    }

    // 从URL参数获取人群 (例如: index.html?crowd=single)
    const urlParams = new URLSearchParams(window.location.search);
    const crowdParam = urlParams.get('crowd');
    
    if (crowdParam) {
        // URL指定了人群，直接加载
        await loadCrowd(crowdParam);
    } else {
        // 修改点：不显示人群选择提示，app容器保持为空
        // 不再显示"请在上方选择您的人群类型"的文字
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = '';
        }
    }
});

// 暴露给全局，供HTML按钮调用
window.setLanguage = setLanguage;
window.loadCrowd = loadCrowd;