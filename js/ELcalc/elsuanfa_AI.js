/* elsuanfa_AI.js – 2026 最终平衡版（已强制使用官方Grundbedarf + 养老金统一处理） */
export default function calculateEL_AI(inputs, cantonRules) {
  // 基础检查
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };

  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,
    couple: 31005
  };

  const r = cantonRules.el || {};
  const isCouple = inputs.numAdults === 2;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = inputs.numAdults + numChildren + numEducation;
  if (totalPersons < 1) return { error: 'err_no_persons', annualBenefit: 0 };

  // 1. 资产门槛
  const assetLimit = isCouple ? (r.asset_limits?.couple || 200000) : (r.asset_limits?.single || 100000);
  if (inputs.taxableAssets > assetLimit) return { error: 'err_asset_exceeded', annualBenefit: 0 };

  // 2. 基本生活费 – 使用官方2026值
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  let monthlyBasic = annualGB / 12;

  // 3. 租金计算
  const region = (r.rent_limits_monthly && r.rent_limits_monthly.regions) ? r.rent_limits_monthly.regions[0] : null;
  if (!region) return { error: 'err_no_rent_region', annualBenefit: 0 };
  let rentKey;
  if (totalPersons === 1) rentKey = '1_person';
  else if (totalPersons >= 5) rentKey = '5_plus_persons';
  else rentKey = `${totalPersons}_persons`;
  const recognizedRent = Math.min(inputs.monthlyRent || 0, region[rentKey] || 0);

  // 4. 医疗保险
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  const premiums = r.recognized_premiums_annual || { adult: 5304, young_adult: 3852, child: 1248 };
  const statePremium = (inputs.numAdults * premiums.adult) +
                       (numEducation * premiums.young_adult) +
                       (numChildren * premiums.child);
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = statePremium;
  }
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);
  const monthlyPremium = totalPremiumAnnual / 12;
  const monthlyNeeds = monthlyBasic + recognizedRent + monthlyPremium;

  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || inputs.income || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[AI] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  let monthlyEarnedIncome = 0;
  if (inputs.earnedIncomeAnnual > 0) {
    const freibetrag = 1250;
    monthlyEarnedIncome = Math.max(0, (inputs.earnedIncomeAnnual / 12) - freibetrag);
  }

  const exemption = isCouple ? 50000 : 30000;
  const divisor = (inputs.pensionType === 'IV') ? 15 : 10;
  const assetIncome = Math.max(0, (inputs.taxableAssets - exemption) / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;

  const annualChildDeduction = (numChildren + numEducation) * (r.child_deduction_annual || 2500);
  const effectiveMonthlyIncome = Math.max(0, (annualIncome - annualChildDeduction) / 12) + monthlyEarnedIncome;
  const monthlyAssetIncome = assetIncome / 12;
  const totalMonthlyIncome = effectiveMonthlyIncome + monthlyAssetIncome;

  const monthlyBenefit = Math.max(0, monthlyNeeds - totalMonthlyIncome);
  const annualBenefit = Math.round(monthlyBenefit * 12);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(monthlyBenefit),
    explanation: {
      steps: [
        { label: 'step_grundbedarf', value: Math.round(monthlyBasic) },
        { label: 'step_recognized_rent', value: Math.round(recognizedRent) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(monthlyPremium) },
        { label: 'step_total_needs_monthly', value: Math.round(monthlyNeeds) },
        { label: 'step_pension_annual_used', value: Math.round(pensionAnnual) },
        { label: 'step_13th_pension_ignored_2026', value: Math.round(deduction13th) },
        { label: 'step_child_deduction_monthly', value: Math.round(annualChildDeduction / 12) },
        { label: 'step_asset_income_monthly', value: Math.round(monthlyAssetIncome) },
        { label: 'step_available_income_monthly', value: Math.round(totalMonthlyIncome) }
      ],
      note_key: 'AI_el_note_standard'
    }
  };
}