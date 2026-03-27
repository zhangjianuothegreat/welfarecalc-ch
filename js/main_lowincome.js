/* main.js – 完整无省略修正版（集成 IPV / EL / SH / FA 四大算法）*/
const CDN = './'; // 使用相对路径
const STATES = ['AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR',
  'JU', 'LU', 'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG',
  'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'];
/* ========== FA 字段规则定义（Phase 2 最终版）========== */
const FA_FIELD_RULES = {
  base: {
    requiredFields: ['numChildren', 'numEducation']
  },
  hasBirthAllowance: {
    states: ['FR', 'GE', 'JU', 'LU', 'NE', 'SZ', 'UR', 'VD', 'VS'],
    requiredFields: ['numNewborns']
  },
  hasAdoptionAllowance: {
    states: ['FR', 'GE', 'JU', 'LU', 'NE', 'UR', 'VD', 'VS'],
    requiredFields: ['numAdoptions']
  },
  childAgeSplit12: {
    states: ['ZH', 'LU'],
    requiredFields: ['numChildrenOver12']
  },
  educationAgeSplit18: {
    states: ['ZG'],
    requiredFields: ['numEducationOver18']
  }
};
/* 1. 增强的路由状态 */
const Router = {
  lang: 'de',
  crowd: null,
  state: null,
  plz: null,
  form: {},
  rule: null,
  calc: null,
  history: [], // 添加历史记录，用于后退功能
  currentStep: 'crowd',
  resultData: null, // 存储计算结果
  pendingSH: false, // 已经问过用户，等待填写
  shExtraShown: false // 额外字段已展开
};

