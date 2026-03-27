// IPVsuanfa_AG.js  — 阿尔高州 IPV（键名版，语言无关）
export default function calculateIPV_AG(inputs, cantonRules) {
  // 1. 入参基础校验
  if (!inputs || typeof inputs !== 'object') return err('invalidInput');

  const req = [
    'numAdults','numChildren','numEducation','taxableIncomeAnnual',
    'taxableAssets','rueckadditionen','annualHealthPremium'
  ];
  for (const f of req) {
    const v = inputs[f];
    if (typeof v !== 'number' || v < 0) return err('negativeOrNaN', f);
  }
  if (inputs.numAdults < 1 || inputs.numAdults > 10) return err('adultsOutOfRange');

  // 2. 读取规则
  const r   = cantonRules.ipv || {};
  const ref = r.ref_premium_annual || {
    adult: 5830.00, young_adult: 4260.00, child: 1380.00
  };

  // === 【逻辑准备区】 提升声明位置，确保全局复用 ===
  const isCouple      = inputs.numAdults === 2; // 全局复用：用于资产校验、自由额计算等
  const totalChildren = inputs.numChildren + inputs.numEducation;
  const hasChildren   = totalChildren > 0;

  // === 3. 显式验证：资产限额 (基于全局变量 isCouple) ===
  const assetLimit = isCouple ? (r.asset_limit_couple || 200000) : (r.asset_limit_single || 100000);
  if (inputs.taxableAssets > assetLimit) {
    return err('ipv_note_no_entitlement_assets_exceeded');
  }

  // 4. 计算 LNA（massgebendes Einkommen）
  const baseIncome    = inputs.taxableIncomeAnnual + (inputs.rueckadditionen || 0);
  const assetAddition = 0.2 * (inputs.taxableAssets || 0);

  // 5. 家庭自由额（直接复用 isCouple 判断）
  let freibetrag = 0;
  if (!isCouple && !hasChildren)       freibetrag = 8500;   // singleNoKids
  else if (!isCouple && hasChildren)   freibetrag = 12200;  // singleWithKids
  else if (isCouple && !hasChildren)   freibetrag = 0;      // coupleNoKids
  else if (isCouple && hasChildren)    freibetrag = 8000;   // coupleWithKids

  freibetrag += 2500 * totalChildren;
  const lna = Math.max(0, baseIncome + assetAddition - freibetrag);

  // 6. 补贴计算
  const refTotal        = inputs.numAdults * ref.adult
                        + inputs.numEducation * ref.young_adult
                        + inputs.numChildren * ref.child;
  
  // Aargau 州标准负担率 17.5%
  const incomeDeductionFactor = 0.175;
  const incomeDeduction = lna * incomeDeductionFactor;
  
  // 计算原始补贴额
  const rawSubsidy = refTotal - incomeDeduction;

  // === 7. 显式验证：收入过高拦截 ===
  if (rawSubsidy <= 0) {
    return err('ipv_note_no_entitlement_income_exceeded');
  }

  // 最终补贴受实际保费限制
  const annualBenefit = Math.min(Math.round(rawSubsidy), inputs.annualHealthPremium);

  // 8. 返回纯数据（零自然语言）
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    calculatedSubsidy: Math.round(rawSubsidy),
    determiningIncome: Math.round(lna),
    totalRefPremium: Math.round(refTotal),
    explanation: {
      steps: [
        { label: 'step_LNA',           value: Math.round(lna) },
        { label: 'step_refPremium',    value: Math.round(refTotal) },
        { label: 'step_incomeLoad',    value: Math.round(incomeDeduction) },
        { label: 'step_rawSubsidy',    value: Math.round(rawSubsidy) },
        { label: 'step_finalIPV',      value: annualBenefit }
      ],
      note: 'note_aargauPercentModel'
    },
    error: null
  };
}

/* 统一错误工厂 */
function err(key, field) {
  return { error: field ? `err_${key}|${field}` : `${key}`, annualBenefit: 0 };
}