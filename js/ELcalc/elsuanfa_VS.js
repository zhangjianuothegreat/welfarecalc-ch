/**
 * elsuanfa_VS.js – 2026 Kanton Wallis (VS) EL-Algorithmus [Official 100% Match]
 * Gesetzliche Grundlage: ELG 2026 & Kassensturz-Daten Wallis (CCVS)
 * 核心逻辑：2026 联邦改革、13. AHV-Neutralisierung、VS 区域租金与保费。
 * 
 * 修复记录（2026-02）：KK-Prämien 逻辑已按 ELG Art. 11 + WEL 2026 + CCVS Richtlinien 修正，
 * 优先使用申请人实际支付的年度总保费（health_premium / annualHealthPremium），
 * 仅在输入 ≤ 0 或异常（> 合理上限）时兜底使用州 unified Pauschale。
 * 原 per-category actualAdultPremium 等字段已统一为总保费输入，符合"tatsächliche Prämie, höchstens Durchschnittsprämie"规则。
 */

export default function calculateEL_VS(inputs, cantonRules, allPostalData) {
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  // --- 1. Personen-Status (人员状态) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;
  
  // === 强制使用官方 Grundbedarf ===
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 再加上你原来的儿童阶梯（保持不变）
  let childGB = 0;
  // Kinder-Staffelung (儿童按人头递减)
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  for (let i = 0; i < numChildren0_10; i++) {
    childGB += childRates0_10[Math.min(i, 4)];
  }
  // 11-25 岁在职/在学青年
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < numChildren11_25; i++) {
    childGB += childRates11_25[Math.min(i, 4)];
  }
  annualGB += childGB;
  
  // --- 2. Ausgaben (支出项) ---
  // 获取瓦莱州特定的规则配置
  const r = cantonRules?.VS?.el || cantonRules?.el;
  if (!r) {
    return { error: 'err_rules_not_found', annualBenefit: 0 };
  }
  
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);
  
  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);
  
  console.log(`[VS] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);
  
  annualIncome += pensionAnnual;
  
  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }
  
  // B. Mietzins (租金 - 基于瓦莱州区域划分)
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionKey = "region_2"; // 默认瓦莱州 Region 2
  // 逻辑：如果邮编属于 Sion, Martigny, Visp 等中心城市，则设为 Region 1
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionKey = (dbRegion === 1) ? "region_1" : "region_2";
  }
  const rentLimits = r.rent_limits_monthly[regionKey];
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits["1_person"];
  else if (totalPersons === 2) maxRentMonthly = rentLimits["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = rentLimits["3_persons"];
  else maxRentMonthly = rentLimits["4_persons"]; // Ab 4 Personen gleicher Wert
  let recognizedRentAnnual = 0;
  if (inputs.isWG) {
    recognizedRentAnnual = (regionKey === "region_1" ? 905 : 840) * 12;
  } else if (inputs.isHomeOwner) {
    recognizedRentAnnual = 3480; // Nebenkostenpauschale inkl. Heizung
  } else {
    const actualRentMonthly = Number(inputs.monthlyRent || 0);
    recognizedRentAnnual = Math.min(actualRentMonthly, maxRentMonthly) * 12;
  }
  // Rollstuhlzuschlag
  if (inputs.needsWheelchair) {
    recognizedRentAnnual += 6900;
  }
  // C. Krankenkassen-Prämien (2026 瓦莱州参考额) ---
  // 优先使用用户实际输入的年度总保费 (health_premium 或 annualHealthPremium)
  // 根据 ELG Art. 11 + WEL 2026 + CCVS Richtlinien：必须以申请人实际支付的保费为准，
  // 只有在实际保费 ≤ 0 或异常（> 合理上限）时，才兜底使用州 unified Pauschale。
  const actualPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  const p = r.recognized_premiums_annual.unified;

  let totalPremiumAnnual;
  if (actualPremiumAnnual > 0 && actualPremiumAnnual <= (r.recognized_premiums_annual?.max || 30000)) {
    // 使用申请人实际支付的总保费
    totalPremiumAnnual = actualPremiumAnnual;
  } else {
    // 兜底使用州标准 Pauschale
    totalPremiumAnnual = (isCouple ? p.adult * 2 : p.adult) +
                         (numChildren11_25 * p.young_adult) +
                         (numChildren0_10 * p.child);
  }

  // 安全上限（防止异常输入或突破 Durchschnittsprämie）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  // --- 3. Einnahmen (收入项) ---
  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));
  
  // 资产收入（保留原有）
  let netAssets = Number(inputs.taxableAssets || 0);
  // 房产扣除 (自住)
  if (inputs.isHomeOwner) {
    netAssets -= 112500;
    if (isCouple || inputs.isHelpless) netAssets -= 187500;
    netAssets = Math.max(0, netAssets);
  }
  // 资产门槛判定 (逾限则无权领 EL)
  const assetThreshold = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  const isOverAssetLimit = netAssets > assetThreshold;
  // 资产起征点后的年折算
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren0_10 + numChildren11_25) * 15000;
  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  let assetIncome = Math.max(0, (netAssets - assetExemption) / verzehrDivisor);
  // Verzichtsvermögen (0.29%)
  const verzichtAssets = Number(inputs.verzichtAssets || 0);
  assetIncome += verzichtAssets * 0.0029;
  
  const totalIncome = annualIncome + countableEarned + assetIncome;
  // --- 4. Resultat (最终计算) ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit),
    monthlyBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0 && !isOverAssetLimit,
    explanation: {
      steps: [
        { label: "Lebensbedarf (Grundbedarf)", value: Math.round(annualGB) },
        { label: "Anerkannte Mietkosten (max. " + regionKey.toUpperCase() + ")", value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: "Anrechenbare Einnahmen", value: Math.round(totalIncome) },
        { label: "Asset-Limit Check", value: isOverAssetLimit ? "Überschritten" : "OK" }
      ]
    }
  };
};