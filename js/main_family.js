/* main.js – 完整无省略修正版（集成 IPV / EL / SH / FA 四大算法）*/
const CDN = './'; // 使用相对路径

/* 22. 工具：t 函数 */
function t(key, fallbackToKey = true) {
  if (!key) return '';

  // 直接查找
  let value = window.LANG ? window.LANG[key] : undefined;

  // 调试日志
  console.log("[T DEBUG] Requested key:", key);

  // 如果找不到，尝试多种可能的键名变体
  if (value === undefined && key.includes('_')) {
    const parts = key.split('_');
    const state = parts[0];
    const type = parts[1];
    const field = parts.slice(2).join('_');

    // 尝试的变体列表
    const variants = [];

    // 原始键
    variants.push(key);

    // IPV 特殊处理
    if (type === 'ipv' && field === 'authority') {
      variants.push(`${state}_ipv_application_authority`);
    }

    // SH 特殊处理
    if (type === 'sozialhilfe' && field === 'authority') {
      variants.push(`${state}_sh_authority`);
    }

    // 通用变体：去掉类型中的某个部分
    if (type === 'sozialhilfe') {
      variants.push(`${state}_sh_${field}`);
    }

    // 尝试所有变体
    for (const variant of variants) {
      if (variant !== key && window.LANG && window.LANG[variant] !== undefined) {
        value = window.LANG[variant];
        console.warn(`[i18n Fallback] Using variant "${variant}" for missing "${key}"`);
        break;
      }
    }
  }

  // 确定最终返回值
  const returnedValue = value !== undefined ? value : (fallbackToKey ? key : '');

  console.log("[T DEBUG] Returned:", returnedValue);
  return returnedValue;
}

// ========== 福利类型规范化映射表 ==========
const BENEFIT_TYPE_MAP = {
  // 简写: 全称（用于键名拼接）
  'sh': 'sozialhilfe',
  'ipv': 'ipv',
  'el': 'el',
  'fa': 'fa',
  'alv': 'alv',
  'iv': 'iv'  // 为未来IV预留
};

/**
 * 获取规范化后的福利类型名称
 * @param {string} type - 可能为简写或全称
 * @returns {string} 标准化后的全称
 */
function getNormalizedBenefitType(type) {
  if (!type) return '';
  // 如果已经是全称或映射不存在，返回原值
  return BENEFIT_TYPE_MAP[type] || type;
}

/**
 * 生成文档列表的翻译键名
 * @param {string} state - 州代码
 * @param {string} type - 福利类型（简写或全称）
 * @returns {string} 完整的翻译键名
 */
function getDocumentKey(state, type) {
  const normalized = getNormalizedBenefitType(type);
  return `${state}_${normalized}_required_documents_list`;
}

/**
 * 生成申请机构信息的翻译键名
 * @param {string} state - 州代码
 * @param {string} type - 福利类型（简写或全称）
 * @param {string} field - 字段名
 * @returns {string} 完整的翻译键名
 */
function getApplicationKey(state, type, field) {
  const normalized = getNormalizedBenefitType(type);

  // 特殊处理已知的不一致格式
  if (type === 'ipv' && field === 'authority') {
    return `${state}_ipv_application_authority`;
  }

  if (type === 'sh' && field === 'authority') {
    return `${state}_sh_authority`;
  }

  // 其他情况保持通用格式
  return `${state}_${normalized}_${field}`;
}

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

/* === EL 联邦统一准入检查 (2026 法律标准) === */
function validateELPreConditions(formData) {
  // A. 第一支柱强制检查：必须领取 AHV 或 IV
  if (formData.isReceivingPension !== 'ahv' && formData.isReceivingPension !== 'iv') {
    return { eligible: false, reasonKey: 'err_no_ahv_iv' };
  }
  // B. 身份与居住年限检查 (联邦 ELG 第 5 条)
  const { nationality, residenceYears } = formData;
  if (nationality === 'non_eu_eea') {
    if (residenceYears < 10) return { eligible: false, reasonKey: 'err_residence_10y' };
  } else if (nationality === 'refugee_f' || nationality === 'refugee_b') {
    if (residenceYears < 5) return { eligible: false, reasonKey: 'err_residence_5y' };
  }
  // C. 2021 改革后的资产硬门槛 (2026 标准)
  // 资产门槛（10万/20万）不包含联邦法律规定的自住房产免征额部分
  // 判定家庭单位：优先检查 crowd === 'couple'，其次 numAdults >= 2
  const isMarried = formData.crowd === 'couple' || formData.numAdults >= 2;
  const assetLimit = isMarried ? 200000 : 100000;
  if (formData.taxableAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_federal' };
  }
  return { eligible: true };
}
/* ========== FA 相关辅助函数（新增）========== */
/**
 * 根据州和当前表单状态，返回需要的 FA 字段列表
 */
function getRequiredFAFields(formData, state) {
  if (!formData || typeof formData !== 'object') return [];

  const numChildren = Number(formData.numChildren) || 0;
  const numEducation = Number(formData.numEducation) || 0;

  // 无孩子 → 不需要 FA 额外字段
  if (numChildren + numEducation === 0) {
    return [];
  }

  // 只收集额外字段（排除基础字段 numChildren 和 numEducation）
  const required = new Set();

  Object.entries(FA_FIELD_RULES).forEach(([ruleKey, rule]) => {
    if (ruleKey === 'base') return; // 跳过基础字段规则

    if (!rule.states || !rule.states.includes(state)) return;

    rule.requiredFields.forEach(field => {
      if (field === 'numChildrenOver12' && numChildren === 0) return;
      if (field === 'numEducationOver18' && numEducation === 0) return;
      if (field === 'numNewborns' && numChildren === 0) return;
      if (field === 'numAdoptions' && numChildren === 0) return;
      required.add(field);
    });
  });

  return Array.from(required);
}
/**
 * 构建 FA 算法所需的数据对象
 */
