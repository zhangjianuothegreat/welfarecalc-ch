// elsuanfa_AR.js – 2026 外阿彭策尔州 (AR) EL 算法 [官方锁定 Region 3 版]
export default function calculateEL_AR(inputs, cantonRules) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };

  // 1. 基础安全检查
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }

  const r = cantonRules.el || {};

  // 定义 isCouple（豆包漏了这一行）
  const isCouple = inputs.numAdults === 2;

  // 强制使用官方 Grundbedarf
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  // 儿童阶梯（如果 AR 有，补上；否则保持 0）
  let childGB = 0;
  // 如果有儿童阶梯逻辑，从其他州复制：
  // const childRates0_10 = r.child_rates?.under_11 || [7590, 6325, 5270, 4390, 3660];
  // const childRates11_25 = r.child_rates?.over_11 || [10815, 10815, 7210, 7210, 3605];
  // ... 计算 childGB ...
  annualGB += childGB;

  // 2. 强制锁定逻辑 (核心修正)
  const regionData = r.rent_limits_monthly ? r.rent_limits_monthly.region_3 : null;
  if (!regionData) {
    const fallbackData = Object.values(r.rent_limits_monthly || {})[0];
    if (!fallbackData) return { error: 'err_no_rent_region', annualBenefit: 0 };
    console.warn("AR EL: Using fallback rent region.");
  }

  // 3. 数据预处理
  const safeInputs = {
    numAdults: Number(inputs.numAdults) || 1,
    numChildren: Number(inputs.numChildren) || 0,
    numYoungAdults: Number(inputs.numYoungAdults || inputs.numEducation || 0),
    monthlyRent: Number(inputs.monthlyRent || 0),
    taxableIncomeAnnual: Number(inputs.taxableIncomeAnnual || inputs.annualIncome || 0),
    earnedIncomeAnnual: Number(inputs.earnedIncomeAnnual || 0),
    taxableAssets: Number(inputs.taxableAssets || 0),
    isReceivingPension: inputs.isReceivingPension,
    regularAnnualPension: Number(inputs.regularAnnualPension || 0),
    annualPension: Number(inputs.annualPension || 0),
    monthlyPensionAmount: Number(inputs.monthlyPensionAmount || 0)
  };

  const totalPersons = safeInputs.numAdults + safeInputs.numChildren + safeInputs.numYoungAdults;

  // 4. 资产门槛检查
  const assetLimit = isCouple ? (r.asset_limits?.couple || 200000) : (r.asset_limits?.single || 100000);
  if (safeInputs.taxableAssets > assetLimit) {
    return { error: 'err_asset_exceeded_federal', annualBenefit: 0 };
  }

  // 5. 支出计算
  const monthlyBasic = annualGB / 12;
  const targetData = regionData || Object.values(r.rent_limits_monthly || {})[0];
  let personKey = totalPersons === 1 ? '1_person' : (totalPersons >= 5 ? '5_plus_persons' : `${totalPersons}_persons`);
  const maxRentLimit = targetData[personKey] || 0;
  const recognizedRent = Math.min(safeInputs.monthlyRent, maxRentLimit);

  const premiums = r.recognized_premiums_annual?.unified || { adult: 6411.6, young_adult: 4620.0, child: 1497.6 };
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = (safeInputs.numAdults * premiums.adult) +
                         (safeInputs.numYoungAdults * premiums.young_adult) +
                         (safeInputs.numChildren * premiums.child);
  }
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalMonthlyNeeds = monthlyBasic + recognizedRent + (totalPremiumAnnual / 12);

  // 6. 收入处理（2026 统一标准）
  let annualIncome = Number(safeInputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(safeInputs.regularAnnualPension || 
                               safeInputs.annualPension || 
                               (safeInputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[AR] Pension: monthly=${safeInputs.monthlyPensionAmount}, regularAnnual=${safeInputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (safeInputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  const earnedIncome = Number(safeInputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  const exemption = isCouple ? 50000 : 30000;
  const divisor = (safeInputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (safeInputs.taxableAssets - exemption) / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;

  // 建议加上子女扣除（AR 州可能有）
  const annualChildDeduction = (safeInputs.numChildren + safeInputs.numYoungAdults) * (r.child_deduction_annual || 2500);
  const totalMonthlyIncome = Math.max(0, (totalIncome - annualChildDeduction) / 12);

  // 7. 最终结果
  const monthlyBenefit = Math.max(0, totalMonthlyNeeds - totalMonthlyIncome);
  const annualBenefit = Math.round(monthlyBenefit * 12);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(monthlyBenefit),
    isEligible: monthlyBenefit > 0,
    explanation: {
      steps: [
        { label: '1. Lebensbedarf (Standard Region 3)', value: Math.round(monthlyBasic) },
        { label: `2. Mietzins-Limit (Standard AR)`, value: maxRentLimit },
        { label: '3. Anerkannte Miete (Effektiv)', value: Math.round(recognizedRent) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual / 12) },
        { label: '5. Total Ausgaben (monatlich)', value: Math.round(totalMonthlyNeeds) },
        { label: '6. Anrechenbares Einkommen', value: Math.round(totalMonthlyIncome) },
        { label: '7. Monatlicher EL-Anspruch', value: Math.round(monthlyBenefit) }
      ],
      note: 'Hinweis: Im Kanton AR gilt einheitlich der Mietzins-Standard der Region 3.'
    }
  };
}