// ========== 新增：全屏管理器 ==========
const FullscreenManager = {
  // 记录原始页面元素状态
  originalElements: {
    headerDisplay: '',
    crowdSelectorDisplay: '',
    footerDisplay: '',
    bodyBackground: '',
    bodyPadding: '',
    bodyMargin: ''
  },

  // 进入全屏模式（隐藏主页元素 + 应用全屏样式）
  enter: function () {
    const app = document.getElementById('app');
    if (!app) return;

    // 保存原始状态
    const header = document.querySelector('.site-header');
    const crowdSelector = document.getElementById('crowd-selector');
    const footer = document.querySelector('.site-footer');

    this.originalElements.headerDisplay = header ? header.style.display : '';
    this.originalElements.crowdSelectorDisplay = crowdSelector ? crowdSelector.style.display : '';
    this.originalElements.footerDisplay = footer ? footer.style.display : '';
    this.originalElements.bodyBackground = document.body.style.background;
    this.originalElements.bodyPadding = document.body.style.padding;
    this.originalElements.bodyMargin = document.body.style.margin;

    // 隐藏主页元素
    if (header) header.style.display = 'none';
    if (crowdSelector) crowdSelector.style.display = 'none';
    if (footer) footer.style.display = 'none';

    // 应用全屏类
    document.body.classList.add('module-fullscreen');
    app.classList.add('fullscreen-mode', 'lowincome-module-active');

    // 强制居中和宽度限制
    app.style.maxWidth = '900px';
    app.style.margin = '0 auto';
    app.style.padding = '30px 20px';
    app.style.width = '100%';
    app.style.boxSizing = 'border-box';
  },

  // 退出全屏模式（恢复原始状态）
  exit: function () {
    const app = document.getElementById('app');
    if (!app) return;

    // 恢复隐藏元素
    const header = document.querySelector('.site-header');
    const crowdSelector = document.getElementById('crowd-selector');
    const footer = document.querySelector('.site-footer');

    if (header) header.style.display = this.originalElements.headerDisplay;
    if (crowdSelector) crowdSelector.style.display = this.originalElements.crowdSelectorDisplay;
    if (footer) footer.style.display = this.originalElements.footerDisplay;

    // 移除全屏类
    document.body.classList.remove('module-fullscreen');
    app.classList.remove('fullscreen-mode', 'lowincome-module-active');

    // 恢复 body 样式
    document.body.style.background = this.originalElements.bodyBackground;
    document.body.style.padding = this.originalElements.bodyPadding;
    document.body.style.margin = this.originalElements.bodyMargin;

    // 清空 app 最大宽度限制
    app.style.maxWidth = '';
    app.style.margin = '';
    app.style.padding = '';
    app.style.width = '';
  },

  // 重置状态（用于切换模块时调用）
  reset: function () {
    this.exit();
    const app = document.getElementById('app');
    if (app) {
      app.classList.remove('lowincome-module-active', 'fullscreen-mode');
      app.innerHTML = '';
    }
  },

  // 动态加载 main_lowincome.css（低收入版专用）
  loadCSS: async function () {
    // 避免重复加载
    if (document.querySelector('link[href*="main_lowincome.css"]')) {
      console.log('[FullscreenManager] main_lowincome.css 已存在，跳过重复加载');
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = 'css/main_lowincome.css';  // 请确认你的文件路径是否正确

    return new Promise((resolve, reject) => {
      link.onload = () => {
        console.log('[FullscreenManager] main_lowincome.css 加载成功');
        resolve();
      };
      link.onerror = () => {
        console.error('[FullscreenManager] main_lowincome.css 加载失败');
        reject(new Error('CSS load failed'));
      };
      document.head.appendChild(link);
    });
  }
};

/* ========== 福利类型规范化映射表 ========== */
const BENEFIT_TYPE_MAP = {
  // 简写: 全称（用于键名拼接）
  'sh': 'sozialhilfe',
  'ipv': 'ipv',
  'el': 'el',
  'fa': 'fa',
  'alv': 'alv',
  // 添加未来可能的类型
  'iv': 'iv',
  'ahv': 'ahv'
};

// 工具函数：获取标准化后的类型名称
function getNormalizedBenefitType(type) {
  return BENEFIT_TYPE_MAP[type] || type;
}

// 工具函数：生成文档键名（统一入口）
function getDocumentKey(state, type) {
  const normalized = getNormalizedBenefitType(type);
  return `${state}_${normalized}_required_documents_list`;
}

// 工具函数：生成申请信息键名（如果有需要）
function getApplicationInfoKey(state, type, suffix = '') {
  const normalized = getNormalizedBenefitType(type);
  return suffix ? `${state}_${normalized}_${suffix}` : `${state}_${normalized}`;
}

/* ========== FA 相关辅助函数（新增）========== */
/**
 * 根据州和当前表单状态，返回需要的 FA 字段列表
 */
function getRequiredFAFields(formData, state) {
  // 严格校验入参合法性
  if (!formData || typeof formData !== 'object' || !state || typeof state !== 'string') {
    return [];
  }

  // 安全解析数值（兼容空值/非数字输入）
  const numChildren = Number(formData.numChildren) || 0;
  const numEducation = Number(formData.numEducation) || 0;

  // 无孩子且无教育相关人员 → 不需要 FA 额外字段
  if (numChildren + numEducation === 0) {
    return [];
  }

  // 只收集额外字段（排除基础字段 numChildren 和 numEducation）
  const required = new Set();

  // 遍历所有 FA 规则（跳过基础规则）
  Object.entries(FA_FIELD_RULES).forEach(([ruleKey, rule]) => {
    if (ruleKey === 'base') return; // 跳过基础字段规则

    // 校验规则结构 + 州匹配
    if (!Array.isArray(rule.states) || !rule.states.includes(state)) return;
    if (!Array.isArray(rule.requiredFields)) return;

    // 遍历当前规则下的必填字段
    rule.requiredFields.forEach(field => {
      // 按字段类型做精细化校验（避免无数据时添加字段）
      switch (field) {
        case 'numChildrenOver12':
          if (numChildren > 0) required.add(field);
          break;
        case 'numEducationOver18':
          if (numEducation > 0) required.add(field);
          break;
        case 'numNewborns':
          if (numChildren > 0) required.add(field);
          break;
        case 'numAdoptions':
          if (numChildren > 0) required.add(field);
          break;
        default:
          // 兼容未来扩展字段（默认添加）
          required.add(field);
      }
    });
  });

  return Array.from(required);
}
/**
 * 构建 FA 算法所需的数据对象
 */
function buildFAFormData(formData) {
  // 入参默认值 + 类型校验
  const safeFormData = (formData && typeof formData === 'object') ? formData : {};

  // 安全解析数值（确保非负整数）
  const safeInt = (key) => {
    const val = safeFormData[key];
    const num = parseInt(val, 10);
    return (isNaN(num) || num < 0) ? 0 : num;
  };

  const numChildren = safeInt('numChildren');
  const numEducation = safeInt('numEducation');

  // 计算衍生字段（确保不超过基础数值）
  const numChildrenOver12 = Math.min(safeInt('numChildrenOver12'), numChildren);
  const numEducationOver18 = Math.min(safeInt('numEducationOver18'), numEducation);
  const numNewborns = Math.min(safeInt('numNewborns'), numChildren);
  const numAdoptions = Math.min(safeInt('numAdoptions'), numChildren);

  return {
    numChildren,
    numEducation,
    totalChildren: numChildren + numEducation,
    numNewborns,
    numAdoptions,
    numChildrenOver12,
    numEducationOver18
  };
}
/**
 * 标准化 FA 计算结果
 */
function normalizeFAResult(raw, input, state) {
  const childMonthlyRaw = raw.breakdown?.childMonthly || raw.childMonthly || 0;
  const educationMonthlyRaw = raw.breakdown?.educationMonthly || raw.educationMonthly || 0;
  const monthly = childMonthlyRaw + educationMonthlyRaw;
  const annual = monthly * 12;

  return {
    // 核心字段
    eligible: monthly > 0 || (raw.birthAllowance || 0) > 0 || (raw.adoptionAllowance || 0) > 0,
    monthlyBenefit: monthly,
    annualBenefit: annual,
    monthly: monthly,
    annual: annual,

    // 一次性津贴（明确标记为FA特有）
    oneTime: {
      birth: raw.birthAllowance || 0,
      adoption: raw.adoptionAllowance || 0
    },

    // 详细分类
    breakdown: {
      children: {
        count: input.numChildren || 0,
        monthlyTotal: childMonthlyRaw
      },
      education: {
        count: input.numEducation || 0,
        monthlyTotal: educationMonthlyRaw
      },
      special: {
        newborns: input.numNewborns || 0,
        adoptions: input.numAdoptions || 0
      }
    },

    // 解释和元数据
    explanation: raw.explanation || { steps: [], note_key: '' },
    meta: {
      state,
      benefitType: 'fa',  // 明确标记为FA
      rulesApplied: raw.appliedRules || []
    },

    // 错误处理
    error: null
  };
}
/**
 * 加载 FA 申请信息
 */
async function loadFAInfo(state) {
  if (!window.FA_INFO) window.FA_INFO = {};
  if (window.FA_INFO[state]) return window.FA_INFO[state];
  try {
    const response = await fetch(resolvePath(`data/fa/meta/fa_${state}.json`));
    if (!response.ok) throw new Error('FA info not found');
    const data = await response.json();
    window.FA_INFO[state] = data[state] || data; // 扁平化：取 data.AG 或 data
    console.log(`FA info loaded for ${state}:`, window.FA_INFO[state]); // 加 log 检查
    return window.FA_INFO[state];
  } catch (e) {
    console.warn(`FA info for ${state} not found`);
    return null;
  }
}
/**
 * 更新 FA 额外字段的显示状态
 */
function updateFAExtraFieldsVisibility() {
  const state = Router.state;
  const formData = Router.form;

  // 前置校验：州/表单数据未初始化时隐藏整个区域
  const faSection = document.getElementById('fa-extra-fields');
  if (!faSection || !state || !formData) {
    if (faSection) faSection.style.display = 'none';
    return;
  }

  // 获取当前州需要的 FA 额外字段
  const requiredFields = getRequiredFAFields(formData, state);

  // 无额外字段 → 隐藏整个区域
  if (requiredFields.length === 0) {
    faSection.style.display = 'none';
    return;
  }

  // 显示 FA 额外字段区域
  faSection.style.display = 'block';

  // 基础字段映射（仅 FA 额外字段）
  const fieldMap = {
    'numNewborns': 'fa-field-newborns',
    'numAdoptions': 'fa-field-adoptions',
    'numChildrenOver12': 'fa-field-children-over12',
    'numEducationOver18': 'fa-field-education-over18'
  };

  // 遍历所有字段，更新显示/必填状态
  Object.entries(fieldMap).forEach(([field, elementId]) => {
    const el = document.getElementById(elementId);
    if (!el) return; // 元素不存在则跳过

    const isRequired = requiredFields.includes(field);

    // 更新元素显示状态
    el.style.display = isRequired ? 'block' : 'none';

    // 更新输入框状态（必填 + 清空非必填字段值）
    const input = el.querySelector('input');
    if (input) {
      input.required = isRequired;
      if (!isRequired) {
        input.value = '0'; // 清空非必填字段值，避免脏数据
        input.removeAttribute('required'); // 显式移除必填属性
      } else {
        input.setAttribute('required', 'required'); // 显式添加必填属性
        // 确保输入值合法（非负整数）
        if (input.value === '' || isNaN(Number(input.value)) || Number(input.value) < 0) {
          input.value = '0';
        }
      }
    }
  });
}
/* 2. 模块缓存 - 保持模块化但简单 */
const moduleCache = {};
/* 3. 路径解析函数 - 修复路径问题 */
function resolvePath(path) {
  // 如果已经是完整URL，直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // 如果是绝对路径（以/开头），相对于网站根目录
  if (path.startsWith('/')) {
    return window.location.origin + path;
  }
  // 相对路径，相对于当前页面
  const baseUrl = window.location.href.split('/').slice(0, -1).join('/') + '/';
  return new URL(path, baseUrl).href;
}
/* 4. 启动 */
window.onload = async () => {
  // 新增：如果是被loader加载，就不自动启动
  if (window.location.search.includes('crowd=')) return;

  document.body.innerHTML = '<div id="app"></div>';
  await loadLanguage();
  //addStyles();

  Router.crowd = 'low_income';

  render('state');  // ✅ 改成 state，跳过人群选择

  // 验证类型映射
  console.log('[Validation] Benefit type mapping:', {
    'sh → sozialhilfe': getNormalizedBenefitType('sh') === 'sozialhilfe',
    'ipv → ipv': getNormalizedBenefitType('ipv') === 'ipv',
    'el → el': getNormalizedBenefitType('el') === 'el',
    'fa → fa': getNormalizedBenefitType('fa') === 'fa'
  });

  // 监听未来可能的问题
  window.addEventListener('error', (e) => {
    if (e.message.includes('required_documents_list')) {
      console.error('Document key error detected:', e.message);
    }
  });
};

/* 6. 语言包加载器（硬编码德语）- 未来可改为加载JSON文件 */
async function loadLanguage(lang = 'de') {
  try {
    const response = await fetch(resolvePath(`lang/${lang}.json`));
    if (!response.ok) {
      throw new Error(`Language file not found: ${lang}.json (status ${response.status})`);
    }
    window.LANG = await response.json();
    console.log(`Sprache ${lang} erfolgreich geladen (${Object.keys(window.LANG).length} Schlüssel)`);
  } catch (error) {
    console.error('Sprachdatei konnte nicht geladen werden, fallback auf Minimal-Deutsch', error);
    // 极简备用，只保核心界面不崩溃（不到50行！）
    window.LANG = {
      lang: 'de',
      lang_de: 'Deutsch',
      lowincome_el_not_supported: "Geringverdiener-Modus unterstützt keine EL-Berechnung",
      lowincome_el_explanation: "EL (Ergänzungsleistungen) richtet sich primär an Rentner/innen oder Personen mit IV-Rente.",
      ask_el_confirm_lowincome: "Für Geringverdiener ist EL in der Regel nicht relevant.",
      eingabeinformationen: 'Eingabeinformationen',
      zielgruppe: 'Zielgruppe',
      sh_recalc_hint_title: "IPV Berechnung abgeschlossen!",
      sh_recalc_hint_text: "Bitte prüfen und ergänzen Sie die <strong>Sozialhilfe-Zusatzangaben</strong> oben (insbesondere Erwerbssituation und medizinische Bedürfnisse).",
      sh_recalc_hint_action: "Klicken Sie dann erneut auf <strong>Sozialhilfe neu berechnen</strong>, um das Ergebnis zu sehen.",
      welcome_family: "Willkommen beim Familien-Rechner",
      welcome_single: "Willkommen beim Einzelperson-Rechner",
      welcome_student: "Willkommen beim Studenten-Rechner",
      welcome_low_income: "Willkommen beim Geringverdiener-Rechner",
      welcome_pregnant: "Willkommen beim Schwangeren-Rechner",
      welcome_unemployed: "Willkommen beim Arbeitslosen-Rechner",
      welcome_disabled: "Willkommen beim Rechner für Menschen mit Behinderung",
      welcome_refugee: "Willkommen beim Flüchtlings-Rechner",
      welcome_retired: "Willkommen beim Rentner-Rechner",
      select_crowd: 'Personengruppe auswählen',
      crowd_family: 'Familie',
      crowd_single: 'Einzelperson',
      crowd_student: 'Student',
      crowd_retired: 'Rentner',
      crowd_low_income: 'Geringverdiener',
      crowd_pregnant: 'Schwangere Person',
      crowd_unemployed: 'Arbeitsloser',
      crowd_disabled: 'Behinderte Person',
      crowd_refugee: 'Flüchtling',
      canton: 'Kanton',
      postal_code: 'Postleitzahl',
      continue: 'Weiter',
      input_data: 'Daten eingeben',
      annual_income: 'Jahreseinkommen',
      assets: 'Vermögen',
      input_data_low_income: "Daten für Personen mit niedrigem Einkommen",
      low_income_mode_active: "Geringverdiener-Modus aktiv",
      low_income_hint: "Bitte geben Sie Ihre finanzielle und berufliche Situation so genau wie möglich an. Das beeinflusst vor allem die mögliche Sozialhilfe (SH) und Prämienverbilligung (IPV).",
      label_arbeitspensum: "Aktuelles Arbeitspensum (%)",
      hint_arbeitspensum: "z. B. 40 %, 60 %, 80 % oder 100 %. Wichtig für die Einschätzung der Erwerbsfähigkeit und Zumutbarkeit.",
      label_zusatzbedarf_monatlich: "Monatliche zusätzliche anerkannte Bedürfnisse (CHF)",
      hint_zusatzbedarf_monatlich: "z. B. Krankheitskosten, Zahnbehandlungen, Brille, behinderungsbedingte Mehrkosten, teure Anfahrt. Nur realistische, üblicherweise anerkannte Beträge.",
      employment_employed_full: "Vollzeit erwerbstätig",
      employment_employed_part: "Teilzeit erwerbstätig",
      employment_employed_minijob: "Geringfügig / Minijob / Gelegenheitsarbeit",
      employment_self_employed: "Selbständig / freiberuflich",
      employment_unemployed: "Arbeitslos (mit oder ohne ALV)",
      employment_unable: "Arbeitsunfähig / krankgeschrieben",
      employment_other: "Andere Situation",
      hint_employment_status_low_income: "Ihre Erwerbssituation ist für Geringverdiener besonders wichtig (z. B. Teilzeit oder Minijob wirkt sich auf die Zumutbarkeit aus)",
      select_crowd_retired: 'Willkommen beim Rentner-Rechner',
      retired_mode_hint: 'Für Rentner (AHV/IV-Bezieher) – berechnet IPV, EL (Ergänzungsleistungen) und SH mit Rentenzuschlägen.',
      input_data_retired: 'Rentnerdaten eingeben',
      retired_mode_active: 'Rentner-Modus aktiv',
      retired_hint: 'Bitte geben Sie Ihre Renten- und Lebenssituation ein. Dies beeinflusst EL und SH-Zuschläge.',
      ask_el_confirm_retired: 'Für Rentner ist EL oft relevant. Prüfen?',
      monthly_pension: 'Monatliche AHV/IV-Rente (CHF)',
      health_insurance_premium: 'Krankenkassenprämie (CHF/Jahr)',
      num_adults: 'Anzahl Erwachsene',
      num_children: 'Anzahl Kinder',
      calculate: 'Berechnen',
      result_title: 'Berechnungsergebnis',
      annual_benefit: 'Jährlicher Anspruch',
      monthly_benefit: 'Monatlicher Anspruch',
      download_pdf: 'PDF herunterladen',
      rent: 'Miete',
      monthly_rent: 'Monatsmiete',
      region: 'Region',
      ipv_title: 'Individuelle Prämienverbilligung (IPV)',
      el_title: 'Ergänzungsleistungen zur AHV/IV (EL)',
      fa_title: 'Familienzulagen (FA)',
      sh_title: 'Sozialhilfe',
      disclaimer_important: 'Wichtiger Hinweis',
      disclaimer_content: 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen.',
      annual_short: 'Jährlich',
      monthly_short: 'Monatlich',
      details_expand: 'Details anzeigen',
      details_collapse: 'Details ausblenden',
      no_sh_when_el_title: 'EL vs. Sozialhilfe',
      no_sh_when_el_message: 'Bei Bezug von Ergänzungsleistungen (EL) besteht in der Regel kein Anspruch auf Sozialhilfe, da EL den Existenzbedarf bereits abdeckt.',
      // 州名称（必须有，显示用）
      AG_name: 'Aargau', AI_name: 'Appenzell Innerrhoden', AR_name: 'Appenzell Ausserrhoden',
      BE_name: 'Bern', BL_name: 'Basel-Landschaft', BS_name: 'Basel-Stadt',
      FR_name: 'Freiburg', GE_name: 'Genf', GL_name: 'Glarus', GR_name: 'Graubünden',
      JU_name: 'Jura', LU_name: 'Luzern', NE_name: 'Neuenburg', NW_name: 'Nidwalden',
      OW_name: 'Obwalden', SG_name: 'St. Gallen', SH_name: 'Schaffhausen',
      SO_name: 'Solothurn', SZ_name: 'Schwyz', TG_name: 'Thurgau', TI_name: 'Tessin',
      UR_name: 'Uri', VD_name: 'Waadt', VS_name: 'Wallis', ZG_name: 'Zug', ZH_name: 'Zürich',
      // EL 准入错误提示
      err_no_ahv_iv: 'Kein EL-Anspruch: Sie müssen eine AHV- oder IV-Rente beziehen.',
      err_residence_10y: 'Kein EL-Anspruch: Für Drittstaatsangehörige ist ein Aufenthalt von 10 Jahren erforderlich.',
      err_residence_5y: 'Kein EL-Anspruch: Für anerkannte Flüchtlinge ist ein Aufenthalt von 5 Jahren erforderlich.',
      err_asset_exceeded_federal: 'Kein EL-Anspruch: Ihr Reinvermögen übersteigt die gesetzliche Grenze von 100\'000 (Alleinstehende) / 200\'000 (Ehepaare).',
      el_precheck_title: 'Zusatzprüfung für EL',
      ask_el_confirm: 'Möchten Sie zusätzlich Ihren Anspruch auf Ergänzungsleistungen (EL) prüfen lassen?',
      confirm_yes: 'Ja, prüfen',
      confirm_no: 'Nein, nur IPV',
      // 新增：养老金无领取警告
      pension_type_none: 'Ich beziehe keine Rente',
      err_el_no_pension_warning: 'Hinweis: Gesetzlich besteht ein Anspruch auf EL nur für Personen, die bereits eine AHV- oder IV-Rente beziehen. Ohne eine solche Rente kann keine EL berechnet werden.',
      // 通用错误
      err_general_no_entitlement: 'Leider kein Anspruch auf diese Leistung.',
      error: 'Fehler',
      error_postcode_format: 'Ungültiges PLZ-Format (muss 4 Ziffern sein).',
      error_invalid_postcode: 'Postleitzahl ungültig oder nicht in Datenbank gefunden.',
      error_postcode_wrong_canton: 'Postleitzahl passt nicht zum ausgewählten Kanton.',
      error_load_postal_data: 'Postleitzahldaten konnten nicht geladen werden.',
      error_calculation_failed: 'Berechnung fehlgeschlagen.',
      error_generate_pdf: 'PDF-Erstellung fehlgeschlagen.',
      error_html2pdf_not_loaded: 'html2pdf-Bibliothek nicht geladen.',
      error_template_not_found: 'PDF-Vorlage nicht gefunden.',
      err_skipped_by_user: 'EL-Prüfung auf Wunsch übersprungen.',
      // 新增键名
      label_is_receiving_pension: 'Beziehen Sie eine AHV- oder IV-Rente?(Für Rentner gelten bei Erwerbseinkommen und Renten unterschiedliche Anrechnungsregeln. Für eine detaillierte EL-Berechnung nutzen Sie bitte unsere <strong>Rentner-Version)',
      label_pension_type: 'Rentenart',
      pension_type_hint: 'Wählen Sie AHV für Altersrente oder IV für Invalidenrente.',
      pension_type_ahv: 'AHV (Altersrente)',
      pension_type_iv: 'IV (Invalidenrente)',
      nat_ch_eu: 'Schweiz / EU / EFTA',
      nat_non_eu: 'Drittstaat (z.B. B/C-Ausweis)',
      nat_refugee: 'Flüchtling / Staatenlos (F/B-Ausweis)',
      label_nationality: 'Nationalität / Aufenthaltsstatus',
      label_residence_years: 'Anzahl Jahre in der Schweiz wohnhaft',
      yes: 'Ja',
      no: 'Nein',
      select_state_plz: 'Kanton und PLZ wählen',
      please_enter_postcode: 'Bitte geben Sie eine Postleitzahl ein.',
      postcode_validation_pending: 'Postleitzahl wird noch geprüft, bitte warten.',
      select_canton: 'Kanton auswählen',
      please_fill_all_fields: 'Bitte füllen Sie alle erforderlichen Felder korrekt aus.',
      refugee_f_status: '(F-Status)',
      young_adults_education: 'Junge Erwachsene in Ausbildung (19-25):',
      ahv_iv_claim: 'AHV/IV-Bezug:',
      nationality: 'Nationalität:',
      residence_years: 'Aufenthaltsjahre:',
      sh_precheck_hint: 'Ihre Angaben deuten auf einen möglichen Anspruch auf Sozialhilfe hin. Möchten Sie eine detaillierte Berechnung durchführen? (Zusätzliche Angaben erforderlich)',
      sh_extra_fields_title: 'Zusätzliche Angaben für Sozialhilfe',
      label_employment_status: 'Beschäftigungsstatus',
      employment_employed: 'Beschäftigt',
      employment_unemployed: 'Arbeitslos',
      employment_unable: 'Arbeitsunfähig',
      employment_other: 'Anderes',
      label_has_medical_needs: 'Haben Sie medizinische Bedürfnisse?',
      sozialhilfe_title: 'Sozialhilfe',
      err_no_entitlement_sh: 'Kein Anspruch auf Sozialhilfe.',
      recalc_sh: 'Sozialhilfe berechnen',
      // FA 相关翻译（新增）
      fa_extra_title: 'Familienzulagen (FA) - Zusätzliche Angaben',
      label_num_newborns: 'Anzahl Neugeborene (für Geburtsszulage)',
      label_num_adoptions: 'Anzahl Adoptionen (für Adoptionszulage)',
      label_children_over12: 'Anzahl Kinder über 12 Jahre',
      label_education_over18: 'Anzahl Auszubildende über 18 Jahre',
      fa_onetime_allowances: 'Einmalzahlungen',
      birth_allowance: 'Geburtsszulage',
      adoption_allowance: 'Adoptionszulage',
      onetime_payment: 'Einmalig'
    };
  }
  document.documentElement.lang = window.LANG.lang || 'de';
}
/* 7. 渲染器 - 学生版优化：进入 form 时重置 SH 相关残留数据 */
function render(step, isBack = false) {
  const app = document.getElementById('app');
  if (!app) return;

  // ========== 新增：全屏模式控制 ==========
  // 确保全屏模式（如果尚未进入）
  if (!document.body.classList.contains('module-fullscreen')) {
      FullscreenManager.enter();
  }
  // ========== 全屏控制结束 ==========

  // 新增的日志打印代码
  console.log('render called, step:', step, 'crowd:', Router.crowd);

  // 如果不是回退操作，记录历史
  if (!isBack && step !== Router.currentStep) {
    Router.history.push(Router.currentStep);
  }
  Router.currentStep = step;

  let formTemplate = tmplForm; // 默认用学生版
  if (Router.crowd === 'retired') {
    if (typeof tmplRetired === 'function') {
      formTemplate = tmplRetired;
    } else {
      console.error('tmplRetired 未定义，使用默认 tmplForm');
    }
  }

  // 低收入版特殊处理（非form步骤时的基础处理，form步骤的处理移到下方）
  if (Router.crowd === 'low_income' && step !== 'form') {
    // 默认展开 SH 额外字段
    const shExtra = document.getElementById('sh-extra-fields');
    if (shExtra) {
      shExtra.style.display = 'block';
    }
    // 标记已展开，并进入等待 SH 填写状态
    Router.shExtraShown = true;
    Router.pendingSH = true;

    // 默认不展开 EL 额外字段（已在模板中设为 display:none）
    const elExtra = document.getElementById('el-extra-fields');
    if (elExtra) {
      elExtra.style.display = 'none';
    }
    // 默认选中 “Nein” （已在模板中设为 checked）
  }

  // 非form步骤的页面渲染
  if (step !== 'form') {
    app.innerHTML = {
      crowd: tmplCrowd,
      state: tmplState,
      form: Router.crowd === 'low_income' ? tmplLowIncome : 
            Router.crowd === 'retired' ? tmplRetired : tmplForm,
      result: tmplResult
    }[step]();
  }

  // form步骤的专属渲染逻辑（替换后的完整代码）
  if (step === 'form') {
    console.log('Using form template for crowd:', Router.crowd);

    const formTemplates = {
      retired: tmplRetired,
      low_income: tmplLowIncome,
      // 可以继续扩展
    };

    const formTemplate = formTemplates[Router.crowd] || tmplForm;

    app.innerHTML = {
      crowd: tmplCrowd,
      state: tmplState,
      form: formTemplate,
      result: tmplResult
    }[step]();

    // 人群特定初始化（必须在 innerHTML 之后执行）
    if (Router.crowd === 'low_income') {
      // SH 默认展开 + 进入 pending 状态
      const shExtra = document.getElementById('sh-extra-fields');
      if (shExtra) {
        shExtra.style.display = 'block';
      }
      Router.shExtraShown = true;
      Router.pendingSH = true;

      // EL 默认隐藏 + 选中 Nein
      const elExtra = document.getElementById('el-extra-fields');
      if (elExtra) {
        elExtra.style.display = 'none';
      }
      const elNoRadio = document.querySelector('input[name="checkEL"][value="no"]');
      if (elNoRadio) {
        elNoRadio.checked = true;
      }
    }

    // 进入 form 页面时，重置可能残留的 SH 相关字段（防止重复累加）
    // 清空或重置 SH 额外字段值
    const shFields = ['employmentStatus', 'hasMedicalNeeds', 'other_income_annual', 'monthly_other_expenses', 'ipvReceivedAnnual', 'elReceivedAnnual'];
    shFields.forEach(field => {
      const el = document.querySelector(`[name="${field}"]`);
      if (el) {
        if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
        else if (el.tagName === 'SELECT') el.value = '';
        else el.value = field.includes('monthly_other_expenses') || field.includes('other_income') ? '0' : '';
      }
    });

    // 同时清空 Router.form 里的 SH 相关缓存（防止计算时用旧值）
    delete Router.form.monthly_other_expenses;
    delete Router.form.other_income_annual;
    delete Router.form.employmentStatus;
    delete Router.form.hasMedicalNeeds;

    // 强制重置 pendingSH 和 shExtraShown（防止状态残留）
    Router.pendingSH = false;
    Router.shExtraShown = false;

    console.log('Form page entered: SH extra fields and Router.form SH cache reset');

    // 恢复表单数据（如果是回退到表单页面）
    if (Object.keys(Router.form).length > 0) {
      restoreFormData();
    }
  }

  bindEvents(step);

  // 如果是结果页面，填充数据
  if (step === 'result' && Router.resultData) {
  fillResultPage();
  const hintBox = document.getElementById('sh-recalc-hint');
  if (hintBox) hintBox.style.display = 'none';
  }
}
/* 8. 返回函数 - 直接跳转到主页面 */
function goBack() {
    window.location.href = 'https://www.welfarecalc.ch/';
}

/* 9. 事件绑定 */
function bindEvents(step) {
  if (step === 'crowd') {
    const select = document.getElementById('sel-crowd');
    if (select) {
      select.onchange = e => {
        Router.crowd = e.target.value;
        render('state');
      };
    }
    // 添加按钮点击事件
    const btnState = document.getElementById('btn-state');
    if (btnState) {
      btnState.onclick = () => {
        const select = document.getElementById('sel-crowd');
        if (select && select.value) {
          Router.crowd = select.value;
          render('state');
        } else {
          alert(t('select_crowd'));
        }
      };
    }
  }

  if (step === 'state') {
    const stateSelect = document.getElementById('sel-state');
    if (stateSelect) {
      stateSelect.onchange = e => Router.state = e.target.value;
    }
    const plzInput = document.getElementById('inp-plz');
    const btnState = document.getElementById('btn-state');
    let plzValid = false;

    if (plzInput) {
      plzInput.addEventListener('input', async (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 4) v = v.slice(0, 4);
        e.target.value = v;
        // 每次输入后重置按钮状态
        btnState.disabled = true;
        plzValid = false;
        if (v.length === 4 && Router.state) {
          const ok = await validatePlz(v, Router.state);
          if (ok) {
            plzValid = true;
            btnState.disabled = false;
            Router.plz = v; // 保存邮编
          }
        }
      });
    }

    if (btnState) {
      btnState.onclick = async () => {
        if (!Router.state) return alert(t('select_canton'));
        const raw = plzInput.value.trim();
        if (!raw) return alert(t('please_enter_postcode'));
        if (!/^\d{4}$/.test(raw)) return alert(t('error_postcode_format'));
        if (!plzValid) return alert(t('postcode_validation_pending'));
        Router.plz = raw;
        await loadStateRule(Router.state);
        render('form');
      };
    }

    // 添加返回按钮
    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = goBack;
    }
  }

  if (step === 'form') {
    // EL 字段动态显隐（已修复：动态控制 required 属性，默认禁用）
    const radiosEL = document.querySelectorAll('input[name="checkEL"]');
    const elBlock = document.getElementById('el-extra-fields');

    // 关键修复：初始化函数 - 确保默认状态下 EL 字段完全禁用
    const initELFieldsState = () => {
      const isELChecked = document.querySelector('input[name="checkEL"][value="yes"]')?.checked;
      if (!isELChecked && elBlock) {
        // 默认未选中 EL，强制禁用所有字段
        elBlock.style.display = 'none';
        elBlock.querySelectorAll('select, input').forEach(el => {
          el.required = false;
          el.disabled = true;
          // 清空值
          if (el.type === 'radio' || el.type === 'checkbox') {
            el.checked = false;
          } else {
            el.value = '';
          }
        });
        // 隐藏子元素
        const warningEl = document.getElementById('el-no-pension-warning');
        const typeBox = document.getElementById('pension-type-field');
        if (warningEl) warningEl.style.display = 'none';
        if (typeBox) typeBox.style.display = 'none';
      }
    };

    // 立即执行初始化
    initELFieldsState();

    radiosEL.forEach(r => {
      r.addEventListener('change', e => {
        const isYes = e.target.value === 'yes';

        if (isYes) {
          elBlock.style.display = 'block';
          // 启用所有需要验证的字段
          elBlock.querySelectorAll('select, input').forEach(el => {
            el.disabled = false;
            // 只对关键字段添加 required
            if (el.name === 'nationality' || el.name === 'residenceYears' ||
              el.name === 'isReceivingPension') {
              el.required = true;
            }
          });
          resetELFields(); // 清空旧值
        } else {
          elBlock.style.display = 'none';
          // 禁用所有字段并移除 required，避免隐藏字段触发验证
          elBlock.querySelectorAll('select, input').forEach(el => {
            el.required = false;
            el.disabled = true;
            if (el.type === 'radio' || el.type === 'checkbox') {
              el.checked = false;
            } else {
              el.value = '';
            }
          });
          // 隐藏警告框和子区域
          const warningEl = document.getElementById('el-no-pension-warning');
          const typeBox = document.getElementById('pension-type-field');
          const otherFields = document.getElementById('el-other-fields');
          if (warningEl) warningEl.style.display = 'none';
          if (typeBox) typeBox.style.display = 'none';
          if (otherFields) {
            otherFields.querySelectorAll('select, input').forEach(i => {
              i.value = '';
              i.required = false;
              i.disabled = true;
            });
          }
        }
      });
    });

    // 养老金选择联动 + 实时阻断
    const pensionRadios = document.querySelectorAll('input[name="isReceivingPension"]');
    const typeBox = document.getElementById('pension-type-field');
    const warningBox = document.getElementById('el-no-pension-warning');
    const otherFields = document.getElementById('el-other-fields');

    pensionRadios.forEach(r => {
      r.addEventListener('change', e => {
        if (e.target.value === 'ahv' || e.target.value === 'iv') {
          typeBox.style.display = 'block';
          warningBox.style.display = 'none';
          otherFields.style.display = 'block';
          // 自动选中对应类型
          const targetType = e.target.value.toUpperCase();
          const radioToCheck = document.querySelector(`input[name="pensionType"][value="${targetType}"]`);
          if (radioToCheck) radioToCheck.checked = true;
          // 启用字段
          otherFields.querySelectorAll('select, input').forEach(i => {
            i.disabled = false;
            // 只对必要字段设置 required
            if (i.name === 'nationality' || i.name === 'residenceYears') {
              i.required = true;
            }
          });
        } else if (e.target.value === 'no') {
          typeBox.style.display = 'none';
          warningBox.style.display = 'block';
          otherFields.style.display = 'block';
          // 清除并禁用
          document.querySelectorAll('input[name="pensionType"]').forEach(pt => pt.checked = false);
          otherFields.querySelectorAll('select, input').forEach(i => {
            i.value = '';
            i.required = false;
            i.disabled = true;
          });
        }
      });
    });

    /* ========== FA 字段动态显隐逻辑（新增）========== */
    const childrenInput = document.querySelector('input[name="numChildren"]');
    const educationInput = document.querySelector('input[name="numEducation"]');

    if (childrenInput) {
      childrenInput.addEventListener('input', () => {
        collectForm();
        updateFAExtraFieldsVisibility();
      });
    }
    if (educationInput) {
      educationInput.addEventListener('input', () => {
        collectForm();
        updateFAExtraFieldsVisibility();
      });
    }

    // 初始检查 FA 字段显示
    updateFAExtraFieldsVisibility();

    // 修改计算按钮逻辑，添加前置检查
    const btnCalcOriginal = document.getElementById('btn-calc');
    if (btnCalcOriginal) {
      // 保存原始点击处理函数
      const originalBtnCalcClick = async () => {
        if (!validateForm()) return;
        collectForm();
        try {
          const result = await runCalculation();
          if (result === null) {
            // 用户刚确认了 SH，需要填写额外字段 → 留在表单页，并改按钮文字提醒
            console.log('Waiting for SH input...');
            const btnCalc = document.getElementById('btn-calc');
            if (btnCalc) {
              btnCalc.textContent = t('recalc_sh') || 'Sozialhilfe berechnen';
              btnCalc.style.backgroundColor = '#ffc107'; // 黄色警示
              btnCalc.style.color = '#212529';
            }
          } else {
            // 正常结果，恢复按钮
            const btnCalc = document.getElementById('btn-calc');
            if (btnCalc) {
              btnCalc.textContent = t('calculate') || 'Berechnen';
              btnCalc.style.backgroundColor = '';
              btnCalc.style.color = '';
            }
            Router.resultData = result;
            render('result');
          }
        } catch (e) {
          console.error(e);
          alert(t('error_calculation_failed'));
        }
      };

      btnCalcOriginal.onclick = async () => {
        // 前置检查1：EL=yes 但没选养老金
        const checkEL = document.querySelector('input[name="checkEL"]:checked');
        const isReceivingPension = document.querySelector('input[name="isReceivingPension"]:checked');
        if (checkEL?.value === 'yes' && isReceivingPension?.value === 'no') {
          alert(t('err_el_no_pension_warning') + '\n\nBitte wählen Sie "Nein, nur IPV" oder korrigieren Sie Ihre Eingabe.');
          return;
        }

        // 前置检查2：SH 已显示时验证必填项
        if (Router.pendingSH || document.getElementById('sh-extra-fields')?.style.display !== 'none') {
          const employmentSelect = document.querySelector('select[name="employmentStatus"]');
          const medicalRadio = document.querySelector('input[name="hasMedicalNeeds"]:checked');
          let errorMessage = '';
          if (!employmentSelect?.value) {
            errorMessage = t('error_sh_employment_required') || 'Bitte wählen Sie einen Beschäftigungsstatus.';
          } else if (!medicalRadio) {
            errorMessage = t('error_sh_medical_needs_required') || 'Bitte geben Sie an, ob medizinische Bedürfnisse bestehen.';
          }
          if (errorMessage) {
            alert(errorMessage);
            if (!employmentSelect?.value) employmentSelect?.focus();
            else document.querySelector('input[name="hasMedicalNeeds"]')?.parentElement?.scrollIntoView();
            return;
          }
        }

        // 继续计算
        await originalBtnCalcClick();
      };
    }

    // 添加返回按钮
    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = goBack;
    }

    // 回退时保持 SH 额外字段可见
    if (Router.shExtraShown) {
      const shExtra = document.getElementById('sh-extra-fields');
      if (shExtra) shExtra.style.display = 'block';
    }

    // SH 字段实时验证样式
    const shExtraFields = document.getElementById('sh-extra-fields');
    if (shExtraFields && shExtraFields.style.display !== 'none') {
      const employmentSelect = shExtraFields.querySelector('select[name="employmentStatus"]');
      const medicalRadios = shExtraFields.querySelectorAll('input[name="hasMedicalNeeds"]');

      if (employmentSelect) {
        employmentSelect.addEventListener('change', function () {
          this.style.borderColor = this.value ? '#28a745' : '#dc3545';
        });
      }

      if (medicalRadios.length > 0) {
        medicalRadios.forEach(radio => {
          radio.addEventListener('change', () => {
            const hasSelection = document.querySelector('input[name="hasMedicalNeeds"]:checked');
            medicalRadios.forEach(r => {
              r.parentElement.style.fontWeight = hasSelection ? 'normal' : 'bold';
              r.parentElement.style.color = hasSelection ? 'inherit' : '#dc3545';
            });
          });
        });
      }
    }
  }

  if (step === 'result') {
    const btnPdf = document.getElementById('btn-pdf');
    if (btnPdf) {
      btnPdf.onclick = () => {
        try {
          generatePDF();
        } catch (e) {
          alert(t('error_generate_pdf'));
        }
      };
    }

    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = goBack;
    }

    const recalcBtn = document.getElementById('btn-recalc');
    if (recalcBtn) {
      recalcBtn.onclick = () => {
        const btnCalc = document.getElementById('btn-calc');
        if (btnCalc) {
          btnCalc.textContent = t('calculate') || 'Berechnen';
          btnCalc.style.backgroundColor = '';
          btnCalc.style.color = '';
        }
        render('form', true);
      };
    }

    // 动态设置所有 toggle-hint 的文字（展开/收起提示）
    document.querySelectorAll('.benefit-details .toggle-hint').forEach(hint => {
      const details = hint.closest('.benefit-details');
      if (details) {
        hint.textContent = details.open
          ? `(${t('details_collapse') || 'Details einklappen'})`
          : `(${t('details_expand') || 'Details anzeigen'})`;
      }
    });

    // 监听 toggle 事件，实时更新提示文字
    document.querySelectorAll('.benefit-details').forEach(details => {
      details.addEventListener('toggle', () => {
        const hint = details.querySelector('.toggle-hint');
        if (hint) {
          hint.textContent = details.open
            ? `(${t('details_collapse') || 'Details einklappen'})`
            : `(${t('details_expand') || 'Details anzeigen'})`;
        }
      });
    });
  }
}
/* 10. 州规则 + 算法 - 使用模块缓存和正确的路径（集成 FA） */
async function loadStateRule(st) {
  // 如果已经缓存了该州的模块，直接使用
  if (moduleCache[st]) {
    window.RULE = moduleCache[st].rule;
    window.CALC = moduleCache[st].calc;
    window.RULE.state = st;
    console.log(`Using cached module for ${st}`);

    // 缓存数据也需要验证
    console.log(`[DATA VERIFICATION] Rules loaded for ${st}:`, {
      hasIPV: !!moduleCache[st].rule[st]?.ipv,
      hasEL: !!moduleCache[st].rule[st]?.el,
      hasSH: !!moduleCache[st].rule[st]?.sozialhilfe,
      hasFA: !!(window.FA_INFO?.[st]),
      RULEKeys: Object.keys(moduleCache[st].rule[st] || {}),
      FA_INFO: window.FA_INFO ? window.FA_INFO[st] : 'No FA info'
    });
    return;
  }

  try {
    console.log(`Loading modules for ${st}...`);

    // 原有路径
    const ipvRulePath = resolvePath(`data/ipv/ipshuju_${st}.json`);
    const ipvModulePath = resolvePath(`js/IPVcalc/ipsuanfa_${st}.js`);
    const elRulePath = resolvePath(`data/el/elshuju_${st}.json`);
    const elModulePath = resolvePath(`js/ELcalc/elsuanfa_${st}.js`);
    const shRulePath = resolvePath(`data/sozialhilfe/SHshuju_${st}.json`);
    const shModulePath = resolvePath(`js/SHcalc/SHsuanfa_${st}.js`);

    // 新增 FA 路径
    const faModulePath = resolvePath(`js/FAcalc/FAzongsuanfa.js`); // FA 总算法
    const faInfoPath = resolvePath(`data/fa/meta/fa_${st}.json`);

    // 并行加载所有模块（包括 FA）
    const [
      ipvRuleResponse, ipvModule,
      elRuleResponse, elModule,
      shRuleResponse, shModule,
      faModule, faInfoResponse
    ] = await Promise.all([
      fetch(ipvRulePath).then(r => {
        if (!r.ok) throw new Error(`Failed to load IPV rule for ${st}: ${r.status}`);
        return r.json();
      }),
      import(ipvModulePath).catch(e => {
        console.error(`IPV Module import error for ${st}:`, e);
        throw new Error(`Failed to import IPV module for ${st}`);
      }),
      fetch(elRulePath).then(r => {
        if (!r.ok) throw new Error(`Failed to load EL rule for ${st}: ${r.status}`);
        return r.json();
      }),
      import(elModulePath).catch(e => {
        console.error(`EL Module import error for ${st}:`, e);
        throw new Error(`Failed to import EL module for ${st}`);
      }),
      fetch(shRulePath).then(r => {
        if (!r.ok) throw new Error(`Failed to load SH rule for ${st}: ${r.status}`);
        return r.json();
      }),
      import(shModulePath).catch(e => {
        console.error(`SH Module import error for ${st}:`, e);
        throw new Error(`Failed to import SH module for ${st}`);
      }),
      import(faModulePath).catch(() => ({ default: null })), // FA 可能不存在
      fetch(faInfoPath).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    // 关键修复：正确合并规则结构
    // ipvRuleResponse 结构: {AG: {ipv: {...}}}
    // elRuleResponse 结构: {AG: {el: {...}}}
    const ipvRule = ipvRuleResponse[st]?.ipv || ipvRuleResponse.ipv || {};
    const elRule = elRuleResponse[st]?.el || elRuleResponse.el || {};
    const shRule = shRuleResponse[st]?.sozialhilfe || shRuleResponse.sozialhilfe || {};

    // 合并规则（FA规则不放入RULE，避免污染）
    const combinedRule = {
      [st]: {
        ipv: ipvRule,
        el: elRule,
        sozialhilfe: shRule
        // 注意：FA规则不在这里，避免污染其他福利的数据源
      }
    };

    // FA信息单独存储，避免污染RULE数据结构
    if (faInfoResponse) {
      if (!window.FA_INFO) window.FA_INFO = {};
      window.FA_INFO[st] = faInfoResponse[st] || faInfoResponse;
      console.log(`FA info loaded for ${st}:`, window.FA_INFO[st]);
    }

    // 构建计算模块对象
    const combinedCalc = {
      ipv: ipvModule.default || ipvModule,
      el: elModule.default || elModule,
      sozialhilfe: shModule.default || shModule,
      fa: faModule ? (faModule.calculateFA || faModule.default || faModule) : null
    };

    // 缓存结果
    moduleCache[st] = {
      rule: combinedRule,
      calc: combinedCalc
    };

    // 设置全局变量
    window.RULE = combinedRule;
    window.CALC = combinedCalc;

    console.log(`Successfully loaded ${st}`, {
      ipv: !!combinedCalc.ipv,
      el: !!combinedCalc.el,
      sh: !!combinedCalc.sozialhilfe,
      fa: !!combinedCalc.fa
    });

    // ========== 新增：提前加载 FA 申请信息 ==========
    if (combinedCalc.fa) {  // 只有当 FA 模块存在时才加载（避免无谓请求）
      console.log(`Pre-loading FA info for ${st}...`);
      await loadFAInfo(st);  // 异步加载，但不阻塞后续
      console.log(`FA info pre-loaded:`, !!window.FA_INFO?.[st]);
    }
    // ==============================================

    // ========== 新增的数据验证日志 ==========
    console.log(`[DATA VERIFICATION] Rules loaded for ${st}:`, {
      hasIPV: !!combinedRule[st].ipv,
      hasEL: !!combinedRule[st].el,
      hasSH: !!combinedRule[st].sozialhilfe,
      hasFA: !!(window.FA_INFO?.[st]),
      RULEKeys: Object.keys(combinedRule[st]),
      FA_INFO: window.FA_INFO ? window.FA_INFO[st] : 'No FA info',
      RULEStructure: 'FA规则已从RULE中移除，存放在FA_INFO中'
    });
    // =======================================

  } catch (error) {
    console.error(`Error loading state rule for ${st}:`, error);
    // 尝试使用备用路径
    try {
      console.log('Trying alternative paths...');
      // 备用路径1：使用绝对路径
      const altIpvRulePath = `/data/ipv/ipshuju_${st}.json`;
      const altIpvModulePath = `/js/IPVcalc/ipsuanfa_${st}.js`;
      const altElRulePath = `/data/el/elshuju_${st}.json`;
      const altElModulePath = `/js/ELcalc/elsuanfa_${st}.js`;
      const altShRulePath = `/data/sozialhilfe/SHshuju_${st}.json`;
      const altShModulePath = `/js/SHcalc/SHsuanfa_${st}.js`;
      const altFaModulePath = `/js/FAcalc/FAzongsuanfa.js`;
      const altFaInfoPath = `/data/fa/meta/fa_${st}.json`;

      const [ipvRule, ipvModule, elRule, elModule, shRule, shModule, faModule, faInfo] = await Promise.all([
        fetch(altIpvRulePath).then(r => r.ok ? r.json() : {}),
        import(altIpvModulePath),
        fetch(altElRulePath).then(r => r.ok ? r.json() : {}),
        import(altElModulePath),
        fetch(altShRulePath).then(r => r.ok ? r.json() : {}),
        import(altShModulePath),
        import(altFaModulePath).catch(() => ({ default: null })),
        fetch(altFaInfoPath).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      const ipvRuleAlt = ipvRule[st]?.ipv || ipvRule.ipv || {};
      const elRuleAlt = elRule[st]?.el || elRule.el || {};
      const shRuleAlt = shRule[st]?.sozialhilfe || shRule.sozialhilfe || {};

      // FA信息单独存储，避免污染RULE数据结构
      if (faInfo) {
        if (!window.FA_INFO) window.FA_INFO = {};
        window.FA_INFO[st] = faInfo[st] || faInfo;
        console.log(`FA info loaded via alternative path for ${st}:`, window.FA_INFO[st]);
      }

      // 合并规则（FA规则不放入RULE，避免污染）
      const combinedRule = {
        [st]: {
          ipv: ipvRuleAlt,
          el: elRuleAlt,
          sozialhilfe: shRuleAlt
          // 注意：FA规则不在这里，避免污染其他福利的数据源
        }
      };

      const combinedCalc = {
        ipv: ipvModule.default || ipvModule,
        el: elModule.default || elModule,
        sozialhilfe: shModule.default || shModule,
        fa: faModule ? (faModule.calculateFA || faModule.default || faModule) : null
      };

      moduleCache[st] = { rule: combinedRule, calc: combinedCalc };
      window.RULE = combinedRule;
      window.CALC = combinedCalc;

      console.log(`Successfully loaded ${st} using alternative path`);

      // ========== 备用路径加载成功后也添加数据验证 ==========
      console.log(`[DATA VERIFICATION] Rules loaded for ${st} (alternative path):`, {
        hasIPV: !!combinedRule[st].ipv,
        hasEL: !!combinedRule[st].el,
        hasSH: !!combinedRule[st].sozialhilfe,
        hasFA: !!(window.FA_INFO?.[st]),
        RULEKeys: Object.keys(combinedRule[st]),
        FA_INFO: window.FA_INFO ? window.FA_INFO[st] : 'No FA info',
        RULEStructure: 'FA规则已从RULE中移除，存放在FA_INFO中'
      });
      // ====================================================

    } catch (altError) {
      console.error(`Alternative path also failed for ${st}:`, altError);
      // 显示用户友好的错误信息
      let errorMessage = `Kann die Berechnungsregeln für ${st} nicht laden. `;
      errorMessage += 'Bitte überprüfen Sie:';
      errorMessage += '\n1. Datei existiert: data/ipv/ipshuju_' + st + '.json';
      errorMessage += '\n2. Datei existiert: js/IPVcalc/ipsuanfa_' + st + '.js';
      errorMessage += '\n3. Datei existiert: data/el/elshuju_' + st + '.json';
      errorMessage += '\n4. Datei existiert: js/ELcalc/elsuanfa_' + st + '.js';
      errorMessage += '\n5. Datei existiert: data/sozialhilfe/SHshuju_' + st + '.json';
      errorMessage += '\n6. Datei existiert: js/SHcalc/SHsuanfa_' + st + '.js';
      errorMessage += '\n7. Datei existiert: data/fa/fa_' + st + '.json (optional)';
      alert(errorMessage);
      throw altError;
    }
  }
}
/* 11. 邮编验证 */
async function validatePlz(plz, state) {
  try {
    if (!window.POSTAL_DB) {
      const postalPath = resolvePath('data/postal_data.json');
      console.log('Loading postal data from:', postalPath);
      const res = await fetch(postalPath);
      if (!res.ok) throw new Error('Postal data not found');
      window.POSTAL_DB = await res.json();
    }
    const rec = window.POSTAL_DB[plz];
    if (!rec) {
      alert(t('error_invalid_postcode'));
      return false;
    }
    if (rec.STATE !== state) {
      alert(t('error_postcode_wrong_canton'));
      return false;
    }
    return true;
  } catch (e) {
    console.error(e);
    alert(t('error_load_postal_data'));
    return false;
  }
}
/* 表单验证函数 */
function validateForm() {
  const form = document.getElementById('dynamic-form');
  if (!form) return false;

  const isValid = form.checkValidity();
  if (!isValid) {
    // 找到第一个无效字段并提示
    const invalidField = form.querySelector(':invalid');
    if (invalidField) {
      let fieldName = invalidField.name || invalidField.labels?.[0]?.textContent || t('field_unknown') || 'ein Feld';
      alert(t('error_field_required').replace('{field}', fieldName) || `Bitte füllen Sie "${fieldName}" korrekt aus.`);
      invalidField.focus();
      invalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      alert(t('please_fill_all_fields'));
    }
  }
  return isValid;
}
/* 12. 收集表单 - 退休版专用：保存退休专属字段 */
function collectForm() {
  const oldForm = { ...Router.form }; // 保存旧 form 以保留预设字段如 region
  Router.form = {};
  const formElements = document.querySelectorAll('#dynamic-form input, #dynamic-form select');
  formElements.forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') {
      Router.form[el.name] = el.checked;
    } else if (el.type === 'radio' && el.checked) {
      Router.form[el.name] = el.value;
    } else if (el.type !== 'radio') {
      const v = el.value.trim();
      const n = parseFloat(v);
      Router.form[el.name] = isNaN(n) ? v : n;
    }
  });

  // 恢复预设字段
  Router.form.region = oldForm.region;

  // === 关键修复：为 EL 算法提供正确字段名 ===
  if (Router.form.income !== undefined) {
    Router.form.taxableIncomeAnnual = Router.form.income;
  }
  if (Router.form.assets !== undefined) {
    Router.form.taxableAssets = Router.form.assets;
  }
  if (Router.form.health_premium !== undefined) {
    Router.form.annualHealthPremium = Router.form.health_premium;
  }
  Router.form.netIncomeAnnual = Router.form.income || 0;
  Router.form.rueckadditionen = Router.form.rueckadditionen || 0;

  // 通用默认值
  Router.form.income = Router.form.income || 0;
  Router.form.assets = Router.form.assets || 0;
  Router.form.health_premium = Router.form.health_premium || 0;
  Router.form.monthlyRent = Router.form.monthlyRent || 0;
  Router.form.crowd = Router.crowd;
  Router.form.pensionType = Router.form.pensionType || 'AHV';

  // 通用零值设置
  Router.form.numAdults = 1;
  Router.form.numChildren = 0;
  Router.form.numEducation = 0;
  Router.form.numNewborns = 0;
  Router.form.numAdoptions = 0;
  Router.form.numChildrenOver12 = 0;
  Router.form.numEducationOver18 = 0;

  // 按人群类型区分处理
  if (Router.crowd === 'retired') {
    Router.form.monthlyPensionAmount = Router.form.monthlyPensionAmount || 0;
    // EL 强制如果 checkEL=yes，必须有养老金
    if (Router.form.checkEL === 'yes' && Router.form.monthlyPensionAmount === 0) {
      alert('Für EL-Berechnung geben Sie bitte den monatlichen Rentenbetrag ein.');
    }
  } else if (Router.crowd === 'student') {
    // 学生兜底（保持原样）
    Router.form.isFulltimeStudent = Router.form.isFulltimeStudent || 'yes';  // 默认全日制
    Router.form.studyCostsMonthly = Router.form.studyCostsMonthly || 0;
    Router.form.hasStipendium = Router.form.hasStipendium || 'no';  // 默认无奖学金
  }

  // 养老金不领取处理（通用）
  if (Router.form.isReceivingPension === 'no') {
    Router.form.elImpossible = true;
    Router.form.nationality = '';
    Router.form.residenceYears = 0;
    Router.form.pensionType = '';
  }

  console.log('Form collected:', Router.form);
}
/* Sozialhilfe 粗检测 - 学生版专用：考虑学生身份 */
function checkPossibleSozialhilfe(inputs, rules) {
  if (!rules || !rules.sozialhilfe) {
    console.log('No Sozialhilfe rules available');
    return false;
  }
  const shRules = rules.sozialhilfe;
  const isCouple = inputs.numAdults >= 2;
  const isStudent = inputs.crowd === 'student';
  const isFulltime = inputs.isFulltimeStudent === 'yes';

  const totalPersons = inputs.numAdults + inputs.numChildren + inputs.numEducation;

  // 资产粗查：学生版资产门槛稍宽松（+20% 缓冲）
  const assetFreibetrag = isCouple ? (shRules.asset_freibetrag?.couple || 8000) : (shRules.asset_freibetrag?.single || 4000);
  let assetBuffer = 1.5;
  if (isStudent) assetBuffer = 1.8; // 学生资产更宽松
  const assetLimit = assetFreibetrag + totalPersons * (shRules.asset_freibetrag?.per_child || 2000) * assetBuffer;
  if (inputs.taxableAssets > assetLimit) {
    console.log('Asset too high for SH (student buffer applied)');
    return false;
  }

  // 收入粗查：学生有额外需求
  const grundbedarfSingle = shRules.grundbedarf_monthly?.single || 987;
  const grundbedarfCouple = shRules.grundbedarf_monthly?.couple || 1510;
  let baseGrundbedarf = isCouple ? grundbedarfCouple : grundbedarfSingle;

  // 学生额外需求：全日制加 300 CHF/月，半日制加 150 CHF/月
  let studentExtra = 0;
  if (isStudent) {
    studentExtra = isFulltime ? 300 : 150;
  }
  const extraPerPerson = shRules.grundbedarf_monthly?.per_child || 380;
  const estimatedMonthlyNeed = baseGrundbedarf + studentExtra + (totalPersons - (isCouple ? 2 : 1)) * extraPerPerson;
  const estimatedAnnualNeed = estimatedMonthlyNeed * 12 * 1.5;

  if (inputs.taxableIncomeAnnual > estimatedAnnualNeed) {
    console.log('Income too high for SH (with student extra need)');
    return false;
  }

  console.log('Possible SH eligibility detected (student mode)');
  return true;
}

/* ========== EL 预检查函数（新增）========== */
function validateELPreConditions(inputs) {
  // 默认结果：有资格
  const result = { eligible: true, reasonKey: '' };

  // 检查是否领取养老金
  if (!inputs.isReceivingPension || inputs.isReceivingPension === 'no') {
    return { eligible: false, reasonKey: 'err_el_no_pension_warning' };
  }

  // 检查国籍和居住年限
  if (inputs.nationality === 'non_eu_eea' && (inputs.residenceYears || 0) < 10) {
    return { eligible: false, reasonKey: 'err_residence_10y' };
  }

  if ((inputs.nationality === 'refugee_f' || inputs.nationality === 'refugee_b') &&
    (inputs.residenceYears || 0) < 5) {
    return { eligible: false, reasonKey: 'err_residence_5y' };
  }

  // 检查资产（使用联邦标准）
  const isCouple = (inputs.numAdults || 1) >= 2;
  const assetLimit = isCouple ? 200000 : 100000;
  if ((inputs.assets || 0) > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_federal' };
  }

  return result;
}

/* 13. 计算（关键修改处 - 保留原始 IPV/EL→SH 同步逻辑，添加 FA 计算 + EL 优先于 SH 规则） */
async function runCalculation() {
  const state = Router.state;
  Router.resultData = {}; // 初始化结果容器

  // --- 流程 A: IPV 计算 ---
  try {
    const ipvModule = window.CALC.ipv;
    const cantonRulesForIPV = window.RULE[state] || window.RULE || {};
    Router.resultData.ipv = ipvModule(Router.form, cantonRulesForIPV);
  } catch (e) {
    console.error("IPV Calc Fail", e);
    Router.resultData.ipv = { error: 'calc_failed' };
  }

  // --- 流程 B: EL 计算 ---
  if (Router.form.checkEL === 'no') {
    Router.resultData.el = { error: 'skipped_by_user' };
  } else if (Router.form.isReceivingPension === 'no') {
    Router.resultData.el = { error: 'err_el_no_pension_warning' };
  } else {
    const elCheck = validateELPreConditions(Router.form);
    if (elCheck.eligible) {
      try {
        const elModule = window.CALC.el;
        const cantonRulesForEL = window.RULE[state] || window.RULE || {};
        const elResult = elModule(Router.form, cantonRulesForEL);
        Router.resultData.el = elResult;
      } catch (e) {
        console.error("EL Calc Fail", e);
        Router.resultData.el = { error: 'calc_failed' };
      }
    } else {
      Router.resultData.el = { error: elCheck.reasonKey };
    }
  }

  // --- 同步 IPV 和 EL 到 SH 输入 ---
  Router.form.ipvReceivedAnnual = (Router.resultData.ipv && !Router.resultData.ipv.error)
    ? (Router.resultData.ipv.annualBenefit || 0) : 0;
  Router.form.elReceivedAnnual = (Router.resultData.el && !Router.resultData.el.error)
    ? (Router.resultData.el.annualBenefit || 0) : 0;

  // 更新 SH 输入框显示（如果已显示）
  const ipvInput = document.querySelector('input[name="ipvReceivedAnnual"]');
  const elInput = document.querySelector('input[name="elReceivedAnnual"]');
  if (ipvInput) {
    ipvInput.value = Router.form.ipvReceivedAnnual;
    ipvInput.readOnly = true;
    ipvInput.style.backgroundColor = '#f0f8ff';
  }
  if (elInput) {
    elInput.value = Router.form.elReceivedAnnual;
    elInput.readOnly = true;
    elInput.style.backgroundColor = '#f0f8ff';
  }

  // --- 流程 C: Sozialhilfe ---
  const stateRules = window.RULE[state] || {};

  if (!Router.pendingSH) { // 第一次进来
    if (checkPossibleSozialhilfe(Router.form, stateRules)) {
      const userWantsSH = confirm(t('sh_precheck_hint') ||
        'Ihre Angaben deuten auf einen möglichen Anspruch auf Sozialhilfe hin. Möchten Sie eine detaillierte Berechnung durchführen? (Zusätzliche Angaben erforderlich)');

      if (userWantsSH) {
        const shExtra = document.getElementById('sh-extra-fields');
        if (shExtra) {
          shExtra.style.display = 'block';
          Router.shExtraShown = true;
          const employmentSelect = shExtra.querySelector('select[name="employmentStatus"]');
          if (employmentSelect) employmentSelect.required = true;
          const medicalRadios = shExtra.querySelectorAll('input[name="hasMedicalNeeds"]');
          medicalRadios.forEach(radio => radio.required = true);
        }
        Router.pendingSH = true;

        // 显示二次计算提示
        const hintBox = document.getElementById('sh-recalc-hint');
        if (hintBox) {
          hintBox.style.display = 'block';
          hintBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // 改按钮文字和样式
        const btnCalc = document.getElementById('btn-calc');
        if (btnCalc) {
          btnCalc.textContent = t('recalc_sh') || 'Sozialhilfe neu berechnen';
          btnCalc.style.backgroundColor = '#ffc107';
          btnCalc.style.color = '#212529';
        }

        return null; // 等待用户补充 SH 字段
      } else {
        Router.resultData.sozialhilfe = { error: 'skipped_by_user_sh' };
        return Router.resultData;
      }
    } else {
      Router.resultData.sozialhilfe = { error: 'not_possible_sh' };
      return Router.resultData;
    }
  } else { // 第二次进来（用户点了“SH neu berechnen”）
    // 关键修改：如果有有效的 EL，则 SH 无效
    if (Router.resultData.el && !Router.resultData.el.error && (Router.resultData.el.annualBenefit || 0) > 0) {
      Router.resultData.sozialhilfe = {
        error: 'no_sh_when_el',
        message: 'Bei Bezug von Ergänzungsleistungen (EL) besteht in der Regel kein Anspruch auf Sozialhilfe, da EL den Existenzbedarf bereits abdeckt.'
      };
    } else {
      // 准备 SH 计算用的临时输入对象
      const shInput = { ...Router.form };

      // 学生版额外调整（如果适用）
      if (shInput.crowd === 'student') {
        const isFulltime = shInput.isFulltimeStudent === 'yes';
        const studentExtraMonthly = isFulltime ? 300 : 150;
        const studyCosts = shInput.studyCostsMonthly || 0;
        const totalStudentExtra = studentExtraMonthly + studyCosts;
        shInput.monthly_other_expenses = (shInput.monthly_other_expenses || 0) + totalStudentExtra;
      }

      // 退休版额外调整（如果适用）
      if (shInput.crowd === 'retired') {
        if (shInput.hasMedicalNeeds === 'yes') {
          shInput.monthly_other_expenses = (shInput.monthly_other_expenses || 0) + 200;
        }
      }

      // 计算 SH
      try {
        const shModule = window.CALC.sozialhilfe;
        const cantonRulesForSH = stateRules || {};
        Router.resultData.sozialhilfe = shModule(shInput, cantonRulesForSH);
      } catch (e) {
        console.error('SH calc error', e);
        Router.resultData.sozialhilfe = { error: 'calc_failed_sh' };
      }
    }

    // 计算完复位状态
    Router.pendingSH = false;
    Router.shExtraShown = false;

    // 隐藏提示框和恢复按钮样式
    const hintBox = document.getElementById('sh-recalc-hint');
    if (hintBox) hintBox.style.display = 'none';

    const btnCalc = document.getElementById('btn-calc');
    if (btnCalc) {
      btnCalc.textContent = t('calculate') || 'Berechnen';
      btnCalc.style.backgroundColor = '';
      btnCalc.style.color = '';
    }

    return Router.resultData;
  }

  // --- 流程 D: FA 计算 ---（保持原样，未修改）
  // ... 此处省略 FA 计算代码（你的原代码已有）

  return Router.resultData;
}
/* 14. 恢复表单数据（集成 FA 字段状态恢复） */
function restoreFormData() {
  if (!Router.form || Object.keys(Router.form).length === 0) return;

  document.querySelectorAll('#dynamic-form input, #dynamic-form select').forEach(el => {
    if (!el.name) return;
    const value = Router.form[el.name];
    if (value !== undefined && value !== null) {
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else if (el.type === 'radio') {
        if (el.value === value) el.checked = true;
      } else {
        el.value = value;
      }
    }
  });

  // 恢复下拉选择
  if (Router.crowd) {
    const crowdSelect = document.getElementById('sel-crowd');
    if (crowdSelect) crowdSelect.value = Router.crowd;
  }
  if (Router.state) {
    const stateSelect = document.getElementById('sel-state');
    if (stateSelect) stateSelect.value = Router.state;
  }
  if (Router.plz) {
    const plzInput = document.getElementById('inp-plz');
    if (plzInput) plzInput.value = Router.plz;
  }

  // 恢复 EL 状态
  if (Router.form.isReceivingPension === 'no') {
    const warningBox = document.getElementById('el-no-pension-warning');
    const typeBox = document.getElementById('pension-type-field');
    const otherFields = document.getElementById('el-other-fields');
    if (warningBox) warningBox.style.display = 'block';
    if (typeBox) typeBox.style.display = 'none';
    if (otherFields) {
      otherFields.querySelectorAll('select,input').forEach(i => i.disabled = true);
    }
  }

  // 恢复 FA 字段显示状态（新增）
  updateFAExtraFieldsVisibility();
}

/* 辅助函数：填充 FA 一次性津贴显示 */
function fillFAOneTime(faResult) {
  const container = document.getElementById('fa-onetime-allowances');
  if (!container) return;

  if (!faResult || !faResult.oneTime) {
    container.innerHTML = '';
    return;
  }

  const birth = faResult.oneTime.birth || 0;
  const adoption = faResult.oneTime.adoption || 0;

  if (birth === 0 && adoption === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<strong>${t('fa_onetime_allowances') || 'Einmalzahlungen'}:</strong><br>`;

  if (birth > 0) {
    html += `• ${t('birth_allowance') || 'Geburtsszulage'}: ${formatCurrency(birth)} CHF<br>`;
  }

  if (adoption > 0) {
    html += `• ${t('adoption_allowance') || 'Adoptionszulage'}: ${formatCurrency(adoption)} CHF<br>`;
  }

  container.innerHTML = html;
}

/* 15. 增强结果页面填充（显示用户输入 + 福利结果） */
function fillResultPage() {
  const b = Router.resultData;
  if (!b) {
    console.error('No result data available');
    return;
  }

  // 1. 始终显示用户输入信息（放在最上方）
  displayUserInputs();

  // 2. IPV（始终显示）
  fillBenefitAmount(b.ipv, 'ipv');
  showFormula(b.ipv, 'ipv-formula-box');
  document.getElementById('ipv-details').style.display = 'block';

  // 3. EL（仅当用户选择计算且无错误时显示）
  const elContainer = document.getElementById('el-details');
  if (Router.form.checkEL === 'yes' && b.el && !b.el.error?.includes('skipped')) {
    elContainer.style.display = 'block';
    fillBenefitAmount(b.el, 'el');
    showFormula(b.el, 'el-formula-box');
  } else {
    elContainer.style.display = 'none';
  }

  // 4. FA（始终显示，即使为0也显示0.00）
  const faContainer = document.getElementById('fa-details');
  faContainer.style.display = 'block';
  fillBenefitAmount(b.fa || { annualBenefit: 0 }, 'fa');
  fillFAOneTime(b.fa);
  showFormula(b.fa, 'fa-formula-box');

  // 5. SH（特殊处理：有EL时显示提示，否则显示金额）
  const shContainer = document.getElementById('sh-details');
  if (b.sozialhilfe) {
    shContainer.style.display = 'block';

    if (b.sozialhilfe.error === 'no_sh_when_el') {
      // 有 EL → 显示提示而不是金额
      const formulaBox = document.getElementById('sh-formula-box');
      if (formulaBox) {
        formulaBox.innerHTML = `
          <div class="warning-box" style="display:block; background:#d4edda; color:#155724; border-color:#c3e6cb; padding:15px; margin-bottom:15px;">
            <strong>${t('no_sh_when_el_title')}</strong><br>
            ${t('no_sh_when_el_message')}
          </div>
        `;
      }
      // 金额显示 0
      document.getElementById('sh-benefit-annual').textContent = '0.00';
      document.getElementById('sh-benefit-monthly').textContent = '0.00';
    } else if (!b.sozialhilfe.error?.includes('skipped') && !b.sozialhilfe.error?.includes('not_possible')) {
      // 正常 SH 计算结果
      fillBenefitAmount(b.sozialhilfe, 'sh');
      showFormula(b.sozialhilfe, 'sh-formula-box');
    } else {
      // 其他错误/无资格情况
      document.getElementById('sh-benefit-annual').textContent = '0.00';
      document.getElementById('sh-benefit-monthly').textContent = '0.00';
      const box = document.getElementById('sh-formula-box');
      if (box) {
        box.innerHTML = `<div class="warning-box"><strong>${t('error')}:</strong> ${t(b.sozialhilfe.error || 'err_no_entitlement_sh')}</div>`;
      }
    }
  } else {
    shContainer.style.display = 'none';
  }

  // 6. 隐藏 SH 二次计算提示（防止从表单回退时残留）
  const hintBox = document.getElementById('sh-recalc-hint');
  if (hintBox) hintBox.style.display = 'none';
}

/* 16. 显示用户输入信息 - 低收入版优化：完整显示所有关键字段 */
function displayUserInputs() {
  const container = document.getElementById('user-inputs');
  if (!container) return;

  const inputs = Router.form || {};
  let html = '<div class="user-inputs-container">';
  html += `<h3>${t('eingabeinformationen') || 'Eingabeinformationen'}</h3>`;
  html += '<table class="inputs-table">';

  // 基本人口信息
  if (Router.crowd) {
    const crowdText = t('crowd_' + Router.crowd) || Router.crowd;
    html += `<tr><td>${t('zielgruppe') || 'Zielgruppe'}:</td><td>${crowdText}</td></tr>`;
  }
  if (Router.state) {
    const stateName = t(Router.state + '_name') || Router.state;
    html += `<tr><td>${t('canton') || 'Kanton'}:</td><td>${stateName} (${Router.state})</td></tr>`;
  }
  if (Router.plz) {
    html += `<tr><td>${t('postal_code') || 'Postleitzahl'}:</td><td>${Router.plz}</td></tr>`;
  }

  // 财务信息（低收入版重点字段）
  html += `<tr><td>${t('annual_income') || 'Jahreseinkommen'}:</td><td>${formatCurrency(inputs.income || 0)} CHF</td></tr>`;
  html += `<tr><td>${t('assets') || 'Vermögen'}:</td><td>${formatCurrency(inputs.assets || 0)} CHF</td></tr>`;
  html += `<tr><td>${t('health_insurance_premium') || 'Krankenkassenprämie (CHF/Jahr)'}:</td><td>${formatCurrency(inputs.health_premium || 0)} CHF</td></tr>`;
  html += `<tr><td>${t('monthly_rent') || 'Monatsmiete'}:</td><td>${formatCurrency(inputs.monthlyRent || 0)} CHF</td></tr>`;

  // 成人数量（低收入版固定1）
  html += `<tr><td>${t('num_adults') || 'Anzahl Erwachsene'}:</td><td>1</td></tr>`;

  // SH 相关输入（低收入版重点）
  if (inputs.employmentStatus) {
    const empText = t('employment_' + inputs.employmentStatus) || inputs.employmentStatus;
    html += `<tr><td>${t('label_employment_status') || 'Erwerbssituation'}:</td><td>${empText}</td></tr>`;
  }
  if (inputs.hasMedicalNeeds) {
    html += `<tr><td>${t('label_has_medical_needs') || 'Besondere medizinische Bedürfnisse'}:</td><td>${inputs.hasMedicalNeeds === 'yes' ? t('yes') : t('no')}</td></tr>`;
  }
  if (inputs.arbeitspensum !== undefined) {
    html += `<tr><td>${t('label_arbeitspensum') || 'Aktuelles Arbeitspensum'}:</td><td>${inputs.arbeitspensum}%</td></tr>`;
  }
  if (inputs.zusatzbedarf_monatlich !== undefined) {
    html += `<tr><td>${t('label_zusatzbedarf_monatlich') || 'Monatliche zusätzliche Bedürfnisse'}:</td><td>${formatCurrency(inputs.zusatzbedarf_monatlich)} CHF</td></tr>`;
  }
  if (inputs.other_income_annual !== undefined) {
    html += `<tr><td>${t('label_other_income_annual') || 'Andere jährliche Einkünfte'}:</td><td>${formatCurrency(inputs.other_income_annual)} CHF</td></tr>`;
  }
  if (inputs.monthly_other_expenses !== undefined) {
    html += `<tr><td>${t('label_monthly_other_expenses') || 'Monatliche zusätzliche Ausgaben'}:</td><td>${formatCurrency(inputs.monthly_other_expenses)} CHF</td></tr>`;
  }

  // 已计算并同步的 IPV/EL（如果存在）
  if (inputs.ipvReceivedAnnual !== undefined && inputs.ipvReceivedAnnual > 0) {
    html += `<tr><td>${t('label_ipv_received_annual') || 'Erhaltene IPV (jährlich)'}:</td><td>${formatCurrency(inputs.ipvReceivedAnnual)} CHF</td></tr>`;
  }
  if (inputs.elReceivedAnnual !== undefined && inputs.elReceivedAnnual > 0) {
    html += `<tr><td>${t('label_el_received_annual') || 'Erhaltene EL (jährlich)'}:</td><td>${formatCurrency(inputs.elReceivedAnnual)} CHF</td></tr>`;
  }

  html += '</table>';
  html += '</div>';
  container.innerHTML = html;
}

/* 17. 工具函数：格式化货币 */
function formatCurrency(amount) {
  if (typeof amount !== 'number') return amount;
  return amount.toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
/* 18. 结果金额填充 */
function fillBenefitAmount(b, type) {
  const aEl = document.getElementById(`${type}-benefit-annual`);
  const mEl = document.getElementById(`${type}-benefit-monthly`);
  if (!aEl || !mEl) return;

  if (b && !b.error) {
    const annual = b.annualBenefit || b.annual || 0;
    aEl.textContent = annual.toFixed(2);
    mEl.textContent = (annual / 12).toFixed(2);
    mEl.style.color = "inherit";
  } else if (b && b.error) {
    aEl.textContent = "0.00";
    const errorKey = b.error.includes('|') ? b.error.split('|')[0] : b.error;
    let errorMessage = t(errorKey);
    if (errorMessage === errorKey) {
      errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
    }
    mEl.innerHTML = `<small style="color:#d9534f;">${errorMessage}</small>`;
  } else {
    aEl.textContent = "0.00";
    mEl.textContent = "0.00";
  }
}
/* 19. 透明公式 - 完全隔离FA数据（关键修复） */
async function showFormula(b, boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;

  // 如果是EL区域且用户选择不计算EL，直接清空内容
  if (boxId.includes('el') && Router.form.checkEL !== 'yes') {
    box.innerHTML = '';
    return;
  }

  // 如果是FA区域且无结果或有错误，显示单人版专用提示
  if (boxId.includes('fa') && (!b || b.error)) {
    let errorHtml = '<div class="warning-box" style="display:block; background:#fff3cd; border:1px solid #ffeeba; padding:15px; margin:15px 0;">';

    // 单人版专用友好提示（优先用翻译键）
    if (Router.crowd === 'single') {
      errorHtml += `<strong>${t('fa_not_applicable_single') || 'Familienzulagen nicht anwendbar'}</strong><br>`;
      errorHtml += t('fa_not_applicable_single_detail') || 'Für alleinstehende Personen ohne Kinder oder Auszubildende besteht kein Anspruch auf Familienzulagen (FA).';
    } else {
      // 其他情况用通用错误
      const errorKey = b?.error || 'err_general_no_entitlement';
      let errorMessage = t(errorKey);
      if (errorMessage === errorKey) {
        errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
      }
      errorHtml += `<strong>${t('error') || 'Fehler'}:</strong> ${errorMessage}`;
    }

    errorHtml += '</div>';
    box.innerHTML = errorHtml;
    return;
  }

  // 0. 确保州规则已加载
  const state = Router.state || 'AG';
  if (!window.RULE || !window.RULE[state]) {
    await loadStateRule(state);
  }

  // 1. 错误处理（主要针对EL）
  if (b.error && boxId.includes('el')) {
    const errorKey = b.error.includes('|') ? b.error.split('|')[0] : b.error;
    let errorMessage = t(errorKey);
    if (errorMessage === errorKey) {
      errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
    }
    box.innerHTML = `<div class="note-error">${t('error')}: ${errorMessage}</div>`;
    return;
  }

  // 2. 计算步骤
  let html = '';
  if (b.explanation && Array.isArray(b.explanation.steps)) {
    html += `<h3>${t('calculation_steps_title') || 'Detaillierte Berechnung Ihrer Ansprüche'}</h3>`;
    html += '<div class="calculation-steps">';
    b.explanation.steps.forEach(s => {
      const labelText = t(s.label) || s.label;
      const valueText = typeof s.value === 'number'
        ? s.value.toLocaleString('de-CH') + ' CHF'
        : (t(s.value) || s.value);
      html += `
        <div class="step">
          <span class="label">${labelText}:</span>
          <span class="val">${valueText}</span>
        </div>`;
    });
    if (b.explanation.note_key) {
      html += `<div class="note-hint"><strong>${t('hint') || 'Hinweis'}:</strong> ${t(b.explanation.note_key)}</div>`;
    }
    html += '</div>';
  }

  // ========== 关键修复：完全隔离数据源 ==========

  // 3. 确定benefitType
  let benefitType = 'ipv';
  if (boxId.includes('ipv')) benefitType = 'ipv';
  else if (boxId.includes('el')) benefitType = 'el';
  else if (boxId.includes('sh')) benefitType = 'sozialhilfe';
  else if (boxId.includes('fa')) benefitType = 'fa';

  let rule = null;
  let applicationData = null;

  // 4. 根据benefitType选择正确的数据源
  if (benefitType === 'fa') {
    // FA: 只从FA_INFO获取
    if (window.FA_INFO && window.FA_INFO[state]) {
      rule = window.FA_INFO[state][state] || window.FA_INFO[state];
      console.log("[FA RULE] Loaded from FA_INFO for", state, ":", rule);
    } else {
      console.warn("[FA RULE] No FA info found for", state);
    }
  } else {
    // IPV/EL/SH: 只从RULE获取
    if (window.RULE && window.RULE[state] && window.RULE[state][benefitType]) {
      rule = window.RULE[state][benefitType];
      console.log(`[${benefitType.toUpperCase()} RULE] Loaded from RULE for`, state, ":", rule);
    } else {
      console.warn(`[${benefitType.toUpperCase()} RULE] No rule found for`, state);
    }
  }

  // ========== 关键修复：增强版法律信息提取函数（支持法律来源URL）==========
  function extractLegalBasis(rule) {
    if (!rule) return null;

    const legalInfo = {
      texts: [],
      sourceUrl: null
    };

    // 情况1: rule.legal_basis 是对象，包含 primary_key
    if (rule.legal_basis && typeof rule.legal_basis === 'object') {

      // 提取主要法律依据
      if (rule.legal_basis.primary_key) {
        const primary = t(rule.legal_basis.primary_key);
        if (primary && primary !== rule.legal_basis.primary_key) {
          legalInfo.texts.push(primary);
        }
      }

      // 提取补充法律依据
      if (rule.legal_basis.additional_sources_key) {
        const additional = t(rule.legal_basis.additional_sources_key);
        if (additional && additional !== rule.legal_basis.additional_sources_key) {
          legalInfo.texts.push(additional);
        }
      }

      // 提取法律来源URL（直接硬编码）
      if (rule.legal_basis.legal_source) {
        legalInfo.sourceUrl = rule.legal_basis.legal_source;
      }
    }

    // 情况2: rule.legalBasis 是数组（如IPV的格式）
    else if (Array.isArray(rule.legalBasis)) {
      legalInfo.texts = rule.legalBasis.map(item => t(item)).filter(text => text && text !== item);
      // 从规则根级别查找法律来源URL
      if (rule.legal_source) {
        legalInfo.sourceUrl = rule.legal_source;
      }
    }

    // 情况3: rule.legal_basis 是字符串（直接是翻译键）
    else if (typeof rule.legal_basis === 'string') {
      const translated = t(rule.legal_basis);
      legalInfo.texts = [translated !== rule.legal_basis ? translated : rule.legal_basis];
      if (rule.legal_source) {
        legalInfo.sourceUrl = rule.legal_source;
      }
    }

    // 情况4: rule.legalBasis 是字符串
    else if (typeof rule.legalBasis === 'string') {
      const translated = t(rule.legalBasis);
      legalInfo.texts = [translated !== rule.legalBasis ? translated : rule.legalBasis];
      if (rule.legal_source) {
        legalInfo.sourceUrl = rule.legal_source;
      }
    }

    return legalInfo;
  }

  // ========== 官方URL提取函数 ==========
  function extractOfficialUrl(rule) {
    if (!rule) return null;
    return rule.official_url || rule.application?.url || null;
  }

  // 5. 显示法律基础 & 申请信息
  if (rule) {
    html += '<div class="legal-info-section">';
    html += `<h4>${t('legal_basis_title') || 'Rechtliche Grundlagen & Antrag'}</h4>`;

    // 法律基础（FA无，其他有）
    if (benefitType !== 'fa') {
      // 提取增强版法律信息（包含文本和来源URL）
      const legalInfo = extractLegalBasis(rule);

      // 显示法律依据文本
      if (legalInfo.texts && legalInfo.texts.length > 0) {
        html += `<p><strong>${t('legal_basis') || 'Rechtsgrundlage'}:</strong> ${legalInfo.texts.join('; ')}</p>`;
      }

      // 显示法律来源URL
      if (legalInfo.sourceUrl) {
        html += `<p><strong>${t('legal_source') || 'Rechtliche Quelle (Bundesrecht)'}:</strong> `;
        html += `<a href="${legalInfo.sourceUrl}" target="_blank" style="color:#007bff; text-decoration:underline;" rel="noopener noreferrer">`;
        html += `${legalInfo.sourceUrl}</a>`;
        html += `</p>`;
      }

      // 显示官方URL
      const officialUrl = extractOfficialUrl(rule);
      if (officialUrl) {
        html += `<p><strong>${t('official_website') || 'Offizielle Webseite (Antragstellung)'}:</strong> `;
        html += `<a href="${officialUrl}" target="_blank" style="color:#007bff; text-decoration:underline;">${officialUrl}</a></p>`;
      }
    }

    // 强制渲染申请信息卡片
    html += '<div class="application-card">';
    html += `<h5>${t('how_to_apply') || 'Zuständige Stelle'}</h5>`;

    // ========== 根据福利类型使用不同的字段 ==========

    if (benefitType === 'fa') {
      // FA专用字段
      const officeKey = rule.authority?.office_name_key;
      const authKey = rule.authority?.authority_key;
      const officeTranslated = officeKey ? t(officeKey) : (rule.authority?.office_name || 'Familienausgleichskasse');
      const authTranslated = authKey ? t(authKey) : '';

      html += `<p><strong>${officeTranslated}${authTranslated ? ' - ' + authTranslated : ''}</strong></p>`;

      // 地址
      if (rule.contact?.address_key) {
        html += `<p>${t(rule.contact.address_key).replace(/\n/g, '<br>')}</p>`;
      } else if (rule.contact?.address) {
        html += `<p>${rule.contact.address.replace(/\n/g, '<br>')}</p>`;
      }

    } else {
      // IPV/EL/SH使用原有字段
      if (rule.application?.authority_key) {
        html += `<p><strong>${t('authority')}:</strong> ${t(rule.application.authority_key)}</p>`;
      } else if (rule.application?.authority) {
        html += `<p><strong>${t('authority')}:</strong> ${rule.application.authority}</p>`;
      }

      if (rule.application?.contact?.address_key) {
        html += `<p><strong>${t('contact_address')}:</strong> ${t(rule.application.contact.address_key)}</p>`;
      }
    }

    // 通用字段（电话、邮箱、网站）
    const contact = benefitType === 'fa' ? rule.contact : (rule.application?.contact || {});
    const phone = contact?.phone || 'Nicht angegeben';
    const email = contact?.email || 'Nicht angegeben';

    html += `<p><strong>Tel:</strong> ${phone}</p>`;
    html += `<p><strong>Email:</strong> ${email !== 'Nicht angegeben' ? `<a href="mailto:${email}">${email}</a>` : email}</p>`;

    // 官网 - FA类型单独处理（避免重复）
    if (benefitType === 'fa') {
      const officialUrl = rule.application?.url;
      if (officialUrl) {
        html += `<p><strong>Offizielle Webseite:</strong> <a href="${officialUrl}" target="_blank" style="color:#007bff;">${officialUrl}</a></p>`;
      }
    }

    // 所需文件 - 使用统一工具函数生成文档键名
    let docs = [];
    const docKey = getDocumentKey(state, benefitType);
    const context = `Web-${benefitType}-${state}`;
    console.log(`[Web] Using document key: ${docKey} for benefitType: ${benefitType}`);

    // 尝试主键
    if (window.LANG && Array.isArray(window.LANG[docKey])) {
      docs = window.LANG[docKey];
      console.log(`[${context}] Found docs using primary key: ${docKey}`);
    }
    // 降级尝试：如果是sh类型，尝试sozialhilfe版本
    else if (benefitType === 'sh') {
      const fallbackKey = `${state}_sozialhilfe_required_documents_list`;
      if (window.LANG && Array.isArray(window.LANG[fallbackKey])) {
        docs = window.LANG[fallbackKey];
        console.warn(`[${context}] Primary key ${docKey} not found, using fallback: ${fallbackKey}`);
      }
    }
    // 通用降级：尝试去掉类型标识
    else {
      const fallbackKey = `${state}_required_documents_list`;
      if (window.LANG && Array.isArray(window.LANG[fallbackKey])) {
        docs = window.LANG[fallbackKey];
        console.warn(`[${context}] Primary key ${docKey} not found, using fallback: ${fallbackKey}`);
      }
    }

    if (docs.length > 0) {
      html += `<h6>${t('required_documents') || 'Erforderliche Unterlagen'}:</h6><ul style="margin-left:20px; list-style-type:disc;">`;
      docs.forEach(item => {
        const itemText = (typeof item === 'string' && item.startsWith('✓')) ? item : (t(item) || item);
        html += `<li>${itemText}</li>`;
      });
      html += `</ul>`;
    }

    // 特殊笔记
    const noteKey = benefitType === 'fa' ? rule.notes_key : rule.application?.contact_reminder_key;
    const noteText = noteKey ? t(noteKey) : '';
    if (noteText && noteText !== noteKey) {
      html += `<div class="note-hint" style="margin-top:15px; background:#fff3cd; padding:10px; border:1px solid #ffeeba; border-radius:4px;"><strong>Wichtiger Hinweis:</strong> ${noteText}</div>`;
    }

    html += '</div>'; // application-card
    html += '</div>'; // legal-info-section
  } else if (benefitType === 'fa') {
    html += '<div class="note-hint"><strong>Hinweis:</strong> Antragsinformationen konnten nicht geladen werden. Bitte besuchen Sie die offizielle Kantonsseite.</div>';
  }

  // 6. 写入页面
  box.innerHTML = html;
}
/* 辅助函数：获取友好的错误消息 */
function getErrorMessage(errorObj) {
  if (!errorObj) return '';

  if (typeof errorObj === 'string') {
    const errorKey = errorObj.includes('|') ? errorObj.split('|')[0] : errorObj;
    const translated = t(errorKey);
    if (translated !== errorKey) return translated;

    // 默认错误消息
    if (errorObj.includes('skipped')) return 'Berechnung wurde übersprungen.';
    if (errorObj.includes('calc_failed')) return 'Berechnung fehlgeschlagen.';
    if (errorObj.includes('not_applicable')) return 'Keine Berechnung erforderlich.';
    if (errorObj.includes('no_sh_when_el')) return 'Bei Bezug von EL besteht in der Regel kein Anspruch auf Sozialhilfe.';

    return 'Kein Anspruch auf diese Leistung.';
  }

  if (typeof errorObj === 'object' && errorObj.message) {
    return errorObj.message;
  }

  return 'Unbekannter Fehler.';
}
/* 110. PDF公文外衣 - 完全对齐页面显示结果（低收入版完整输入字段） */
function buildPdfHtml(resultData) {
  const form = Router.form || {};
  const state = Router.state || '';
  const stateName = t(state + '_name') || state;
  const now = new Date().toLocaleString('de-CH');

  // 获取福利结果（安全访问）
  const ipvResult = resultData.ipv || {};
  const elResult = resultData.el || {};
  const faResult = resultData.fa || { annualBenefit: 0, oneTime: { birth: 0, adoption: 0 } };
  const shResult = resultData.sozialhilfe || {};

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #000; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
        .header h1 { font-size: 18pt; color: #0066cc; margin: 0; }
        .subtitle { font-size: 12pt; color: #666; margin-top: 5px; }
        .section { margin: 25px 0; page-break-inside: avoid; }
        .section-title { font-size: 14pt; font-weight: bold; background: #f0f0f0; padding: 8px 12px; border-left: 4px solid #0066cc; margin-bottom: 15px; }
        .disclaimer-box { background: #fff3cd; border: 2px solid #ffeeba; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px 0; color: #856404; font-size: 1.05em; line-height: 1.5; text-align: center; }
        .disclaimer-box strong { color: #c47f00; font-size: 1.15em; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table th, .info-table td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; vertical-align: top; }
        .info-table th { background: #f8f9fa; font-weight: bold; }
        .benefit-card { border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin: 15px 0; page-break-inside: avoid; }
        .benefit-card.success { border-left: 4px solid #28a745; background: #f8fff8; }
        .benefit-card.warning { border-left: 4px solid #ffc107; background: #fffdf6; }
        .benefit-card.error { border-left: 4px solid #dc3545; background: #fff8f8; }
        .benefit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .benefit-name { font-weight: bold; font-size: 13pt; color: #333; }
        .benefit-amount { font-size: 14pt; font-weight: bold; color: #28a745; }
        .amount-zero { color: #999; }
        .note { font-size: 10pt; color: #666; font-style: italic; margin-top: 10px; padding: 8px; background: #f9f9f9; border-radius: 3px; }
        .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 9pt; color: #777; text-align: center; }
        @media print { .page-break { page-break-before: always; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>Sozialleistungsberechnung</h1>
        <div class="subtitle">Berechnungsergebnisse für ${stateName} (${state || 'CH'}) - Erstellt am ${now}</div>
    </div>

    <!-- 醒目免责声明（完全对齐页面） -->
    <div class="disclaimer-box">
        <strong>WICHTIGER HINWEIS</strong><br>
        Dieser Rechner liefert eine nicht verbindliche Schätzung. Die Ergebnisse sind nicht offiziell und können von der tatsächlichen Berechnung durch die Behörden abweichen. Maßgeblich ist ausschließlich das offizielle Ergebnis der zuständigen Stelle. Der Rechner dient ausschließlich zu Informationszwecken.
    </div>

    <!-- 用户输入信息 - 低收入版完整版（已对齐页面） -->
    <div class="section">
        <div class="section-title">Eingabeinformationen</div>
        <table class="info-table">
            <tr><th>Feld</th><th>Wert</th></tr>
            <tr><td>Zielgruppe</td><td>Geringverdiener</td></tr>
            <tr><td>Kanton</td><td>${stateName} (${state})</td></tr>
            <tr><td>Postleitzahl</td><td>${Router.plz || '-'}</td></tr>
            <tr><td>Jahreseinkommen</td><td>${formatCurrency(form.income || 0)} CHF</td></tr>
            <tr><td>Vermögen</td><td>${formatCurrency(form.assets || 0)} CHF</td></tr>
            <tr><td>Krankenkassenprämie (CHF/Jahr)</td><td>${formatCurrency(form.health_premium || 0)} CHF</td></tr>
            <tr><td>Monatsmiete</td><td>${formatCurrency(form.monthlyRent || 0)} CHF</td></tr>
            <tr><td>Anzahl Erwachsene</td><td>${form.numAdults || 1}</td></tr>
            ${form.employmentStatus ? `<tr><td>Erwerbssituation</td><td>${t('employment_' + form.employmentStatus) || form.employmentStatus}</td></tr>` : ''}
            ${form.hasMedicalNeeds ? `<tr><td>Besondere medizinische oder pflegerische Bedürfnisse?</td><td>${form.hasMedicalNeeds === 'yes' ? 'Ja' : 'Nein'}</td></tr>` : ''}
            ${form.arbeitspensum !== undefined ? `<tr><td>Aktuelles Arbeitspensum (%)</td><td>${form.arbeitspensum}%</td></tr>` : ''}
            ${form.zusatzbedarf_monatlich !== undefined ? `<tr><td>Monatliche zusätzliche anerkannte Bedürfnisse (CHF)</td><td>${formatCurrency(form.zusatzbedarf_monatlich || 0)} CHF</td></tr>` : ''}
            ${form.other_income_annual !== undefined ? `<tr><td>Andere jährliche Einkünfte (z. B. ALV, IV-Zusatzrente etc.) CHF</td><td>${formatCurrency(form.other_income_annual || 0)} CHF</td></tr>` : ''}
            ${form.monthly_other_expenses !== undefined ? `<tr><td>Monatliche zusätzliche Ausgaben (z. B. Krankheit, Pflege, Transport) CHF</td><td>${formatCurrency(form.monthly_other_expenses || 0)} CHF</td></tr>` : ''}
            ${form.ipvReceivedAnnual !== undefined ? `<tr><td>Jährlich erhaltene Individuelle Prämienverbilligung (IPV) CHF</td><td>${formatCurrency(form.ipvReceivedAnnual || 0)} CHF</td></tr>` : ''}
            ${form.elReceivedAnnual !== undefined && form.elReceivedAnnual > 0 ? `<tr><td>Jährlich erhaltene EL CHF</td><td>${formatCurrency(form.elReceivedAnnual)} CHF</td></tr>` : ''}
        </table>
    </div>

    <!-- 计算结果部分 -->
    <div class="section">
        <div class="section-title">Berechnungsergebnisse im Detail</div>

        <!-- IPV -->
        <div class="benefit-card ${ipvResult && !ipvResult.error ? 'success' : 'warning'}">
            <div class="benefit-header">
                <div class="benefit-name">Individuelle Prämienverbilligung (IPV)</div>
                <div class="benefit-amount ${ipvResult?.annualBenefit ? '' : 'amount-zero'}">
                    ${formatCurrency(ipvResult?.annualBenefit || 0)} CHF/Jahr
                </div>
            </div>
            <div>
                <strong>Monatlich:</strong> ${formatCurrency((ipvResult?.annualBenefit || 0) / 12)} CHF
                ${ipvResult?.error ? `<div class="note">${getErrorMessage(ipvResult.error)}</div>` : ''}
            </div>
        </div>

        <!-- EL（仅当用户选择计算时显示） -->
        ${form.checkEL === 'yes' ? `
        <div class="benefit-card ${elResult && !elResult.error ? 'success' : 'warning'}">
            <div class="benefit-header">
                <div class="benefit-name">Ergänzungsleistungen (EL)</div>
                <div class="benefit-amount ${elResult?.annualBenefit ? '' : 'amount-zero'}">
                    ${formatCurrency(elResult?.annualBenefit || 0)} CHF/Jahr
                </div>
            </div>
            <div>
                <strong>Monatlich:</strong> ${formatCurrency((elResult?.annualBenefit || 0) / 12)} CHF
                ${elResult?.error ? `<div class="note">${getErrorMessage(elResult.error)}</div>` : ''}
            </div>
        </div>
        ` : ''}

        <!-- FA（始终显示，即使为0） -->
        <div class="benefit-card ${faResult && !faResult.error ? 'success' : 'warning'}">
            <div class="benefit-header">
                <div class="benefit-name">Familienzulagen (FA)</div>
                <div class="benefit-amount ${faResult?.annualBenefit ? '' : 'amount-zero'}">
                    ${formatCurrency(faResult?.annualBenefit || 0)} CHF/Jahr
                </div>
            </div>
            <div>
                <strong>Monatlich:</strong> ${formatCurrency((faResult?.annualBenefit || 0) / 12)} CHF
                ${faResult?.oneTime?.birth > 0 ? `<div>Geburtsszulage: ${formatCurrency(faResult.oneTime.birth)} CHF (einmalig)</div>` : ''}
                ${faResult?.oneTime?.adoption > 0 ? `<div>Adoptionszulage: ${formatCurrency(faResult.oneTime.adoption)} CHF (einmalig)</div>` : ''}
                ${faResult?.error ? `<div class="note">${getErrorMessage(faResult.error)}</div>` : ''}
            </div>
        </div>

        <!-- SH -->
        <div class="benefit-card ${shResult && !shResult.error ? 'success' : 'warning'}">
            <div class="benefit-header">
                <div class="benefit-name">Sozialhilfe</div>
                <div class="benefit-amount ${shResult?.annualBenefit ? '' : 'amount-zero'}">
                    ${formatCurrency(shResult?.annualBenefit || 0)} CHF/Jahr
                </div>
            </div>
            <div>
                <strong>Monatlich:</strong> ${formatCurrency((shResult?.annualBenefit || 0) / 12)} CHF
                ${shResult?.error ? `<div class="note">${getErrorMessage(shResult.error)}</div>` : ''}
            </div>
        </div>
    </div>

    <!-- 免责声明 -->
    <div class="section">
        <div class="section-title">Wichtige Hinweise</div>
        <div class="note">
            <strong>Dies ist eine unverbindliche Vorab-Berechnung.</strong><br>
            Die endgültige Prüfung erfolgt durch die zuständigen Stellen. Bitte reichen Sie die erforderlichen Unterlagen persönlich bei der zuständigen Behörde ein.
        </div>
    </div>

    <div class="footer">
        Erstellt mit Sozialleistungs-Rechner ${new Date().getFullYear()} | Diese Berechnung dient nur als Orientierungshilfe.
    </div>
</body>
</html>`;
}
/* 111. PDF公文框架 */
function buildPdfResultTable(result) {
  let rows = '';

  if (result.ipv && !result.ipv.error) {
    rows += `
      <tr>
        <td>${t('pdf_benefit_ipv')}</td>
        <td>${result.ipv.monthlyBenefit || 0}</td>
        <td>${result.ipv.annualBenefit || 0}</td>
      </tr>
    `;
  }

  if (result.el && !result.el.error) {
    rows += `
      <tr>
        <td>${t('pdf_benefit_el')}</td>
        <td>${result.el.monthlyBenefit || 0}</td>
        <td>${result.el.annualBenefit || 0}</td>
      </tr>
    `;
  }

  if (result.fa && !result.fa.error) {
    rows += `
    <tr>
      <td>${t('pdf_benefit_fa_children')}</td>
      <td>${result.fa.childrenMonthly || 0}</td>
      <td>${result.fa.childrenAnnual || 0}</td>
    </tr>

    <tr>
      <td>${t('pdf_benefit_fa_education')}</td>
      <td>${result.fa.educationMonthly || 0}</td>
      <td>${result.fa.educationAnnual || 0}</td>
    </tr>

    <tr>
      <td>${t('pdf_benefit_fa_birth')}</td>
      <td>${t('pdf_one_time')}</td>
      <td>${result.fa.birthOnce || 0}</td>
    </tr>

    <tr>
      <td>${t('pdf_benefit_fa_adoption')}</td>
      <td>${t('pdf_one_time')}</td>
      <td>${result.fa.adoptionOnce || 0}</td>
    </tr>
  `;
  }

  if (!rows) {
    rows = `
      <tr>
        <td colspan="3">${t('pdf_no_benefits')}</td>
      </tr>
    `;
  }

  return `
    <table width="100%" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;">
      <thead>
        <tr>
          <th>${t('pdf_table_col_benefit')}</th>
          <th>${t('pdf_table_col_monthly')}</th>
          <th>${t('pdf_table_col_annual')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function buildPdfIpvDetails(ipv) {
  if (!ipv || ipv.error) return '';

  const documents = Array.isArray(ipv.documents) ? ipv.documents : [];

  return `
    <h3>${t('pdf_ipv_detail_title')}</h3>

    <ul>
      <li>${t('pdf_ipv_lna')}: ${ipv.lna}</li>
      <li>${t('pdf_ipv_reference_premium')}: ${ipv.referencePremium}</li>
      <li>${t('pdf_ipv_income_load')}: ${ipv.incomeLoad}</li>
      <li>${t('pdf_ipv_subsidy')}: ${ipv.subsidy}</li>
      <li>${t('pdf_ipv_final')}: ${ipv.finalAmount}</li>
    </ul>

    <p><strong>${t('pdf_legal_basis')}:</strong> ${t(ipv.legalBasisKey)}</p>
    <p><strong>${t('pdf_application_office')}:</strong> ${t(ipv.officeKey)}</p>

    <p><strong>${t('pdf_required_documents')}:</strong></p>
    <ul>
      ${documents.map(key => `<li>${t(key)}</li>`).join('')}
    </ul>
  `;
}

function buildPdfElDetails(el) {
  if (!el || el.error) return '';

  const documents = Array.isArray(el.documents) ? el.documents : [];

  return `
    <hr />

    <h3>${t('pdf_el_detail_title')}</h3>

    <h4>${t('pdf_el_calc_title')}</h4>
    <ul>
      <li>${t('pdf_el_basic_need')}: ${el.basicNeed}</li>
      <li>${t('pdf_el_rent')}: ${el.acceptedRent}</li>
      <li>${t('pdf_el_health_premium')}: ${el.healthPremium}</li>
      <li>${t('pdf_el_total_need')}: ${el.totalNeed}</li>
      <li>${t('pdf_el_child_deduction')}: ${el.childDeduction}</li>
      <li>${t('pdf_el_assets_use')}: ${el.assetConsumption}</li>
      <li>${t('pdf_el_available_income')}: ${el.availableIncome}</li>
    </ul>

    ${el.noteKey ? `<p><em>${t(el.noteKey)}</em></p>` : ''}

    <p><strong>${t('pdf_legal_basis')}:</strong> ${t(el.legalBasisKey)}</p>

    <h4>${t('pdf_application_title')}</h4>

    <p><strong>${t('pdf_application_office')}:</strong> ${t(el.officeKey)}</p>

    <p>
      <strong>${t('pdf_contact')}:</strong><br />
      ${t(el.contactAddressKey)}<br />
      ${t('pdf_phone')}: ${el.phone}<br />
      ${t('pdf_email')}: ${el.email}<br />
      ${t('pdf_website')}: ${el.website}
    </p>

    <h4>${t('pdf_required_documents')}</h4>
    <ul>
      ${documents.map(key => `<li>${t(key)}</li>`).join('')}
    </ul>
  `;
}

function buildPdfFaDetails(fa) {
  if (!fa || fa.error) return '';

  const documents = Array.isArray(fa.documents) ? fa.documents : [];

  return `
    <hr />

    <h3>${t('pdf_fa_detail_title')}</h3>

    <h4>${t('pdf_fa_calc_title')}</h4>
    <ul>
      <li>${t('pdf_fa_children_monthly')}: ${fa.childrenMonthly}</li>
      <li>${t('pdf_fa_children_annual')}: ${fa.childrenAnnual}</li>
      <li>${t('pdf_fa_education_monthly')}: ${fa.educationMonthly}</li>
      <li>${t('pdf_fa_education_annual')}: ${fa.educationAnnual}</li>
      <li>${t('pdf_fa_birth_once')}: ${fa.birthOnce}</li>
      <li>${t('pdf_fa_adoption_once')}: ${fa.adoptionOnce}</li>
    </ul>

    ${fa.noteKey ? `<p><em>${t(fa.noteKey)}</em></p>` : ''}

    ${fa.legalBasisKey ? `
      <p><strong>${t('pdf_legal_basis')}:</strong> ${t(fa.legalBasisKey)}</p>
    ` : ''}

    <h4>${t('pdf_application_title')}</h4>

    <p><strong>${t('pdf_application_office')}:</strong> ${t(fa.officeKey)}</p>

    <p>
      <strong>${t('pdf_contact')}:</strong><br />
      ${t(fa.contactAddressKey)}<br />
      ${t('pdf_phone')}: ${fa.phone}<br />
      ${t('pdf_email')}: ${fa.email}<br />
      ${t('pdf_website')}: ${fa.website}
    </p>

    <h4>${t('pdf_required_documents')}</h4>
    <ul>
      ${documents.map(key => `<li>${t(key)}</li>`).join('')}
    </ul>
  `;
}

function buildPdfSozialhilfeHint(sozialhilfe) {
  if (!sozialhilfe || !sozialhilfe.mainHintKey) return '';

  return `
    <hr />

    <h3>${t('pdf_sozialhilfe_title')}</h3>

    <p>
      ${t(sozialhilfe.mainHintKey)}
    </p>

    ${sozialhilfe.reasonKey ? `
      <p>
        <strong>${t('pdf_sozialhilfe_reason')}:</strong>
        ${t(sozialhilfe.reasonKey)}
      </p>
    ` : ''}

    ${sozialhilfe.exceptionKey ? `
      <p>
        <strong>${t('pdf_sozialhilfe_exception')}:</strong>
        ${t(sozialhilfe.exceptionKey)}
      </p>
    ` : ''}

    ${sozialhilfe.contactKey ? `
      <p>
        <strong>${t('pdf_sozialhilfe_contact')}:</strong>
        ${t(sozialhilfe.contactKey)}
      </p>
    ` : ''}
  `;
}

// 工具函数：获取标准化后的类型名称
function getNormalizedBenefitType(type) {
  return BENEFIT_TYPE_MAP[type] || type;
}

// 工具函数：生成文档键名
function getDocumentKey(state, type) {
  const normalized = getNormalizedBenefitType(type);
  return `${state}_${normalized}_required_documents_list`;
}

// 工具函数：生成申请信息键名
function getApplicationKey(state, type, field) {
  const normalized = getNormalizedBenefitType(type);

  // 特殊处理：authority 字段使用 application_authority 格式
  if (field === 'authority') {
    return `${state}_${normalized}_application_${field}`;
  }

  // 其他字段保持原有格式
  return `${state}_${normalized}_${field}`;
}

/* 20. PDF 生成 — 完全对齐家庭版格式（修复重叠问题） */
async function generatePDF() {
  const btnPdf = document.getElementById('btn-pdf');
  const originalText = btnPdf ? btnPdf.textContent : t('download_pdf') || 'PDF herunterladen';
  const state = Router.state || 'CH';
  const stateName = t(state + '_name') || state;

  // 更新按钮状态
  if (btnPdf) {
    btnPdf.disabled = true;
    btnPdf.textContent = t('pdf_creating') || 'PDF wird erstellt...';
  }

  // ========== 离线支持：检查是否已有 jsPDF ==========
  if (!window.jspdf) {
    console.log('尝试加载 jsPDF 库...');

    try {
      const loadTimeout = setTimeout(() => {
        if (!window.jspdf) {
          console.error('jsPDF 加载超时');
        }
      }, 5000);

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

        script.onload = () => {
          clearTimeout(loadTimeout);
          console.log('jsPDF 成功加载');
          resolve();
        };

        script.onerror = () => {
          clearTimeout(loadTimeout);
          reject(new Error('无法加载 jsPDF 库'));
        };

        document.head.appendChild(script);
      });

    } catch (error) {
      console.error('jsPDF 加载失败:', error);

      const useFallback = confirm(
        t('pdf_library_failed') ||
        'PDF-Bibliothek konnte nicht geladen werden.\n\n' +
        'Möchten Sie:\n' +
        '1. HTML-Ergebnis anzeigen (kann gespeichert/gedruckt werden)\n' +
        '2. Abbrechen\n\n' +
        'Um PDF-Funktion vollständig zu nutzen, bitte Internetverbindung herstellen.'
      );

      if (btnPdf) {
        btnPdf.disabled = false;
        btnPdf.textContent = originalText;
      }

      if (useFallback) {
        showHTMLResultFallback();
        return;
      } else {
        return;
      }
    }
  }

  try {
    console.log('开始生成 PDF...');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 额外保险措施：重置字体大小和行高
    pdf.setFontSize(10);
    pdf.setLineHeightFactor(1.2);

    const currentLang = Router.lang || 'de';

    // 特殊字符映射
    const specialCharMap = {
      'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
      'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
      'à': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
      'î': 'i', 'ï': 'i', 'ô': 'o', 'ù': 'u', 'û': 'u', 'ç': 'c',
      'À': 'A', 'Â': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
      'Î': 'I', 'Ï': 'I', 'Ô': 'O', 'Ù': 'U', 'Û': 'U', 'Ç': 'C',
      'ì': 'i', 'ò': 'o', 'Ì': 'I', 'Ò': 'O',
      'ñ': 'n', 'Ñ': 'N', 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
      'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
      'ã': 'a', 'õ': 'o', 'Ã': 'A', 'Õ': 'O',
      'ı': 'i', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S',
      'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't',
      'Ă': 'A', 'Â': 'A', 'Î': 'I', 'Ș': 'S', 'Ț': 'T',
      'č': 'c', 'ć': 'c', 'đ': 'dj', 'š': 's', 'ž': 'z',
      'Č': 'C', 'Ć': 'C', 'Đ': 'Dj', 'Š': 'S', 'Ž': 'Z'
    };

    function processTextForPDF(text, forceEscape = false) {
      if (typeof text !== 'string') return text;
      if (forceEscape) {
        return text.replace(/[^\x00-\x7F]/g, char => {
          return specialCharMap[char] || char;
        });
      }
      return text;
    }

    // 【关键修复 1】字体改为 helvetica，解决宽度计算错误导致的重叠
    const FONT_FAMILY = 'helvetica';
    const FONT_NORMAL = 'normal';
    const FONT_BOLD = 'bold';
    const LINE_HEIGHT = 5.5;

    pdf.setFont(FONT_FAMILY, FONT_NORMAL);

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 15;
    const contentWidth = pageWidth - (2 * margin);
    let yPos = margin;

    const checkPageBreak = (neededSpace) => {
      if (yPos + neededSpace > pageHeight - 20) {
        pdf.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };

    const drawSection = (title) => {
      checkPageBreak(15);
      pdf.setFontSize(13);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(0, 102, 204);
      const safeTitle = processTextForPDF(title);
      pdf.text(safeTitle, margin, yPos);
      yPos += 6;
      pdf.setDrawColor(0, 102, 204);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;
    };

    const drawKeyValue = (label, value, indent = 0, fixedValueX = null) => {
      pdf.setFontSize(10);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(80, 80, 80);
      const safeLabel = processTextForPDF(label);
      const labelText = safeLabel + ':';

      // 计算标签可用宽度（如果标签太长，自动换行）
      const maxLabelWidth = 70; // 标签最大宽度（mm）
      const labelWidth = pdf.getTextWidth(labelText);

      if (labelWidth > maxLabelWidth) {
        // 标签太长，需要换行
        const labelLines = pdf.splitTextToSize(labelText, maxLabelWidth);

        // 绘制多行标签
        labelLines.forEach((line, index) => {
          pdf.text(line, margin + indent, yPos + (index * LINE_HEIGHT));
        });

        // 数值放在标签下方，左对齐
        const valueStartX = margin + indent + 5; // 稍微缩进
        const safeValue = processTextForPDF(value, true);
        const valueLines = pdf.splitTextToSize(safeValue, contentWidth - valueStartX + margin - 10);

        // 计算数值的起始Y位置（在标签最后一行下方）
        const valueY = yPos + (labelLines.length * LINE_HEIGHT) + 2;

        valueLines.forEach((line, index) => {
          pdf.setFont(FONT_FAMILY, FONT_NORMAL);
          pdf.setTextColor(0, 0, 0);
          pdf.text(line, valueStartX, valueY + (index * LINE_HEIGHT));
        });

        // 更新yPos（考虑标签和数值的总高度）
        yPos = valueY + (valueLines.length * LINE_HEIGHT) + 4;

      } else {
        // 标签正常长度，使用原有逻辑
        let valueStartX;
        if (fixedValueX !== null) {
          valueStartX = fixedValueX;
        } else {
          const minStartX = margin + 50;
          const maxStartX = margin + 90;
          const calculatedStartX = margin + indent + labelWidth + 5;
          valueStartX = Math.min(Math.max(calculatedStartX, minStartX), maxStartX);
        }

        pdf.text(labelText, margin + indent, yPos);

        const availableWidth = contentWidth - (valueStartX - margin) - 5;
        const safeValue = processTextForPDF(value, true);
        const textLines = pdf.splitTextToSize(safeValue, availableWidth);

        let currentY = yPos;
        textLines.forEach((line, index) => {
          pdf.setFont(FONT_FAMILY, FONT_NORMAL);
          pdf.setTextColor(0, 0, 0);
          pdf.text(line, valueStartX, currentY);
          if (index > 0) currentY += LINE_HEIGHT;
        });

        yPos = currentY + LINE_HEIGHT;
      }
    };
    const drawApplicationInfo = async (type, state) => {
      await loadStateRule(state);

      let appInfo = null;
      let documents = [];

      if (type === 'fa') {
        if (window.FA_INFO && window.FA_INFO[state]) {
          const faInfo = window.FA_INFO[state][state] || window.FA_INFO[state];
          appInfo = {
            authority: faInfo.authority ? (t(faInfo.authority.authority_key) || faInfo.authority.office_name) : (t('familienkasse') || 'Familienkasse'),
            address: faInfo.contact?.address_key ? t(faInfo.contact.address_key) : (faInfo.contact?.address || ''),
            phone: faInfo.contact?.phone || t('not_specified') || 'Nicht angegeben',
            email: faInfo.contact?.email || t('not_specified') || 'Nicht angegeben',
            website: faInfo.application?.url || '',
            note: faInfo.notes_key ? t(faInfo.notes_key) : ''
          };
          const docKey = getDocumentKey(state, type);
          if (window.LANG && Array.isArray(window.LANG[docKey])) {
            documents = window.LANG[docKey];
          }
        }
      } else {
        const rule = window.RULE && window.RULE[state] && window.RULE[state][type === 'sh' ? 'sozialhilfe' : type];
        if (rule) {
          // 优先使用规则中定义的 authority_key
          let authKey = rule.authority?.authority_key;

          // 如果没有定义，则根据类型生成正确的键名
          if (!authKey) {
            if (type === 'ipv') {
              authKey = `${state}_ipv_application_authority`;
            } else if (type === 'sh' || type === 'sozialhilfe') {
              authKey = `${state}_sh_application_authority`;
            } else if (type === 'el') {
              authKey = `${state}_el_application_authority`;
            } else {
              // 回退到通用格式
              authKey = getApplicationKey(state, type, 'authority');
            }
          }

          appInfo = {
            authority: authKey ? t(authKey) : (rule.application?.authority || ''),
            address: rule.application?.contact?.address_key ? t(rule.application.contact.address_key) : '',
            phone: rule.application?.contact?.phone || t('not_specified') || 'Nicht angegeben',
            email: rule.application?.contact?.email || t('not_specified') || 'Nicht angegeben',
            website: rule.application?.url || rule.official_url || '',
            legalBasis: rule.legalBasis ? (Array.isArray(rule.legalBasis) ? rule.legalBasis.join(', ') : t(rule.legalBasis)) : ''
          };
          const docKey = getDocumentKey(state, type);
          if (window.LANG && Array.isArray(window.LANG[docKey])) {
            documents = window.LANG[docKey];
          }
        }
      }

      if (!appInfo) return;

      const valueStartX = margin + 72;
      const availableWidth = contentWidth - (valueStartX - margin) - 5;

      const getTextHeight = (text) => {
        if (!text) return 0;
        const lines = pdf.splitTextToSize(processTextForPDF(text, true), availableWidth);
        return lines.length * LINE_HEIGHT;
      };

      let requiredHeight = 30;
      requiredHeight += getTextHeight(appInfo.authority);
      requiredHeight += getTextHeight(appInfo.address);
      requiredHeight += getTextHeight(appInfo.phone);
      requiredHeight += getTextHeight(appInfo.email);
      if (appInfo.website) requiredHeight += getTextHeight(appInfo.website);
      if (appInfo.legalBasis) requiredHeight += getTextHeight(appInfo.legalBasis);

      if (documents.length > 0) {
        requiredHeight += 15;
        documents.forEach(doc => {
          let docText = typeof doc === 'string' ? doc : String(doc);
          docText = docText.replace(/^[✓•]\s*/, '');
          if (typeof doc === 'string' && doc !== docText && window.LANG && window.LANG[doc]) {
            docText = window.LANG[doc];
          }
          requiredHeight += getTextHeight('• ' + docText);
          requiredHeight += 2;
        });
      }

      if (appInfo.note) {
        requiredHeight += 10;
        requiredHeight += getTextHeight(appInfo.note);
      }

      requiredHeight += 10;
      checkPageBreak(requiredHeight + 10);

      pdf.setFillColor(231, 243, 255);
      pdf.rect(margin + 5, yPos, contentWidth - 10, requiredHeight, 'F');

      pdf.setFontSize(9);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(0, 64, 128);
      const antragsinfoTitle = processTextForPDF(t('application_info') || 'Antragsinformationen');
      pdf.text(antragsinfoTitle, margin + 8, yPos + 6);
      yPos += 12;

      pdf.setFont(FONT_FAMILY, FONT_NORMAL);
      pdf.setTextColor(0, 0, 0);

      const drawField = (label, value) => {
        if (!value) return 0;
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(80, 80, 80);
        const safeLabel = processTextForPDF(label + ':', true);
        pdf.text(safeLabel, margin + 5, yPos);
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(0, 0, 0);
        const safeValue = processTextForPDF(value, true);
        const lines = pdf.splitTextToSize(safeValue, availableWidth);
        lines.forEach((line, index) => {
          pdf.text(line, valueStartX, yPos + (index * LINE_HEIGHT));
        });
        const heightUsed = lines.length * LINE_HEIGHT;
        yPos += heightUsed + 2;
        return heightUsed;
      };

      drawField(t('authority') || 'Behörde', appInfo.authority);
      drawField(t('address') || 'Adresse', appInfo.address);
      drawField(t('phone') || 'Telefon', appInfo.phone);
      drawField(t('email') || 'Email', appInfo.email);
      if (appInfo.website) drawField(t('website') || 'Website', appInfo.website);
      if (appInfo.legalBasis) drawField(t('legal_basis') || 'Rechtsgrundlage', appInfo.legalBasis);

      if (documents.length > 0) {
        yPos += 3;
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setFontSize(9);
        pdf.setTextColor(0, 102, 204);
        const unterlagenTitle = processTextForPDF(t('required_documents') || 'Erforderliche Unterlagen:', true);
        pdf.text(unterlagenTitle, margin + 8, yPos);
        yPos += 6;
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setFontSize(9);
        pdf.setTextColor(80, 80, 80);
        documents.forEach((doc) => {
          let docText = typeof doc === 'string' ? doc : String(doc);
          docText = docText.replace(/^[✓•]\s*/, '');
          docText = '• ' + docText;
          if (typeof doc === 'string' && doc !== docText && window.LANG && window.LANG[doc]) {
            const translatedText = window.LANG[doc];
            docText = '• ' + processTextForPDF(translatedText, true);
          } else {
            docText = processTextForPDF(docText, true);
          }
          const docAvailableWidth = contentWidth - 25;
          const docLines = pdf.splitTextToSize(docText, docAvailableWidth);
          docLines.forEach((line) => {
            pdf.text(line, margin + 10, yPos);
            yPos += LINE_HEIGHT;
          });
          yPos += 2;
        });
        pdf.setTextColor(0, 0, 0);
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setFontSize(9);
        yPos += 5;
      }

      if (appInfo.note) {
        yPos += 3;
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.setFont(FONT_FAMILY, 'italic');
        const safeNote = processTextForPDF(appInfo.note, true);
        const noteLines = pdf.splitTextToSize(safeNote, contentWidth - 20);
        noteLines.forEach((line) => {
          pdf.text(line, margin + 8, yPos);
          yPos += LINE_HEIGHT;
        });
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(9);
      }
      yPos += 8;
    };

    // ========== 完全按照家庭版修改的 drawBenefitCard 函数 ==========
    const drawBenefitCard = async (type, title, result) => {
      if (!result) return;

      const hasError = result.error;
      const annual = result.annualBenefit || result.annual || 0;
      const monthly = annual / 12;
      const hasAmount = annual > 0;

      // 处理标题换行
      const fullTitle = processTextForPDF(title);
      // 给错误消息留出足够空间
      const titleAvailableWidth = hasError ? contentWidth - 80 : contentWidth - 35;
      const wrappedTitleLines = pdf.splitTextToSize(fullTitle, titleAvailableWidth);
      const titleLineCount = wrappedTitleLines.length;

      // 计算错误文本
      let topErrorLines = [];
      let detailErrorLines = [];

      if (hasError) {
        const errorText = t('err_general_no_entitlement') || 'Kein Anspruch';
        const safeErrorText = processTextForPDF(errorText, true);
        topErrorLines = pdf.splitTextToSize(safeErrorText, contentWidth - 20);
        const errorMsg = getErrorMessage(result.error);
        const safeErrorMsg = processTextForPDF(errorMsg, true);
        detailErrorLines = pdf.splitTextToSize(safeErrorMsg, contentWidth - 30);
      }

      // 计算卡片高度
      let cardHeight = 25; // 基础高度

      // 标题高度
      if (titleLineCount > 1) {
        cardHeight += (titleLineCount - 1) * LINE_HEIGHT;
      }

      // 如果有错误，增加错误消息区域的高度
      if (hasError) {
        // 顶部错误标题的高度
        cardHeight += (topErrorLines.length * LINE_HEIGHT) + 5;
        // 详细错误消息的高度
        cardHeight += (detailErrorLines.length * LINE_HEIGHT) + 8;
      } else if (hasAmount) {
        // 正常情况下的月度金额显示
        cardHeight += 5;
      }

      if (result.explanation?.steps) cardHeight += result.explanation.steps.length * 6;
      if (result.oneTime?.birth > 0 || result.oneTime?.adoption > 0) cardHeight += 10;

      checkPageBreak(cardHeight + 20);

      // 绘制卡片背景
      pdf.setFillColor(248, 249, 250);
      pdf.rect(margin, yPos, contentWidth, cardHeight, 'F');

      const colors = {
        ipv: [40, 167, 69],
        el: [23, 162, 184],
        fa: [255, 193, 7],
        sh: [108, 117, 125]
      };
      pdf.setFillColor(...(colors[type] || [128, 128, 128]));
      pdf.rect(margin, yPos, 3, cardHeight, 'F');

      // 1. 绘制标题
      pdf.setFontSize(12);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(0, 0, 0);

      let currentTitleY = yPos + 7;
      wrappedTitleLines.forEach((line, index) => {
        pdf.text(line, margin + 8, currentTitleY);
        currentTitleY += LINE_HEIGHT;
      });

      // 2. 绘制金额或错误消息
      if (hasError) {
        // 错误消息放在标题下方
        currentTitleY += 3;

        // 绘制错误标题
        pdf.setFontSize(10);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(220, 53, 69);

        topErrorLines.forEach((line, index) => {
          pdf.text(line, margin + 8, currentTitleY + (index * LINE_HEIGHT));
        });

        // 更新Y位置到错误标题之后
        const errorTitleHeight = topErrorLines.length * LINE_HEIGHT;
        yPos = currentTitleY + errorTitleHeight + 5;

        // 绘制详细错误消息
        pdf.setFontSize(9);
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(150, 150, 150);

        detailErrorLines.forEach((line, index) => {
          pdf.text(line, margin + 8, yPos + (index * LINE_HEIGHT));
        });

        // 更新Y位置到详细错误之后
        yPos += (detailErrorLines.length * LINE_HEIGHT) + 8;

      } else {
        // 正常情况：金额显示在右侧
        const rightAlignX = pageWidth - margin - 5;
        const firstLineY = yPos + 7;

        pdf.setFontSize(11);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(40, 167, 69);
        const amountText = `${formatCurrency(annual)} CHF/Jahr`;
        const safeAmountText = processTextForPDF(amountText);
        pdf.text(safeAmountText, rightAlignX, firstLineY, { align: 'right' });

        if (hasAmount) {
          pdf.setFontSize(9);
          pdf.setTextColor(100, 100, 100);
          const monthlyText = `${t('monthly_short') || 'Monatlich'}: ${formatCurrency(monthly)} CHF`;
          const safeMonthlyText = processTextForPDF(monthlyText);
          pdf.text(safeMonthlyText, rightAlignX, firstLineY + 5, { align: 'right' });
        }

        // 计算Y偏移
        let titleHeight = titleLineCount * LINE_HEIGHT;
        let amountHeight = hasAmount ? 10 : (pdf.getTextWidth(safeAmountText) > 0 ? LINE_HEIGHT : 0);
        let yOffset = Math.max(titleHeight, amountHeight) + 8;
        yPos += yOffset;

        // 绘制计算步骤
        if (result.explanation && Array.isArray(result.explanation.steps)) {
          pdf.setFontSize(9);
          const stepsStartY = yPos;
          let maxStepHeight = 0;
          result.explanation.steps.forEach((step, idx) => {
            const isLast = idx === result.explanation.steps.length - 1;
            const label = t(step.label) || step.label;
            const value = typeof step.value === 'number' ? formatCurrency(step.value) + ' CHF' : (t(step.value) || step.value);
            pdf.setFont(FONT_FAMILY, isLast ? FONT_BOLD : FONT_NORMAL);
            pdf.setTextColor(isLast ? 0 : 80, isLast ? 102 : 80, isLast ? 204 : 80);
            const safeLabel = processTextForPDF(label, true);
            const safeValue = processTextForPDF(value, true);
            const labelW = pdf.getTextWidth(safeLabel + ': ') + 8;
            pdf.text(safeLabel + ':', margin + 8, stepsStartY + (idx * LINE_HEIGHT * 1.5));
            const stepValueStartX = margin + labelW;
            const stepValueAvailableWidth = contentWidth - stepValueStartX - 10;
            if (pdf.getTextWidth(safeValue) > stepValueAvailableWidth) {
              const valueLines = pdf.splitTextToSize(safeValue, stepValueAvailableWidth);
              valueLines.forEach((line, lineIdx) => {
                pdf.text(line, stepValueStartX, stepsStartY + ((idx + lineIdx) * LINE_HEIGHT * 1.5));
              });
              maxStepHeight = Math.max(maxStepHeight, (valueLines.length - 1) * LINE_HEIGHT * 1.5);
            } else {
              pdf.text(safeValue, stepValueStartX, stepsStartY + (idx * LINE_HEIGHT * 1.5));
            }
          });
          yPos = stepsStartY + (result.explanation.steps.length * LINE_HEIGHT * 1.5) + maxStepHeight + 5;
        }

        // 绘制FA一次性津贴
        if (type === 'fa' && result.oneTime) {
          const birth = result.oneTime.birth || 0;
          const adoption = result.oneTime.adoption || 0;
          if (birth > 0 || adoption > 0) {
            yPos += 3;
            pdf.setFontSize(9);
            pdf.setTextColor(23, 162, 184);
            const einmalzahlungenText = processTextForPDF(t('fa_onetime_allowances') || 'Einmalzahlungen:', true);
            pdf.text(einmalzahlungenText, margin + 8, yPos);
            yPos += 5;
            pdf.setTextColor(0, 0, 0);
            if (birth > 0) {
              const birthText = `• ${t('birth_allowance') || 'Geburtsszulage'}: ${formatCurrency(birth)} CHF`;
              const safeBirthText = processTextForPDF(birthText, true);
              pdf.text(safeBirthText, margin + 12, yPos);
              yPos += 4;
            }
            if (adoption > 0) {
              const adoptionText = `• ${t('adoption_allowance') || 'Adoptionszulage'}: ${formatCurrency(adoption)} CHF`;
              const safeAdoptionText = processTextForPDF(adoptionText, true);
              pdf.text(safeAdoptionText, margin + 12, yPos);
              yPos += 4;
            }
          }
        }
      }

      yPos += 8;
      await drawApplicationInfo(type, state);
    };

    // === 开始绘制 PDF ===
    pdf.setFontSize(22);
    pdf.setFont(FONT_FAMILY, FONT_BOLD);
    pdf.setTextColor(0, 102, 204);

    const mainTitle = processTextForPDF(t('pdf_title') || 'Sozialleistungsberechnung');
    pdf.text(mainTitle, pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;

    pdf.setFontSize(11);
    pdf.setTextColor(102, 102, 102);

    const kantonText = processTextForPDF(`${t('canton') || 'Kanton'} ${stateName} (${state})`);
    pdf.text(kantonText, pageWidth / 2, yPos, { align: 'center' });
    yPos += 5;

    const now = new Date().toLocaleString('de-CH');
    pdf.setFontSize(9);
    const dateText = processTextForPDF(`${t('pdf_calculation_date') || 'Erstellt am'} ${now}`);
    pdf.text(dateText, pageWidth / 2, yPos, { align: 'center' });
    yPos += 12;

    pdf.setDrawColor(0, 102, 204);
    pdf.setLineWidth(0.5);
    pdf.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // ========== 输入数据 ==========
    drawSection(t('input_data') || 'Ihre Eingabedaten');

    const form = Router.form || {};
    const inputFields = [
      [t('zielgruppe') || 'Personengruppe', t('crowd_' + Router.crowd) || Router.crowd || '-'],
      [t('canton') || 'Kanton', stateName],
      [t('postal_code') || 'Postleitzahl', Router.plz || '-'],
      [t('num_adults') || 'Anzahl Erwachsene', String(form.numAdults || 1)],
      [t('annual_income') || 'Jahreseinkommen', `${formatCurrency(form.income || 0)} CHF`],
      [t('assets') || 'Vermögen', `${formatCurrency(form.assets || 0)} CHF`],
      [t('health_insurance_premium') || 'KK-Prämie (Jahr)', `${formatCurrency(form.health_premium || 0)} CHF`],
      [t('monthly_rent') || 'Monatsmiete', `${formatCurrency(form.monthlyRent || 0)} CHF`]
    ];

    // 添加低收入版专属字段
    if (form.employmentStatus) {
      inputFields.push([t('label_employment_status') || 'Erwerbssituation', t('employment_' + form.employmentStatus) || form.employmentStatus]);
    }
    if (form.hasMedicalNeeds) {
      inputFields.push([t('label_has_medical_needs') || 'Med. Bedürfnisse?', form.hasMedicalNeeds === 'yes' ? 'Ja' : 'Nein']);
    }
    if (form.arbeitspensum !== undefined) {
      inputFields.push([t('label_arbeitspensum') || 'Arbeitspensum', `${form.arbeitspensum}%`]);
    }
    if (form.zusatzbedarf_monatlich !== undefined) {
      inputFields.push([t('label_zusatzbedarf_monatlich') || 'Zusatzbedarf (monatlich)', `${formatCurrency(form.zusatzbedarf_monatlich)} CHF`]);
    }
    if (form.other_income_annual !== undefined) {
      inputFields.push([t('label_other_income_annual') || 'Andere Einkünfte', `${formatCurrency(form.other_income_annual)} CHF`]);
    }
    if (form.monthly_other_expenses !== undefined) {
      inputFields.push([t('label_monthly_other_expenses') || 'Zusatzausgaben (monatlich)', `${formatCurrency(form.monthly_other_expenses)} CHF`]);
    }
    if (form.ipvReceivedAnnual !== undefined && form.ipvReceivedAnnual > 0) {
      inputFields.push([t('label_ipv_received_annual') || 'Erhaltene IPV', `${formatCurrency(form.ipvReceivedAnnual)} CHF`]);
    }
    if (form.elReceivedAnnual !== undefined && form.elReceivedAnnual > 0) {
      inputFields.push([t('label_el_received_annual') || 'Erhaltene EL', `${formatCurrency(form.elReceivedAnnual)} CHF`]);
    }

    pdf.setFontSize(10);
    inputFields.forEach(([label, value]) => {
      drawKeyValue(label, value, 0);
    });

    yPos += 10;

    // EL信息（如果适用）
    if (form.checkEL === 'yes') {
      yPos += 5;
      pdf.setFillColor(240, 248, 255);
      pdf.rect(margin, yPos, contentWidth, 20, 'F');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 64, 128);
      const pensionType = form.isReceivingPension === 'ahv' ? t('pension_type_ahv') || 'AHV (Altersrente)' :
        form.isReceivingPension === 'iv' ? t('pension_type_iv') || 'IV (Invalidenrente)' : t('pension_type_none') || 'Keine Rente';
      const nationality = form.nationality === 'ch_eu' ? t('nat_ch_eu') || 'Schweiz/EU/EFTA' :
        form.nationality === 'non_eu_eea' ? t('nat_non_eu') || 'Drittstaat' : t('nat_refugee') || 'Flüchtling';
      const elInfoText = processTextForPDF(
        `EL-${t('info') || 'Info'}: ${pensionType} | ${nationality} | ${form.residenceYears || 0} ${t('residence_years') || 'Jahre Aufenthalt'}`,
        true
      );
      pdf.text(elInfoText, margin + 5, yPos + 7);
      yPos += 25;
    } else {
      yPos += 10;
    }

    drawSection(t('berechnungsergebnisse_heading') || 'Berechnungsergebnisse im Detail');

    const results = Router.resultData || {};

    await drawBenefitCard('ipv', t('ipv_title') || 'Individuelle Prämienverbilligung (IPV)', results.ipv);

    if (form.checkEL === 'yes' && results.el) {
      await drawBenefitCard('el', t('el_title') || 'Ergänzungsleistungen (EL)', results.el);
    }

    await drawBenefitCard('fa', t('fa_title') || 'Familienzulagen (FA)', results.fa);
    await drawBenefitCard('sh', t('sozialhilfe_title') || 'Sozialhilfe', results.sozialhilfe);

    checkPageBreak(40);
    yPos += 10;
    pdf.setFillColor(255, 243, 205);
    pdf.setDrawColor(255, 234, 167);
    pdf.rect(margin, yPos, contentWidth, 35, 'FD');

    pdf.setFontSize(11);
    pdf.setFont(FONT_FAMILY, FONT_BOLD);
    pdf.setTextColor(133, 100, 4);

    const hinweisTitle = processTextForPDF(t('disclaimer_important') || 'Wichtiger Hinweis');
    pdf.text(hinweisTitle, pageWidth / 2, yPos + 8, { align: 'center' });

    pdf.setFont(FONT_FAMILY, FONT_NORMAL);
    pdf.setFontSize(9);

    const disclaimer = t('disclaimer_content') || 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen. Bitte reichen Sie die erforderlichen Unterlagen persönlich bei der zuständigen Behörde ein.';
    const safeDisclaimer = processTextForPDF(disclaimer, true);
    const disclaimerLines = pdf.splitTextToSize(safeDisclaimer, contentWidth - 10);

    let disclaimerY = yPos + 15;
    disclaimerLines.forEach((line) => {
      pdf.text(line, margin + 5, disclaimerY);
      disclaimerY += LINE_HEIGHT;
    });
    yPos = disclaimerY + 5;

    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);

    const footerText = processTextForPDF(
      (t('pdf_footer') || 'Erstellt mit Sozialleistungs-Rechner {year} | Diese Berechnung dient nur als Orientierungshilfe.').replace('{year}', new Date().getFullYear()),
      true
    );
    pdf.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });

    const filename = `Sozialleistungs_Berechnung_${state}_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);

    console.log('PDF 成功创建，使用 Helvetica 字体');
    console.log('Verwendete Schriftart:', FONT_FAMILY);
    console.log('Aktuelle Sprache:', currentLang);

    if (btnPdf) {
      btnPdf.disabled = false;
      btnPdf.textContent = originalText;
    }

  } catch (error) {
    console.error('PDF 生成错误:', error);
    alert(t('error_generate_pdf') || 'PDF konnte nicht erstellt werden: ' + (error.message || 'Unbekannter Fehler'));

    if (btnPdf) {
      btnPdf.disabled = false;
      btnPdf.textContent = originalText;
    }
  }
}

/* 22. 工具：t 函数 */
function t(key) {
  if (!key) return '';
  const value = window.LANG ? window.LANG[key] : undefined;

  console.log("[T DEBUG] Requested key:", key);
  console.log("[T DEBUG] window.LANG exists:", !!window.LANG);
  console.log("[T DEBUG] Value found:", value);
  console.log("[T DEBUG] Returned:", value || key);

  return value || key;
}
/* 23. 模板函数 - 现在默认显示低收入版欢迎词 + 默认选中低收入 */
const tmplCrowd = () => `
  <h2>${t('welcome_low_income') || 'Willkommen beim Geringverdiener-Rechner'}</h2>
  
  <p style="color:#666; margin-bottom:20px;">
    ${t('crowd_low_income_hint') || 'Bitte geben Sie Ihre finanzielle und berufliche Situation so genau wie möglich an. Das beeinflusst vor allem die mögliche Sozialhilfe (SH) und Prämienverbilligung (IPV).'}
  </p>

  <select id="sel-crowd">
    <option value="">-- ${t('select_crowd') || 'Personengruppe auswählen'} --</option>
    <option value="family">${t('crowd_family')}</option>
    <option value="single">${t('crowd_single')}</option>
    <option value="student">${t('crowd_student')}</option>
    <option value="low_income" selected>${t('crowd_low_income') || 'Geringverdiener'}</option>
    <option value="pregnant">${t('crowd_pregnant')}</option>
    <option value="unemployed">${t('crowd_unemployed')}</option>
    <option value="disabled">${t('crowd_disabled')}</option>
    <option value="refugee">${t('crowd_refugee')}</option>
  </select>

  <div class="button-group">
    <button id="btn-state" class="btn-primary" style="margin-top: 20px;">${t('continue') || 'Weiter'}</button>
  </div>
`;

const tmplState = () => `
  <h2>${t('select_state_plz')}</h2>
  <label>${t('canton')}</label>
  <select id="sel-state">
    <option value="">-- ${t('canton')} --</option>
    ${STATES.map(s => `<option value="${s}">${t(s + '_name') || s}</option>`).join('')}
  </select>
  <label>${t('postal_code')}</label>
  <input id="inp-plz" type="text" maxlength="4" placeholder="z.B. 3000" pattern="\\d{4}">
  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
    <button id="btn-state" class="btn-primary" disabled>${t('continue')}</button>
  </div>
`;
/* 输入表单 - 学生版专用：添加学生专属字段 */
const tmplForm = () => `
  <h2>${t('input_data_student') || 'Studentendaten eingeben'}</h2>
  
  <!-- 学生版专用提示 -->
  <div style="background:#fff3cd; padding:12px; border-radius:4px; margin-bottom:20px; border:1px solid #ffeeba;">
    <strong>${t('student_mode_active') || 'Studenten-Modus aktiv'}</strong><br>
    ${t('student_hint') || 'Bitte geben Sie Ihre Studien- und Lebenssituation ein. Dies beeinflusst mögliche Zuschläge bei Sozialhilfe (SH) und Prämienverbilligung (IPV).'}
  </div>

  <form id="dynamic-form">
    <!-- 基本财务信息（和单人版一样） -->
    <label>${t('annual_income')} (CHF)</label>
    <span class="hint">${t('hint_income_student') || 'Steuerbares Jahreseinkommen (inkl. Nebenjobs, Stipendien etc.)'}</span>
    <input name="income" type="number" step="0.01" min="0" placeholder="z.B. 15000" required>

    <label>${t('assets')} (CHF) <small>${t('hint_assets_small') || '(steuerbares Reinvermögen, ohne selbstgenutztes Wohneigentum)'}</small></label>
    <span class="hint">${t('hint_assets_student') || 'Vermögen abzüglich Schulden (z.B. Sparkonto, Wertpapiere)'}</span>
    <input name="assets" type="number" step="0.01" min="0" placeholder="z.B. 5000" required>

    <label>${t('health_insurance_premium')}</label>
    <span class="hint">${t('hint_health_premium') || 'Jahresprämie der obligatorischen Grundversicherung'}</span>
    <input name="health_premium" type="number" step="0.01" min="0" placeholder="z.B. 2500" required>

    <label>${t('monthly_rent')} (CHF)</label>
    <span class="hint">${t('hint_rent_student') || 'Monatliche Miete (WG-Zimmer, Studentenwohnheim etc.)'}</span>
    <input name="monthlyRent" type="number" step="0.01" min="0" placeholder="z.B. 800" required>

    <!-- 成人固定为1（学生版通常单人） -->
    <label>${t('num_adults_single') || 'Anzahl Erwachsene (fest: 1)'}</label>
    <input name="numAdults" type="number" min="1" max="1" value="1" readonly style="background:#f0f8ff;">

    <!-- 新增：学生专属字段 -->
    <label>${t('is_fulltime_student') || 'Studieren Sie Vollzeit?'}</label>
    <span class="hint">${t('hint_fulltime_student') || 'Vollzeit = mind. 20 ECTS pro Semester'}</span>
    <div style="margin:5px 0 15px;">
      <label style="display:inline-block; margin-right:20px;">
        <input type="radio" name="isFulltimeStudent" value="yes" checked> ${t('yes_fulltime') || 'Ja, Vollzeit'}
      </label>
      <label style="display:inline-block;">
        <input type="radio" name="isFulltimeStudent" value="parttime"> ${t('parttime') || 'Nein, Teilzeit/Fernstudium'}
      </label>
    </div>

    <label>${t('study_costs_monthly') || 'Monatliche Studienkosten (CHF)'}</label>
    <span class="hint">${t('hint_study_costs') || 'z.B. Semestergebühren, Bücher, Transport, Laptop etc. (nur nachweisbare Kosten)'}</span>
    <input name="studyCostsMonthly" type="number" step="0.01" min="0" placeholder="z.B. 400" value="0">

    <label>${t('has_stipendium') || 'Erhalten Sie Stipendium oder Ausbildungsbeihilfe?'}</label>
    <span class="hint">${t('hint_stipendium') || 'z.B. Kantonales Stipendium, Stiftungen, Sozialstipendium'}</span>
    <div style="margin:5px 0 15px;">
      <label style="display:inline-block; margin-right:20px;">
        <input type="radio" name="hasStipendium" value="yes"> ${t('yes')}
      </label>
      <label style="display:inline-block;">
        <input type="radio" name="hasStipendium" value="no" checked> ${t('no')}
      </label>
    </div>

    <!-- EL 额外字段（保持不变） -->
    <div id="el-extra-fields" style="display:none">
      <!-- ... 这里保持和单人版一样的 EL 字段代码，不需要改 ... -->
      <!-- 你可以直接从原来的 tmplForm 复制 el-extra-fields 的全部内容粘贴在这里 -->
      <label>${t('label_is_receiving_pension')}</label>
      <div style="margin:5px 0 15px;">
        <label style="display:inline-block; margin-right:15px; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="ahv"> ${t('pension_type_ahv')}
        </label>
        <label style="display:inline-block; margin-right:15px; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="iv"> ${t('pension_type_iv')}
        </label>
        <label style="display:inline-block; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="no"> ${t('pension_type_none')}
        </label>
      </div>

      <div id="el-no-pension-warning" class="warning-box">
        <strong>${t('error')}:</strong> ${t('err_el_no_pension_warning')}
      </div>

      <div id="pension-type-field" style="display:none">
        <label>${t('label_pension_type')}</label>
        <span class="hint">${t('pension_type_hint')}</span>
        <div style="margin:5px 0 15px;">
          <label style="display:inline-block; margin-right:15px;">
            <input type="radio" name="pensionType" value="AHV" checked> ${t('pension_type_ahv')}
          </label>
          <label style="display:inline-block;">
            <input type="radio" name="pensionType" value="IV"> ${t('pension_type_iv')}
          </label>
        </div>
      </div>

      <div id="el-other-fields">
        <label>${t('label_nationality')}</label>
        <select name="nationality" required>
          <option value="">-- ${t('select_canton')} --</option>
          <option value="ch_eu">${t('nat_ch_eu')}</option>
          <option value="non_eu_eea">${t('nat_non_eu')}</option>
          <option value="refugee_f">${t('nat_refugee')} ${t('refugee_f_status')}</option>
          <option value="refugee_b">${t('nat_refugee')} (B-Status)</option>
        </select>
        <label>${t('label_residence_years')}</label>
        <input name="residenceYears" type="number" min="0" max="100" placeholder="z.B. 12" required>
      </div>
    </div>

    <!-- SH 额外字段（保持不变） -->
    <div id="sh-extra-fields" style="display:none; margin-top:20px; padding:15px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px;">
      <!-- ... 这里保持和单人版一样的 SH 字段代码，不需要改 ... -->
      <!-- 你可以直接从原来的 tmplForm 复制 sh-extra-fields 的全部内容粘贴在这里 -->
      <h4>${t('sh_extra_fields_title')}</h4>
      <label>${t('label_employment_status')}</label>
      <span class="hint" style="color: #666; font-size: 0.9em;">Für Studierende oft 'other' oder 'unemployed'</span>
      <select name="employmentStatus">
        <option value="" disabled selected>${t('select_option_placeholder') || '-- Bitte wählen --'}</option>
        <option value="employed">${t('employment_employed')}</option>
        <option value="unemployed">${t('employment_unemployed')}</option>
        <option value="unable">${t('employment_unable')}</option>
        <option value="other" selected>${t('employment_other')}</option>
      </select>

      <label>${t('label_has_medical_needs')}</label>
      <div>
        <label style="display:inline-block; margin-right:15px;"><input type="radio" name="hasMedicalNeeds" value="yes"> ${t('yes')}</label>
        <label style="display:inline-block;"><input type="radio" name="hasMedicalNeeds" value="no"> ${t('no')}</label>
      </div>

      <label>${t('label_other_income_annual') || "Andere jährliche Einkünfte (z. B. Stipendium, ALV)"} CHF</label>
      <input name="other_income_annual" type="number" step="0.01" min="0" placeholder="z.B. 0" value="0">

      <label>${t('label_monthly_other_expenses') || "Monatliche zusätzliche Ausgaben (z. B. Krankheit, Pflege)"} CHF</label>
      <input name="monthly_other_expenses" type="number" step="0.01" min="0" placeholder="z.B. 0" value="0">

      <label style="color: #28a745;">✓ ${t('label_ipv_received_annual') || "Bereits erhaltene IPV (jährlich)"} CHF</label>
      <input name="ipvReceivedAnnual" type="number" step="0.01" min="0" placeholder="0.00" value="0" readonly style="background-color: #f0f8ff; border-color: #28a745;">

      <label style="color: #28a745;">✓ ${t('label_el_received_annual') || "Bereits erhaltene EL (jährlich)"} CHF</label>
      <input name="elReceivedAnnual" type="number" step="0.01" min="0" placeholder="0.00" value="0" readonly style="background-color: #f0f8ff; border-color: #28a745;">
    </div>
  </form>

  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
    <button id="btn-calc" class="btn-primary">${t('calculate')}</button>
  </div>
`;
/* 输入表单 - 退休版专用：去除学生字段，加养老金金额 */
const tmplRetired = () => `
  <h2>${t('input_data_retired') || 'Rentnerdaten eingeben'}</h2>
 
  <!-- 退休版专用提示 -->
  <div style="background:#fff3cd; padding:12px; border-radius:4px; margin-bottom:20px; border:1px solid #ffeeba;">
    <strong>${t('retired_mode_active') || 'Rentner-Modus aktiv'}</strong><br>
    ${t('retired_hint') || 'Bitte geben Sie Ihre Renten- und Lebenssituation ein. Dies beeinflusst EL (Ergänzungsleistungen) und mögliche SH-Zuschläge.'}
  </div>
  <form id="dynamic-form">
    <!-- 基本财务信息（类似学生版） -->
    <label>${t('annual_income')} (CHF)</label>
    <span class="hint">${t('hint_income_retired') || 'Steuerbares Jahreseinkommen (z.B. Nebenjobs, Zinsen) – ohne AHV/IV'}</span>
    <input name="income" type="number" step="0.01" min="0" placeholder="z.B. 5000" required>
    <label>${t('assets')} (CHF) <small>${t('hint_assets_small') || '(steuerbares Reinvermögen, ohne selbstgenutztes Wohneigentum)'}</small></label>
    <span class="hint">${t('hint_assets_retired') || 'Vermögen abzüglich Schulden'}</span>
    <input name="assets" type="number" step="0.01" min="0" placeholder="z.B. 80000" required>
    <label>${t('health_insurance_premium')}</label>
    <span class="hint">${t('hint_health_premium') || 'Jahresprämie der obligatorischen Grundversicherung'}</span>
    <input name="health_premium" type="number" step="0.01" min="0" placeholder="z.B. 4500" required>
    <label>${t('monthly_rent')} (CHF)</label>
    <span class="hint">${t('hint_rent_retired') || 'Monatliche Miete oder Hypothekarzinsen'}</span>
    <input name="monthlyRent" type="number" step="0.01" min="0" placeholder="z.B. 1200" required>
    <!-- 成人固定为1 -->
    <label>${t('num_adults_single') || 'Anzahl Erwachsene (fest: 1)'}</label>
    <input name="numAdults" type="number" min="1" max="1" value="1" readonly style="background:#f0f8ff;">
    <!-- 新增：退休专属字段 - 养老金金额 -->
    <label>${t('monthly_pension') || 'Monatliche AHV/IV-Rente (CHF)'}</label>
    <span class="hint">${t('hint_monthly_pension') || 'Aktueller monatlicher Rentenbetrag (vor EL)'}</span>
    <input name="monthlyPensionAmount" type="number" step="0.01" min="0" placeholder="z.B. 1500" required>
    <!-- EL 准入字段（退休版默认开启） -->
    <label>${t('el_precheck_title')}</label>
    <span class="hint">${t('ask_el_confirm_retired') || 'Für Rentner ist EL oft relevant. Prüfen?'}</span>
    <div style="margin:5px 0 15px;">
      <label style="display:inline;font-weight:normal;"><input type="radio" name="checkEL" value="yes" checked> ${t('confirm_yes')}</label>
      <label style="display:inline;font-weight:normal;margin-left:15px;"><input type="radio" name="checkEL" value="no"> ${t('confirm_no')}</label>
    </div>
    <!-- EL 额外字段（默认显示） -->
    <div id="el-extra-fields" style="display:block">
      <label>${t('label_is_receiving_pension')}</label>
      <div style="margin:5px 0 15px;">
        <label style="display:inline-block; margin-right:15px; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="ahv" checked> ${t('pension_type_ahv')}
        </label>
        <label style="display:inline-block; margin-right:15px; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="iv"> ${t('pension_type_iv')}
        </label>
        <label style="display:inline-block; margin-bottom:8px;">
          <input type="radio" name="isReceivingPension" value="no"> ${t('pension_type_none')}
        </label>
      </div>
      <div id="el-no-pension-warning" class="warning-box">
        <strong>${t('error')}:</strong> ${t('err_el_no_pension_warning')}
      </div>
      <div id="pension-type-field" style="display:block">
        <label>${t('label_pension_type')}</label>
        <span class="hint">${t('pension_type_hint')}</span>
        <div style="margin:5px 0 15px;">
          <label style="display:inline-block; margin-right:15px;">
            <input type="radio" name="pensionType" value="AHV" checked> ${t('pension_type_ahv')}
          </label>
          <label style="display:inline-block;">
            <input type="radio" name="pensionType" value="IV"> ${t('pension_type_iv')}
          </label>
        </div>
      </div>
      <div id="el-other-fields">
        <label>${t('label_nationality')}</label>
        <select name="nationality" required>
          <option value="">-- ${t('select_option_placeholder') || 'Bitte wählen'} --</option>
          <option value="ch_eu">${t('nat_ch_eu')}</option>
          <option value="non_eu_eea">${t('nat_non_eu')}</option>
          <option value="refugee_f">${t('nat_refugee')} ${t('refugee_f_status')}</option>
          <option value="refugee_b">${t('nat_refugee')} (B-Status)</option>
        </select>
        <label>${t('label_residence_years')}</label>
        <input name="residenceYears" type="number" min="0" max="100" placeholder="z.B. 40" required>
      </div>
    </div>
    <!-- SH 额外字段（退休版复用学生版的） -->
    <div id="sh-extra-fields" style="display:none; margin-top:20px; padding:15px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px;">
      <h4>${t('sh_extra_fields_title')}</h4>
      <label>${t('label_employment_status')}</label>
      <span class="hint" style="color: #666; font-size: 0.9em;">${t('hint_employment_status_retired') || 'Für Rentner oft \'unable\' oder \'other\''}</span>
      <select name="employmentStatus">
        <option value="" disabled selected>-- ${t('select_option_placeholder') || 'Bitte wählen'} --</option>
        <option value="employed">${t('employment_employed')}</option>
        <option value="unemployed">${t('employment_unemployed')}</option>
        <option value="unable" selected>${t('employment_unable')}</option>
        <option value="other">${t('employment_other')}</option>
      </select>
      <label>${t('label_has_medical_needs')}</label>
      <div>
        <label style="display:inline-block; margin-right:15px;"><input type="radio" name="hasMedicalNeeds" value="yes"> ${t('yes')}</label>
        <label style="display:inline-block;"><input type="radio" name="hasMedicalNeeds" value="no"> ${t('no')}</label>
      </div>
      <label>${t('label_other_income_annual') || "Andere jährliche Einkünfte (z. B. Nebenverdienst)"} CHF</label>
      <input name="other_income_annual" type="number" step="0.01" min="0" placeholder="z.B. 0" value="0">
      <label>${t('label_monthly_other_expenses') || "Monatliche zusätzliche Ausgaben (z. B. Pflege, Medikamente)"} CHF</label>
      <input name="monthly_other_expenses" type="number" step="0.01" min="0" placeholder="z.B. 200" value="0">
      <label style="color: #28a745;">✓ ${t('label_ipv_received_annual') || "Bereits erhaltene IPV (jährlich)"} CHF</label>
      <input name="ipvReceivedAnnual" type="number" step="0.01" min="0" placeholder="0.00" value="0" readonly style="background-color: #f0f8ff; border-color: #28a745;">
      <label style="color: #28a745;">✓ ${t('label_el_received_annual') || "Bereits erhaltene EL (jährlich)"} CHF</label>
      <input name="elReceivedAnnual" type="number" step="0.01" min="0" placeholder="0.00" value="0" readonly style="background-color: #f0f8ff; border-color: #28a745;">
    </div>
  </form>
  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
    <button id="btn-calc" class="btn-primary">${t('calculate')}</button>
  </div>
`;
const tmplResult = () => `
  <h2>${t('result_title')}</h2>

  <!-- 醒目的免责声明 -->
  <div class="disclaimer-box">
    <strong>${t('disclaimer_important') || 'Wichtiger Hinweis'}</strong><br>
    ${t('disclaimer_content') || 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen.'}
  </div>

  <!-- 用户输入信息始终显示 -->
  <div id="user-inputs"></div>
  <hr>

  <!-- IPV -->
  <details class="benefit-details" id="ipv-details" open>
    <summary class="benefit-summary">
      <span>${t('ipv_title')}</span>
      <span class="benefit-total">
        ${t('annual_short') || 'Jährlich'}: <b id="ipv-benefit-annual">0.00</b> CHF | 
        ${t('monthly_short') || 'Monatlich'}: <b id="ipv-benefit-monthly">0.00</b> CHF
        <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
      </span>
    </summary>
    <div class="benefit-details-content">
      <div id="ipv-formula-box" class="formula-container"></div>
    </div>
  </details>

  <!-- EL -->
  <details class="benefit-details" id="el-details" style="display:none">
    <summary class="benefit-summary">
      <span>${t('el_title')}</span>
      <span class="benefit-total">
        ${t('annual_short') || 'Jährlich'}: <b id="el-benefit-annual">0.00</b> CHF | 
        ${t('monthly_short') || 'Monatlich'}: <b id="el-benefit-monthly">0.00</b> CHF
        <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
      </span>
    </summary>
    <div class="benefit-details-content">
      <div id="el-formula-box" class="formula-container"></div>
    </div>
  </details>

  <!-- FA -->
  <details class="benefit-details" id="fa-details">
    <summary class="benefit-summary">
      <span>${t('fa_title')}</span>
      <span class="benefit-total">
        ${t('annual_short') || 'Jährlich'}: <b id="fa-benefit-annual">0.00</b> CHF | 
        ${t('monthly_short') || 'Monatlich'}: <b id="fa-benefit-monthly">0.00</b> CHF
        <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
      </span>
    </summary>
    <div class="benefit-details-content">
      <div id="fa-onetime-allowances" style="margin-bottom:15px; font-size:0.95em;"></div>
      <div id="fa-formula-box" class="formula-container"></div>
    </div>
  </details>

  <!-- SH -->
  <details class="benefit-details" id="sh-details" style="display:none">
    <summary class="benefit-summary">
      <span>${t('sozialhilfe_title')}</span>
      <span class="benefit-total">
        ${t('annual_short') || 'Jährlich'}: <b id="sh-benefit-annual">0.00</b> CHF | 
        ${t('monthly_short') || 'Monatlich'}: <b id="sh-benefit-monthly">0.00</b> CHF
        <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
      </span>
    </summary>
    <div class="benefit-details-content">
      <div id="sh-formula-box" class="formula-container"></div>
      <div class="warning-box" style="margin-top:20px;">
        ${t('sh_general_disclaimer') || 'Hinweis: Sozialhilfe ist das letzte Sicherungsnetz und nachrangig.'}
      </div>
    </div>
  </details>

  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
    <button id="btn-recalc" class="btn-secondary">${t('recalculate') || 'Neu berechnen'}</button>
    <button id="btn-pdf" class="btn-primary">${t('download_pdf')}</button>
  </div>
`;

/* 输入表单 - 低收入版专用 */
const tmplLowIncome = () => `
  <h2>${t('input_data_low_income')}</h2>

  <!-- 低收入版专用提示 - 修改为使用 mode-notice 类 -->
  <div class="mode-notice">
    <strong>${t('low_income_mode_active')}</strong>
    <span class="mode-notice-text">${t('low_income_hint')}</span>
  </div>

  <form id="dynamic-form">
    <!-- 基本财务信息 -->
    <label>${t('annual_income')} (CHF)</label>
    <span class="hint">${t('hint_income_low_income') || 'Steuerbares Jahreseinkommen (inkl. Nebenjobs, Gelegenheitsarbeit, kleine ALV etc.)'}</span>
    <input name="income" type="number" step="0.01" min="0" placeholder="z.B. 18000" required>

    <label>${t('assets')} (CHF) <small>${t('hint_assets_small') || '(steuerbares Reinvermögen, ohne selbstgenutztes Wohneigentum)'}</small></label>
    <span class="hint">${t('hint_assets_low_income') || 'Vermögen abzüglich Schulden (Sparkonto, Wertpapiere etc.)'}</span>
    <input name="assets" type="number" step="0.01" min="0" placeholder="z.B. 8000" required>

    <label>${t('health_insurance_premium')}</label>
    <span class="hint">${t('lowincome_hint_health_premium')}</span>
    <input name="health_premium" type="number" step="0.01" min="0" placeholder="z.B. 3800" required>

    <label>${t('monthly_rent')} (CHF)</label>
    <span class="hint">${t('hint_rent_low_income') || 'Monatliche Miete oder Wohnkosten'}</span>
    <input name="monthlyRent" type="number" step="0.01" min="0" placeholder="z.B. 950" required>

    <!-- 成人数量固定为1 -->
    <label>${t('num_adults')} (fest: 1)</label>
    <input 
      name="numAdults" 
      type="number" 
      min="1" 
      max="1" 
      value="1" 
      readonly 
      style="background: #f0f8ff;"
    >

    <!-- 是否计算 EL（低收入版强制 no，并显示说明） -->
    <label>${t('el_precheck_title')}</label>
    <span class="hint">${t('ask_el_confirm_lowincome')}</span>
    <div style="margin: 5px 0 15px;">
      <label style="display: inline; font-weight: normal; color: #6c757d; opacity: 0.7; cursor: not-allowed;">
        <input type="radio" name="checkEL" value="yes" disabled> ${t('confirm_yes')}
      </label>
      <label style="display: inline; font-weight: normal; margin-left: 15px; cursor: default;">
        <input type="radio" name="checkEL" value="no" checked disabled> ${t('confirm_no')}
      </label>
    </div>

    <!-- 低收入模式专属 EL 禁用说明（无链接） -->
    <div id="el-disabled-notice" class="warning-box" style="
      background: #fff3cd;
      border: 1px solid #ffeeba;
      color: #856404;
      padding: 15px;
      margin: 10px 0 20px 0;
      border-radius: 4px;
      font-size: 0.95em;
    ">
      <strong>${t('lowincome_el_not_supported')}</strong><br>
      ${t('lowincome_el_explanation')}
    </div>

    <!-- EL 额外字段永远隐藏 -->
    <div id="el-extra-fields" style="display: none;">
      <!-- 保留结构，但不会显示 -->
    </div>

    <!-- SH 额外字段（低收入版默认展开） -->
    <div 
      id="sh-extra-fields" 
      style="
        display: block; 
        margin-top: 20px; 
        padding: 15px; 
        background: #f8f9fa; 
        border: 1px solid #dee2e6; 
        border-radius: 4px;
      "
    >
      <h4>${t('sh_extra_fields_title')}</h4>

      <label>${t('label_employment_status')}</label>
      <span class="hint">${t('hint_employment_status_low_income')}</span>
      <select name="employmentStatus" required>
        <option value="" disabled>-- ${t('select_option_placeholder') || 'Bitte wählen'} --</option>
        <option value="employed_full">${t('employment_employed_full')}</option>
        <option value="employed_part">${t('employment_employed_part')}</option>
        <option value="employed_minijob">${t('employment_employed_minijob')}</option>
        <option value="self_employed">${t('employment_self_employed')}</option>
        <option value="unemployed">${t('employment_unemployed')}</option>
        <option value="unable">${t('employment_unable')}</option>
        <option value="other" selected>${t('employment_other')}</option>
      </select>

      <label>${t('label_has_medical_needs')}</label>
      <div>
        <label style="display: inline-block; margin-right: 15px;">
          <input type="radio" name="hasMedicalNeeds" value="yes" checked> ${t('yes')}
        </label>
        <label style="display: inline-block;">
          <input type="radio" name="hasMedicalNeeds" value="no"> ${t('no')}
        </label>
      </div>

      <label>${t('label_arbeitspensum')}</label>
      <span class="hint">${t('hint_arbeitspensum')}</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input 
          name="arbeitspensum" 
          type="number" 
          min="0" 
          max="100" 
          placeholder="z.B. 60" 
          value="0" 
          style="width: 120px;"
        >
        <span>%</span>
      </div>

      <label>${t('label_zusatzbedarf_monatlich')}</label>
      <span class="hint">${t('hint_zusatzbedarf_monatlich')}</span>
      <input 
        name="zusatzbedarf_monatlich" 
        type="number" 
        step="0.01" 
        min="0" 
        placeholder="z.B. 150" 
        value="0"
      >

      <label>${t('label_other_income_annual')}</label>
      <input 
        name="other_income_annual" 
        type="number" 
        step="0.01" 
        min="0" 
        placeholder="z.B. 0" 
        value="0"
      >

      <label>${t('label_monthly_other_expenses')}</label>
      <input 
        name="monthly_other_expenses" 
        type="number" 
        step="0.01" 
        min="0" 
        placeholder="z.B. 0" 
        value="0"
      >

      <label style="color: #28a745;">✓ ${t('label_ipv_received_annual')}</label>
      <input 
        name="ipvReceivedAnnual" 
        type="number" 
        step="0.01" 
        min="0" 
        placeholder="0.00" 
        value="0" 
        readonly 
        style="background-color: #f0f8ff; border-color: #28a745;"
      >

      <label style="color: #28a745;">✓ ${t('label_el_received_annual')}</label>
      <input 
        name="elReceivedAnnual" 
        type="number" 
        step="0.01" 
        min="0" 
        placeholder="0.00" 
        value="0" 
        readonly 
        style="background-color: #f0f8ff; border-color: #28a745;"
      >
    </div>
  </form>

  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back')}</button>
    <button id="btn-calc" class="btn-primary">${t('calculate')}</button>
  </div>

  <!-- 新增：SH 二次计算提示（默认隐藏） -->
  <div 
    id="sh-recalc-hint" 
    class="warning-box" 
    style="
      display: none; 
      background: #fff3cd; 
      border: 2px solid #ffeeba; 
      color: #856404; 
      padding: 18px; 
      margin-top: 25px; 
      font-size: 1.1em; 
      font-weight: bold; 
      text-align: center; 
      border-radius: 8px;
    "
  >
    <div style="margin-bottom: 10px; font-size: 1.3em;">${t('sh_recalc_hint_title')}</div>
    <div>${t('sh_recalc_hint_text')}</div>
    <div style="margin-top: 12px;">${t('sh_recalc_hint_action')}</div>
  </div>
`;

/* 24. 调试工具 - 可选 */
if (window.location.hostname === 'localhost') {
  window.debug = {
    clearCache: () => {
      for (const key in moduleCache) delete moduleCache[key];
      window.RULE = null;
      window.CALC = null;
      console.log('Cache cleared');
    },
    showCache: () => console.log('Module cache:', moduleCache),
    showFAFields: () => getRequiredFAFields(Router.form, Router.state),
    testFA: () => buildFAFormData(Router.form),
    testPath: (path) => {
      console.log(`Resolved path for "${path}":`, resolvePath(path));
    }
  };
}
window.Router = Router;
function resetELFields() {
  // 清空或重置EL字段
  document.querySelectorAll('#el-extra-fields input, #el-extra-fields select').forEach(el => {
    if (el.type === 'radio' || el.type === 'checkbox') {
      el.checked = false;
    } else {
      el.value = '';
    }
  });

  // 重置隐藏状态
  const warningEl = document.getElementById('el-no-pension-warning');
  const typeBox = document.getElementById('pension-type-field');
  const otherFields = document.getElementById('el-other-fields');

  if (warningEl) warningEl.style.display = 'none';
  if (typeBox) typeBox.style.display = 'none';
  if (otherFields) {
    otherFields.style.display = 'block';
    otherFields.querySelectorAll('select, input').forEach(i => {
      i.value = '';
      i.required = false;
      i.disabled = false;
    });
  }
}
// 离线回退：显示HTML版本
function showHTMLResultFallback() {
  const resultData = Router.resultData;
  const form = Router.form || {};
  const state = Router.state || 'CH';
  const stateName = t(state + '_name') || state;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Sozialleistungsberechnung - ${stateName}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; border-bottom: 2px solid #0066cc; padding-bottom: 15px; }
        .section { margin: 25px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #f8f9fa; }
        .benefit-card { border: 1px solid #ddd; padding: 15px; margin: 15px 0; }
        .warning-box { background: #fff3cd; border: 1px solid #ffeeba; padding: 15px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Sozialleistungsberechnung</h1>
        <h3>${stateName} - ${new Date().toLocaleDateString('de-CH')}</h3>
        <p><em>Offline-Version - Speichern Sie diese Seite als PDF</em></p>
      </div>
      
      <div class="section">
        <h2>Eingabedaten</h2>
        <table>
          <tr><th>Feld</th><th>Wert</th></tr>
          ${Object.entries({
    'Personengruppe': t('crowd_' + Router.crowd) || Router.crowd,
    'Kanton': stateName,
    'Postleitzahl': Router.plz || '-',
    'Erwachsene': form.numAdults || 1,
    'Kinder': form.numChildren || 0,
    'Junge Erwachsene': form.numEducation || 0,
    'Jahreseinkommen': formatCurrency(form.income || 0) + ' CHF',
    'Vermögen': formatCurrency(form.assets || 0) + ' CHF',
    'KK-Prämie': formatCurrency(form.health_premium || 0) + ' CHF',
    'Monatsmiete': formatCurrency(form.monthlyRent || 0) + ' CHF'
  }).map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('')}
        </table>
      </div>
      
      <div class="section">
        <h2>Berechnungsergebnisse</h2>
        ${resultData.ipv ? `<div class="benefit-card">
          <h3>IPV: ${formatCurrency(resultData.ipv.annualBenefit || 0)} CHF/Jahr</h3>
          <p>Monatlich: ${formatCurrency((resultData.ipv.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.el && !resultData.el.error ? `<div class="benefit-card">
          <h3>EL: ${formatCurrency(resultData.el.annualBenefit || 0)} CHF/Jahr</h3>
          <p>Monatlich: ${formatCurrency((resultData.el.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.fa ? `<div class="benefit-card">
          <h3>FA: ${formatCurrency(resultData.fa.annualBenefit || 0)} CHF/Jahr</h3>
          <p>Monatlich: ${formatCurrency((resultData.fa.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.sozialhilfe ? `<div class="benefit-card">
          <h3>Sozialhilfe: ${formatCurrency(resultData.sozialhilfe.annualBenefit || 0)} CHF/Jahr</h3>
          <p>Monatlich: ${formatCurrency((resultData.sozialhilfe.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
      </div>
      
      <div class="warning-box">
        <h3>Wichtiger Hinweis</h3>
        <p>Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen.</p>
        <p><strong>Speichern:</strong> Drücken Sie Strg+P (Windows) oder Cmd+P (Mac) und wählen Sie "Als PDF speichern".</p>
      </div>
    </body>
    </html>
  `;

  // 在新窗口显示
  const newWindow = window.open('', '_blank');
  newWindow.document.write(htmlContent);
  newWindow.document.close();
}

// ========== 新增：模块初始化函数（供loader.js调用）==========
window.initCrowdModule = async function () {  // ← 添加 async
  console.log('Initializing low income crowd module (fullscreen mode)');

  try {
    // 1. 加载低收入版专用CSS（如果有）
    await FullscreenManager.loadCSS().catch(e => {
      console.warn('Low income CSS load failed, continue anyway', e);
    });

    // 2. 重置状态
    FullscreenManager.reset();

    // 3. 进入全屏模式
    FullscreenManager.enter();

    // 4. 设置人群类型
    Router.crowd = 'low_income';

    // 5. 应用语言设置
    if (window.currentLang) {
      Router.lang = window.currentLang;
    } else {
      const savedLang = localStorage.getItem('preferred_lang');
      if (savedLang) Router.lang = savedLang;
    }

    // 6. 清空app容器
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      app.classList.add('lowincome-module-active');  // 添加模块激活类
    }

    // 7. 开始渲染（从州选择页面开始）
    render('state');

    console.log('Low income fullscreen module initialized successfully');

  } catch (error) {
    console.error('Low income module init failed:', error);
    FullscreenManager.exit();

    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
                <div style="color: red; text-align: center; padding: 50px;">
                    <h3>低收入模块加载失败</h3>
                    <p>${error.message}</p>
                    <button onclick="location.reload()">重新加载</button>
                </div>
            `;
    }
  }
};

// ========== 修改原有的window.onload（使其兼容两种加载方式）==========
const originalOnload = window.onload;

window.onload = async function () {
  // 检查是否通过loader加载（URL中有crowd参数）
  const isLoadedByLoader = window.location.search.includes('crowd=');

  if (!isLoadedByLoader) {
    // 直接访问此文件时，执行原来的初始化逻辑
    console.log('Direct access to low income module, initializing directly');

    document.body.innerHTML = '<div id="app"></div>';
    await loadLanguage();
    // addStyles();  // 可以注释掉，因为我们用外部CSS

    // 直接调用初始化函数
    await window.initCrowdModule();
  } else {
    // 通过loader加载，等待loader调用initCrowdModule
    console.log('Low income module loaded by loader, waiting for init...');
    // 什么都不做，等待loader调用initCrowdModule
  }
}; // ← 这里闭合 window.onload 函数

// ===== 新增：给loader用的启动函数 =====
window.startLowIncome = function () {
  Router.crowd = 'low_income';
  const app = document.getElementById('app');
  if (app) app.innerHTML = '';
  render('state');  // ✅ 改成 state，跳过人群选择
};

console.log('Low income module loaded, ready for initialization');