function buildFAFormData(formData) {
  if (!formData || typeof formData !== 'object') {
    formData = {};
  }

  const safeInt = (key) => {
    const val = formData[key];
    const num = parseInt(val, 10);
    return isNaN(num) || num < 0 ? 0 : num;
  };

  const numChildren = safeInt('numChildren');
  const numEducation = safeInt('numEducation');

  return {
    numChildren,
    numEducation,
    totalChildren: numChildren + numEducation,
    numNewborns: safeInt('numNewborns'),
    numAdoptions: safeInt('numAdoptions'),
    numChildrenOver12: Math.min(safeInt('numChildrenOver12'), numChildren),
    numEducationOver18: Math.min(safeInt('numEducationOver18'), numEducation)
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

  const requiredFields = getRequiredFAFields(formData, state);
  const faSection = document.getElementById('fa-extra-fields');

  if (!faSection) return;

  // 基础字段映射（这些字段在 fa-extra-fields 容器内）
  const fieldMap = {
    'numNewborns': 'fa-field-newborns',
    'numAdoptions': 'fa-field-adoptions',
    'numChildrenOver12': 'fa-field-children-over12',
    'numEducationOver18': 'fa-field-education-over18'
  };

  // 检查是否有任何额外字段需要显示
  const hasExtraFields = requiredFields.some(field => fieldMap[field]);

  if (!hasExtraFields || requiredFields.length === 0) {
    faSection.style.display = 'none';
    return;
  }

  faSection.style.display = 'block';

  // 显示/隐藏具体字段
  Object.entries(fieldMap).forEach(([field, elementId]) => {
    const el = document.getElementById(elementId);
    if (el) {
      const isRequired = requiredFields.includes(field);
      el.style.display = isRequired ? 'block' : 'none';
      const input = el.querySelector('input');
      if (input) {
        input.required = isRequired;
        if (!isRequired) input.value = '0';
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
  document.body.innerHTML = '<div id="app"></div>';
  await loadLanguage();
  addStyles();
  render('crowd');
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
      select_option_placeholder: '-- Bitte wählen --',
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
/* 7. 渲染器 - 修改版（添加全屏退出逻辑） */
function render(step, isBack = false) {
  const app = document.getElementById('app');
  if (!app) return;

  // ========== 新增：全屏模式管理逻辑 ==========
  // 如果渲染的是人群选择页面（step === 'crowd'），退出全屏模式
  if (step === 'crowd') {
    console.log('Rendering crowd step, exiting fullscreen mode');

    // 退出全屏模式
    if (window.FullscreenManager) {
      window.FullscreenManager.exit();
    }

    // 恢复主页面元素的显示
    const header = document.querySelector('.site-header');
    const crowdSelector = document.getElementById('crowd-selector');
    const footer = document.querySelector('.site-footer');

    if (header) header.style.display = '';
    if (crowdSelector) crowdSelector.style.display = '';
    if (footer) footer.style.display = '';

    // 移除家庭模块激活类
    app.classList.remove('family-module-active');

    // 重置Router状态（但保留语言设置）
    const currentLang = Router.lang;
    Router.crowd = null;
    Router.state = null;
    Router.plz = null;
    Router.form = {};
    Router.rule = null;
    Router.calc = null;
    Router.history = [];
    Router.resultData = null;
    Router.pendingSH = false;
    Router.shExtraShown = false;
    Router.lang = currentLang;

    // 可选：更新URL，移除crowd参数
    const url = new URL(window.location);
    url.searchParams.delete('crowd');
    window.history.replaceState({}, '', url);
  }
  // 如果渲染的是state或form页面，确保进入全屏模式（但避免重复进入）
  else if ((step === 'state' || step === 'form' || step === 'result') &&
    window.FullscreenManager &&
    !document.body.classList.contains('module-fullscreen')) {
    console.log(`Rendering ${step} step, ensuring fullscreen mode`);

    // 确保全屏模式
    window.FullscreenManager.enter();
    app.classList.add('family-module-active');
  }
  // ========== 结束：全屏模式管理逻辑 ==========

  // 如果不是回退操作，记录历史
  if (!isBack && step !== Router.currentStep) {
    Router.history.push(Router.currentStep);
  }
  Router.currentStep = step;

  // 渲染对应模板
  app.innerHTML = {
    crowd: tmplCrowd,
    state: tmplState,
    form: tmplForm,
    result: tmplResult
  }[step]();

  // 恢复表单数据（如果是回退到表单页面）
  if (step === 'form' && Object.keys(Router.form).length > 0) {
    restoreFormData();
  }

  // 绑定事件
  bindEvents(step);

  // 如果是结果页面，填充数据
  if (step === 'result' && Router.resultData) {
    fillResultPage();
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

    // 添加退出模块按钮事件
    const exitBtn = document.getElementById('btn-exit-module');
    if (exitBtn) {
      exitBtn.onclick = () => {
        console.log('Exit button clicked, returning to main page');

        // 退出全屏模式
        if (window.FullscreenManager) {
          window.FullscreenManager.exit();
        }

        // 恢复主页面显示
        const header = document.querySelector('.site-header');
        const crowdSelector = document.getElementById('crowd-selector');
        const footer = document.querySelector('.site-footer');

        if (header) header.style.display = '';
        if (crowdSelector) crowdSelector.style.display = '';
        if (footer) footer.style.display = '';

        // 移除家庭模块激活类
        const app = document.getElementById('app');
        if (app) {
          app.classList.remove('family-module-active');
        }

        // 清空app容器并显示默认提示
        app.innerHTML = `
                <div style="text-align:center; padding:50px; color:#666;">
                    Bitte wählen Sie oben Ihre Zielgruppe
                </div>
            `;

        // 重置Router状态
        const currentLang = Router.lang;
        Router.crowd = null;
        Router.state = null;
        Router.plz = null;
        Router.form = {};
        Router.rule = null;
        Router.calc = null;
        Router.history = [];
        Router.resultData = null;
        Router.pendingSH = false;
        Router.shExtraShown = false;
        Router.lang = currentLang;

        // 可选：返回到主页面的初始URL
        const url = new URL(window.location);
        url.searchParams.delete('crowd');
        window.history.pushState({}, '', url);
      };
    }
  }

  if (step === 'form') {
    // EL 字段动态显隐
    const radiosEL = document.querySelectorAll('input[name="checkEL"]');
    const elBlock = document.getElementById('el-extra-fields');
    radiosEL.forEach(r => r.addEventListener('change', e => {
      if (e.target.value === 'yes') {
        elBlock.style.display = 'block';
        // 重置所有EL字段状态
        resetELFields();
      } else {
        elBlock.style.display = 'none';
        elBlock.querySelectorAll('select,input').forEach(i => {
          if (i.type === 'radio' || i.type === 'checkbox') i.checked = false;
          else i.value = '';
          i.required = false;
          i.disabled = false;
        });
        // 隐藏警告框
        document.getElementById('el-no-pension-warning').style.display = 'none';
      }
    }));

    // 养老金选择联动 + 实时阻断
    const pensionRadios = document.querySelectorAll('input[name="isReceivingPension"]');
    const typeBox = document.getElementById('pension-type-field');
    const warningBox = document.getElementById('el-no-pension-warning');
    const otherFields = document.getElementById('el-other-fields');
    const btnCalc = document.getElementById('btn-calc');
    pensionRadios.forEach(r => r.addEventListener('change', e => {
      if (e.target.value === 'ahv' || e.target.value === 'iv') {
        // 选择AHV或IV：显示类型选择，隐藏警告，启用其他字段
        typeBox.style.display = 'block';
        warningBox.style.display = 'none';
        otherFields.style.display = 'block';
        // 自动选中对应类型
        document.querySelector(`input[name="pensionType"][value="${e.target.value.toUpperCase()}"]`).checked = true;
        // 启用所有EL字段并设为必填
        otherFields.querySelectorAll('select,input').forEach(i => {
          i.required = true;
          i.disabled = false;
        });
      } else if (e.target.value === 'no') {
        // 选择"不领取"：显示法律警告，禁用其他EL字段
        typeBox.style.display = 'none';
        warningBox.style.display = 'block';
        otherFields.style.display = 'block'; // 仍然显示，但禁用
        // 清除类型选择
        document.querySelectorAll('input[name="pensionType"]').forEach(pt => pt.checked = false);
        // 禁用国籍和居住年限字段（用户无需填写）
        otherFields.querySelectorAll('select,input').forEach(i => {
          i.value = '';
          i.required = false;
          i.disabled = true;
        });
      }
    }));

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
              // 可选：改颜色提醒用户现在是 SH 阶段
              btnCalc.style.backgroundColor = '#ffc107'; // 黄色警示
              btnCalc.style.color = '#212529';
            }
          } else {
            // 正常结果，恢复原按钮文字（防止从结果页回退时文字不对）
            const btnCalc = document.getElementById('btn-calc');
            if (btnCalc) {
              btnCalc.textContent = t('calculate') || 'Berechnen';
              btnCalc.style.backgroundColor = ''; // 恢复原色
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
        // 前置检查1：如果选择"不领取养老金"但检查EL=yes
        const checkEL = document.querySelector('input[name="checkEL"]:checked');
        const isReceivingPension = document.querySelector('input[name="isReceivingPension"]:checked');
        if (checkEL && checkEL.value === 'yes' &&
          isReceivingPension && isReceivingPension.value === 'no') {
          // 友好的错误提示
          alert(t('err_el_no_pension_warning') + '\n\nBitte wählen Sie "Nein, nur IPV" oder korrigieren Sie Ihre Eingabe.');
          return;
        }
        // 前置检查2：如果SH字段已显示，验证SH必填字段
        if (Router.pendingSH || document.getElementById('sh-extra-fields').style.display !== 'none') {
          // 验证SH必填字段
          const employmentSelect = document.querySelector('select[name="employmentStatus"]');
          const medicalRadio = document.querySelector('input[name="hasMedicalNeeds"]:checked');
          let errorMessage = '';
          if (!employmentSelect || !employmentSelect.value) {
            errorMessage = 'Bitte wählen Sie einen Beschäftigungsstatus.';
          } else if (!medicalRadio) {
            errorMessage = 'Bitte geben Sie an, ob medizinische Bedürfnisse bestehen.';
          }
          if (errorMessage) {
            alert(errorMessage);
            // 聚焦到第一个错误的字段
            if (!employmentSelect || !employmentSelect.value) {
              employmentSelect?.focus();
            } else if (!medicalRadio) {
              document.querySelector('input[name="hasMedicalNeeds"]')?.parentElement?.scrollIntoView();
            }
            return;
          }
        }
        // 继续原有验证和计算
        await originalBtnCalcClick();
      };
    }
    // 添加返回按钮
    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = goBack;
    }
    // === 回退到 form 页时，如果 SH 额外字段曾展开，保持可见 ===
    if (Router.shExtraShown) {
      document.getElementById('sh-extra-fields').style.display = 'block';
    }
    // === 新增：SH字段动态验证 ===
    // 当SH字段显示时，为必填字段添加实时验证
    const shExtraFields = document.getElementById('sh-extra-fields');
    if (shExtraFields && shExtraFields.style.display !== 'none') {
      const employmentSelect = shExtraFields.querySelector('select[name="employmentStatus"]');
      const medicalRadios = shExtraFields.querySelectorAll('input[name="hasMedicalNeeds"]');
      if (employmentSelect) {
        // 为就业状态添加验证样式
        employmentSelect.addEventListener('change', function () {
          if (this.value) {
            this.style.borderColor = '#28a745';
          } else {
            this.style.borderColor = '#dc3545';
          }
        });
      }
      if (medicalRadios.length > 0) {
        // 为医疗需求选项添加验证样式
        medicalRadios.forEach(radio => {
          radio.addEventListener('change', function () {
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
    // 添加返回按钮
    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = goBack;
    }
    // 添加重新计算按钮（回退到 form 时恢复按钮文字和样式）
    const recalcBtn = document.getElementById('btn-recalc');
    if (recalcBtn) {
      recalcBtn.onclick = () => {
        // 回退到 form 时恢复原 “Berechnen” 按钮的文字和样式
        const btnCalc = document.getElementById('btn-calc');
        if (btnCalc) {
          btnCalc.textContent = t('calculate') || 'Berechnen';
          btnCalc.style.backgroundColor = ''; // 恢复默认背景色
          btnCalc.style.color = ''; // 恢复默认文字颜色
        }
        render('form', true);
      };
    }
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
    alert(t('please_fill_all_fields'));
  }
  return isValid;
}
/* 12. 收集表单（集成 FA 字段） */
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
  // EL 算法要求 taxableIncomeAnnual 和 taxableAssets
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

  // 确保有默认值
  Router.form.income = Router.form.income || 0;
  Router.form.assets = Router.form.assets || 0;
  Router.form.health_premium = Router.form.health_premium || 0;
  Router.form.numAdults = Router.form.numAdults || 1;
  Router.form.numChildren = Router.form.numChildren || 0;
  Router.form.numEducation = Router.form.numEducation || 0;
  Router.form.monthlyRent = Router.form.monthlyRent || 0;
  Router.form.crowd = Router.crowd;
  Router.form.pensionType = Router.form.pensionType || 'AHV';

  // FA 字段安全兜底（新增）
  Router.form.numNewborns = Router.form.numNewborns || 0;
  Router.form.numAdoptions = Router.form.numAdoptions || 0;
  Router.form.numChildrenOver12 = Router.form.numChildrenOver12 || 0;
  Router.form.numEducationOver18 = Router.form.numEducationOver18 || 0;

  // 特殊处理：如果用户选择不领取养老金
  if (Router.form.isReceivingPension === 'no') {
    // 明确标记无法计算EL
    Router.form.elImpossible = true;
    // 清空不需要的EL字段
    Router.form.nationality = '';
    Router.form.residenceYears = 0;
    Router.form.pensionType = '';
  }

  console.log('Form collected:', Router.form);
  // 【新增】这里加 FA 关键输入的详细 log
  console.log('FA relevant inputs:', {
    numChildren: Router.form.numChildren,
    numEducation: Router.form.numEducation,
    totalChildren: (Router.form.numChildren || 0) + (Router.form.numEducation || 0),
    numNewborns: Router.form.numNewborns || 0,
    numAdoptions: Router.form.numAdoptions || 0,
    numChildrenOver12: Router.form.numChildrenOver12 || 0,
    numEducationOver18: Router.form.numEducationOver18 || 0
  });
}
// Sozialhilfe 粗检测函数：判断是否值得询问用户计算 SH
function checkPossibleSozialhilfe(inputs, rules) {
  if (!rules || !rules.sozialhilfe) {
    console.log('No Sozialhilfe rules available');
    return false;
  }
  const shRules = rules.sozialhilfe;
  const isCouple = inputs.numAdults >= 2;
  const totalPersons = inputs.numAdults + inputs.numChildren + inputs.numEducation;
  // 资产粗查：超过 Freibetrag + 50% 缓冲 → 不值得问
  const assetFreibetrag = isCouple ? (shRules.asset_freibetrag?.couple || 8000) : (shRules.asset_freibetrag?.single || 4000);
  const assetLimit = assetFreibetrag + totalPersons * (shRules.asset_freibetrag?.per_child || 2000) * 1.5;
  if (inputs.taxableAssets > assetLimit) {
    console.log('Asset too high for SH');
    return false;
  }
  // 收入粗查：年收入超过估算需求 150% → 不值得问
  const grundbedarfSingle = shRules.grundbedarf_monthly?.single || 987;
  const grundbedarfCouple = shRules.grundbedarf_monthly?.couple || 1510;
  const baseGrundbedarf = isCouple ? grundbedarfCouple : grundbedarfSingle;
  const extraPerPerson = shRules.grundbedarf_monthly?.per_child || 380;
  const estimatedAnnualNeed = (baseGrundbedarf + (totalPersons - (isCouple ? 2 : 1)) * extraPerPerson) * 12 * 1.5;
  if (inputs.taxableIncomeAnnual > estimatedAnnualNeed) {
    console.log('Income too high for SH');
    return false;
  }
  // 如果资产和收入都低，就认为"可能有资格"
  console.log('Possible SH eligibility detected');
  return true;
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
        return null; // 等待用户补充 SH 字段
      } else {
        Router.resultData.sozialhilfe = { error: 'skipped_by_user_sh' };
      }
    } else {
      Router.resultData.sozialhilfe = { error: 'not_possible_sh' };
    }
  } else { // 第二次进来（用户点了“SH neu berechnen”）
    // 关键修改：如果有有效的 EL，则 SH 无效
    if (Router.resultData.el && !Router.resultData.el.error && (Router.resultData.el.annualBenefit || 0) > 0) {
      Router.resultData.sozialhilfe = {
        error: 'no_sh_when_el',
        message: 'Bei Bezug von Ergänzungsleistungen (EL) besteht in der Regel kein Anspruch auf Sozialhilfe, da EL den Existenzbedarf bereits abdeckt.'
      };
    } else {
      // 只有没有 EL 时才真正计算 SH
      try {
        const shModule = window.CALC.sozialhilfe;
        const cantonRulesForSH = stateRules || {};
        Router.resultData.sozialhilfe = shModule(Router.form, cantonRulesForSH);
      } catch (e) {
        console.error('SH calc error', e);
        Router.resultData.sozialhilfe = { error: 'calc_failed_sh' };
      }
    }
    // 计算完复位
    Router.pendingSH = false;
    Router.shExtraShown = false;
  }

  // --- 流程 D: FA 计算 ---
  try {
    const faInput = buildFAFormData(Router.form);

    if (faInput.totalChildren === 0) {
      Router.resultData.fa = {
        error: 'not_applicable',
        message: 'Keine Kinder oder Auszubildende angegeben'
      };
    } else if (!window.CALC.fa) {
      console.warn('FA module not available');
      Router.resultData.fa = {
        error: 'module_not_available',
        message: 'FA-Berechnungsmodul nicht verfügbar'
      };
    } else {
      console.log(`Starting FA calculation for ${state} with input:`, faInput);
      const faResult = await window.CALC.fa(faInput, state);
      console.log(`FA raw result for ${state}:`, faResult);
      Router.resultData.fa = normalizeFAResult(faResult, faInput, state);

      if (!window.FA_INFO || !window.FA_INFO[state]) {
        console.log(`FA info not yet loaded for ${state}, loading now...`);
        await loadFAInfo(state);
      }
    }
  } catch (e) {
    console.error('FA calc error', e);
    Router.resultData.fa = {
      error: 'calc_failed_fa',
      message: `FA-Berechnung fehlgeschlagen: ${e.message}`
    };
  }

  // 最终日志
  console.log(`[CALCULATION COMPLETE] All results for ${state}:`, {
    ipv: Router.resultData.ipv ? (Router.resultData.ipv.error ? `Error: ${Router.resultData.ipv.error}` : 'Success') : 'No result',
    el: Router.resultData.el ? (Router.resultData.el.error ? `Error: ${Router.resultData.el.error}` : 'Success') : 'No result',
    sh: Router.resultData.sozialhilfe ? (Router.resultData.sozialhilfe.error ? `Error: ${Router.resultData.sozialhilfe.error}` : 'Success') : 'No result',
    fa: Router.resultData.fa ? (Router.resultData.fa.error ? `Error: ${Router.resultData.fa.error}` : 'Success') : 'No result',
    FA_INFO: window.FA_INFO ? window.FA_INFO[state] : 'Not loaded'
  });

  // 类型安全检查函数
  function validateResultTypes(result) {
    const warnings = [];

    // 检查所有福利类型的错误消息是否使用了正确的键名
    if (result.sozialhilfe?.error && result.sozialhilfe.error.includes('_')) {
      const errorKey = result.sozialhilfe.error;
      if (errorKey.startsWith('err_') && !window.LANG?.[errorKey]) {
        warnings.push(`Missing translation for SH error: ${errorKey}`);
      }
    }

    if (warnings.length > 0) {
      console.warn('[Type Validation]', warnings);
    }

    return result;
  }

  // 在返回前调用类型验证函数
  Router.resultData = validateResultTypes(Router.resultData);

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
/* 15. 增强结果页面填充（集成 FA 结果显示 + 临时强制调试） */
/* 15. 增强结果页面填充（集成 FA 结果显示 + 修复完整内容） */
/* 15. 增强结果页面填充（修复 SH 显示逻辑） */
function fillResultPage() {
  const b = Router.resultData;
  if (!b) {
    console.error('No result data available');
    return;
  }

  // IPV（始终显示）
  fillBenefitAmount(b.ipv, 'ipv');
  showFormula(b.ipv, 'ipv-formula-box');
  document.getElementById('ipv-details').style.display = 'block';

  // 用户输入信息
  displayUserInputs();

  // EL
  const elContainer = document.getElementById('el-details');
  if (Router.form.checkEL === 'yes' && b.el && !b.el.error?.includes('skipped')) {
    elContainer.style.display = 'block';
    fillBenefitAmount(b.el, 'el');
    showFormula(b.el, 'el-formula-box');
  } else {
    elContainer.style.display = 'none';
  }

  // FA
  const faContainer = document.getElementById('fa-details');
  faContainer.style.display = 'block';
  fillBenefitAmount(b.fa, 'fa');
  fillFAOneTime(b.fa);
  showFormula(b.fa, 'fa-formula-box');

  // SH（特殊处理：有 EL 时显示提示而不是金额）
  const shContainer = document.getElementById('sh-details');
  if (b.sozialhilfe) {
    shContainer.style.display = 'block';

    if (b.sozialhilfe.error === 'no_sh_when_el') {
      // 有 EL → 显示提示
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
      // 其他错误情况
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
}

/* 小辅助函数：显示 FA 的一次性津贴 */
function fillFAOneTime(fa) {
  const div = document.getElementById('fa-onetime-allowances');
  if (!div) return;

  if (!fa || !fa.oneTime || (fa.oneTime.birth === 0 && fa.oneTime.adoption === 0)) {
    div.innerHTML = `<span style="color:#666">Keine Einmalzahlungen</span>`;
    return;
  }

  let html = '';
  if (fa.oneTime.birth > 0) {
    html += `<div><span class="onetime-badge">Einmalig</span> Geburtsszulage: ${fa.oneTime.birth.toFixed(2)} CHF</div>`;
  }
  if (fa.oneTime.adoption > 0) {
    html += `<div><span class="onetime-badge">Einmalig</span> Adoptionszulage: ${fa.oneTime.adoption.toFixed(2)} CHF</div>`;
  }
  div.innerHTML = html;
}
/* 16. 显示用户输入信息（集成 FA 输入显示） */
function displayUserInputs() {
  const container = document.getElementById('user-inputs');
  if (!container) return;
  const inputs = Router.form;
  let html = '<div class="user-inputs-container">';
  html += '<h3>Eingabeinformationen</h3>';
  html += '<table class="inputs-table">';

  // 基本人口信息
  if (Router.crowd) {
    const crowdText = t('crowd_' + Router.crowd) || Router.crowd;
    html += `<tr><td>Zielgruppe:</td><td>${crowdText}</td></tr>`;
  }
  if (Router.state) {
    const stateName = t(Router.state + '_name') || Router.state;
    html += `<tr><td>${t('canton')}:</td><td>${stateName} (${Router.state})</td></tr>`;
  }
  if (Router.plz) {
    html += `<tr><td>${t('postal_code')}:</td><td>${Router.plz}</td></tr>`;
  }

  // 财务信息
  html += `<tr><td>${t('annual_income')}:</td><td>${formatCurrency(inputs.income)} CHF</td></tr>`;
  html += `<tr><td>${t('assets')}:</td><td>${formatCurrency(inputs.assets)} CHF</td></tr>`;
  html += `<tr><td>${t('health_insurance_premium')}:</td><td>${formatCurrency(inputs.health_premium)} CHF</td></tr>`;
  html += `<tr><td>${t('monthly_rent')}:</td><td>${formatCurrency(inputs.monthlyRent)} CHF</td></tr>`;

  // 家庭成员信息
  html += `<tr><td>${t('num_adults')}:</td><td>${inputs.numAdults}</td></tr>`;
  html += `<tr><td>${t('num_children')}:</td><td>${inputs.numChildren}</td></tr>`;
  html += `<tr><td>${t('young_adults_education')}:</td><td>${inputs.numEducation}</td></tr>`;

  // 显示 FA 相关输入（如果有）
  if (inputs.numChildren > 0 || inputs.numEducation > 0) {
    if (inputs.numNewborns > 0) {
      html += `<tr><td>${t('label_num_newborns')}:</td><td>${inputs.numNewborns}</td></tr>`;
    }
    if (inputs.numAdoptions > 0) {
      html += `<tr><td>${t('label_num_adoptions')}:</td><td>${inputs.numAdoptions}</td></tr>`;
    }
    if (inputs.numChildrenOver12 > 0) {
      html += `<tr><td>${t('label_children_over12')}:</td><td>${inputs.numChildrenOver12}</td></tr>`;
    }
    if (inputs.numEducationOver18 > 0) {
      html += `<tr><td>${t('label_education_over18')}:</td><td>${inputs.numEducationOver18}</td></tr>`;
    }
  }

  // 只有用户选择计算 EL 时，才显示 EL 相关的输入信息
  if (inputs.checkEL === 'yes') {
    if (inputs.isReceivingPension !== undefined) {
      let pensionText = inputs.isReceivingPension;
      if (inputs.isReceivingPension === 'ahv') pensionText = 'AHV (Altersrente)';
      else if (inputs.isReceivingPension === 'iv') pensionText = 'IV (Invalidenrente)';
      else if (inputs.isReceivingPension === 'no') pensionText = 'Ich beziehe keine Rente';
      html += `<tr><td>${t('ahv_iv_claim')}</td><td>${pensionText}</td></tr>`;
    }
    if (inputs.nationality !== undefined && inputs.nationality !== '') {
      let natText = inputs.nationality;
      if (inputs.nationality === 'ch_eu') natText = 'Schweiz / EU / EFTA';
      else if (inputs.nationality === 'non_eu_eea') natText = 'Drittstaat';
      else if (inputs.nationality === 'refugee_f' || inputs.nationality === 'refugee_b') natText = 'Annerkannte Flüchtling';
      html += `<tr><td>${t('nationality')}</td><td>${natText}</td></tr>`;
    }
    if (inputs.residenceYears !== undefined && inputs.residenceYears > 0) {
      html += `<tr><td>${t('residence_years')}</td><td>${inputs.residenceYears}</td></tr>`;
    }
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
/* 19. 透明公式 - 完全隔离FA数据（关键修复）- 增强版支持法律来源URL */
async function showFormula(b, boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;

  // 如果是EL区域且用户选择不计算EL，直接清空内容
  if (boxId.includes('el') && Router.form.checkEL !== 'yes') {
    box.innerHTML = '';
    return;
  }

  // 如果是FA区域且无结果或有错误，显示错误提示
  if (boxId.includes('fa') && (!b || b.error)) {
    let errorHtml = '';
    if (b?.error) {
      const errorKey = b.error.includes('|') ? b.error.split('|')[0] : b.error;
      let errorMessage = t(errorKey);
      if (errorMessage === errorKey) {
        errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
      }
      errorHtml = `<div class="warning-box" style="display:block;"><strong>${t('error')}:</strong> ${errorMessage}</div>`;
    }
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

  // ========== 官方URL提取函数（保持不变）- 用于申请网址 ==========
  function extractOfficialUrl(rule) {
    if (!rule) return null;
    return rule.official_url || rule.application?.url || null;
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

  // ========== 关键修复：显示法律信息、法律来源URL和官方申请链接 ==========
  if (rule) {
    html += '<div class="legal-info-section" style="margin-top:20px; padding-top:15px; border-top:1px solid #dee2e6;">';
    html += `<h4>${t('legal_information_title') || 'Rechtliche Grundlagen & Informationen'}</h4>`;

    // 提取增强版法律信息（包含文本和来源URL）
    const legalInfo = extractLegalBasis(rule);

    // 显示法律依据文本
    if (legalInfo.texts && legalInfo.texts.length > 0) {
      html += `<p><strong>${t('legal_basis') || 'Rechtsgrundlage'}:</strong> ${legalInfo.texts.join('; ')}</p>`;
    }

    // ========== 新增：显示法律来源URL（权威法律原文）- 直接硬编码URL ==========
    if (legalInfo.sourceUrl) {
      html += `<p><strong>${t('legal_source') || 'Rechtliche Quelle (Bundesrecht)'}:</strong> `;
      html += `<a href="${legalInfo.sourceUrl}" target="_blank" style="color:#007bff; text-decoration:underline;" rel="noopener noreferrer">`;
      html += `${legalInfo.sourceUrl}</a>`;
      html += `</p>`;
    }

    // 提取并显示官方URL（作为可点击链接）- 用于申请流程
    const officialUrl = extractOfficialUrl(rule);
    if (officialUrl) {
      html += `<p><strong>${t('official_website') || 'Offizielle Webseite (Antragstellung)'}:</strong> `;
      html += `<a href="${officialUrl}" target="_blank" style="color:#007bff; text-decoration:underline;">${officialUrl}</a></p>`;
    }

    // 显示数据来源说明（如果有）
    if (rule.source_note || rule.source_note_key) {
      const sourceNote = rule.source_note_key ? t(rule.source_note_key) : rule.source_note;
      if (sourceNote) {
        html += `<p class="source-note" style="font-size:0.9em; color:#666; margin-top:10px;">`;
        html += `<em>${t('source') || 'Quelle'}: ${sourceNote}</em>`;
        html += `</p>`;
      }
    }

    // 5. 显示申请信息
    html += '<div class="application-card" style="margin-top:15px; background:#f8f9fa; padding:15px; border-radius:4px;">';
    html += `<h5>${t('how_to_apply') || 'Zuständige Stelle & Antrag'}</h5>`;

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

    // 通用字段（电话、邮箱）
    const contact = benefitType === 'fa' ? rule.contact : (rule.application?.contact || {});
    const phone = contact?.phone || 'Nicht angegeben';
    const email = contact?.email || 'Nicht angegeben';

    html += `<p><strong>Tel:</strong> ${phone}</p>`;
    html += `<p><strong>Email:</strong> ${email !== 'Nicht angegeben' ? `<a href="mailto:${email}">${email}</a>` : email}</p>`;

    // 所需文件 - 使用工具函数生成键名
    let docs = [];
    const langKey = getDocumentKey(state, benefitType);

    if (window.LANG && Array.isArray(window.LANG[langKey])) {
      docs = window.LANG[langKey];
      console.log(`[DOCS] Rendering ${docs.length} docs for ${benefitType} using key: ${langKey}`);
    } else if (rule.application?.required_docs_keys) {
      // 从规则中直接获取文档键名
      docs = rule.application.required_docs_keys;
    } else if (rule.application?.required_docs_list) {
      docs = rule.application.required_docs_list;
    }

    if (docs.length > 0) {
      html += `<h6 style="margin-top:15px;">${t('required_documents') || 'Erforderliche Unterlagen'}:</h6>`;
      html += '<ul style="margin-left:20px; list-style-type:disc;">';
      docs.forEach(item => {
        const itemText = (typeof item === 'string' && item.startsWith('✓')) ? item : (t(item) || item);
        html += `<li>${itemText}</li>`;
      });
      html += '</ul>';
    }

    // 特殊备注
    const noteKey = benefitType === 'fa' ? rule.notes_key : rule.application?.contact_reminder_key;
    const noteText = noteKey ? t(noteKey) : '';
    if (noteText && noteText !== noteKey) {
      html += `<div class="note-hint" style="margin-top:15px; background:#fff3cd; padding:10px; border:1px solid #ffeeba; border-radius:4px;">`;
      html += `<strong>${t('important_note') || 'Wichtiger Hinweis'}:</strong> ${noteText}`;
      html += '</div>';
    }

    html += '</div>'; // 关闭 application-card
    html += '</div>'; // 关闭 legal-info-section
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
/* 110. PDF公文外衣 - 修复版 */
function buildPdfHtml(resultData) {
  const form = Router.form || {};
  const state = Router.state || '';
  const stateName = t(state + '_name') || state;
  const now = new Date().toLocaleString('de-CH');

  // 获取福利结果（安全访问）
  const ipvResult = resultData.ipv || {};
  const elResult = resultData.el || {};
  const faResult = resultData.fa || {};
  const shResult = resultData.sozialhilfe || {};

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.4;
            color: #000;
            margin: 0;
            padding: 20px;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 15px;
        }
        .header h1 {
            font-size: 18pt;
            color: #0066cc;
            margin: 0;
        }
        .subtitle {
            font-size: 12pt;
            color: #666;
            margin-top: 5px;
        }
        .section {
            margin: 25px 0;
            page-break-inside: avoid;
        }
        .section-title {
            font-size: 14pt;
            font-weight: bold;
            background: #f0f0f0;
            padding: 8px 12px;
            border-left: 4px solid #0066cc;
            margin-bottom: 15px;
        }
        .info-table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }
        .info-table th, .info-table td {
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
            vertical-align: top;
        }
        .info-table th {
            background: #f8f9fa;
            font-weight: bold;
        }
        .benefit-card {
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            page-break-inside: avoid;
        }
        .benefit-card.success {
            border-left: 4px solid #28a745;
            background: #f8fff8;
        }
        .benefit-card.warning {
            border-left: 4px solid #ffc107;
            background: #fffdf6;
        }
        .benefit-card.error {
            border-left: 4px solid #dc3545;
            background: #fff8f8;
        }
        .benefit-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .benefit-name {
            font-weight: bold;
            font-size: 13pt;
            color: #333;
        }
        .benefit-amount {
            font-size: 14pt;
            font-weight: bold;
            color: #28a745;
        }
        .amount-zero {
            color: #999;
        }
        .note {
            font-size: 10pt;
            color: #666;
            font-style: italic;
            margin-top: 10px;
            padding: 8px;
            background: #f9f9f9;
            border-radius: 3px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            font-size: 9pt;
            color: #777;
            text-align: center;
        }
        @media print {
            .page-break {
                page-break-before: always;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Sozialleistungsberechnung</h1>
        <div class="subtitle">
            Berechnungsergebnisse für ${stateName || 'Schweiz'} (${state || 'CH'}) - Erstellt am ${now}
        </div>
    </div>

    <!-- 用户信息部分 -->
    <div class="section">
        <div class="section-title">Eingabedaten</div>
        <table class="info-table">
            <tr>
                <th>Feld</th>
                <th>Wert</th>
                <th>Feld</th>
                <th>Wert</th>
            </tr>
            <tr>
                <td>Personengruppe</td>
                <td>${t('crowd_' + Router.crowd) || Router.crowd || 'Nicht angegeben'}</td>
                <td>Kanton</td>
                <td>${stateName || 'Nicht angegeben'}</td>
            </tr>
            <tr>
                <td>Postleitzahl</td>
                <td>${Router.plz || '-'}</td>
                <td>Anzahl Erwachsene</td>
                <td>${form.numAdults || 1}</td>
            </tr>
            <tr>
                <td>Jahreseinkommen</td>
                <td>${formatCurrency(form.income || 0)} CHF</td>
                <td>Anzahl Kinder</td>
                <td>${form.numChildren || 0}</td>
            </tr>
            <tr>
                <td>Vermögen</td>
                <td>${formatCurrency(form.assets || 0)} CHF</td>
                <td>Junge Erwachsene in Ausbildung</td>
                <td>${form.numEducation || 0}</td>
            </tr>
            <tr>
                <td>Krankenkassenprämie</td>
                <td>${formatCurrency(form.health_premium || 0)} CHF</td>
                <td>Monatsmiete</td>
                <td>${formatCurrency(form.monthlyRent || 0)} CHF</td>
            </tr>
        </table>
    </div>

    <!-- 计算结果部分 -->
    <div class="section">
        <div class="section-title">Berechnungsergebnisse</div>
        
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

        <!-- EL -->
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

        <!-- FA -->
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
            Die endgültige Prüfung erfolgt durch die zuständigen Stellen. 
            Bitte reichen Sie die erforderlichen Unterlagen persönlich bei der zuständigen Behörde ein.
        </div>
    </div>

    <div class="footer">
        Erstellt mit Sozialleistungs-Rechner ${new Date().getFullYear()} | 
        Diese Berechnung dient nur als Orientierungshilfe.
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

/* 20. PDF 生成 — 多语言字体兼容性完整解决方案 (最终修复版) */
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
      const labelWidth = pdf.getTextWidth(labelText);
      
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
          const authKey = rule.authority?.authority_key || getApplicationKey(state, type, 'authority');
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

    // ========== 完全按照修改建议重写的 drawBenefitCard 函数 ==========
    const drawBenefitCard = async (type, title, result) => {
      if (!result) return;

      const hasError = result.error;
      const annual = result.annualBenefit || result.annual || 0;
      const monthly = annual / 12;
      const hasAmount = annual > 0;

      // 处理标题换行
      const fullTitle = processTextForPDF(title);
      // 关键修改：给错误消息留出足够空间，或者当错误时限制标题宽度
      const titleAvailableWidth = hasError ? contentWidth - 80 : contentWidth - 35;
      const wrappedTitleLines = pdf.splitTextToSize(fullTitle, titleAvailableWidth);
      const titleLineCount = wrappedTitleLines.length;

      // 计算错误文本
      let topErrorLines = [];
      let detailErrorLines = [];

      if (hasError) {
        const errorText = t('err_general_no_entitlement') || 'Kein Anspruch';
        const safeErrorText = processTextForPDF(errorText, true);
        // 错误消息现在放在下方，宽度更宽
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

      // 关键修改：如果有错误，增加错误消息区域的高度（现在放在标题下方）
      if (hasError) {
        // 顶部错误标题的高度
        cardHeight += (topErrorLines.length * LINE_HEIGHT) + 5; // 5是间距
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

      // ========== 关键修复：完全重新设计布局 ==========
      
      // 1. 绘制标题（左侧，完整宽度或受限宽度）
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
        // ========== 关键修改：错误消息现在放在标题下方 ==========
        
        // 添加一些间距
        currentTitleY += 3;
        
        // 绘制错误标题（红色，加粗）
        pdf.setFontSize(10);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(220, 53, 69); // 红色
        
        topErrorLines.forEach((line, index) => {
          pdf.text(line, margin + 8, currentTitleY + (index * LINE_HEIGHT));
        });
        
        // 更新Y位置到错误标题之后
        const errorTitleHeight = topErrorLines.length * LINE_HEIGHT;
        yPos = currentTitleY + errorTitleHeight + 5;
        
        // 绘制详细错误消息（灰色，普通字体）
        pdf.setFontSize(9);
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(150, 150, 150); // 灰色
        
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
      [t('num_children') || 'Anzahl Kinder', String(form.numChildren || 0)],
      [t('young_adults_education') || 'Junge Erwachsene (19-25)', String(form.numEducation || 0)],
      [t('annual_income') || 'Jahreseinkommen', `${formatCurrency(form.income || 0)} CHF`],
      [t('assets') || 'Vermögen', `${formatCurrency(form.assets || 0)} CHF`],
      [t('health_insurance_premium') || 'KK-Prämie (Jahr)', `${formatCurrency(form.health_premium || 0)} CHF`],
      [t('monthly_rent') || 'Monatsmiete', `${formatCurrency(form.monthlyRent || 0)} CHF`]
    ];

    pdf.setFontSize(10);
    inputFields.forEach(([label, value]) => {
      drawKeyValue(label, value, 0);
    });

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
      <title>${t('pdf_title') || 'Sozialleistungsberechnung'} - ${stateName}</title>
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
        <h1>${t('pdf_title') || 'Sozialleistungsberechnung'}</h1>
        <h3>${stateName} - ${new Date().toLocaleDateString('de-CH')}</h3>
        <p><em>${t('offline_version') || 'Offline-Version - Speichern Sie diese Seite als PDF'}</em></p>
      </div>
      
      <div class="section">
        <h2>${t('input_data') || 'Eingabedaten'}</h2>
        <table>
          <tr><th>${t('field') || 'Feld'}</th><th>${t('value') || 'Wert'}</th></tr>
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
    }).map(([key, value]) => `<tr><td>${t(key.toLowerCase()) || key}</td><td>${value}</td></tr>`).join('')}
        </table>
      </div>
      
      <div class="section">
        <h2>${t('berechnungsergebnisse_heading') || 'Berechnungsergebnisse'}</h2>
        ${resultData.ipv ? `<div class="benefit-card">
          <h3>${t('ipv_title') || 'IPV'}: ${formatCurrency(resultData.ipv.annualBenefit || 0)} CHF/Jahr</h3>
          <p>${t('monthly_short') || 'Monatlich'}: ${formatCurrency((resultData.ipv.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.el && !resultData.el.error ? `<div class="benefit-card">
          <h3>${t('el_title') || 'EL'}: ${formatCurrency(resultData.el.annualBenefit || 0)} CHF/Jahr</h3>
          <p>${t('monthly_short') || 'Monatlich'}: ${formatCurrency((resultData.el.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.fa ? `<div class="benefit-card">
          <h3>${t('fa_title') || 'FA'}: ${formatCurrency(resultData.fa.annualBenefit || 0)} CHF/Jahr</h3>
          <p>${t('monthly_short') || 'Monatlich'}: ${formatCurrency((resultData.fa.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
        
        ${resultData.sozialhilfe ? `<div class="benefit-card">
          <h3>${t('sozialhilfe_title') || 'Sozialhilfe'}: ${formatCurrency(resultData.sozialhilfe.annualBenefit || 0)} CHF/Jahr</h3>
          <p>${t('monthly_short') || 'Monatlich'}: ${formatCurrency((resultData.sozialhilfe.annualBenefit || 0) / 12)} CHF</p>
        </div>` : ''}
      </div>
      
      <div class="warning-box">
        <h3>${t('disclaimer_important') || 'Wichtiger Hinweis'}</h3>
        <p>${t('disclaimer_content') || 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen.'}</p>
        <p><strong>${t('save_hint') || 'Speichern'}:</strong> ${t('save_instructions') || 'Drücken Sie Strg+P (Windows) oder Cmd+P (Mac) und wählen Sie "Als PDF speichern".'}</p>
      </div>
    </body>
    </html>
  `;

    // 在新窗口显示
    const newWindow = window.open('', '_blank');
    newWindow.document.write(htmlContent);
    newWindow.document.close();
  }

  /* 23. 模板函数（集成 FA 字段和结果显示） */
  const tmplCrowd = () => `
  <h2>${t('select_crowd')}</h2>
  <select id="sel-crowd">
    <option value="">-- ${t('select_crowd')} --</option>
    <option value="family">${t('crowd_family')}</option>
    <option value="single">${t('crowd_single')}</option>
    <option value="student">${t('crowd_student')}</option>
    <option value="retired">${t('crowd_retired')}</option>
    <option value="low_income">${t('crowd_low_income')}</option>
    <option value="pregnant">${t('crowd_pregnant')}</option>
    <option value="unemployed">${t('crowd_unemployed')}</option>
    <option value="disabled">${t('crowd_disabled')}</option>
    <option value="refugee">${t('crowd_refugee')}</option>
  </select>
  <div class="button-group">
    <button id="btn-state" class="btn-primary" style="margin-top: 20px;">${t('continue')}</button>
  </div>
`;
  const tmplState = () => `
  <div class="module-header">
    <h2>${t('select_state_plz')}</h2>
  </div>
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
  const tmplForm = () => `
  <h2>${t('input_data')}</h2>
  
  <!-- 家庭模式专属提示框 - 修复空行问题 -->
  <div class="mode-notice" style="margin: 15px 0; padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
    <strong>${t('family_mode_active') || 'Familien-Modus aktiv'}</strong>
    ${t('family_hint') || 'Bitte geben Sie Ihre Familieninformationen ein – wir schätzen damit Ihren möglichen Anspruch auf IPV, EL, Sozialhilfe und Familienzulagen.'}
  </div>
  
  <form id="dynamic-form">
    <label>${t('annual_income')} (CHF)</label>
    <span class="hint">${t('hint_annual_income') || 'Steuerbares Jahreseinkommen des gesamten Haushalts (aus der letzten definitiven Steuerveranlagung)'}</span>
    <input name="income" type="number" step="0.01" min="0" placeholder="z.B. 50000" required>
   
    <label>${t('assets')} (CHF) <small>${t('hint_assets_small') || '(steuerbares Reinvermögen, <strong>ohne</strong> selbstgenutztes Wohneigentum)'}</small></label>
    <span class="hint">${t('hint_assets') || 'Steuerbares Reinvermögen / Nettovermögen des gesamten Haushalts (Vermögen abzüglich Schulden, aus der letzten definitiven Steuerveranlagung)'}</span>
    <input name="assets" type="number" step="0.01" min="0" placeholder="z.B. 100000" required>
   
    <label>${t('health_insurance_premium')}</label>
    <span class="hint">${t('hint_health_premium') || 'Tatsächliche Jahresprämie der obligatorischen Grundversicherung für alle Haushaltsmitglieder zusammen'}</span>
    <input name="health_premium" type="number" step="0.01" min="0" placeholder="z.B. 3000" required>
   
    <label>${t('monthly_rent')} (CHF)</label>
    <span class="hint">${t('hint_monthly_rent') || 'Monatliche Miete oder Hypothekarzinsen'}</span>
    <input name="monthlyRent" type="number" step="0.01" min="0" placeholder="z.B. 1500" required>
   
    <label>${t('num_adults')}</label>
    <span class="hint">${t('hint_num_adults') || 'Anzahl Erwachsene (ab 26 Jahren oder nicht in Ausbildung; Ehepaare/Partner zählen als 2)'}</span>
    <input name="numAdults" type="number" min="1" max="10" value="1" required>
   
    <label>${t('num_children')}</label>
    <span class="hint">${t('hint_num_children') || 'Anzahl Kinder (bis 18 Jahre)'}</span>
    <input name="numChildren" type="number" min="0" value="0" required>
   
    <label>${t('young_adults_education')}</label>
    <span class="hint">${t('hint_num_education') || 'Anzahl junge Erwachsene (19–25 Jahre) in Ausbildung'}</span>
    <input name="numEducation" type="number" min="0" value="0" required>
   
    <!-- FA 额外字段区域（动态显示，新增） -->
    <div id="fa-extra-fields" style="display:none;">
      <h4>${t('fa_extra_title')}</h4>
     
      <div id="fa-field-newborns" style="display:none;">
        <label>${t('label_num_newborns')}</label>
        <span class="hint">${t('hint_num_newborns') || 'Nur für Geburten im aktuellen Jahr'}</span>
        <input name="numNewborns" type="number" min="0" value="0">
      </div>
     
      <div id="fa-field-adoptions" style="display:none;">
        <label>${t('label_num_adoptions')}</label>
        <span class="hint">${t('hint_num_adoptions') || 'Nur für Adoptionen im aktuellen Jahr'}</span>
        <input name="numAdoptions" type="number" min="0" value="0">
      </div>
     
      <div id="fa-field-children-over12" style="display:none;">
        <label>${t('label_children_over12')}</label>
        <input name="numChildrenOver12" type="number" min="0" value="0">
      </div>
     
      <div id="fa-field-education-over18" style="display:none;">
        <label>${t('label_education_over18')}</label>
        <input name="numEducationOver18" type="number" min="0" value="0">
      </div>
    </div>
   
    <!-- EL 准入字段 -->
    <label>${t('el_precheck_title')}</label>
    <span class="hint">${t('ask_el_confirm')}</span>
    <div style="margin:5px 0 15px;">
      <label style="display:inline;font-weight:normal;"><input type="radio" name="checkEL" value="yes"> ${t('confirm_yes')}</label>
      <label style="display:inline;font-weight:normal;margin-left:15px;"><input type="radio" name="checkEL" value="no"> ${t('confirm_no')}</label>
    </div>
   
    <div id="el-extra-fields" style="display:none">
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
    
      <!-- 法律警告区域 -->
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
    
      <!-- 其他EL字段（国籍、居住年限） -->
      <div id="el-other-fields">
        <label>${t('label_nationality')}</label>
        <select name="nationality" required>
          <option value="">${t('select_option_placeholder')}</option>
          <option value="ch_eu">${t('nat_ch_eu')}</option>
          <option value="non_eu_eea">${t('nat_non_eu')}</option>
          <option value="refugee_f">${t('nat_refugee')} ${t('refugee_f_status')}</option>
          <option value="refugee_b">${t('nat_refugee')} (B-Status)</option>
        </select>
        <label>${t('label_residence_years')}</label>
        <input name="residenceYears" type="number" min="0" max="100" placeholder="z.B. 12" required>
      </div>
    </div>
   
    <!-- SH 额外字段 -->
    <div id="sh-extra-fields" style="display:none; margin-top:20px; padding:15px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px;">
      <h4>${t('sh_extra_fields_title')}</h4>
     
      <!-- 关键：employmentStatus 必须与各州SH算法中的值匹配 -->
      <label>${t('label_employment_status')}</label>
      <span class="hint" style="color: #666; font-size: 0.9em;">${t('hint_employment_status') || 'Für alle 26 Kantone gültig: employed, unemployed, unable, other'}</span>
      <select name="employmentStatus">
        <option value="" disabled selected>-- ${t('please_select') || 'Bitte wählen'} --</option>
        <option value="employed">${t('employment_employed')}</option>
        <option value="unemployed">${t('employment_unemployed')}</option>
        <option value="unable">${t('employment_unable')}</option>
        <option value="other">${t('employment_other')}</option>
      </select>
     
      <!-- 注意：AG算法检查 hasMedicalNeeds === 'yes'，其他州可能也使用 -->
      <label>${t('label_has_medical_needs')}</label>
      <span class="hint" style="color: #666; font-size: 0.9em;">${t('hint_has_medical_needs') || 'Wichtig für AG und andere Kantone: beeinflusst Gesundheitszuschlag'}</span>
      <div>
        <label style="display:inline-block; margin-right:15px;"><input type="radio" name="hasMedicalNeeds" value="yes"> ${t('yes')}</label>
        <label style="display:inline-block;"><input type="radio" name="hasMedicalNeeds" value="no"> ${t('no')}</label>
      </div>
     
      <!-- 其他SH字段 -->
      <label>${t('label_other_income_annual') || "Andere Jahreseinkommen"}</label>
      <span class="hint">${t('hint_other_income_annual') || 'z.B. ALV, IV-Zusatz, etc. (CHF/Jahr)'}</span>
      <input name="other_income_annual" type="number" step="0.01" min="0" placeholder="z.B. 0" value="0">
     
      <label>${t('label_monthly_other_expenses') || "Monatliche sonstige Ausgaben"}</label>
      <span class="hint">${t('hint_monthly_other_expenses') || 'z.B. Krankheit, Pflege, Transport (CHF/Monat, nur bei Nachweis)'}</span>
      <input name="monthly_other_expenses" type="number" step="0.01" min="0" placeholder="z.B. 0" value="0">
     
      <!-- IPV和EL金额会自动填充（关键功能保留） -->
      <label style="color: #28a745;">✓ ${t('label_ipv_received_annual') || "Bereits erhaltene IPV (jährlich)"}</label>
      <span class="hint" style="color: #28a745; font-weight: bold;">${t('hint_ipv_auto_fill') || 'Wird automatisch aus Ihrer IPV-Berechnung übernommen'}</span>
      <input name="ipvReceivedAnnual" type="number" step="0.01" min="0" placeholder="0.00" value="0" readonly style="background-color: #f0f8ff; border-color: #28a745;">
     
      <label style="color: #28a745;">✓ ${t('label_el_received_annual') || "Bereits erhaltene EL (jährlich)"}</label>
      <span class="hint" style="color: #28a745; font-weight: bold;">${t('hint_el_auto_fill') || 'Wird automatisch aus Ihrer EL-Berechnung übernommen (falls berechnet)'}</span>
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
    <button id="btn-recalc" class="btn-secondary">${t('neu_berechnen') || 'Neu berechnen'}</button>
    <button id="btn-pdf" class="btn-primary">${t('download_pdf')}</button>
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
    // 清空或重置EL字段，例如
    document.querySelectorAll('#el-extra-fields input, #el-extra-fields select').forEach(el => {
      if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
  }

  // ========== 新增：全屏模式管理 ==========
  const FullscreenManager = {
    // 保存原始页面元素
    originalElements: {
      header: null,
      crowdSelector: null,
      footer: null
    },

    // 进入全屏模式
    enter() {
      console.log('Entering fullscreen mode');

      // 保存原始元素
      this.originalElements.header = document.querySelector('.site-header');
      this.originalElements.crowdSelector = document.getElementById('crowd-selector');
      this.originalElements.footer = document.querySelector('.site-footer');

      // 隐藏原始元素
      if (this.originalElements.header) {
        this.originalElements.header.style.display = 'none';
      }
      if (this.originalElements.crowdSelector) {
        this.originalElements.crowdSelector.style.display = 'none';
      }
      if (this.originalElements.footer) {
        this.originalElements.footer.style.display = 'none';
      }

      // 为app容器添加全屏类
      const app = document.getElementById('app');
      if (app) {
        app.classList.add('fullscreen-mode');
      }

      // 为body添加全屏标记（用于CSS）
      document.body.classList.add('module-fullscreen');

      console.log('Fullscreen mode activated');
    },

    // 退出全屏模式
    exit() {
      console.log('Exiting fullscreen mode');

      // 恢复原始元素
      if (this.originalElements.header) {
        this.originalElements.header.style.display = '';
      }
      if (this.originalElements.crowdSelector) {
        this.originalElements.crowdSelector.style.display = '';
      }
      if (this.originalElements.footer) {
        this.originalElements.footer.style.display = '';
      }

      // 移除全屏类
      const app = document.getElementById('app');
      if (app) {
        app.classList.remove('fullscreen-mode');
      }

      document.body.classList.remove('module-fullscreen');

      console.log('Fullscreen mode deactivated');
    },

    // 重置所有状态
    reset() {
      console.log('Resetting module state');

      // 重置Router状态（保留语言设置）
      const currentLang = Router.lang;

      // 深度重置Router
      Router.crowd = 'family';
      Router.state = null;
      Router.plz = null;
      Router.form = {};
      Router.rule = null;
      Router.calc = null;
      Router.history = [];
      Router.currentStep = 'state';  // 直接从state步骤开始
      Router.resultData = null;
      Router.pendingSH = false;
      Router.shExtraShown = false;
      Router.lang = currentLang;  // 恢复语言设置

      // 清理全局变量（保留语言包）
      const langBackup = window.LANG;

      // 清理模块缓存
      if (window.RULE) {
        delete window.RULE;
      }
      if (window.CALC) {
        delete window.CALC;
      }
      if (window.FA_INFO) {
        delete window.FA_INFO;
      }
      if (window.POSTAL_DB) {
        delete window.POSTAL_DB;
      }

      // 清空moduleCache
      for (const key in moduleCache) {
        delete moduleCache[key];
      }

      // 恢复语言包
      window.LANG = langBackup;

      console.log('Module state reset complete');
    },

    // 加载CSS文件
    async loadCSS() {
      const cssUrl = 'css/main_family.css';

      // 检查是否已加载
      const existingLink = document.querySelector(`link[href="${cssUrl}"]`);
      if (existingLink) {
        console.log('CSS already loaded, removing old version');
        existingLink.remove();
      }

      return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.onload = () => {
          console.log('Family module CSS loaded successfully');
          resolve();
        };
        link.onerror = () => {
          console.error('Failed to load family module CSS');
          reject(new Error(`Failed to load CSS: ${cssUrl}`));
        };
        document.head.appendChild(link);
      });
    }
  };

  // ========== 新增：模块初始化函数（供loader.js调用）==========
  window.initCrowdModule = async function () {
    console.log('Initializing family crowd module');

    try {
      // 1. 加载专用CSS
      await FullscreenManager.loadCSS();

      // 2. 重置所有状态
      FullscreenManager.reset();

      // 3. 进入全屏模式
      FullscreenManager.enter();

      // 4. 设置人群类型为家庭
      Router.crowd = 'family';

      // 5. 应用语言设置（如果存在）
      if (window.currentLang) {
        Router.lang = window.currentLang;
      } else {
        // 尝试从localStorage恢复语言
        const savedLang = localStorage.getItem('preferred_lang');
        if (savedLang) {
          Router.lang = savedLang;
        }
      }

      // 6. 确保语言包已加载
      if (!window.LANG || Object.keys(window.LANG).length === 0) {
        console.log('Language not loaded, loading now...');
        await loadLanguage(Router.lang);
      }

      // 7. 清空app容器（确保干净）
      const app = document.getElementById('app');
      if (app) {
        app.innerHTML = '';
      }

      // 8. 添加CSS类到app容器（用于特定样式）
      app.classList.add('family-module-active');

      // 9. 开始渲染（直接从州选择页面开始，跳过人群选择）
      render('state');

      console.log('Family module initialized, starting from state step');

    } catch (error) {
      console.error('Failed to initialize family module:', error);

      // 显示错误信息
      const app = document.getElementById('app');
      if (app) {
        app.innerHTML = `
                <div style="color: red; text-align: center; padding: 50px;">
                    <h3>Fehler beim Laden des Familienmoduls</h3>
                    <p>${error.message}</p>
                    <button onclick="location.reload()">Seite neu laden</button>
                </div>
            `;
      }

      // 如果加载失败，退出全屏模式
      FullscreenManager.exit();
    }
  };

  // ========== 修改原有的window.onload（使其兼容两种加载方式）==========
  const originalOnload = window.onload;

  window.onload = async function () {
    // 检查是否通过loader加载（URL中有crowd参数或存在window.currentCrowd）
    const isLoadedByLoader = window.location.search.includes('crowd=') ||
      (window.currentCrowd !== undefined && window.currentCrowd !== null);

    if (!isLoadedByLoader) {
      // 直接访问此文件时，执行原来的初始化逻辑
      console.log('Direct access to family module, running original onload');
      if (originalOnload) {
        await originalOnload();
      }
    } else {
      // 通过loader加载，等待loader调用initCrowdModule
      console.log('Family module loaded by loader, waiting for init...');
      // 什么都不做，等待loader调用initCrowdModule
    }
  };

  // ========== 新增：导出模块接口（供其他模块使用）==========
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      init: window.initCrowdModule,
      Router: Router,
      render: render
    };
  }