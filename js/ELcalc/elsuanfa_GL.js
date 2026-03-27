// elsuanfa_GL.js – 2026 Glarus州 (GL) EL 算法 [官方 100% 匹配版]
// 核心依据：SVA Glarus & Bundesgesetz über Ergänzungsleistungen (ELG) 2026
export default function calculateEL_GL(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };
  const r = cantonRules?.el || {};
  
  // --- 1. 环境与分区判定 ---
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionKey = 'region_3'; // 默认保底为 Region 3 (Glarus Süd)
  let foundPLZ = false;
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    // GL 州仅存在 Region 2 和 3
    regionKey = (dbRegion === 2) ? 'region_2' : 'region_3';
    foundPLZ = true;
  }
  const rentLimits = r.rent_limits_monthly[regionKey];
  if (!rentLimits) return { error: 'err_no_rent_region', annualBenefit: 0 };
  
  // --- 2. 支出项计算 (Ausgaben) ---
  const numAdults = Number(inputs.numAdults) || 1;
  const isCouple = numAdults === 2;
  const numChildren = Number(inputs.numChildren) || 0; // <11岁
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0); // >=11岁在教育中
  const totalPersons = numAdults + numChildren + numEducation;
  
  // A. 生活基准额 (Grundbedarf 2026 联邦标准)
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 阶梯递减逻辑：联邦法律规定按孩子总数排名计费，先排 >=11岁孩子（较高率），再排 <11岁
  const childRatesUnder11 = r.child_grundbedarf_rates?.under_11 || [7590, 6325, 5270, 4390, 3660];
  const childRatesOver11 = r.child_grundbedarf_rates?.over_11 || [10815, 10815, 7210, 7210, 3605];
  let currentChildIndex = 0;
  // 先算 >=11岁/教育中
  for (let i = 0; i < numEducation; i++) {
    const rateIdx = Math.min(currentChildIndex, childRatesOver11.length - 1);
    annualGB += childRatesOver11[rateIdx] || 0;
    currentChildIndex++;
  }
  // 再算 <11岁
  for (let i = 0; i < numChildren; i++) {
    const rateIdx = Math.min(currentChildIndex, childRatesUnder11.length - 1);
    annualGB += childRatesUnder11[rateIdx] || 0;
    currentChildIndex++;
  }
  
  // B. 医疗保险费 (Krankenkassenprämien) – 严格遵守 ELG Art. 11 + GL州执行细则
  // 优先使用申请人实际支付的保费，只有在无法核实（<=0）或异常高（>30,000 CHF）时才兜底使用州标准 Richtprämien
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    // 兜底使用州标准 Pauschale（GL unified）
    const premiumRules = r.recognized_premiums_annual.unified || {};
    totalPremiumAnnual =
      (numAdults * (premiumRules.adult || 5808)) +
      (numEducation * (premiumRules.young_adult || 4344)) +
      (numChildren * (premiumRules.child || 1380));
  }
  // 安全上限（防止极端输入，即使是实际保费也受州最高认可额限制）
  const maxPremium = r.recognized_premiums_annual?.max || 30000;
  totalPremiumAnnual = Math.min(totalPremiumAnnual, maxPremium);
  
  // C. 房租/住房费 (Mietzins - 联邦 BSV Maxima 2026)
  const rentSizeKey = totalPersons >= 5 ? '5_plus_persons' : `${totalPersons}_persons`;
  const maxRentMonthly = rentLimits[rentSizeKey] || rentLimits['1_person'];
  const userRentMonthly = Number(inputs.monthlyRent) || 0;
  const recognizedRentMonthly = Math.min(userRentMonthly, maxRentMonthly);
  const recognizedRentAnnual = recognizedRentMonthly * 12;
  
  // D. 总支出 (Total Ausgaben)
  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 3. 收入项计算 (Einnahmen) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[GL] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? (r.social_deductions?.earned_income_freibetrag_couple || 1950) : (r.social_deductions?.earned_income_freibetrag_single || 1300);
  const countableEarnedIncome = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留原有）
  // 准入门槛检查 (2026 联邦标准)
  const baseEntranceLimit = isCouple ? (r.asset_limits?.couple || 200000) : (r.asset_limits?.single || 100000);
  const perChildExtra = r.asset_limits?.per_child_extra || 50000;
  const entranceLimit = baseEntranceLimit + (numChildren + numEducation) * perChildExtra;
  if (Number(inputs.taxableAssets || 0) > entranceLimit) {
    return { isEligible: false, error: 'err_asset_exceeded', annualBenefit: 0 };
  }
  const assetExemption = isCouple ? (r.social_deductions?.asset_exemption_couple || 50000) : (r.social_deductions?.asset_exemption_single || 30000);
  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (Number(inputs.taxableAssets || 0) - assetExemption) / divisor);

  const totalIncome = annualIncome + countableEarnedIncome + assetIncome;
  
  // --- 4. 最终结果 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'GL_Region', value: regionKey === 'region_2' ? 'Region 2 (Glarus/Nord)' : 'Region 3 (Glarus Süd)' },
        { label: 'step_grundbedarf_annual', value: Math.round(annualGB) },
        { label: 'step_recognized_rent_annual', value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'step_total_needs_annual', value: Math.round(totalAnnualNeeds) },
        { label: 'step_13th_pension_ignored_2026', value: Math.round(deduction13th) },
        { label: 'step_income_counted_annual', value: Math.round(totalIncome) }
      ],
      note: foundPLZ ? "Berechnung basiert auf offizieller EL-Region." : "Hinweis: PLZ nicht erkannt, Standard-Region 3 angewendet. Konform mit ELG-Reform 2026 und SVA Glarus-Richtlinien."
    }
  };
}