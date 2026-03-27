/* main.js – 完整无省略修正版（集成 IPV / EL / SH / FA 四大算法）*/
const CDN = './'; // 使用相对路径
const STATES = ['AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR',
  'JU', 'LU', 'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG',
  'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'];

// ========== 福利类型规范化映射表（从家庭版复制）==========
const BENEFIT_TYPE_MAP = {
  'sh': 'sozialhilfe',
  'ipv': 'ipv',
  'el': 'el',
  'fa': 'fa',
  'alv': 'alv',
  'iv': 'iv'
};

/**
 * 获取规范化后的福利类型名称（从家庭版复制）
 * @param {string} type - 可能为简写或全称
 * @returns {string} 标准化后的全称
 */
function getNormalizedBenefitType(type) {
  if (!type) return '';
  return BENEFIT_TYPE_MAP[type] || type;
}

/**
 * 生成文档列表的翻译键名（从家庭版复制）
 * @param {string} state - 州代码
 * @param {string} type - 福利类型（简写或全称）
 * @returns {string} 完整的翻译键名
 */
function getDocumentKey(state, type) {
  const normalized = getNormalizedBenefitType(type);
  return `${state}_${normalized}_required_documents_list`;
}

/**
 * 生成申请机构信息的翻译键名（从家庭版复制）
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

  return `${state}_${normalized}_${field}`;
}

/* ========== 废弃模板保护（防止误调用）========== */
const tmplLowIncome = () => { throw new Error('tmplLowIncome 已废弃，请使用 tmplUnemployed'); };
// const tmplForm      = () => { throw new Error('tmplForm 已废弃，请使用 tmplUnemployed'); };  // 已删除，因为我们现在用 tmplUnemployed
const tmplRetired = () => { throw new Error('tmplRetired 已废弃，请使用 tmplUnemployed'); };

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
/* 4. 启动 - 修改版：只在直接访问时渲染，被loader加载时不执行 */
window.onload = async () => {
  // 检查是否通过loader加载（URL中有crowd参数）
  const isLoadedByLoader = window.location.search.includes('crowd=');
  
  // 如果是直接访问此文件（没有crowd参数），才执行初始化
  if (!isLoadedByLoader) {
    console.log('Direct access to disabled module, initializing...');
    
    // ✅ 加载专用CSS（修复：直接访问时没有样式的问题）
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/main_disabled.css?v=' + Date.now();
    document.head.appendChild(link);
    
    const app = document.getElementById('app');
    if (!app) return;
    
    await loadLanguage();
    // addStyles();  <- 这一行已经删除，现在用上面的方式加载CSS
    
    Router.crowd = 'disabled';  // ✅ 修正人群类型
    render('crowd');
  } else {
    // 通过loader加载，什么都不做，等待loader调用initCrowdModule
    console.log('Disabled module loaded by loader, waiting for init...');
  }
};
/* 6. 语言包加载器（硬编码德语）- 未来可改为加载JSON文件 */
async function loadLanguage(lang = 'de') {
  try {
    const response = await fetch(resolvePath(`lang/${lang}.json`));
    if (!response.ok) {
      throw new Error(`Language file not found: ${lang}.json (status ${response.status})`);
    }
    window.LANG = await response.json();
    console.log('LANG loaded keys:', Object.keys(window.LANG));  // 检查所有翻译键
    console.log('Specific SH key:', window.LANG['AG_sozialhilfe_required_documents_list']);  // 检查特定键
    console.log(`Sprache ${lang} erfolgreich geladen (${Object.keys(window.LANG).length} Schlüssel)`);
  } catch (error) {
    console.error('Sprachdatei konnte nicht geladen werden, fallback auf Minimal-Deutsch', error);
    // 极简备用，只保核心界面不崩溃（不到50行！）
    window.LANG = {
      lang: 'de',
      lang_de: 'Deutsch',
      iv_legal_title: 'IV-Rente - Rechtsgrundlage & Information',
      iv_legal_basis: 'Bundesgesetz über die Invalidenversicherung (IVG)',
      iv_legal_date: 'vom 19. Juni 1959 (SR 831.20)',
      iv_legal_source: 'Rechtliche Quelle (Bundesrecht)',
      iv_legal_note: 'Dieses Gesetz regelt die Leistungen der Invalidenversicherung, einschliesslich der IV-Renten und Hilflosenentschädigungen.',
      iv_he_title: "IV-Rente & Hilflosenentschädigung",
      iv_he_monthly_label: "Bekannte monatliche IV-Rente",
      he_monthly_label: "Hilflosenentschädigung (Stufe {level})",
      he_total_monthly: "Gesamt monatlich (Rente + HE)",
      he_total_annual: "Jährlich",
      he_note: "Die Hilflosenentschädigung wird automatisch mit der IV-Rente ausbezahlt und zählt als Einkommen bei der EL-Berechnung.",
      el_formula_he_included: "Verwendete jährliche Rente (inkl. HE): {total} CHF",
      el_formula_he_detail: "(darunter Hilflosenentschädigung: {he} CHF/Jahr)",
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
      input_data_disabled: "Daten für Behinderte eingeben",
      disabled_mode_active: "Behinderungs-Modus aktiv",
      disabled_hint: "Bitte geben Sie Ihre IV- und Behinderungsdetails ein. Dies beeinflusst IV, EL und SH.",
      label_invalidity_degree: "Invaliditätsgrad (%)",
      hint_invalidity_degree: "z.B. 60% (basierend auf IV-Bescheid, beeinflusst Rente-Schätzung)",
      label_iv_monthly_pension: "Monatliche IV-Rente (CHF)",
      hint_iv_monthly_pension: "Aktueller IV-Rentenbetrag (falls bekannt, sonst wird geschätzt)",
      label_hilflosen_level: "Hilflosenentschädigung Stufe",
      hilflosen_leicht: "Leicht (252 CHF/Monat)",
      hilflosen_mittel: "Mittel (630 CHF/Monat)",
      hilflosen_schwer: "Schwer (1008 CHF/Monat)",
      hint_hilflosen_level: "Stufe der Hilflosenentschädigung (falls zutreffend, für zusätzliche Bedürfnisse)",
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
      hint_num_children: 'Anzahl Kinder unter 18 Jahren (wichtig für Kinderzulagen)',
      hint_num_education: 'Anzahl in Ausbildung (19–25 Jahre, wichtig für Ausbildungszulagen)',
      adoption_allowance: 'Adoptionszulage',
      onetime_payment: 'Einmalig'
    };
  }
  document.documentElement.lang = window.LANG.lang || 'de';
}
/* 7. 渲染器 - 失业人员版优化：进入 form 时重置 SH 相关残留数据 */
function render(step, isBack = false) {
  const app = document.getElementById('app');
  if (!app) return;
  
  // ★★★ 新增這段：如果回到人群選擇頁，退出全屏模式 ★★★
  if (step === 'crowd') {
      app.classList.remove('full-screen');
      
      // 恢復上方元素顯示
      const header = document.querySelector('.site-header');
      if (header) header.style.display = 'block';
      
      const crowdSelector = document.getElementById('crowd-selector');
      if (crowdSelector) crowdSelector.style.display = 'grid';  // 恢復原佈局
      
      const languageSelector = document.querySelector('.language-selector');
      if (languageSelector) languageSelector.style.display = 'flex';
      
      // 恢復 body 樣式
      document.body.style.padding = '';  // 恢復原本的 padding（或設為你想要的值）
      document.body.style.margin = '';
  }

  // 新增：如果渲染回人群選擇頁，恢復上方元素（保留原有逻辑，与新增逻辑互补）
  if (step === 'crowd') {
      const header = document.querySelector('.site-header');
      if (header) header.style.display = 'block';
      const crowdSelector = document.getElementById('crowd-selector');
      if (crowdSelector) crowdSelector.style.display = 'grid';  // 恢復 grid 佈局
      const languageSelector = document.querySelector('.language-selector');
      if (languageSelector) languageSelector.style.display = 'flex';
      
      // 恢復 body/main 樣式
      document.body.style.padding = '20px';
      document.querySelector('main').style.padding = '2.5rem 0 4rem';
      document.getElementById('app').style.minHeight = 'auto';
  }

  // 新增的日志打印代码
  console.log('render called, step:', step, 'crowd:', Router.crowd);

  // 如果不是回退操作，记录历史
  if (!isBack && step !== Router.currentStep) {
    Router.history.push(Router.currentStep);
  }
  Router.currentStep = step;

  // 所有人群统一使用 tmplUnemployed（失业人员版是唯一支持的版本）
  let formTemplate = tmplUnemployed;

  // 失业人员版特殊处理（非form步骤时的基础处理，form步骤的处理移到下方）
  if (Router.crowd === 'unemployed' && step !== 'form') {
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
    // 默认选中 "Nein" （已在模板中设为 checked）
  }

  // 非form步骤的页面渲染
  if (step !== 'form') {
    app.innerHTML = {
      crowd: tmplCrowd,
      state: tmplState,
      form: tmplUnemployed, // 统一使用失业人员版模板
      result: tmplResult
    }[step]();
  }

  // form步骤的专属渲染逻辑
  if (step === 'form') {
    console.log('Using form template for crowd:', Router.crowd);
    let formTemplate = tmplUnemployed;  // 所有人群现在都用这个智能模板

    // 支持的人群列表（以后扩展时在这里加）
    const supportedCrowds = ['unemployed', 'disabled'];
    if (!supportedCrowds.includes(Router.crowd)) {
      console.warn(`Crowd '${Router.crowd}' not fully supported yet, using tmplUnemployed as fallback`);
    }
    // 不需要再 if-else 了，因为 tmplUnemployed 已经根据 Router.crowd 动态显示内容

    app.innerHTML = {
      crowd: tmplCrowd,
      state: tmplState,
      form: formTemplate,
      result: tmplResult
    }[step]();

    // 人群特定初始化（支持 unemployed 和 disabled）
    if (Router.crowd === 'unemployed') {
      console.log('Unemployed form initialized');
      // SH 默认展开 + pending 状态（失业版默认需要详细 SH）
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
    } else if (Router.crowd === 'disabled') {
      console.log('Disabled form initialized');
      // 对于残疾人模式：
      // SH 默认展开（像失业版一样，因为也需要详细医疗/额外需求）
      const shExtra = document.getElementById('sh-extra-fields');
      if (shExtra) {
        shExtra.style.display = 'block';
      }
      Router.shExtraShown = true;
      Router.pendingSH = true;

      // EL 默认显示 + 选中 Ja（因为 IV 领取者通常有 EL 资格）
      const elExtra = document.getElementById('el-extra-fields');
      if (elExtra) {
        elExtra.style.display = 'block';
      }
      const elYesRadio = document.querySelector('input[name="checkEL"][value="yes"]');
      if (elYesRadio) {
        elYesRadio.checked = true;
        // 手动触发 change 事件，让 EL 里面的字段自动启用
        elYesRadio.dispatchEvent(new Event('change'));
      }

      // 自动选中 IV 作为养老金类型
      const ivRadio = document.querySelector('input[name="isReceivingPension"][value="iv"]');
      if (ivRadio) {
        ivRadio.checked = true;
        // 也触发 change 事件，让下面的字段显示
        ivRadio.dispatchEvent(new Event('change'));
      }
      // 确保 pensionType 也选中 IV
      const pensionIV = document.querySelector('input[name="pensionType"][value="IV"]');
      if (pensionIV) {
        pensionIV.checked = true;
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
        // 前置检查1：EL=yes 但没选养老金（保持不变）
        const checkEL = document.querySelector('input[name="checkEL"]:checked');
        const isReceivingPension = document.querySelector('input[name="isReceivingPension"]:checked');
        if (checkEL?.value === 'yes' && isReceivingPension?.value === 'no') {
          alert(t('err_el_no_pension_warning') + '\n\nBitte wählen Sie "Nein, nur IPV" oder korrigieren Sie Ihre Eingabe.');
          return;
        }

        // 前置检查2：SH 已显示时验证必填项（只在 unemployed 模式强制检查 hasMedicalNeeds）
        if (Router.pendingSH || document.getElementById('sh-extra-fields')?.style.display !== 'none') {
          const employmentSelect = document.querySelector('select[name="employmentStatus"]');
          let errorMessage = '';

          if (!employmentSelect?.value) {
            errorMessage = 'Bitte wählen Sie einen Beschäftigungsstatus.';
          }

          // 只在 unemployed 模式下检查 hasMedicalNeeds
          if (Router.crowd === 'unemployed') {
            const medicalRadio = document.querySelector('input[name="hasMedicalNeeds"]:checked');
            if (!medicalRadio) {
              errorMessage = 'Bitte geben Sie an, ob medizinische Bedürfnisse bestehen.';
            }
          }

          if (errorMessage) {
            alert(errorMessage);
            if (!employmentSelect?.value) {
              employmentSelect?.focus();
            } else if (Router.crowd === 'unemployed') {
              document.querySelector('input[name="hasMedicalNeeds"]')?.parentElement?.scrollIntoView();
            }
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
      let fieldName = invalidField.name || invalidField.labels?.[0]?.textContent || 'ein Feld';
      alert(t('please_fill_field').replace('{field}', fieldName) || `Bitte füllen Sie "${fieldName}" korrekt aus.`);
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
  Router.form.numChildren = Number(Router.form.numChildren) || 0;          // ← 新增：收集孩子数量
  Router.form.numEducation = Number(Router.form.numEducation) || 0;        // ← 新增：收集在读学生数量
  Router.form.numNewborns = Number(Router.form.numNewborns) || 0;
  Router.form.numAdoptions = Number(Router.form.numAdoptions) || 0;
  Router.form.numChildrenOver12 = Number(Router.form.numChildrenOver12) || 0;
  Router.form.numEducationOver18 = Number(Router.form.numEducationOver18) || 0;

  // 失业人员专属字段（收集 + 默认值）
  if (Router.crowd === 'unemployed') {
    Router.form.previousMonthlySalary = Math.max(Number(Router.form.previousMonthlySalary) || 0, 1000); // 最低1000，防误填
    Router.form.unemploymentDurationMonths = Number(Router.form.unemploymentDurationMonths) || 6; // 默认估6个月
    Router.form.hasALV = Router.form.hasALV || 'yes'; // 默认有ALV
    Router.form.hasDisability = Router.form.hasDisability || 'no'; // 默认无残疾
  }
  // 残疾人员专属字段（收集 + 默认值）
  if (Router.crowd === 'disabled') {
    // Invaliditätsgrad：0-100 的整数，默认 0
    Router.form.invalidityDegree = Math.max(0, Math.min(100, Number(Router.form.invalidityDegree) || 0));

    // Monatliche IV-Rente：金额，默认 0
    Router.form.ivMonthlyPension = Math.max(0, Number(Router.form.ivMonthlyPension) || 0);

    // Hilflosenstufe：字符串，默认空
    Router.form.hilflosenLevel = Router.form.hilflosenLevel || '';

    console.log('Disabled fields collected:', {
      invalidityDegree: Router.form.invalidityDegree,
      ivMonthlyPension: Router.form.ivMonthlyPension,
      hilflosenLevel: Router.form.hilflosenLevel
    });
  }

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
/* Sozialhilfe 粗检测 - 残疾人版 */
function checkPossibleSozialhilfe(inputs, rules) {
  if (!rules || !rules.sozialhilfe) {
    console.log('No Sozialhilfe rules available');
    return false;
  }
  const shRules = rules.sozialhilfe;

  const isCouple = inputs.numAdults >= 2;
  const isStudent = inputs.crowd === 'student';
  const isDisabled = inputs.crowd === 'disabled';
  const isFulltime = inputs.isFulltimeStudent === 'yes';

  const totalPersons = inputs.numAdults + inputs.numChildren + inputs.numEducation;

  // 资产粗查：不同人群使用不同缓冲系数
  const assetFreibetrag = isCouple
    ? (shRules.asset_freibetrag?.couple || 8000)
    : (shRules.asset_freibetrag?.single || 4000);

  let assetBuffer = 1.5;           // 默认缓冲
  if (isStudent) assetBuffer = 1.8;          // 学生更宽松
  if (isDisabled) assetBuffer = 2.0;         // 残疾人更宽松（可调到 2.2 或更高）

  const assetLimit = assetFreibetrag + totalPersons * (shRules.asset_freibetrag?.per_child || 2000) * assetBuffer;

  if (inputs.taxableAssets > assetLimit) {
    console.log(`Asset too high for SH (buffer: ${assetBuffer}x, limit: ${assetLimit})`);
    return false;
  }

  // 收入粗查：不同人群有不同额外需求
  const grundbedarfSingle = shRules.grundbedarf_monthly?.single || 987;
  const grundbedarfCouple = shRules.grundbedarf_monthly?.couple || 1510;
  let baseGrundbedarf = isCouple ? grundbedarfCouple : grundbedarfSingle;

  // 额外需求估算
  let extraMonthly = 0;

  // 学生额外需求
  if (isStudent) {
    extraMonthly += isFulltime ? 300 : 150;
  }

  // 残疾人额外需求（医疗/护理/辅助等，保守估计每月额外500 CHF）
  if (isDisabled) {
    extraMonthly += 500;  // 可根据实际情况调整为 400~800
    // 如果有 Hilflosenentschädigung，还可以再加（可选）
    if (inputs.hilflosenLevel === 'mittel') extraMonthly += 300;
    if (inputs.hilflosenLevel === 'schwer') extraMonthly += 600;
  }

  const extraPerPerson = shRules.grundbedarf_monthly?.per_child || 380;
  const estimatedMonthlyNeed = baseGrundbedarf + extraMonthly + (totalPersons - (isCouple ? 2 : 1)) * extraPerPerson;
  const estimatedAnnualNeed = estimatedMonthlyNeed * 12 * 1.5;  // 1.5倍年化缓冲

  if (inputs.taxableIncomeAnnual > estimatedAnnualNeed) {
    console.log(`Income too high for SH (estimated need: ${estimatedAnnualNeed}, extra: ${extraMonthly}/month)`);
    return false;
  }

  console.log(`Possible SH eligibility detected (${isDisabled ? 'disabled' : isStudent ? 'student' : 'general'} mode)`);
  return true;
}
/* 13. 计算（关键修复：IV-Rente桥接必须在EL计算之前，且多字段覆盖；新增 HE 桥接） */
/* 13. 计算（关键修复：IV-Rente桥接必须在EL计算之前，且多字段覆盖；新增 HE 桥接） */
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
  // --- 流程 A.5: 简单 ALV 估算（失业人员专属）---
  if (Router.crowd === 'unemployed') {
    const prevSalary = Router.form.previousMonthlySalary || 0;
    const months = Math.min(Router.form.unemploymentDurationMonths || 6, 12);
    const hasALV = Router.form.hasALV === 'yes';
    const hasDisability = Router.form.hasDisability === 'yes';
    let rate = hasDisability ? 0.80 : 0.70;
    let monthlyALV = prevSalary * rate;
    let annualALV = monthlyALV * months;
    Router.resultData.alv = {
      eligible: hasALV && prevSalary > 0,
      monthlyBenefit: hasALV ? monthlyALV : 0,
      annualBenefit: hasALV ? annualALV : 0,
      explanation: {
        steps: [
          { label: 'Vorheriges Monatsgehalt', value: prevSalary },
          { label: 'Erwartete Dauer (Monate)', value: months },
          { label: 'ALV-Ersatzquote', value: `${(rate * 100).toFixed(0)}%` },
          { label: 'Monatliche ALV', value: monthlyALV.toFixed(2) },
          { label: 'Gesamte geschätzte ALV', value: annualALV.toFixed(2) }
        ]
      }
    };
    Router.form.other_income_annual = (Router.form.other_income_annual || 0) + annualALV;
  }
  // --- ★★★ 超级桥接：必须在EL计算之前，多字段全覆盖 ★★★ ---
  if (Router.crowd === 'disabled') {
    const ivMonthly = Number(Router.form.ivMonthlyPension) || 0;
    // IV-Rente 桥接（原有逻辑，保持不变）
    if (ivMonthly > 0) {
      Router.form.monthlyPensionAmount = ivMonthly;
      Router.form.monthlyPension = ivMonthly;
      Router.form.pensionMonthly = ivMonthly;
      Router.form.ivMonthlyPensionConfirmed = ivMonthly;
      Router.form.regularAnnualPension = ivMonthly * 12;
      Router.form.annualPension = ivMonthly * 12;
      Router.form.pensionAnnual = ivMonthly * 12;
      Router.form.ivAnnualPension = ivMonthly * 12;
      Router.form.isReceivingPension = 'iv';
      Router.form.pensionType = 'IV';
      console.log('[🚀 BRIDGE SUPER FORCE] IV-Rente 已全面注入:', {
        monthly: Router.form.monthlyPensionAmount,
        annual: Router.form.regularAnnualPension,
        annual2: Router.form.annualPension,
        rawIV: ivMonthly
      });
    } else {
      Router.form.monthlyPensionAmount = 0;
      Router.form.regularAnnualPension = 0;
      Router.form.annualPension = 0;
    }
    // ── 新增：Hilflosenentschädigung (HE) 桥接 ──
    if (Router.form.hilflosenLevel) {
      const heLevels = {
        'leicht': 252,
        'mittel': 630,
        'schwer': 1008
      };
      const heMonthly = heLevels[Router.form.hilflosenLevel.toLowerCase()] || 0;
      if (heMonthly > 0) {
        // 注入到 EL 可识别的字段（基于代码中已有桥接逻辑，使用类似命名模式）
        Router.form.hilflosenEntschaedigungMonthly = heMonthly;
        Router.form.additionalNeedMonthly = (Router.form.additionalNeedMonthly || 0) + heMonthly;
        // 如果 EL 算法读取养老相关的额外字段，也注入
        Router.form.monthlyPensionAmount = (Router.form.monthlyPensionAmount || 0) + heMonthly;
        Router.form.monthlyPension = (Router.form.monthlyPension || 0) + heMonthly;
        Router.form.regularAnnualPension = (Router.form.regularAnnualPension || 0) + heMonthly * 12;
        // 同时增强 SH 的额外需求（基于代码中已有 zusatzbedarf_monatlich）
        Router.form.zusatzbedarf_monatlich = (Router.form.zusatzbedarf_monatlich || 0) + heMonthly;
        Router.form.monthly_other_expenses = (Router.form.monthly_other_expenses || 0) + heMonthly;
        console.log('[HE BRIDGE] Hilflosenentschädigung 已注入:', {
          level: Router.form.hilflosenLevel,
          monthly: heMonthly,
          addedToELAdditional: Router.form.additionalNeedMonthly,
          addedToSHzusatzbedarf: Router.form.zusatzbedarf_monatlich,
          addedToPensionMonthly: Router.form.monthlyPensionAmount
        });
      }
    }
  }
  // --- 同步 IPV 到 SH 输入 ---
  Router.form.ipvReceivedAnnual = (Router.resultData.ipv && !Router.resultData.ipv.error)
    ? (Router.resultData.ipv.annualBenefit || 0) : 0;
  // --- ★★★ 增强EL预检：强制绕过资产/国籍检查（如果有IV-Rente）★★★ ---
  let skipELPreCheck = false;
  if (Router.crowd === 'disabled' && Number(Router.form.ivMonthlyPension) > 0) {
    skipELPreCheck = true;
    console.log('[EL] 残疾人模式 + 有IV-Rente，跳过资产/国籍预检');
  }
  // --- 流程 B: EL 计算（现在能看到桥接后的值，包括 HE）---
  if (Router.form.checkEL === 'no') {
    Router.resultData.el = { error: 'skipped_by_user' };
  } else if (Router.form.isReceivingPension === 'no' && !skipELPreCheck) {
    Router.resultData.el = { error: 'err_el_no_pension_warning' };
  } else {
    let elCheck = { eligible: true };
    if (!skipELPreCheck) {
      elCheck = validateELPreConditions(Router.form);
    }
    if (elCheck.eligible) {
      try {
        const elModule = window.CALC.el;
        const cantonRulesForEL = window.RULE[state] || window.RULE || {};
        const elResult = elModule(Router.form, cantonRulesForEL);
        Router.resultData.el = elResult;
        // 调试日志：验证EL算法是否收到了正确的养老金 + HE 值
        console.log('[EL] 计算结果:', {
          annualBenefit: elResult.annualBenefit,
          monthlyBenefit: elResult.monthlyBenefit,
          pensionUsed: Router.form.regularAnnualPension,
          heUsed: Router.form.hilflosenEntschaedigungMonthly || 0,
          additionalNeedUsed: Router.form.additionalNeedMonthly || 0
        });
      } catch (e) {
        console.error("EL Calc Fail", e);
        Router.resultData.el = { error: 'calc_failed' };
      }
    } else {
      Router.resultData.el = { error: elCheck.reasonKey };
    }
  }
  // --- 同步 EL 到 SH 输入 ---
  Router.form.elReceivedAnnual = (Router.resultData.el && !Router.resultData.el.error)
    ? (Router.resultData.el.annualBenefit || 0) : 0;
  // 更新页面上的输入框
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
  if (!Router.pendingSH) {
    if (checkPossibleSozialhilfe(Router.form, stateRules)) {
      const userWantsSH = confirm(t('sh_precheck_hint'));
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
        const hintBox = document.getElementById('sh-recalc-hint');
        if (hintBox) {
          hintBox.style.display = 'block';
          hintBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const btnCalc = document.getElementById('btn-calc');
        if (btnCalc) {
          btnCalc.textContent = t('recalc_sh') || 'Sozialhilfe neu berechnen';
          btnCalc.style.backgroundColor = '#ffc107';
          btnCalc.style.color = '#212529';
        }
        return null;
      } else {
        Router.resultData.sozialhilfe = { error: 'skipped_by_user_sh' };
      }
    } else {
      Router.resultData.sozialhilfe = { error: 'not_possible_sh' };
    }
  } else {
    if (Router.resultData.el && !Router.resultData.el.error && (Router.resultData.el.annualBenefit || 0) > 0) {
      Router.resultData.sozialhilfe = {
        error: 'no_sh_when_el_message',
        message: 'Bei Bezug von Ergänzungsleistungen (EL) besteht in der Regel kein Anspruch auf Sozialhilfe, da EL den Existenzbedarf bereits abdeckt.'
      };
    } else {
      const shInput = { ...Router.form };
      if (shInput.crowd === 'student') {
        const isFulltime = shInput.isFulltimeStudent === 'yes';
        const studentExtraMonthly = isFulltime ? 300 : 150;
        const studyCosts = shInput.studyCostsMonthly || 0;
        const totalStudentExtra = studentExtraMonthly + studyCosts;
        shInput.monthly_other_expenses = (shInput.monthly_other_expenses || 0) + totalStudentExtra;
      }
      if (shInput.crowd === 'retired') {
        if (shInput.hasMedicalNeeds === 'yes') {
          shInput.monthly_other_expenses = (shInput.monthly_other_expenses || 0) + 200;
        }
      }
      // 残疾人模式下，确保 HE 已加到 zusatzbedarf_monatlich（已在上面桥接过，这里再确认）
      if (shInput.crowd === 'disabled' && shInput.hilflosenLevel) {
        const heLevels = { 'leicht': 252, 'mittel': 630, 'schwer': 1008 };
        const heMonthly = heLevels[shInput.hilflosenLevel.toLowerCase()] || 0;
        if (heMonthly > 0) {
          shInput.zusatzbedarf_monatlich = (shInput.zusatzbedarf_monatlich || 0) + heMonthly;
          console.log('[SH] Hilflosenentschädigung 已加到 zusatzbedarf_monatlich:', heMonthly);
        }
      }
      try {
        const shModule = window.CALC.sozialhilfe;
        const cantonRulesForSH = stateRules || {};
        Router.resultData.sozialhilfe = shModule(shInput, cantonRulesForSH);
      } catch (e) {
        console.error('SH calc error', e);
        Router.resultData.sozialhilfe = { error: 'calc_failed_sh' };
      }
    }
    Router.pendingSH = false;
    Router.shExtraShown = false;
    const hintBox = document.getElementById('sh-recalc-hint');
    if (hintBox) hintBox.style.display = 'none';
    const btnCalc = document.getElementById('btn-calc');
    if (btnCalc) {
      btnCalc.textContent = t('calculate') || 'Berechnen';
      btnCalc.style.backgroundColor = '';
      btnCalc.style.color = '';
    }
  }
  // --- 流程 D: Familienzulagen (FA) ---
  try {
    Router.form.numChildren = Number(Router.form.numChildren) || 0;
    Router.form.numEducation = Number(Router.form.numEducation) || 0;
    if (Router.form.numChildren > 0 || Router.form.numEducation > 0) {
      const faInput = buildFAFormData(Router.form);
      console.log('FA 输入数据:', faInput);
      if (!window.CALC.fa) {
        console.warn('FA 模块未加载，尝试重新加载...');
        await loadStateRule(Router.state);
      }
      if (window.CALC.fa) {
        const faRules = window.FA_INFO?.[state] || {};
        const faResultRaw = await window.CALC.fa(faInput, faRules);
        console.log('FA 原始计算结果:', faResultRaw);
        Router.resultData.fa = normalizeFAResult(faResultRaw, faInput, state);
        console.log('FA 计算成功:', Router.resultData.fa);
      } else {
        console.error('FA 计算模块仍然不可用');
        Router.resultData.fa = { error: 'fa_module_missing' };
      }
    } else {
      Router.resultData.fa = {
        annualBenefit: 0,
        monthlyBenefit: 0,
        oneTime: { birth: 0, adoption: 0 },
        explanation: { steps: [], note_key: 'no_children_fa' }
      };
    }
  } catch (e) {
    console.error('FA 计算异常:', e);
    Router.resultData.fa = {
      error: 'fa_calc_error',
      annualBenefit: 0,
      monthlyBenefit: 0
    };
  }
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

/* 15. 增强结果页面填充（显示用户输入 + 福利结果 + 新增 IV+HE 卡片） */
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
  // 3. IV-Rente + HE 联合卡片（使用新语言键，格式与 FA 一致）
  let ivHeContainer = document.getElementById('iv-he-details');
  if (Router.crowd === 'disabled' && (Router.form.ivMonthlyPension > 0 || Router.form.hilflosenLevel)) {
    const ivMonthly = Number(Router.form.ivMonthlyPension) || 0;
    const heLevels = { 'leicht': 252, 'mittel': 630, 'schwer': 1008 };
    const heMonthly = heLevels[Router.form.hilflosenLevel?.toLowerCase()] || 0;
    const totalMonthly = ivMonthly + heMonthly;
    const totalAnnual = totalMonthly * 12;

    // ★★★ 关键修复：正确处理 he_monthly_label 中的 {level} ★★★
    let heLabel = t('he_monthly_label') || 'Hilflosenentschädigung';
    let levelText = '';
    if (Router.form.hilflosenLevel) {
      const levelKey = 'hilflosen_' + Router.form.hilflosenLevel.toLowerCase();
      levelText = t(levelKey) || Router.form.hilflosenLevel;
      // 如果翻译里有 {level}，替换它；否则直接拼接 "Stufe xxx"
      if (heLabel.includes('{level}')) {
        heLabel = heLabel.replace('{level}', levelText);
      } else {
        heLabel = heLabel + ' (Stufe ' + levelText + ')';
      }
    }

    if (!ivHeContainer) {
      ivHeContainer = document.createElement('details');
      ivHeContainer.id = 'iv-he-details';
      ivHeContainer.className = 'benefit-details';
      ivHeContainer.innerHTML = `
        <summary class="benefit-summary">
          <span>${t('iv_title') || 'Invalidenrente (IV-Rente)'}</span>
          <span class="benefit-total">
            ${t('annual_short') || 'Jährlich'}: <b id="ivhe-benefit-annual">${totalAnnual.toFixed(2)}</b> CHF | 
            ${t('monthly_short') || 'Monatlich'}: <b id="ivhe-benefit-monthly">${totalMonthly.toFixed(2)}</b> CHF
            <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-details-content">
          <div class="formula-container">
            <div class="step" style="margin-bottom: 8px;">
              <span class="label">${t('iv_he_monthly_label') || 'Bekannte monatliche IV-Rente'}:</span>
              <span class="val">${ivMonthly.toFixed(2)} CHF</span>
            </div>
            ${heMonthly > 0 ? `
            <div class="step" style="margin-bottom: 8px;">
              <span class="label">${heLabel}:</span>
              <span class="val">${heMonthly.toFixed(2)} CHF</span>
            </div>` : ''}
            <div class="step" style="font-weight:bold; color:#0066cc; margin: 12px 0 8px 0; padding-top: 8px; border-top: 1px solid #dee2e6;">
              <span class="label">${t('he_total_monthly') || 'Gesamt monatlich'}:</span>
              <span class="val">${totalMonthly.toFixed(2)} CHF</span>
            </div>
            <div class="step" style="font-weight:bold; color:#0066cc; margin-bottom: 8px;">
              <span class="label">${t('he_total_annual') || 'Jährlich'}:</span>
              <span class="val">${totalAnnual.toFixed(2)} CHF</span>
            </div>
            <div class="note" style="font-size: 0.9em; color: #666; margin: 10px 0;">${t('he_note') || 'Die Hilflosenentschädigung wird automatisch mit der IV-Rente ausbezahlt und zählt als Einkommen bei der EL-Berechnung.'}</div>

            <!-- 法律与申请信息 -->
            <div class="legal-info-section" style="margin-top: 12px; border-top: 1px solid #dee2e6; padding-top: 8px;">
              <h4 style="color:#0066cc; margin: 0 0 4px 0; font-size: 1.1em;">${t('iv_legal_title') || 'IV-Rente - Rechtsgrundlage & Information'}</h4>
              <div style="margin:2px 0;"><strong>${t('legal_basis') || 'Gesetz'}:</strong> ${t('iv_legal_basis') || 'Bundesgesetz über die Invalidenversicherung (IVG)'}</div>
              <div style="margin:2px 0;"><strong>${t('legal_source') || 'Rechtliche Quelle'}:</strong> <a href="${t('iv_legal_link') || 'https://www.fedlex.admin.ch/eli/cc/1959/827_857_845/de'}" target="_blank" style="color:#007bff; text-decoration:underline; word-break:break-all;">${t('iv_legal_link') || 'https://www.fedlex.admin.ch/eli/cc/1959/827_857_845/de'}</a></div>
              <div style="margin:4px 0 0 0; background:#e7f3ff; padding:4px 8px; border-radius:3px; font-size:0.95em;"><strong>${t('hint') || 'Hinweis'}:</strong> ${t('iv_note') || 'Die IV-Rente ist bundeseinheitlich. Die Auszahlung erfolgt monatlich. Für Hilflosenentschädigung (HE) gelten separate Stufen.'}</div>
            </div>

            <div class="application-card" style="margin-top: 8px; background:#f8f9fa; padding:8px 10px; border-radius:4px;">
              <h5 style="margin: 0 0 4px 0; font-size: 1em; color:#0066cc;">${t('how_to_apply') || 'So beantragen Sie die Leistung'}</h5>
              <div style="margin:2px 0;"><strong>${t('authority') || 'Zuständige Stelle'}:</strong> ${t('iv_application_authority') || 'Lokale IV-Stelle (Invalidenversicherung)'}</div>
              <div style="margin:2px 0;">${t('iv_application_how') || 'Beantragen Sie die IV-Rente bei Ihrer kantonalen IV-Stelle. Füllen Sie das Antragsformular aus und reichen Sie medizinische Unterlagen ein. Eine Vorabprüfung ist online möglich.'}</div>
              <div style="margin:2px 0;">${t('iv_application_where') || 'Finden Sie Ihre IV-Stelle über die offizielle Website oder kontaktieren Sie das Bundesamt für Sozialversicherungen (BSV).'}</div>
              <div style="margin:2px 0;"><strong>${t('official_website') || 'Offizielle Webseite'}:</strong> <a href="https://www.ahv-iv.ch/de" target="_blank" style="color:#007bff; word-break:break-all;">https://www.ahv-iv.ch/de</a></div>
            </div>
          </div>
        </div>
      `;

      // 插入位置（放在 EL 之前或 IPV 之后）
      const elDetails = document.getElementById('el-details');
      if (elDetails && elDetails.parentNode) {
        elDetails.before(ivHeContainer);
      } else {
        const ipvDetails = document.getElementById('ipv-details');
        if (ipvDetails && ipvDetails.parentNode) {
          ipvDetails.after(ivHeContainer);
        } else {
          document.querySelector('.benefit-details:last-of-type')?.parentNode?.appendChild(ivHeContainer);
        }
      }
    } else {
      // 更新金额（如果已存在）
      document.getElementById('ivhe-benefit-annual').textContent = totalAnnual.toFixed(2);
      document.getElementById('ivhe-benefit-monthly').textContent = totalMonthly.toFixed(2);
    }

    ivHeContainer.style.display = 'block';
  } else if (ivHeContainer) {
    ivHeContainer.style.display = 'none';
  }

  // 4. EL（仅当用户选择计算且无错误时显示）
  const elContainer = document.getElementById('el-details');
  if (Router.form.checkEL === 'yes' && b.el && !b.el.error?.includes('skipped')) {
    elContainer.style.display = 'block';
    fillBenefitAmount(b.el, 'el');
    showFormula(b.el, 'el-formula-box');
  } else {
    elContainer.style.display = 'none';
  }

  // 5. FA（始终显示，即使为0也显示0.00）
  const faContainer = document.getElementById('fa-details');
  faContainer.style.display = 'block';
  fillBenefitAmount(b.fa || { annualBenefit: 0 }, 'fa');
  fillFAOneTime(b.fa);
  // 新增的 showFormula 调用
  showFormula(b.fa, 'fa-formula-box');

  // ALV（失业专属）- 修复插入位置：固定在FA后面，SH前面
  if (Router.crowd === 'unemployed' && Router.resultData.alv) {
    const alv = Router.resultData.alv;
    let alvContainer = document.getElementById('alv-details');
    if (!alvContainer) {
      alvContainer = document.createElement('details');
      alvContainer.id = 'alv-details';
      alvContainer.className = 'benefit-details';
      alvContainer.innerHTML = `
        <summary class="benefit-summary">
          <span>Arbeitslosenversicherung (ALV)</span>
          <span class="benefit-total">
            Jährlich: <b>${formatCurrency(alv.annualBenefit || 0)}</b> CHF | 
            Monatlich: <b>${formatCurrency((alv.annualBenefit || 0) / 12)}</b> CHF
            <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-details-content">
          <div id="alv-formula-box" class="formula-container"></div>
        </div>
      `;
      const hint = alvContainer.querySelector('.toggle-hint');
      if (hint) hint.textContent = `(${t('details_expand') || 'Details anzeigen'})`;
      const faDetails = document.getElementById('fa-details');
      const shDetails = document.getElementById('sh-details');
      if (faDetails && faDetails.parentNode) {
        faDetails.after(alvContainer);
      } else if (shDetails && shDetails.parentNode) {
        shDetails.before(alvContainer);
      } else {
        document.querySelector('.benefit-details:last-of-type')?.parentNode?.appendChild(alvContainer);
      }
    } else {
      const summarySpan = alvContainer.querySelector('.benefit-total');
      if (summarySpan) {
        summarySpan.innerHTML = `
          Jährlich: <b>${formatCurrency(alv.annualBenefit || 0)}</b> CHF | 
          Monatlich: <b>${formatCurrency((alv.annualBenefit || 0) / 12)}</b> CHF
          <span class="toggle-hint">(${t('details_expand') || 'Details anzeigen'})</span>
        `;
      }
      const hint = alvContainer.querySelector('.toggle-hint');
      if (hint) hint.textContent = `(${t('details_expand') || 'Details anzeigen'})`;
    }
    alvContainer.style.display = 'block';
    showFormula(alv, 'alv-formula-box');
  } else {
    const alvContainer = document.getElementById('alv-details');
    if (alvContainer) alvContainer.style.display = 'none';
  }

  // 6. SH（特殊处理：有EL时显示提示，否则显示金额）
  const shContainer = document.getElementById('sh-details');
  if (b.sozialhilfe) {
    shContainer.style.display = 'block';
    if (b.sozialhilfe.error === 'no_sh_when_el_message') {
      const formulaBox = document.getElementById('sh-formula-box');
      if (formulaBox) {
        formulaBox.innerHTML = `
          <div class="warning-box" style="display:block; background:#d4edda; color:#155724; border-color:#c3e6cb; padding:15px; margin-bottom:15px;">
            <strong>${t('no_sh_when_el_title')}</strong><br>
            ${t('no_sh_when_el_message')}
          </div>
        `;
      }
      document.getElementById('sh-benefit-annual').textContent = '0.00';
      document.getElementById('sh-benefit-monthly').textContent = '0.00';
    } else if (!b.sozialhilfe.error?.includes('skipped') && !b.sozialhilfe.error?.includes('not_possible')) {
      fillBenefitAmount(b.sozialhilfe, 'sh');
      showFormula(b.sozialhilfe, 'sh-formula-box');
    } else {
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

  // 7. 隐藏 SH 二次计算提示
  const hintBox = document.getElementById('sh-recalc-hint');
  if (hintBox) hintBox.style.display = 'none';
}

/* 16. 显示用户输入信息 - 低收入版优化：完整显示所有关键字段 + 新增 HE 显示 */
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
  // 儿童和教育相关字段
  if (inputs.numChildren !== undefined && inputs.numChildren > 0) {
    html += `<tr><td>${t('num_children') || 'Anzahl Kinder'}:</td><td>${inputs.numChildren}</td></tr>`;
  }
  if (inputs.numEducation !== undefined && inputs.numEducation > 0) {
    html += `<tr><td>${t('young_adults_education') || 'Junge Erwachsene in Ausbildung (19-25)'}:</td><td>${inputs.numEducation}</td></tr>`;
  }
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
  // === 失业人员专属输入字段（新增） ===
  if (Router.crowd === 'unemployed') {
    if (inputs.previousMonthlySalary !== undefined) {
      html += `<tr><td>${t('label_previous_monthly_salary') || 'Monatslohn vor Arbeitslosigkeit'}:</td><td>${formatCurrency(inputs.previousMonthlySalary)} CHF</td></tr>`;
    }
    if (inputs.unemploymentDurationMonths !== undefined) {
      html += `<tr><td>${t('label_unemployment_duration_months') || 'Erwartete Arbeitslosigkeitsdauer'}:</td><td>${inputs.unemploymentDurationMonths} Monate</td></tr>`;
    }
    if (inputs.hasALV !== undefined) {
      html += `<tr><td>${t('label_has_alv') || 'Bezieht ALV'}:</td><td>${inputs.hasALV === 'yes' ? t('yes') : t('no')}</td></tr>`;
    }
    if (inputs.hasDisability !== undefined) {
      html += `<tr><td>${t('label_has_disability') || 'Anerkannte Behinderung'}:</td><td>${inputs.hasDisability === 'yes' ? t('yes') : t('no')}</td></tr>`;
    }
  }
  // === 残疾人专属输入字段 - 新增 HE 显示 ===
  if (Router.crowd === 'disabled') {
    if (inputs.invalidityDegree !== undefined) {
      html += `<tr><td>${t('label_invalidity_degree') || 'Invaliditätsgrad'}:</td><td>${inputs.invalidityDegree}%</td></tr>`;
    }
    if (inputs.ivMonthlyPension !== undefined) {
      html += `<tr><td>${t('label_iv_monthly_pension') || 'Monatliche IV-Rente'}:</td><td>${formatCurrency(inputs.ivMonthlyPension)} CHF</td></tr>`;
    }
    // 新增：Hilflosenentschädigung Stufe 显示
    if (inputs.hilflosenLevel) {
      let heText = inputs.hilflosenLevel;
      if (inputs.hilflosenLevel === 'leicht') {
        heText = t('hilflosen_leicht') || 'Leicht (252 CHF/Monat)';
      } else if (inputs.hilflosenLevel === 'mittel') {
        heText = t('hilflosen_mittel') || 'Mittel (630 CHF/Monat)';
      } else if (inputs.hilflosenLevel === 'schwer') {
        heText = t('hilflosen_schwer') || 'Schwer (1008 CHF/Monat)';
      }
      html += `<tr><td>${t('label_hilflosen_level') || 'Hilflosenentschädigung Stufe'}:</td><td>${heText}</td></tr>`;
    }
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
/* 19. 透明公式 - 完全隔离FA数据 + 修复ALV申请信息错误使用IPV的问题 + EL 中添加 HE 说明 */
async function showFormula(b, boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  // 如果是EL区域且用户选择不计算EL，直接清空内容
  if (boxId.includes('el') && Router.form.checkEL !== 'yes') {
    box.innerHTML = '';
    return;
  }
  // 如果是FA区域且无结果或有错误，显示提示
  if (boxId.includes('fa') && (!b || b.error)) {
    let errorHtml = '<div class="warning-box" style="display:block; background:#fff3cd; border:1px solid #ffeeba; padding:15px; margin:15px 0;">';
    if (Router.crowd === 'single') {
      errorHtml += `<strong>${t('fa_not_applicable_single') || 'Familienzulagen nicht anwendbar'}</strong><br>`;
      errorHtml += 'Für alleinstehende Personen ohne Kinder oder Auszubildende besteht kein Anspruch auf Familienzulagen (FA).';
    } else {
      const errorKey = b?.error || 'err_general_no_entitlement';
      let errorMessage = t(errorKey);
      if (errorMessage === errorKey) errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
      errorHtml += `<strong>${t('error') || 'Fehler'}:</strong> ${errorMessage}`;
    }
    errorHtml += '</div>';
    box.innerHTML = errorHtml;
    return;
  }
  // 确保州规则已加载
  const state = Router.state || 'AG';
  if (!window.RULE || !window.RULE[state]) {
    await loadStateRule(state);
  }
  // 错误处理（主要针对EL）
  if (b.error && boxId.includes('el')) {
    const errorKey = b.error.includes('|') ? b.error.split('|')[0] : b.error;
    let errorMessage = t(errorKey);
    if (errorMessage === errorKey) {
      errorMessage = t('err_general_no_entitlement') || 'Leider kein Anspruch auf diese Leistung.';
    }
    box.innerHTML = `<div class="note-error">${t('error')}: ${errorMessage}</div>`;
    return;
  }
  // 计算步骤（通用）
  let html = '';

  // ========== 从家庭版复制增强版法律信息提取函数 ==========
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

      // 提取法律来源URL
      if (rule.legal_basis.legal_source) {
        legalInfo.sourceUrl = rule.legal_basis.legal_source;
      }
    }

    // 情况2: rule.legalBasis 是数组
    else if (Array.isArray(rule.legalBasis)) {
      legalInfo.texts = rule.legalBasis.map(item => t(item)).filter(text => text && text !== item);
      if (rule.legal_source) {
        legalInfo.sourceUrl = rule.legal_source;
      }
    }

    // 情况3: rule.legal_basis 是字符串
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

  function extractOfficialUrl(rule) {
    if (!rule) return null;
    return rule.official_url || rule.application?.url || null;
  }

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

    // === 新增：如果这是 EL 公式，且有 HE，添加影响说明 ===
    if (boxId.includes('el') && Router.crowd === 'disabled' && Router.form.hilflosenLevel) {
      const heLevels = { 'leicht': 252, 'mittel': 630, 'schwer': 1008 };
      const heMonthly = heLevels[Router.form.hilflosenLevel.toLowerCase()] || 0;
      if (heMonthly > 0) {
        const heAnnual = heMonthly * 12;
        const totalPensionAnnual = (Router.form.regularAnnualPension || 0) + heAnnual;
        html += `
          <div class="step" style="font-weight:bold; background:#e6f3ff; padding:6px; border-radius:4px;">
            <span class="label">${t('el_formula_he_included').replace('{total}', totalPensionAnnual.toFixed(2))}</span>
            <span class="val"></span>
          </div>
          <div class="step note" style="margin-top:4px; font-size:0.95em;">
            ${t('el_formula_he_detail').replace('{he}', heAnnual.toFixed(2))}
          </div>
        `;
      }
    }

    // 添加 IV 法律来源信息
    if (boxId.includes('el') && Router.crowd === 'disabled') {
      html += `
            <div class="legal-info-section" style="margin-top: 20px; border-top: 2px dashed #dee2e6; padding-top: 15px;">
                <h4 style="color: #0066cc; margin-bottom: 10px;">${t('legal_basis_title') || 'Rechtsgrundlage & Information'}</h4>
                <div class="application-card" style="background: #f8f9fa; padding: 15px; border-radius: 4px;">
                    <p><strong>${t('legal_basis') || 'Gesetz'}:</strong> ${t('iv_legal_basis') || 'Bundesgesetz über die Invalidenversicherung (IVG)'}</p>
                    <p><strong>vom 19. Juni 1959 (SR 831.20)</strong></p>
                    <p><strong>${t('legal_source') || 'Rechtliche Quelle (Bundesrecht)'}:</strong><br>
                    <a href="https://www.fedlex.admin.ch/eli/cc/1959/827_857_845/de" 
                       target="_blank" 
                       style="color: #007bff; text-decoration: underline; word-break: break-all;"
                       rel="noopener noreferrer">
                        https://www.fedlex.admin.ch/eli/cc/1959/827_857_845/de
                    </a></p>
                    <div class="note-hint" style="margin-top: 10px; background: #e7f3ff; padding: 8px;">
                        <strong>Hinweis:</strong> Dieses Gesetz regelt die Leistungen der Invalidenversicherung, 
                        einschliesslich der IV-Renten und Hilflosenentschädigungen.
                    </div>
                </div>
            </div>
        `;
    }

    if (b.explanation.note_key) {
      html += `<div class="note-hint"><strong>${t('hint') || 'Hinweis'}:</strong> ${t(b.explanation.note_key)}</div>`;
    }
    html += '</div>';
  }
  // 确定benefitType
  let benefitType = 'ipv';
  if (boxId.includes('ipv')) benefitType = 'ipv';
  else if (boxId.includes('el')) benefitType = 'el';
  else if (boxId.includes('sh')) benefitType = 'sozialhilfe';
  else if (boxId.includes('fa')) benefitType = 'fa';
  else if (boxId.includes('alv')) benefitType = 'alv';
  let rule = null;
  // 根据benefitType选择数据源 + ALV特殊处理（保持原样）
  if (benefitType === 'alv') {
    html += '<div class="legal-info-section">';
    html += `<h4>${t('legal_basis_title') || 'Rechtliche Grundlagen & Antrag'}</h4>`;
    html += '<div class="application-card">';
    html += `<h5>${t('how_to_apply') || 'Zuständige Stelle'}</h5>`;
    html += `<p><strong>${t('alv_authority') || 'Arbeitslosenkasse (ALV)'}</strong></p>`;
    html += `<p>${t('alv_address') || 'Kontakt über die kantonale Arbeitslosenkasse oder via www.arbeit.swiss'}</p>`;
    html += `<p><strong>${t('phone') || 'Tel'}:</strong> ${t('alv_phone') || 'Kantonale Hotline (je nach Kanton unterschiedlich)'}</p>`;
    html += `<p><strong>${t('email') || 'Email'}:</strong> ${t('alv_email') || 'Kontaktformular auf arbeit.swiss'}</p>`;
    html += `<p><strong>${t('official_website') || 'Offizielle Webseite'}:</strong> <a href="${t('alv_website') || 'https://www.arbeit.swiss'}" target="_blank" style="color:#007bff;">${t('alv_website') || 'https://www.arbeit.swiss'}</a></p>`;
    html += `<div class="note-hint" style="margin-top:15px; background:#fff3cd; padding:10px; border:1px solid #ffeeba; border-radius:4px;">`;
    html += `<strong>${t('important_note') || 'Wichtiger Hinweis'}:</strong><br>`;
    html += `${t('alv_note') || 'Gehen Sie so schnell wie möglich zur RAV (Regionale Arbeitsvermittlung) Ihrer Wohngemeinde, um sich anzumelden. Unabhängig vom Kanton ist der erste Schritt, Ihre aktive Arbeitssuche nachzuweisen.'}`;
    html += '</div>';
    const alvDocKey = 'alv_required_documents_list';
    let alvDocs = [];
    if (window.LANG && Array.isArray(window.LANG[alvDocKey])) {
      alvDocs = window.LANG[alvDocKey];
    }
    if (alvDocs.length > 0) {
      html += `<h6>${t('required_documents') || 'Erforderliche Unterlagen'}:</h6><ul style="margin-left:20px; list-style-type:disc;">`;
      alvDocs.forEach(item => {
        html += `<li>${t(item) || item}</li>`;
      });
      html += '</ul>';
    }
    html += '</div></div>';
  } else if (benefitType === 'fa') {
    if (window.FA_INFO && window.FA_INFO[state]) {
      rule = window.FA_INFO[state][state] || window.FA_INFO[state];
    }
  } else {
    if (window.RULE && window.RULE[state] && window.RULE[state][benefitType]) {
      rule = window.RULE[state][benefitType];
    }
  }
  // 原有 rule 渲染逻辑（替换为增强版）
  if (rule && benefitType !== 'alv') {
    html += '<div class="legal-info-section">';
    html += `<h4>${t('legal_basis_title') || 'Rechtliche Grundlagen & Antrag'}</h4>`;

    // ========== 使用增强版法律信息提取 ==========
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
      html += `<p><strong>Offizielle Webseite:</strong> <a href="${officialUrl}" target="_blank" style="color:#007bff;">${officialUrl}</a></p>`;
    }

    // 继续原有的 application-card 渲染...
    html += '<div class="application-card">';
    html += `<h5>${t('how_to_apply') || 'Zuständige Stelle'}</h5>`;
    if (benefitType === 'fa') {
      const officeKey = rule.authority?.office_name_key;
      const authKey = rule.authority?.authority_key;
      const officeTranslated = officeKey ? t(officeKey) : (rule.authority?.office_name || 'Familienausgleichskasse');
      const authTranslated = authKey ? t(authKey) : '';
      html += `<p><strong>${officeTranslated}${authTranslated ? ' - ' + authTranslated : ''}</strong></p>`;
      if (rule.contact?.address_key) {
        html += `<p>${t(rule.contact.address_key).replace(/\n/g, '<br>')}</p>`;
      } else if (rule.contact?.address) {
        html += `<p>${rule.contact.address.replace(/\n/g, '<br>')}</p>`;
      }
    } else {
      if (rule.application?.authority_key) {
        html += `<p><strong>${t('authority')}:</strong> ${t(rule.application.authority_key)}</p>`;
      } else if (rule.application?.authority) {
        html += `<p><strong>${t('authority')}:</strong> ${rule.application.authority}</p>`;
      }
      if (rule.application?.contact?.address_key) {
        html += `<p><strong>${t('contact_address')}:</strong> ${t(rule.application.contact.address_key)}</p>`;
      }
    }
    const contact = benefitType === 'fa' ? rule.contact : (rule.application?.contact || {});
    const phone = contact?.phone || 'Nicht angegeben';
    const email = contact?.email || 'Nicht angegeben';
    html += `<p><strong>Tel:</strong> ${phone}</p>`;
    html += `<p><strong>Email:</strong> ${email !== 'Nicht angegeben' ? `<a href="mailto:${email}">${email}</a>` : email}</p>`;

    // 移除原有重复的官方URL渲染（已通过extractOfficialUrl处理）

    let docs = [];
    // 使用 getDocumentKey 函数生成文档键名
    let langKey = benefitType === 'fa'
      ? getDocumentKey(state, 'fa')
      : getDocumentKey(state, benefitType);

    if (window.LANG && Array.isArray(window.LANG[langKey])) {
      docs = window.LANG[langKey];
    } else {
      // 备选方案：尝试直接使用原有的键名格式
      const fallbackKey = benefitType === 'fa'
        ? `${state}_fa_required_documents_list`
        : `${state}_${benefitType}_required_documents_list`;
      if (window.LANG && Array.isArray(window.LANG[fallbackKey])) {
        docs = window.LANG[fallbackKey];
      }
    }

    if (docs.length > 0) {
      html += `<h6>${t('required_documents') || 'Erforderliche Unterlagen'}:</h6><ul style="margin-left:20px; list-style-type:disc;">`;
      docs.forEach(item => {
        const itemText = (typeof item === 'string' && item.startsWith('✓')) ? item : (t(item) || item);
        html += `<li>${itemText}</li>`;
      });
      html += '</ul>';
    }
    const noteKey = benefitType === 'fa' ? rule.notes_key : rule.application?.contact_reminder_key;
    const noteText = noteKey ? t(noteKey) : '';
    if (noteText && noteText !== noteKey) {
      html += `<div class="note-hint" style="margin-top:15px; background:#fff3cd; padding:10px; border:1px solid #ffeeba; border-radius:4px;"><strong>Wichtiger Hinweis:</strong> ${noteText}</div>`;
    }
    html += '</div>';
  } else if (benefitType !== 'alv') {
    html += '<div class="note-hint"><strong>Hinweis:</strong> Antragsinformationen konnten nicht geladen werden. Bitte besuchen Sie die offizielle Kantonsseite.</div>';
  }
  // 写入页面
  box.innerHTML = html;
}
/* EL 准入条件预检函数 */
function validateELPreConditions(formData) {
  // 默认结果
  const result = {
    eligible: true,
    reasonKey: ''
  };

  // 1. 必须正在领取养老金（已在外层判断）

  // 2. 国籍/居住年限检查
  const nationality = formData.nationality;
  const residenceYears = Number(formData.residenceYears) || 0;

  if (nationality === 'non_eu_eea' && residenceYears < 10) {
    result.eligible = false;
    result.reasonKey = 'err_residence_10y';
  } else if (nationality === 'refugee_f' && residenceYears < 5) {
    result.eligible = false;
    result.reasonKey = 'err_residence_5y';
  } else if (nationality === 'refugee_b' && residenceYears < 5) {
    result.eligible = false;
    result.reasonKey = 'err_residence_5y';
  }

  // 3. 资产检查（联邦标准：单人10万，夫妻20万）- 快速预检
  const assets = Number(formData.assets) || 0;
  const isCouple = formData.numAdults >= 2;
  const assetLimit = isCouple ? 200000 : 100000;

  if (assets > assetLimit) {
    result.eligible = false;
    result.reasonKey = 'err_asset_exceeded_federal';
  }

  return result;
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

    <!-- 用户输入信息 - 失业版完整版（已对齐页面） -->
    <div class="section">
        <div class="section-title">Eingabeinformationen</div>
        <table class="info-table">
            <tr><th>Feld</th><th>Wert</th></tr>
            <tr><td>Zielgruppe</td><td>${t('crowd_' + Router.crowd) || Router.crowd || 'Arbeitsloser'}</td></tr>
            <tr><td>Kanton</td><td>${stateName} (${state})</td></tr>
            <tr><td>Postleitzahl</td><td>${Router.plz || '-'}</td></tr>
            <tr><td>Jahreseinkommen</td><td>${formatCurrency(form.income || 0)} CHF</td></tr>
            <tr><td>Vermögen</td><td>${formatCurrency(form.assets || 0)} CHF</td></tr>
            <tr><td>Krankenkassenprämie (CHF/Jahr)</td><td>${formatCurrency(form.health_premium || 0)} CHF</td></tr>
            <tr><td>Monatsmiete</td><td>${formatCurrency(form.monthlyRent || 0)} CHF</td></tr>
            <tr><td>Anzahl Erwachsene</td><td>${form.numAdults || 1}</td></tr>
            <tr><td>Anzahl Kinder</td><td>${form.numChildren || 0}</td></tr>
            <tr><td>Anzahl in Ausbildung (19-25)</td><td>${form.numEducation || 0}</td></tr>
            
            <!-- 失业人员专属字段 -->
            ${Router.crowd === 'unemployed' ? `
            <tr><td>Monatslohn vor Arbeitslosigkeit</td><td>${formatCurrency(form.previousMonthlySalary || 0)} CHF</td></tr>
            <tr><td>Erwartete Arbeitslosigkeitsdauer</td><td>${form.unemploymentDurationMonths || 0} Monate</td></tr>
            <tr><td>Bezieht ALV</td><td>${form.hasALV === 'yes' ? 'Ja' : 'Nein'}</td></tr>
            <tr><td>Anerkannte Behinderung</td><td>${form.hasDisability === 'yes' ? 'Ja' : 'Nein'}</td></tr>
            ` : ''}
            
            ${form.employmentStatus ? `<tr><td>Erwerbssituation</td><td>${t('employment_' + form.employmentStatus) || form.employmentStatus}</td></tr>` : ''}
            ${form.hasMedicalNeeds ? `<tr><td>Besondere medizinische oder pflegerische Bedürfnisse?</td><td>${form.hasMedicalNeeds === 'yes' ? 'Ja' : 'Nein'}</td></tr>` : ''}
            ${form.arbeitspensum !== undefined ? `<tr><td>Aktuelles Arbeitspensum (%)</td><td>${form.arbeitspensum}%</td></tr>` : ''}
            ${form.zusatzbedarf_monatlich !== undefined ? `<tr><td>Monatliche zusätzliche anerkannte Bedürfnisse (CHF)</td><td>${formatCurrency(form.zusatzbedarf_monatlich || 0)} CHF</td></tr>` : ''}
            ${form.other_income_annual !== undefined ? `<tr><td>Andere jährliche Einkünfte (z. B. ALV, IV-Zusatzrente etc.) CHF</td><td>${formatCurrency(form.other_income_annual || 0)} CHF</td></tr>` : ''}
            ${form.monthly_other_expenses !== undefined ? `<tr><td>Monatliche zusätzliche Ausgaben (z. B. Krankheit, Pflege, Transport) CHF</td><td>${formatCurrency(form.monthly_other_expenses || 0)} CHF</td></tr>` : ''}
            ${form.ipvReceivedAnnual !== undefined && form.ipvReceivedAnnual > 0 ? `<tr><td>Jährlich erhaltene Individuelle Prämienverbilligung (IPV) CHF</td><td>${formatCurrency(form.ipvReceivedAnnual)} CHF</td></tr>` : ''}
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

/* 20. PDF 生成 — 严格按照家庭版版式修改（残疾版） */
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

  // ========== 数据完整性校验 ==========
  if (!Router.resultData || Object.keys(Router.resultData).length < 4) {
    console.warn('Result data incomplete, recalculating...');
    try {
      await runCalculation();
      console.log('Recalculation completed for PDF generation');
    } catch (e) {
      console.error('Recalculation failed:', e);
    }
  }
  const results = Router.resultData || {};

  // ========== 离线支持：检查是否已有 jsPDF ==========
  if (!window.jspdf) {
    console.log('Attempting to load jsPDF library...');

    try {
      const loadTimeout = setTimeout(() => {
        if (!window.jspdf) {
          console.error('jsPDF load timeout');
        }
      }, 5000);

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => {
          clearTimeout(loadTimeout);
          console.log('jsPDF loaded successfully');
          resolve();
        };
        script.onerror = () => {
          clearTimeout(loadTimeout);
          reject(new Error('Failed to load jsPDF library'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.error('jsPDF load failed:', error);

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
      }
      return;
    }
  }

  try {
    console.log('Starting PDF generation...');
    console.log('PDF results:', results);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // ========== 1. 基础配置（严格按照家庭版）==========
    const FONT_FAMILY = 'helvetica';
    const FONT_NORMAL = 'normal';
    const FONT_BOLD = 'bold';
    const LINE_HEIGHT = 5.5;  // 家庭版使用的行高

    pdf.setFont(FONT_FAMILY, FONT_NORMAL);
    pdf.setFontSize(10);
    pdf.setLineHeightFactor(1.2);

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 15;
    const contentWidth = pageWidth - (2 * margin);
    let yPos = margin;

    // ========== 2. 多语言字符处理 ==========
    const specialCharMap = {
      'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
      'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
      'à': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
      'î': 'i', 'ï': 'i', 'ô': 'o', 'ù': 'u', 'û': 'u', 'ç': 'c',
      'À': 'A', 'Â': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
      'Î': 'I', 'Ï': 'I', 'Ô': 'O', 'Ù': 'U', 'Û': 'U', 'Ç': 'C',
      'ì': 'i', 'ò': 'o', 'Ì': 'I', 'Ò': 'O',
      'ñ': 'n', 'Ñ': 'N', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u',
      'Á': 'A', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
      'ã': 'a', 'õ': 'o', 'Ã': 'A', 'Õ': 'O',
      'ı': 'i', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S',
      'č': 'c', 'ć': 'c', 'đ': 'dj', 'š': 's', 'ž': 'z',
      'Č': 'C', 'Ć': 'C', 'Đ': 'Dj', 'Š': 'S', 'Ž': 'Z',
      'œ': 'oe', 'Œ': 'Oe', 'æ': 'ae', 'Æ': 'Ae',
      'ÿ': 'y', 'Ÿ': 'Y', 'ƒ': 'f'
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

    // ========== 3. 格式化货币函数 ==========
    function formatCurrency(amount) {
      if (typeof amount !== 'number') return '0.00';
      return amount.toLocaleString('de-CH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    // ========== 4. 换页逻辑（家庭版）==========
    const checkPageBreak = (neededSpace) => {
      if (yPos + neededSpace > pageHeight - 20) {
        pdf.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };

    // ========== 5. 章节标题绘制函数（家庭版）==========
    const drawSection = (title) => {
      checkPageBreak(15);
      pdf.setFontSize(13);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(0, 102, 204);
      const safeTitle = processTextForPDF(title);
      pdf.text(safeTitle, margin, yPos);
      yPos += 6;
      pdf.setDrawColor(0, 102, 204);
      pdf.setLineWidth(0.5);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;
    };

    // ========== 6. 键值对绘制函数（家庭版）==========
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
      pdf.setFont(FONT_FAMILY, FONT_NORMAL);
      pdf.setTextColor(0, 0, 0);
      
      textLines.forEach((line, index) => {
        pdf.text(line, valueStartX, currentY);
        if (index > 0) currentY += LINE_HEIGHT;
      });

      yPos = currentY + LINE_HEIGHT;
    };

    // ========== 7. 绘制标题（家庭版）==========
    const drawHeader = () => {
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

      const now = new Date();
      const dateStr = now.toLocaleDateString('de-CH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const timeStr = now.toLocaleTimeString('de-CH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      pdf.setFontSize(9);
      pdf.setTextColor(102, 102, 102);
      const dateText = processTextForPDF(`${t('pdf_created_on') || 'Erstellt am'} ${dateStr}, ${timeStr}`);
      pdf.text(dateText, pageWidth / 2, yPos, { align: 'center' });
      yPos += 12;

      pdf.setDrawColor(0, 102, 204);
      pdf.setLineWidth(0.5);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;
    };

    // ========== 8. 绘制申请信息（严格按照家庭版）==========
    const drawApplicationInfo = async (type, state) => {
      await loadStateRule(state);

      let appInfo = null;
      let documents = [];

      // ALV 特殊处理
      if (type === 'alv') {
        appInfo = {
          authority: t('alv_authority') || 'Arbeitslosenkasse (ALV)',
          address: t('alv_address') || 'Kontakt über die kantonale Arbeitslosenkasse oder via www.arbeit.swiss',
          phone: t('alv_phone') || 'Kantonale Hotline (je nach Kanton unterschiedlich)',
          email: t('alv_email') || 'Kontaktformular auf arbeit.swiss',
          website: t('alv_website') || 'https://www.arbeit.swiss',
          note: t('alv_note') || 'Gehen Sie so schnell wie möglich zur RAV (Regionale Arbeitsvermittlung) Ihrer Wohngemeinde, um sich anzumelden.'
        };

        const alvDocKey = 'alv_required_documents_list';
        if (window.LANG && Array.isArray(window.LANG[alvDocKey])) {
          documents = window.LANG[alvDocKey];
        } else {
          documents = [
            '✓ ' + (t('alv_doc_registration') || 'Anmeldung bei der RAV'),
            '✓ ' + (t('alv_doc_contract') || 'Arbeitsvertrag und Kündigungsnachweis'),
            '✓ ' + (t('alv_doc_salary') || 'Lohnausweise der letzten Monate')
          ];
        }
      }
      // FA 处理
      else if (type === 'fa') {
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
          const docKey = getDocumentKey(state, 'fa');
          if (window.LANG && Array.isArray(window.LANG[docKey])) documents = window.LANG[docKey];
        }
      }
      // IV 专属内容（残疾人模式）- 按家庭版风格修改
      else if (type === 'iv') {
        const valueStartX = margin + 72;
        const availableWidth = contentWidth - (valueStartX - margin) - 5;

        const getTextHeight = (text) => {
          if (!text) return 0;
          const lines = pdf.splitTextToSize(processTextForPDF(text, true), availableWidth);
          return lines.length * LINE_HEIGHT;
        };

        let requiredHeight = 30;
        requiredHeight += getTextHeight(t('iv_note') || "Die IV-Rente ist bundeseinheitlich. Die Auszahlung erfolgt monatlich. Für Hilflosenentschädigung (HE) gelten separate Stufen.");
        requiredHeight += getTextHeight(t('iv_application_how') || "Beantragen Sie die IV-Rente bei Ihrer kantonalen IV-Stelle. Eine Vorabprüfung ist online möglich.");
        requiredHeight += 30;

        checkPageBreak(requiredHeight + 10);

        pdf.setFillColor(231, 243, 255);
        pdf.rect(margin + 5, yPos, contentWidth - 10, requiredHeight, 'F');

        pdf.setFontSize(9);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(0, 64, 128);
        pdf.text(processTextForPDF(t('application_info') || 'Antragsinformationen'), margin + 8, yPos + 6);
        yPos += 12;

        pdf.setFont(FONT_FAMILY, 'italic');
        pdf.setFontSize(9);
        pdf.setTextColor(80, 80, 80);
        const hinweis = t('iv_note') || "Die IV-Rente ist bundeseinheitlich. Die Auszahlung erfolgt monatlich. Für Hilflosenentschädigung (HE) gelten separate Stufen.";
        const hinweisLines = pdf.splitTextToSize(processTextForPDF(hinweis, true), contentWidth - 20);
        hinweisLines.forEach((line, index) => {
          pdf.text(line, margin + 8, yPos + (index * LINE_HEIGHT));
        });
        yPos += hinweisLines.length * LINE_HEIGHT + 4;

        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setFontSize(9);
        pdf.setTextColor(0, 102, 204);
        pdf.text(processTextForPDF(t('how_to_apply') || "So beantragen Sie die Leistung"), margin + 8, yPos);
        yPos += 6;

        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(0, 0, 0);
        pdf.text(processTextForPDF(t('iv_application_authority') || "Lokale IV-Stelle (Invalidenversicherung)"), margin + 12, yPos);
        yPos += 5;

        const how = t('iv_application_how') || "Beantragen Sie die IV-Rente bei Ihrer kantonalen IV-Stelle. Eine Vorabprüfung ist online möglich.";
        const howLines = pdf.splitTextToSize(processTextForPDF(how, true), contentWidth - 24);
        howLines.forEach((line, index) => {
          pdf.text(line, margin + 12, yPos + (index * LINE_HEIGHT));
        });
        yPos += howLines.length * LINE_HEIGHT + 4;

        pdf.setTextColor(0, 123, 255);
        pdf.textWithLink(
          processTextForPDF(t('official_website') || "Offizielle Webseite") + ": https://www.ahv-iv.ch/de",
          margin + 12,
          yPos,
          { url: "https://www.ahv-iv.ch/de" }
        );
        yPos += 8;
        return;
      }
      // IPV / EL / SH 从 RULE 读取
      else {
        const rule = window.RULE?.[state]?.[type === 'sh' ? 'sozialhilfe' : type];
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
      pdf.text(processTextForPDF(t('application_info') || 'Antragsinformationen'), margin + 8, yPos + 6);
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
        pdf.text(processTextForPDF(t('required_documents') || 'Erforderliche Unterlagen:', true), margin + 8, yPos);
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

    // ========== 9. 绘制福利卡片（严格按照家庭版）==========
    const drawBenefitCard = async (type, title, result) => {
      if (!result) return;

      const hasError = result.error;
      const annual = result.annualBenefit || result.annual || 0;
      const monthly = annual / 12;
      const hasAmount = annual > 0;

      const fullTitle = processTextForPDF(title);
      const titleAvailableWidth = hasError ? contentWidth - 80 : contentWidth - 35;
      const wrappedTitleLines = pdf.splitTextToSize(fullTitle, titleAvailableWidth);
      const titleLineCount = wrappedTitleLines.length;

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

      let cardHeight = 25;
      
      if (titleLineCount > 1) {
        cardHeight += (titleLineCount - 1) * LINE_HEIGHT;
      }

      if (hasError) {
        cardHeight += (topErrorLines.length * LINE_HEIGHT) + 5;
        cardHeight += (detailErrorLines.length * LINE_HEIGHT) + 8;
      } else if (hasAmount) {
        cardHeight += 5;
      }

      if (result.explanation?.steps) cardHeight += result.explanation.steps.length * 6;
      if (result.oneTime?.birth > 0 || result.oneTime?.adoption > 0) cardHeight += 10;

      checkPageBreak(cardHeight + 20);

      pdf.setFillColor(248, 249, 250);
      pdf.rect(margin, yPos, contentWidth, cardHeight, 'F');

      const colors = {
        ipv: [40, 167, 69],
        el: [23, 162, 184],
        fa: [255, 193, 7],
        sh: [108, 117, 125],
        alv: [255, 152, 0],
        iv: [153, 102, 255]
      };
      pdf.setFillColor(...(colors[type] || [128, 128, 128]));
      pdf.rect(margin, yPos, 3, cardHeight, 'F');

      pdf.setFontSize(12);
      pdf.setFont(FONT_FAMILY, FONT_BOLD);
      pdf.setTextColor(0, 0, 0);
      
      let currentTitleY = yPos + 7;
      wrappedTitleLines.forEach((line, index) => {
        pdf.text(line, margin + 8, currentTitleY);
        currentTitleY += LINE_HEIGHT;
      });

      if (hasError) {
        currentTitleY += 3;
        
        pdf.setFontSize(10);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(220, 53, 69);
        
        topErrorLines.forEach((line, index) => {
          pdf.text(line, margin + 8, currentTitleY + (index * LINE_HEIGHT));
        });
        
        const errorTitleHeight = topErrorLines.length * LINE_HEIGHT;
        yPos = currentTitleY + errorTitleHeight + 5;
        
        pdf.setFontSize(9);
        pdf.setFont(FONT_FAMILY, FONT_NORMAL);
        pdf.setTextColor(150, 150, 150);
        
        detailErrorLines.forEach((line, index) => {
          pdf.text(line, margin + 8, yPos + (index * LINE_HEIGHT));
        });
        
        yPos += (detailErrorLines.length * LINE_HEIGHT) + 8;
        
      } else {
        const rightAlignX = pageWidth - margin - 5;
        const firstLineY = yPos + 7;
        
        pdf.setFontSize(11);
        pdf.setFont(FONT_FAMILY, FONT_BOLD);
        pdf.setTextColor(40, 167, 69);
        const amountText = `${formatCurrency(annual)} ${t('chf_per_year') || 'CHF/Jahr'}`;
        const safeAmountText = processTextForPDF(amountText);
        pdf.text(safeAmountText, rightAlignX, firstLineY, { align: 'right' });
        
        if (hasAmount) {
          pdf.setFontSize(9);
          pdf.setTextColor(100, 100, 100);
          const monthlyText = `${t('monthly_short') || 'Monatlich'}: ${formatCurrency(monthly)} CHF`;
          const safeMonthlyText = processTextForPDF(monthlyText);
          pdf.text(safeMonthlyText, rightAlignX, firstLineY + 5, { align: 'right' });
        }
        
        let titleHeight = titleLineCount * LINE_HEIGHT;
        let amountHeight = hasAmount ? 10 : (pdf.getTextWidth(safeAmountText) > 0 ? LINE_HEIGHT : 0);
        let yOffset = Math.max(titleHeight, amountHeight) + 8;
        yPos += yOffset;

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

        if (type === 'fa' && result.oneTime) {
          const birth = result.oneTime.birth || 0;
          const adoption = result.oneTime.adoption || 0;
          if (birth > 0 || adoption > 0) {
            yPos += 3;
            pdf.setFontSize(9);
            pdf.setTextColor(23, 162, 184);
            const einmalText = processTextForPDF(t('fa_onetime_allowances') || 'Einmalzahlungen:', true);
            pdf.text(einmalText, margin + 8, yPos);
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

    // ========== 开始构建PDF内容 ==========
    drawHeader();

    // ========== 输入数据部分 ==========
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

    // 残疾人专属字段
    if (Router.crowd === 'disabled') {
      inputFields.push([t('label_invalidity_degree') || 'Invaliditätsgrad', (form.invalidityDegree || '0') + '%']);
      inputFields.push([t('label_iv_monthly_pension') || 'Monatliche IV-Rente', `${formatCurrency(form.ivMonthlyPension || 0)} CHF`]);

      if (form.hilflosenLevel) {
        let heText = '';
        if (form.hilflosenLevel === 'leicht') heText = t('hilflosen_leicht') || 'Leicht (252 CHF)';
        else if (form.hilflosenLevel === 'mittel') heText = t('hilflosen_mittel') || 'Mittel (630 CHF)';
        else if (form.hilflosenLevel === 'schwer') heText = t('hilflosen_schwer') || 'Schwer (1008 CHF)';
        inputFields.push([t('label_hilflosen_level') || 'Hilflosenentschädigung', heText]);
      }
    }

    // 失业人员专属字段
    if (Router.crowd === 'unemployed') {
      inputFields.push([t('label_previous_monthly_salary') || 'Monatslohn vor AL', `${formatCurrency(form.previousMonthlySalary || 0)} CHF`]);
      inputFields.push([t('label_unemployment_duration_months') || 'ALV-Dauer', (form.unemploymentDurationMonths || '0') + ' Monate']);
      inputFields.push([t('label_has_alv') || 'Bezieht ALV', form.hasALV === 'yes' ? 'Ja' : 'Nein']);
    }

    // SH相关字段
    if (form.employmentStatus) {
      let empText = '';
      if (form.employmentStatus === 'unemployed_alv') empText = t('employment_unemployed_alv') || 'Arbeitslos mit ALV';
      else if (form.employmentStatus === 'unemployed') empText = t('employment_unemployed') || 'Arbeitslos';
      else if (form.employmentStatus === 'unable') empText = t('employment_unable') || 'Arbeitsunfähig / krankgeschrieben';
      else empText = t('employment_other') || 'Andere Situation';
      inputFields.push([t('label_employment_status') || 'Erwerbssituation', empText]);
    }

    if (form.hasMedicalNeeds) {
      inputFields.push([t('label_has_medical_needs') || 'Med. Bedürfnisse', form.hasMedicalNeeds === 'yes' ? 'Ja' : 'Nein']);
    }

    if (form.zusatzbedarf_monatlich > 0) {
      inputFields.push([t('label_zusatzbedarf_monatlich') || 'Zusatzbedarf', `${formatCurrency(form.zusatzbedarf_monatlich)} CHF`]);
    }

    if (form.other_income_annual > 0) {
      inputFields.push([t('label_other_income_annual') || 'Andere Einkünfte', `${formatCurrency(form.other_income_annual)} CHF`]);
    }

    pdf.setFontSize(10);
    inputFields.forEach(([label, value]) => {
      drawKeyValue(label, value, 0);
    });

    if (form.checkEL === 'yes') {
      yPos += 5;

      let pensionType = t('pension_type_none') || 'Keine Rente';
      if (form.ivMonthlyPension > 0) {
        pensionType = t('pension_type_iv') || 'IV-Rente';
      } else if (form.isReceivingPension === 'ahv') {
        pensionType = t('pension_type_ahv') || 'AHV-Rente';
      } else if (form.isReceivingPension === 'iv') {
        pensionType = t('pension_type_iv') || 'IV-Rente';
      }

      let nationalityText = '';
      if (form.nationality === 'ch_eu') nationalityText = t('nat_ch_eu') || 'Schweiz/EU/EFTA';
      else if (form.nationality === 'non_eu_eea') nationalityText = t('nat_non_eu') || 'Drittstaat';
      else nationalityText = t('nat_ch_eu') || 'Schweiz/EU/EFTA';

      const residenceYears = form.residenceYears || '25';

      pdf.setFillColor(240, 248, 255);
      pdf.rect(margin, yPos, contentWidth, 12, 'F');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 64, 128);

      const elInfoText = processTextForPDF(
        `EL-${t('info') || 'Info'}: ${pensionType} | ${nationalityText} | ${residenceYears} ${t('years_residence') || 'Jahre Aufenthalt'}`,
        true
      );
      pdf.text(elInfoText, margin + 5, yPos + 8);
      yPos += 17;
    } else {
      yPos += 5;
    }

    // ========== 计算结果部分 ==========
    drawSection(t('berechnungsergebnisse_heading') || 'Berechnungsergebnisse im Detail');

    // IPV
    await drawBenefitCard('ipv', t('ipv_title') || 'Individuelle Prämienverbilligung (IPV)', results.ipv);

    // EL
    if (form.checkEL === 'yes' && results.el && !results.el.error?.includes('skipped')) {
      await drawBenefitCard('el', t('el_title') || 'Ergänzungsleistungen (EL)', results.el);
    }

    // ALV（失业模式）
    if (Router.crowd === 'unemployed' && results.alv) {
      await drawBenefitCard('alv', t('alv_title') || 'Arbeitslosenversicherung (ALV)', results.alv);
    }

    // FA
    await drawBenefitCard('fa', t('fa_title') || 'Familienzulagen (FA)', results.fa || { annualBenefit: 0 });

    // IV-Rente & HE（残疾人模式）
    if (Router.crowd === 'disabled' && (form.ivMonthlyPension > 0 || form.hilflosenLevel)) {
      const ivMonthly = Number(form.ivMonthlyPension) || 0;
      const heLevels = { 'leicht': 252, 'mittel': 630, 'schwer': 1008 };
      const heMonthly = heLevels[form.hilflosenLevel?.toLowerCase()] || 0;
      const totalMonthly = ivMonthly + heMonthly;
      const totalAnnual = totalMonthly * 12;

      const ivHeSteps = [];
      if (ivMonthly > 0) {
        ivHeSteps.push({ label: 'Monatliche IV-Rente', value: ivMonthly });
      }
      if (heMonthly > 0) {
        ivHeSteps.push({ label: 'Hilflosenentschädigung', value: heMonthly });
      }
      ivHeSteps.push({ label: 'Gesamt monatlich', value: totalMonthly });

      await drawBenefitCard('iv', t('iv_title') || 'Invalidenrente (IV-Rente)', {
        annualBenefit: totalAnnual,
        monthlyBenefit: totalMonthly,
        explanation: { steps: ivHeSteps }
      });
    }

    // SH
    await drawBenefitCard('sh', t('sozialhilfe_title') || 'Sozialhilfe', results.sozialhilfe);

    // ========== 免责声明 ==========
    checkPageBreak(40);
    yPos += 10;

    pdf.setFillColor(255, 243, 205);
    pdf.setDrawColor(255, 234, 167);
    pdf.rect(margin, yPos, contentWidth, 35, 'FD');

    pdf.setFontSize(11);
    pdf.setFont(FONT_FAMILY, FONT_BOLD);
    pdf.setTextColor(133, 100, 4);
    pdf.text(processTextForPDF(t('disclaimer_important') || 'Wichtiger Hinweis'), pageWidth / 2, yPos + 8, { align: 'center' });

    pdf.setFont(FONT_FAMILY, FONT_NORMAL);
    pdf.setFontSize(9);
    pdf.setTextColor(133, 100, 4);

    const disclaimer = t('disclaimer_content') || 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Prüfung erfolgt durch die zuständigen Stellen. Bitte reichen Sie die erforderlichen Unterlagen persönlich bei der zuständigen Behörde ein.';
    const safeDisclaimer = processTextForPDF(disclaimer, true);
    const disclaimerLines = pdf.splitTextToSize(safeDisclaimer, contentWidth - 10);

    let disclaimerY = yPos + 15;
    disclaimerLines.forEach((line) => {
      pdf.text(line, margin + 5, disclaimerY);
      disclaimerY += LINE_HEIGHT;
    });
    yPos = disclaimerY + 5;

    // ========== 页脚 ==========
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);

    const footerText = processTextForPDF(
      (t('pdf_footer') || 'Erstellt mit Sozialleistungs-Rechner {year} | Diese Berechnung dient nur als Orientierungshilfe.').replace('{year}', new Date().getFullYear()),
      true
    );
    pdf.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });

    // ========== 保存PDF ==========
    const filename = `Sozialleistungs_Berechnung_${state}_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);

    console.log('PDF successfully created with Helvetica font');
    console.log('PDF results final:', results);

    if (btnPdf) {
      btnPdf.disabled = false;
      btnPdf.textContent = originalText;
    }

  } catch (error) {
    console.error('PDF generation error:', error);
    console.error('Error stack:', error.stack);
    alert(t('pdf_generation_error') || 'PDF konnte nicht erstellt werden: ' + (error.message || 'Unbekannter Fehler'));

    if (btnPdf) {
      btnPdf.disabled = false;
      btnPdf.textContent = originalText;
    }
  }
}

/* 辅助函数：获取错误消息 */
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
    if (errorObj.includes('no_sh_when_el_message')) return 'Bei Bezug von EL besteht in der Regel kein Anspruch auf Sozialhilfe.';
    if (errorObj.includes('no_sh_when_el_title')) return 'Kein Anspruch auf Sozialhilfe bei EL-Bezug.';
    if (errorObj.includes('fa_module_missing')) return 'Familienzulagen-Modul nicht verfügbar.';
    if (errorObj.includes('fa_calc_error')) return 'Fehler bei der Berechnung der Familienzulagen.';

    return 'Kein Anspruch auf diese Leistung.';
  }

  if (typeof errorObj === 'object' && errorObj.message) {
    return errorObj.message;
  }

  return 'Unbekannter Fehler.';
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
/* 23. 模板函数 - 现在默认显示残疾版版欢迎词 + 默认选中低收入 */
const tmplCrowd = () => `
  <h2>${t('welcome_disabled') || 'Willkommen beim Rechner für Menschen mit Behinderung'}</h2>
  <p style="color:#666; margin-bottom:20px;">
    ${t('disabled_hint') || 'Bitte geben Sie Ihre IV- und Behinderungsdetails ein. Dies beeinflusst IV, EL und SH.'}
  </p>
  <select id="sel-crowd">
    <option value="">-- ${t('select_crowd') || 'Personengruppe auswählen'} --</option>
    <option value="family">${t('crowd_family') || 'Familie'}</option>
    <option value="single">${t('crowd_single') || 'Einzelperson'}</option>
    <option value="student">${t('crowd_student') || 'Student'}</option>
    <option value="pregnant">${t('crowd_pregnant') || 'Schwangere Person'}</option>
    <option value="unemployed">${t('crowd_unemployed') || 'Arbeitsloser'}</option>
    <option value="disabled" selected>${t('crowd_disabled') || 'Behinderte Person'}</option>
    <option value="refugee">${t('crowd_refugee') || 'Flüchtling'}</option>
  </select>
  <div class="button-group">
    <button id="btn-state" class="btn-primary" style="margin-top: 20px;">${t('continue') || 'Weiter'}</button>
  </div>
`;
const tmplState = () => `
  <h2>${t('select_state_plz') || 'Kanton und PLZ wählen'}</h2>
  <label>${t('canton') || 'Kanton'}</label>
  <select id="sel-state">
    <option value="">-- ${t('canton') || 'Kanton'} --</option>
    ${STATES.map(s => `<option value="${s}">${t(s + '_name') || s}</option>`).join('')}
  </select>
  <label>${t('postal_code') || 'Postleitzahl'}</label>
  <input id="inp-plz" type="text" maxlength="4" placeholder="${t('input_postal_code') || 'z.B. 3000'}" pattern="\\d{4}">
  <div class="button-group">
    <button id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
    <button id="btn-state" class="btn-primary" disabled>${t('continue') || 'Weiter'}</button>
  </div>
`;

/* 输入表单 - 残疾人版专用 */
const tmplUnemployed = () => `
  <div class="app-container">
    <h2 class="form-title">
      ${Router.crowd === 'disabled' 
        ? t('input_data_disabled') || 'Daten für Menschen mit Behinderung eingeben' 
        : t('input_data') || 'Ihre Daten eingeben'}
    </h2>

    <!-- 模式專屬提示框（綠色調） -->
    <div class="mode-notice">
      <strong style="display: block; text-align: center; margin-bottom: 8px;">${Router.crowd === 'disabled' 
        ? t('disabled_mode_active') || 'Behinderungs-Modus aktiv' 
        : t('unemployed_mode_active') || 'Arbeitslosen-Modus aktiv'}</strong>
      ${Router.crowd === 'disabled'
        ? t('disabled_hint') || 'Bitte geben Sie Ihre IV- und Behinderungsdetails ein. Dies beeinflusst IV, EL und SH.'
        : t('unemployed_hint') || 'Bitte geben Sie Ihre finanzielle und berufliche Situation so genau wie möglich an.'}
    </div>

    <form id="dynamic-form" class="input-form">

      <!-- 基本財務信息 -->
      <div class="form-group">
        <label class="form-label form-label-highlight" for="income">${t('annual_income') || 'Jahreseinkommen (CHF)'}</label>
        <span class="hint">${t('hint_annual_income') || 'Steuerbares Jahreseinkommen (inkl. Nebenjobs, ALV etc.)'}</span>
        <input name="income" id="income" type="number" step="0.01" min="0" placeholder="z.B. 18000" required class="form-input">
      </div>

      <div class="form-group">
        <label class="form-label form-label-highlight" for="assets">${t('assets') || 'Vermögen (CHF)'}</label>
        <span class="hint">${t('hint_assets') || 'Steuerbares Reinvermögen (ohne selbstgenutztes Wohneigentum)'}</span>
        <input name="assets" id="assets" type="number" step="0.01" min="0" placeholder="z.B. 8000" required class="form-input">
      </div>

      <div class="form-group">
        <label class="form-label form-label-highlight" for="health_premium">${t('health_insurance_premium') || 'Krankenkassenprämie (CHF/Jahr)'}</label>
        <span class="hint">${t('hint_health_premium') || 'Jahresprämie der obligatorischen Grundversicherung'}</span>
        <input name="health_premium" id="health_premium" type="number" step="0.01" min="0" placeholder="z.B. 3800" required class="form-input">
      </div>

      <div class="form-group">
        <label class="form-label form-label-highlight" for="monthlyRent">${t('monthly_rent') || 'Monatsmiete (CHF)'}</label>
        <span class="hint">${t('hint_monthly_rent') || 'Monatliche Miete oder Wohnkosten'}</span>
        <input name="monthlyRent" id="monthlyRent" type="number" step="0.01" min="0" placeholder="z.B. 950" required class="form-input">
      </div>

      <!-- 孩子和教育字段 -->
      <div class="form-group">
        <label class="form-label form-label-highlight" for="numChildren">${t('num_children') || 'Anzahl Kinder'}</label>
        <span class="hint">${t('hint_num_children') || 'Wichtig für Familienzulagen (FA)'}</span>
        <input name="numChildren" id="numChildren" type="number" min="0" value="0" placeholder="z.B. 0" class="form-input">
      </div>

      <div class="form-group">
        <label class="form-label form-label-highlight" for="numEducation">${t('num_education') || 'Anzahl in Ausbildung (19-25 Jahre)'}</label>
        <span class="hint">${t('hint_num_education') || 'Wichtig für Ausbildungszulagen'}</span>
        <input name="numEducation" id="numEducation" type="number" min="0" value="0" placeholder="z.B. 0" class="form-input">
      </div>

      <!-- FA 動態額外字段 -->
      <div id="fa-extra-fields" class="fa-extra-section">
        <h4 class="section-subtitle">${t('fa_extra_title') || 'Familienzulagen – Zusätzliche Angaben'}</h4>
        
        <div id="fa-field-newborns" class="form-group" style="display:none;">
          <label class="form-label form-label-highlight" for="numNewborns">${t('label_num_newborns') || 'Anzahl Neugeborene (Geburtsszulage)'}</label>
          <span class="hint">${t('hint_num_newborns') || 'Nur für Geburten im aktuellen Jahr'}</span>
          <input name="numNewborns" id="numNewborns" type="number" min="0" value="0" class="form-input">
        </div>

        <div id="fa-field-adoptions" class="form-group" style="display:none;">
          <label class="form-label form-label-highlight" for="numAdoptions">${t('label_num_adoptions') || 'Anzahl Adoptionen (Adoptionszulage)'}</label>
          <span class="hint">${t('hint_num_adoptions') || 'Nur für Adoptionen im aktuellen Jahr'}</span>
          <input name="numAdoptions" id="numAdoptions" type="number" min="0" value="0" class="form-input">
        </div>

        <div id="fa-field-children-over12" class="form-group" style="display:none;">
          <label class="form-label form-label-highlight" for="numChildrenOver12">${t('label_children_over12') || 'Anzahl Kinder über 12 Jahre'}</label>
          <input name="numChildrenOver12" id="numChildrenOver12" type="number" min="0" value="0" class="form-input">
        </div>

        <div id="fa-field-education-over18" class="form-group" style="display:none;">
          <label class="form-label form-label-highlight" for="numEducationOver18">${t('label_education_over18') || 'Anzahl Auszubildende über 18 Jahre'}</label>
          <input name="numEducationOver18" id="numEducationOver18" type="number" min="0" value="0" class="form-input">
        </div>
      </div>

      <!-- 成人數量固定為1 -->
      <div class="form-group">
        <label class="form-label form-label-highlight">${t('num_adults') || 'Anzahl Erwachsene'} (fest: 1)</label>
        <input name="numAdults" type="number" min="1" max="1" value="1" readonly class="form-input readonly">
      </div>

      <!-- 人群專屬字段：disabled 模式 -->
      ${Router.crowd === 'disabled' ? `
        <div class="form-group">
          <label class="form-label form-label-highlight" for="invalidityDegree">${t('label_invalidity_degree') || 'Invaliditätsgrad (%)'}</label>
          <span class="hint">${t('hint_invalidity_degree') || 'z.B. 60% (basierend auf IV-Bescheid, beeinflusst Rente-Schätzung)'}</span>
          <input name="invalidityDegree" id="invalidityDegree" type="number" min="0" max="100" placeholder="${t('example') || 'z.B.'} 60" value="0" required class="form-input">
        </div>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="ivMonthlyPension">${t('label_iv_monthly_pension') || 'Monatliche IV-Rente (CHF)'}</label>
          <span class="hint">${t('hint_iv_monthly_pension') || 'Aktueller IV-Rentenbetrag (falls bekannt, sonst wird geschätzt)'}</span>
          <input name="ivMonthlyPension" id="ivMonthlyPension" type="number" step="0.01" min="0" placeholder="${t('example') || 'z.B.'} 1500" value="0" class="form-input">
        </div>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="hilflosenLevel">${t('label_hilflosen_level') || 'Hilflosenentschädigung Stufe'}</label>
          <span class="hint">${t('hint_hilflosen_level') || 'Stufe der Hilflosenentschädigung (falls zutreffend, für zusätzliche Bedürfnisse)'}</span>
          <select name="hilflosenLevel" id="hilflosenLevel" class="form-select">
            <option value="">-- ${t('none') || 'Keine'} --</option>
            <option value="leicht">${t('hilflosen_leicht') || 'Leicht (252 CHF/Monat)'}</option>
            <option value="mittel">${t('hilflosen_mittel') || 'Mittel (630 CHF/Monat)'}</option>
            <option value="schwer">${t('hilflosen_schwer') || 'Schwer (1008 CHF/Monat)'}</option>
          </select>
        </div>
      ` : ''}

      <!-- EL 部分 -->
      <div class="form-group">
        <label class="form-label form-label-highlight">${t('el_precheck_title') || 'Ergänzungsleistungen (EL) prüfen?'}</label>
        <span class="hint">${t('ask_el_confirm') || 'Möchten Sie zusätzlich Ihren EL-Anspruch prüfen lassen?'}</span>
        <div class="radio-group">
          <label><input type="radio" name="checkEL" value="yes"> ${t('confirm_yes') || 'Ja, prüfen'}</label>
          <label><input type="radio" name="checkEL" value="no" checked> ${t('confirm_no') || 'Nein, nur IPV'}</label>
        </div>
      </div>

      <div id="el-extra-fields" style="display:none;">
        <div class="form-group">
          <label class="form-label form-label-highlight">${t('label_is_receiving_pension') || 'Beziehen Sie eine AHV- oder IV-Rente?'}</label>
          <span class="hint">${t('hint_pension_receiving') || 'Für Rentner gelten bei Erwerbseinkommen und Renten unterschiedliche Anrechnungsregeln.'}</span>
          <div class="radio-group">
            <label><input type="radio" name="isReceivingPension" value="ahv"> ${t('pension_type_ahv') || 'AHV (Altersrente)'}</label>
            <label><input type="radio" name="isReceivingPension" value="iv"> ${t('pension_type_iv') || 'IV (Invalidenrente)'}</label>
            <label><input type="radio" name="isReceivingPension" value="no"> ${t('pension_type_none') || 'Ich beziehe keine Rente'}</label>
          </div>
        </div>

        <div id="el-no-pension-warning" class="warning-box" style="display:none;">
          <strong>${t('error') || 'Hinweis'}:</strong> ${t('err_el_no_pension_warning') || 'Hinweis: Gesetzlich besteht ein Anspruch auf EL nur für Personen, die bereits eine AHV- oder IV-Rente beziehen. Ohne eine solche Rente kann keine EL berechnet werden.'}
        </div>

        <div id="pension-type-field" class="form-group" style="display:none;">
          <label class="form-label form-label-highlight">${t('label_pension_type') || 'Rentenart'}</label>
          <span class="hint">${t('pension_type_hint') || 'Wählen Sie AHV für Altersrente oder IV für Invalidenrente.'}</span>
          <div class="radio-group">
            <label><input type="radio" name="pensionType" value="AHV" checked> ${t('pension_type_ahv') || 'AHV (Altersrente)'}</label>
            <label><input type="radio" name="pensionType" value="IV"> ${t('pension_type_iv') || 'IV (Invalidenrente)'}</label>
          </div>
        </div>

        <div id="el-other-fields">
          <div class="form-group">
            <label class="form-label form-label-highlight" for="nationality">${t('label_nationality') || 'Nationalität / Aufenthaltsstatus'}</label>
            <select name="nationality" id="nationality" class="form-select">
              <option value="">-- ${t('select_option_placeholder') || 'Bitte wählen'} --</option>
              <option value="ch_eu">${t('nat_ch_eu') || 'Schweiz / EU / EFTA'}</option>
              <option value="non_eu_eea">${t('nat_non_eu') || 'Drittstaat (z.B. B/C-Ausweis)'}</option>
              <option value="refugee_f">${t('nat_refugee') || 'Flüchtling / Staatenlos'} (F-Status)</option>
              <option value="refugee_b">${t('nat_refugee') || 'Flüchtling / Staatenlos'} (B-Status)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label form-label-highlight" for="residenceYears">${t('label_residence_years') || 'Anzahl Jahre in der Schweiz wohnhaft'}</label>
            <input name="residenceYears" id="residenceYears" type="number" min="0" max="100" placeholder="${t('example') || 'z.B.'} 8" class="form-input">
          </div>
        </div>
      </div>

      <!-- SH 額外字段 -->
      <div id="sh-extra-fields" class="sh-extra-section">
        <h4 class="section-subtitle">${t('sh_extra_fields_title') || 'Zusätzliche Angaben für Sozialhilfe'}</h4>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="employmentStatus">${t('label_employment_status') || 'Beschäftigungsstatus'}</label>
          <span class="hint">${t('hint_employment_status') || 'Für Arbeitslose oft \'unemployed\' oder \'unable\''}</span>
          <select name="employmentStatus" id="employmentStatus" class="form-select" required>
            <option value="" disabled>-- ${t('select_option_placeholder') || 'Bitte wählen'} --</option>
            <option value="unemployed_alv" selected>${t('employment_unemployed_alv') || 'Arbeitslos mit ALV'}</option>
            <option value="unemployed">${t('employment_unemployed') || 'Arbeitslos'}</option>
            <option value="unable">${t('employment_unable') || 'Arbeitsunfähig'}</option>
            <option value="other">${t('employment_other') || 'Anderes'}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="hasMedicalNeeds">${t('label_has_medical_needs') || 'Haben Sie medizinische Bedürfnisse?'}</label>
          <span class="hint">${t('hint_has_medical_needs') || 'Wichtig für AG und andere Kantone: beeinflusst Gesundheitszuschlag'}</span>
          <div class="radio-group">
            <label><input type="radio" name="hasMedicalNeeds" value="yes"> ${t('yes') || 'Ja'}</label>
            <label><input type="radio" name="hasMedicalNeeds" value="no"> ${t('no') || 'Nein'}</label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="other_income_annual">${t('label_other_income_annual') || 'Andere Jahreseinkommen'}</label>
          <span class="hint">${t('hint_other_income_annual') || 'z.B. ALV, IV-Zusatz, etc. (CHF/Jahr)'}</span>
          <input name="other_income_annual" id="other_income_annual" type="number" step="0.01" min="0" placeholder="0" value="0" class="form-input">
        </div>

        <div class="form-group">
          <label class="form-label form-label-highlight" for="monthly_other_expenses">${t('label_monthly_other_expenses') || 'Monatliche sonstige Ausgaben'}</label>
          <span class="hint">${t('hint_monthly_other_expenses') || 'z.B. Krankheit, Pflege, Transport (CHF/Monat, nur bei Nachweis)'}</span>
          <input name="monthly_other_expenses" id="monthly_other_expenses" type="number" step="0.01" min="0" placeholder="0" value="0" class="form-input">
        </div>
      </div>

      <!-- 提交按鈕 -->
      <div class="button-group">
        <button type="button" id="btn-back" class="btn-secondary">${t('back') || 'Zurück'}</button>
        <button type="button" id="btn-calc" class="submit-btn">${t('calculate') || 'Berechnen'}</button>
      </div>
    </form>

    <!-- SH 二次計算提示 -->
    <div id="sh-recalc-hint" class="warning-box" style="display:none;">
      <div class="hint-title">${t('sh_recalc_hint_title') || 'IPV Berechnung abgeschlossen!'}</div>
      <p>${t('sh_recalc_hint_text') || 'Bitte prüfen und ergänzen Sie die Sozialhilfe-Zusatzangaben oben (insbesondere Erwerbssituation und medizinische Bedürfnisse).'}</p>
      <p>${t('sh_recalc_hint_action') || 'Klicken Sie dann erneut auf <strong>"Sozialhilfe neu berechnen"</strong>, um das Ergebnis zu sehen.'}</p>
    </div>
  </div>
`;

/* 结果页模板 - 必须保留！ */
const tmplResult = () => `
  <div class="result-page-magazine">
    <h1 class="magazine-title">${t('result_title') || 'Ihre Berechnung'}</h1>
    
    <div class="magazine-lead">
      <div class="disclaimer-magazine">
        <strong>${t('disclaimer_important') || 'Wichtiger Hinweis'}</strong><br>
        ${t('disclaimer_content') || 'Dies ist eine unverbindliche Vorab-Berechnung. Die endgültige Entscheidung treffen die zuständigen Stellen.'}
      </div>
    </div>

    <section class="magazine-section inputs-section">
      <h2 class="section-heading">${t('eingabeinformationen') || 'Ihre Angaben'}</h2>
      <div id="user-inputs" class="magazine-input-grid"></div>
    </section>

    <section class="magazine-section benefits-section">
      <h2 class="section-heading">${t('berechnungsergebnisse_heading') || 'Ihre Ansprüche im Überblick'}</h2>
      
      <details class="benefit-card-magazine" id="ipv-details" open>
        <summary class="benefit-summary-magazine">
          <span class="benefit-name">${t('ipv_title') || 'Individuelle Prämienverbilligung (IPV)'}</span>
          <span class="benefit-total-magazine">
            ${t('annual_short') || 'Jährlich'}: <b id="ipv-benefit-annual">0.00</b> CHF | 
            ${t('monthly_short') || 'Monatlich'}: <b id="ipv-benefit-monthly">0.00</b> CHF
            <span class="toggle-hint-magazine">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-content-magazine">
          <div id="ipv-formula-box" class="formula-magazine"></div>
        </div>
      </details>

      <details class="benefit-card-magazine" id="el-details" style="display:none">
        <summary class="benefit-summary-magazine">
          <span class="benefit-name">${t('el_title') || 'Ergänzungsleistungen (EL)'}</span>
          <span class="benefit-total-magazine">
            ${t('annual_short') || 'Jährlich'}: <b id="el-benefit-annual">0.00</b> CHF | 
            ${t('monthly_short') || 'Monatlich'}: <b id="el-benefit-monthly">0.00</b> CHF
            <span class="toggle-hint-magazine">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-content-magazine">
          <div id="el-formula-box" class="formula-magazine"></div>
        </div>
      </details>

      <details class="benefit-card-magazine" id="fa-details">
        <summary class="benefit-summary-magazine">
          <span class="benefit-name">${t('fa_title') || 'Familienzulagen (FA)'}</span>
          <span class="benefit-total-magazine">
            ${t('annual_short') || 'Jährlich'}: <b id="fa-benefit-annual">0.00</b> CHF | 
            ${t('monthly_short') || 'Monatlich'}: <b id="fa-benefit-monthly">0.00</b> CHF
            <span class="toggle-hint-magazine">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-content-magazine">
          <div id="fa-onetime-allowances" class="onetime-magazine"></div>
          <div id="fa-formula-box" class="formula-magazine"></div>
        </div>
      </details>

      <details class="benefit-card-magazine" id="sh-details" style="display:none">
        <summary class="benefit-summary-magazine">
          <span class="benefit-name">${t('sozialhilfe_title') || 'Sozialhilfe'}</span>
          <span class="benefit-total-magazine">
            ${t('annual_short') || 'Jährlich'}: <b id="sh-benefit-annual">0.00</b> CHF | 
            ${t('monthly_short') || 'Monatlich'}: <b id="sh-benefit-monthly">0.00</b> CHF
            <span class="toggle-hint-magazine">(${t('details_expand') || 'Details anzeigen'})</span>
          </span>
        </summary>
        <div class="benefit-content-magazine">
          <div id="sh-formula-box" class="formula-magazine"></div>
          <div class="sh-disclaimer-magazine">
            ${t('sh_general_disclaimer') || 'Sozialhilfe ist das letzte Sicherungsnetz und nachrangig.'}
          </div>
        </div>
      </details>
    </section>

    <div class="magazine-actions">
      <button id="btn-back" class="btn-magazine secondary">${t('back') || 'Zurück'}</button>
      <button id="btn-recalc" class="btn-magazine secondary">${t('neu_berechnen') || 'Neu berechnen'}</button>
      <button id="btn-pdf" class="btn-magazine primary">${t('download_pdf') || 'PDF herunterladen'}</button>
    </div>
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

window.initCrowdModule = function() {
    console.log('Initializing disabled crowd module');
    
    // ★★★ 只加载专用CSS文件，不加载styles.css ★★★
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/main_disabled.css?v=' + Date.now();
    document.head.appendChild(link);
    
    // 設置人群類型為残疾人
    Router.crowd = 'disabled';
    
    // 應用語言設置（如果存在）
    if (window.currentLang) {
        Router.lang = window.currentLang;
    }
    
    // 清空app容器（確保乾淨）
    const app = document.getElementById('app');
    if (app) {
        app.innerHTML = '';
        
        // ★★★ 移除這一行：因為無定義，且可能破壞居中 ★★★
        // app.classList.add('full-screen');
    }
    
    // 隱藏 index.html 上方的固定元素（header、語言選擇、人群選擇）
    const header = document.querySelector('.site-header');
    if (header) header.style.display = 'none';
    
    const crowdSelector = document.getElementById('crowd-selector');
    if (crowdSelector) crowdSelector.style.display = 'none';
    
    const languageSelector = document.querySelector('.language-selector');
    if (languageSelector) languageSelector.style.display = 'none';
    
    // 可選：調整 body 避免多餘 padding
    document.body.style.padding = '0';
    document.body.style.margin = '0';
    
    // 開始渲染（建議從 'state' 或 'form' 開始，視需求）
    render('state');  // 或 render('form'); 如果想直接進輸入頁
    
    console.log('Disabled module initialized, full-screen mode activated');
};