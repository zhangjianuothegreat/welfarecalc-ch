/**
 * elsuanfa_SG.js – 2026 Kanton St. Gallen (SG) EL-Algorithmus [Official 100% Match]
 * 核心逻辑：2026 联邦 EL 改革、13th AHV 中性化、SG 三分法区域匹配。
 */
export default function calculateEL_SG(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  const r = cantonRules.el || {};
  
  // --- 1. 区域判定 (Region via PLZ) ---
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 3; // 默认 Region 3
  let foundPLZ = false;
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    regionNumber = allPostalData[userPLZ].EL_REGION || 3;
    foundPLZ = true;
  }
  const regionKey = `region_${regionNumber}`;
  const premiumKey = regionNumber === 1 ? "region1_high" : (regionNumber === 2 ? "region2_medium" : "region3_low");
  
  // --- 2. 生活基准额 (Grundbedarf 2026) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 儿童阶梯扣减（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  let childGB = 0;
  for (let i = 0; i < numChildren0_10; i++) {
    childGB += childRates0_10[Math.min(i, 4)];
  }
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < numChildren11_25; i++) {
    childGB += childRates11_25[Math.min(i, 4)];
  }
  annualGB += childGB; // 将儿童生活费加到总生活基准额中
  
  // --- 3. 租金计算 (Miete) ---
  const rentLimits = r.rent_limits_monthly[regionKey];
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;
  
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits["1_person"];
  else if (totalPersons === 2) maxRentMonthly = rentLimits["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = rentLimits["3_persons"];
  else if (totalPersons === 4) maxRentMonthly = rentLimits["4_persons"];
  else maxRentMonthly = rentLimits["5_plus_persons"];
  const actualRentMonthly = Number(inputs.monthlyRent) || 0;
  let recognizedRentAnnual = Math.min(actualRentMonthly, maxRentMonthly) * 12;
  // 自住房杂费
  if (inputs.isHomeOwner) {
    recognizedRentAnnual = 3480;
  }
  // 轮椅适配住房补充 (2026 标准)
  if (inputs.isWheelchairAccessible === true) {
    recognizedRentAnnual += 6900;
  }
  
  // --- 4. 医保保费 (KK-Pauschale 2026) ---
  const p = r.recognized_premiums_annual[premiumKey];
  const statePremiumAnnual = (isCouple ? 2 : 1) * p.adult
                           + numChildren11_25 * p.young_adult
                           + numChildren0_10 * p.child;
  let userPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  let totalPremiumAnnual = (userPremiumAnnual > 0 && userPremiumAnnual <= 30000) ? userPremiumAnnual : statePremiumAnnual;
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);
  
  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 5. 资产准入门槛检查 ---
  const assetThreshold = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  const netAssets = Number(inputs.taxableAssets) || 0;
  if (netAssets > assetThreshold) {
    return { isEligible: false, error: 'err_asset_exceeded_sg', annualBenefit: 0 };
  }
  
  // --- 6. 可计算收入 (Einnahmen) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[SG] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

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
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren0_10 + numChildren11_25) * 15000;
  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (netAssets - assetExemption) / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 7. 最终计算 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Grundbedarf (inkl. Kinder)', value: Math.round(annualGB) },
        { label: `Mietzinsmaximum (Region ${regionNumber})`, value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen', value: Math.round(totalIncome) }
      ],
      region: regionNumber,
      note: "Basierend auf den offiziellen Richtlinien der SVA St. Gallen für das Jahr 2026."
    }
  };
}