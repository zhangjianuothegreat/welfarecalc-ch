/**
 * elsuanfa_BS.js – 2026 巴塞尔城市州 (BS) EL 算法 [官方 100% 匹配版 - 2026统一收入处理]
 * 核心特性：
 * 1. 强制使用2026联邦Grundbedarf基准值
 * 2. 统一养老金读取优先级 + 调试日志
 * 3. AHV第13个月养老金中性化（仅AHV领取者）
 * 4. 劳动收入和资产折算逻辑保持BS原有规则
 */
export default function calculateEL_BS(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };

  const r = cantonRules?.el || {};
  const state = 'BS';
  const isCouple = (Number(inputs.numAdults) || 1) === 2;

  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670, // Alleinstehende
    couple: 31005  // Ehepaare
  };
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  // 再加上你原来的儿童阶梯（保持不变）
  let childGB = 0;
  const numChildren = Number(inputs.numChildren) || 0;     // < 11 岁
  const numEducation = Number(inputs.numEducation || 0);   // >= 11 岁且在职校/高中
  const childRatesUnder11 = r.child_grundbedarf_rates?.under_11 || [];
  const childRatesOver11  = r.child_grundbedarf_rates?.over_11  || [];
  let currentChildIndex = 0;

  // 先算 11 岁以上/教育中
  for (let i = 0; i < numEducation; i++) {
    const rateIdx = Math.min(currentChildIndex, 4);
    annualGB += childRatesOver11[rateIdx] || 0;
    currentChildIndex++;
  }
  // 再算 11 岁以下
  for (let i = 0; i < numChildren; i++) {
    const rateIdx = Math.min(currentChildIndex, 4);
    annualGB += childRatesUnder11[rateIdx] || 0;
    currentChildIndex++;
  }

  // B. 租金上限 (BS 为 Region 1)
  const rentLimits = r.rent_limits_annual?.region_1 || {};
  const pKey = (numChildren + numEducation + (Number(inputs.numAdults)||1)) >= 5 ? "5" : String(numChildren + numEducation + (Number(inputs.numAdults)||1));
  const maxRentAnnual = rentLimits[pKey] || 0;
  const recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0) * 12, maxRentAnnual);

  // C. 医疗保费 – 严格遵守 ELG Art. 11 + BS 执行细则
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    const prem = r.recognized_premiums_annual?.standard_2026 || { adult: 0, young_adult: 0, child: 0 };
    totalPremiumAnnual = ( (Number(inputs.numAdults)||1) * prem.adult ) +
                         ( numEducation * prem.young_adult ) +
                         ( numChildren * prem.child );
  }
  const maxPremium = r.recognized_premiums_annual?.max || 30000;
  totalPremiumAnnual = Math.min(totalPremiumAnnual, maxPremium);

  const totalNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;

  // ────────────────────────────────────────────────
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);
  const pensionAnnual = Number(inputs.regularAnnualPension ||
                               inputs.annualPension ||
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[${state}] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);           // 仅记录，不直接使用
    annualIncome = Math.round((annualIncome / 13) * 12);      // 中性化处理
  }

  // 劳动收入（保留原有BS逻辑）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  let annualEarnedIncome = 0;
  if (earnedIncome > 0) {
    const freibetrag = isCouple
      ? r.social_deductions?.earned_income_freibetrag_couple || 1950
      : r.social_deductions?.earned_income_freibetrag_single || 1300;
    annualEarnedIncome = Math.max(0, (earnedIncome - freibetrag) * (2 / 3));
  }

  // 资产折算（保留原有BS逻辑）
  const entranceLimit = isCouple ? r.asset_limits?.couple : r.asset_limits?.single;
  if (Number(inputs.taxableAssets || 0) > (entranceLimit || Infinity)) {
    return { error: 'err_asset_exceeded', annualBenefit: 0, isEligible: false };
  }

  const assetExemption = isCouple
    ? r.social_deductions?.asset_exemption_couple || 0
    : r.social_deductions?.asset_exemption_single || 0;

  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (Number(inputs.taxableAssets || 0) - assetExemption) / divisor);

  const totalIncome = annualIncome + annualEarnedIncome + assetIncome;
  // ────────────────────────────────────────────────

  // --- 结果 ---
  const annualBenefit = Math.max(0, totalNeeds - totalIncome);

  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Grundbedarf (incl. Kinder-Staffelung)', value: `${Math.round(annualGB)} CHF` },
        { label: 'Anerkannte Miete (Region 1)', value: `+ ${Math.round(recognizedRentAnnual)} CHF` },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: `+ ${Math.round(totalPremiumAnnual)} CHF` },
        { label: 'Netto-Einkommen (bereinigt, AHV/13 neutralisiert)', value: `– ${Math.round(totalIncome)} CHF` }
      ],
      note: 'Konform mit ELG-Reform 2026 und BS-Richtlinien. 13. AHV neutralisiert (nur bei AHV-Bezug).'
    }
  };
}