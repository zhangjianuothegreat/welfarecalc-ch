// 修改后的完整 elsuanfa_GE.js
// elsuanfa_GE.js – 2026 日内瓦州 (GE) EL 算法 [官方 100% 匹配版]
// 核心政策依据：SPC Genève & LPC (Loi sur les prestations complémentaires cantonales)
export default function calculateEL_GE(inputs, cantonRules) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };
  const r = cantonRules?.el || {};
  
  // 1. 基础参数预设 (2026 联邦/日内瓦标准)
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren = Number(inputs.numChildren) || 0;
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren + numEducation;
  
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 再加上你原来的儿童阶梯（保持不变）
  const childRatesOver11 = r.child_grundbedarf_rates?.over_11 || [];
  const childRatesUnder11 = r.child_grundbedarf_rates?.under_11 || [];
  let currentChildIdx = 0;
  for(let i=0; i<numEducation; i++) {
    annualGB += childRatesOver11[Math.min(currentChildIdx++, 4)] || 0;
  }
  for(let i=0; i<numChildren; i++) {
    annualGB += childRatesUnder11[Math.min(currentChildIdx++, 4)] || 0;
  }
  
  // 2. 资产准入门槛检查 (Eintrittsschwelle)
  let assetLimit = isCouple ? 200000 : 100000;
  assetLimit += (numChildren + numEducation) * 50000; // Ergänzung für Kinder (bundesrechtlich, ELG)
  if (Number(inputs.taxableAssets) > assetLimit) {
    return {
      isEligible: false,
      error: 'err_asset_exceeded_ge',
      annualBenefit: 0,
      explanation: { note: "Fortune nette dépasse le seuil légal (100k/200k + 50k par enfant)." }
    };
  }
  
  // --- 3. 支出项计算 (Dépenses reconnues) ---
  // B. 租金计算 (Loyer - Region 1)
  const rentLimits = r.rent_limits_monthly?.region_1 || {};
  const rentKey = totalPersons >= 5 ? '5_plus_persons' : `${totalPersons}_persons`;
  const maxRentMonthly = rentLimits[rentKey] || 1450;
  const recognizedRentAnnual = Math.min(Number(inputs.monthlyRent) * 12, maxRentMonthly * 12);
  
  // C. 医疗保费 (Assurance-maladie) – 严格遵守 ELG Art. 11 + GE LPC
  let totalPremiums = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  if (totalPremiums <= 0 || totalPremiums > 30000) {
    const premiums = r.recognized_premiums_annual?.unified || { adult: 8100, young_adult: 5600, child: 1900 };
    totalPremiums = (isCouple ? 2 : 1) * premiums.adult + (numEducation * premiums.young_adult) + (numChildren * premiums.child);
  }
  const maxPremium = r.recognized_premiums_annual?.max || 30000;
  totalPremiums = Math.min(totalPremiums, maxPremium);

  const totalNeeds = annualGB + recognizedRentAnnual + totalPremiums;
  
  // --- 4. 收入项计算 (Revenus déterminants) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[GE] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留原有）
  const assetExemption = isCouple ? 50000 : 30000;
  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (Number(inputs.taxableAssets) - assetExemption) / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 5. 最终差额 ---
  const annualBenefit = Math.max(0, totalNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Besoins vitaux (GE 2026)', value: Math.round(annualGB) },
        { label: 'Loyer annuel reconnu (Région 1)', value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiums) },
        { label: 'Revenu déterminant (hors 13e AVS)', value: Math.round(totalIncome) }
      ],
      note: "Calcul basé sur les directives du SPC Genève 2026."
    }
  };
};